// @ts-check
/** 原生 V2 薄插件：装饰通道独立启动、订阅与清理，不注册工具、不触碰模型上下文。 */
import { isAbsolute } from 'node:path'
import { bridgeDirectory } from '../opencode-bridge/paths.js'
import { createBridgeClient } from './bridge-client.js'
import { createBridgeLauncher } from './standalone-launcher.js'
import { createEventAdapter } from './event-adapter.js'

/** @typedef {{directory?:string,nodeExecutable?:string,autoStart?:boolean}} PiggyOptions */
/** @typedef {{app:{version:string},location:{directory:string,workspaceID?:string},options?:unknown,
 * event:{subscribe:(options:{signal:AbortSignal})=>AsyncIterable<unknown>},
 * session?:{get:(input:{sessionID:string},options?:{signal:AbortSignal})=>Promise<unknown>}}} PiggyContext */

/** 不展开异常或来源元数据，日志函数自身失败也不传播到 OpenCode。 */
function createSafeLog(write) {
  return message => {
    try { write(`[opencode-piggy] ${message}`) } catch (error) {
      console.warn('[opencode-piggy] diagnostic logging failed')
    }
  }
}

/** @param {unknown} value @returns {PiggyOptions} */
function validateOptions(value) {
  if (value === undefined) return {}
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid options')
  const options = /** @type {Record<string,unknown>} */ (value)
  for (const [key, option] of Object.entries(options)) {
    if (key === 'directory' || key === 'nodeExecutable') {
      if (typeof option !== 'string' || !option.trim() || option.includes('\0') || !isAbsolute(option)) throw new Error('invalid path option')
    } else if (key === 'autoStart') {
      if (typeof option !== 'boolean') throw new Error('invalid boolean option')
    } else throw new Error('unknown option')
  }
  return options
}

/** @param {PiggyContext} ctx @returns {void} */
function validateContext(ctx) {
  const version = /^v?(2)\.(\d+)\.(\d+)(?:[-+][\w.-]+)?$/.exec(ctx?.app?.version ?? '')
  // 固定验证的是 2.0.26 的工具终态和公共流契约，不能假定早期 V2 同样兼容。
  if (!version || (Number(version[2]) === 0 && Number(version[3]) < 26)) throw new Error('unsupported runtime')
  if (typeof ctx.location?.directory !== 'string' || !isAbsolute(ctx.location.directory)
    || typeof ctx.event?.subscribe !== 'function') throw new Error('invalid V2 context')
}

/** 取消重连等待时清理自己的定时器，绝不查询或重演历史事件。 */
function waitForReconnect(milliseconds, signal) {
  if (signal.aborted) return Promise.resolve()
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(undefined) }
    const timer = setTimeout(finish, milliseconds)
    timer.unref?.()
    signal.addEventListener('abort', finish, { once: true })
  })
}

/** 入队失败撤销本实例缓存，若同一真实事件再次到达，仍可交由后端持久去重。 */
async function enqueueEvent({ event, controller, adapter, client, log }) {
  let mapped
  try {
    mapped = await adapter.map(event)
    if (mapped && !controller.signal.aborted && await client.enqueue(mapped) === false) {
      throw new Error('bridge rejected event enqueue')
    }
  } catch (error) {
    if (mapped) adapter.forget(mapped.id)
    log('event mapping or enqueue failed')
  }
}

/** 流和单个映射/入队错误分开隔离；只重新订阅仍存活的公共流。 */
async function consumeEvents({ ctx, controller, adapter, client, log, wait }) {
  let failures = 0
  while (!controller.signal.aborted) {
    try {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        if (controller.signal.aborted) break
        failures = 0
        await enqueueEvent({ event, controller, adapter, client, log })
      }
      if (!controller.signal.aborted) log('event stream ended; reconnecting live subscription')
    } catch (error) {
      if (!controller.signal.aborted) log('event stream failed; reconnecting live subscription')
    }
    if (controller.signal.aborted) return
    await wait(Math.min(30000, 1000 * 2 ** Math.min(failures++, 5)), controller.signal)
  }
}

/** 工厂只用于注入无 IO 测试依赖；正式入口仍是原生 {id,setup}。
 * @param {{createClient?:typeof createBridgeClient,createWake?:typeof createBridgeLauncher,log?:(message:string)=>void,wait?:typeof waitForReconnect}} [dependencies]
 * @returns {{id:string,setup:(ctx:PiggyContext)=>Promise<()=>Promise<void>>}}
 */
export function createPiggyPlugin(dependencies = {}) {
  const log = createSafeLog(dependencies.log ?? (message => console.warn(message)))

  /** @param {PiggyContext} ctx @returns {Promise<()=>Promise<void>>} */
  async function setup(ctx) {
    const controller = new AbortController()
    let client, adapter, running
    let closing
    async function closeResources() {
      controller.abort()
      try { await running } catch (error) { log('event stream cleanup failed') }
      try { await client?.close() } catch (error) { log('bridge cleanup failed') }
      adapter?.clear()
    }
    const cleanup = () => closing ??= closeResources()
    try {
      validateContext(ctx)
      const options = validateOptions(ctx.options)
      const directory = bridgeDirectory(options)
      const wake = (dependencies.createWake ?? createBridgeLauncher)({ ...options, directory })
      client = (dependencies.createClient ?? createBridgeClient)({ directory, wake, standalone: true,
        log: () => log('bridge operation failed') })
      adapter = createEventAdapter({ location: ctx.location, log,
        fetchSession: ctx.session?.get ? sessionID => ctx.session.get({ sessionID }, { signal: controller.signal }) : undefined })
      await client.start()
      running = consumeEvents({ ctx, controller, adapter, client, log, wait: dependencies.wait ?? waitForReconnect })
        .catch(error => { log('event worker failed'); controller.abort() })
    } catch (error) {
      log('plugin startup failed; decoration disabled')
      await cleanup()
    }
    return cleanup
  }

  return { id: 'opencode-piggy', setup }
}

export default createPiggyPlugin()
