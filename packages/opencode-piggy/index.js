// @ts-check
/** 自包含 V2 插件：异步保存工作事件并投递官方工作事件 HTTP。 */
import { isAbsolute } from 'node:path'
import { pluginDirectory, gameDirectories } from './paths.js'
import { retainDirectClient } from './direct-client.js'
import { createEventAdapter } from './event-adapter.js'

/** @typedef {{directory?:string,gameDirectory?:string}} PiggyOptions */
/** @typedef {{app:{version:string},location:{directory:string,workspaceID?:string},options?:unknown,
 * event:{subscribe:(options:{signal:AbortSignal})=>AsyncIterable<unknown>},
 * session?:{get:(input:{sessionID:string},options?:{signal:AbortSignal})=>Promise<unknown>}}} PiggyContext */

/** 不展开异常或来源元数据，日志函数自身失败也不传播到 OpenCode。 */
function createSafeLog(write) {
  return message => {
    try { write(`[opencode-piggy] ${message}`) } catch (error) {
      console.warn('[opencode-piggy] 诊断日志写入失败')
    }
  }
}

/** @param {unknown} value @returns {PiggyOptions} */
function validateOptions(value) {
  if (value === undefined) return {}
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('插件选项无效')
  const options = /** @type {Record<string,unknown>} */ (value)
  for (const [key, option] of Object.entries(options)) {
    if (key !== 'directory' && key !== 'gameDirectory') throw new Error('未知插件选项')
    if (typeof option !== 'string' || !option.trim() || option.includes('\0') || !isAbsolute(option)) throw new Error('路径选项无效')
  }
  return options
}

/** @param {PiggyContext} ctx @returns {void} */
function validateContext(ctx) {
  const version = /^v?(2)\.(\d+)\.(\d+)(?:[-+][\w.-]+)?$/.exec(ctx?.app?.version ?? '')
  // 固定验证的是 2.0.26 的工具终态和公共流契约，不能假定早期 V2 同样兼容。
  if (!version || (Number(version[2]) === 0 && Number(version[3]) < 26)) throw new Error('OpenCode 版本不支持')
  if (typeof ctx.location?.directory !== 'string' || !isAbsolute(ctx.location.directory)
    || typeof ctx.event?.subscribe !== 'function') throw new Error('V2 插件上下文无效')
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
      throw new Error('插件发件箱拒收事件')
    }
  } catch (error) {
    if (mapped) adapter.forget(mapped.id)
    log('事件映射或入队失败')
  }
}

/** 流和单个映射/入队错误分开隔离；只重新订阅仍存活的公共流。 */
async function consumeEvents({ ctx, controller, adapter, client, log }) {
  let failures = 0
  while (!controller.signal.aborted) {
    try {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        if (controller.signal.aborted) break
        failures = 0
        await enqueueEvent({ event, controller, adapter, client, log })
      }
      if (!controller.signal.aborted) log('公共事件流结束，正在重连')
    } catch (error) {
      if (!controller.signal.aborted) log('公共事件流订阅失败，正在重连')
    }
    if (controller.signal.aborted) return
    await waitForReconnect(Math.min(30000, 1000 * 2 ** Math.min(failures++, 5)), controller.signal)
  }
}

const log = createSafeLog(message => console.warn(message))

/** @param {PiggyContext} ctx @returns {Promise<()=>Promise<void>>} */
async function setup(ctx) {
  const controller = new AbortController()
  let adapter, running, releaseClient
  let closing
  async function closeResources() {
    controller.abort()
    try { await running } catch (error) { log('事件流清理失败') }
    try { await releaseClient?.() } catch (error) { log('投递器清理失败') }
    adapter?.clear()
  }
  const cleanup = () => closing ??= closeResources()
  try {
    validateContext(ctx)
    const options = validateOptions(ctx.options)
    const retained = await retainDirectClient({ directory: pluginDirectory(options),
      gameDirectory: gameDirectories(options), log })
    releaseClient = retained.release
    adapter = createEventAdapter({ location: ctx.location, log,
      fetchSession: ctx.session?.get ? sessionID => ctx.session.get({ sessionID }, { signal: controller.signal }) : undefined })
    running = consumeEvents({ ctx, controller, adapter, client: retained.client, log })
      .catch(error => { log('事件消费任务失败'); controller.abort() })
  } catch (error) {
    log('插件启动失败，已停止联动')
    await cleanup()
  }
  return cleanup
}

export default { id: 'opencode-piggy', setup }
