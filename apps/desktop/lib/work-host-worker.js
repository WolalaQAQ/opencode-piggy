// @ts-check
/** 原宿主、接收器和游戏 WAL 共用后台单写者；独立桥不在此进程内启动。 */
import { parentPort, workerData } from 'node:worker_threads'
import { startHost } from './host.js'
import { recoverOpenCodeWork, startOpenCodeWork } from './opencode-mode.js'

if (!parentPort) throw new Error('work host requires a parent port')
const port = parentPort
const pendingFetches = new Map()
const tasks = new Set()
let fetchSequence = 0
let host, bridge
let isClosing = false

/** @type {typeof globalThis.fetch} */
const fetchFromMain = (input, init = {}) => new Promise((resolve, reject) => {
  const id = ++fetchSequence
  const signal = init.signal
  if (signal?.aborted) { reject(new Error('fetch aborted')); return }
  const cancel = () => {
    pendingFetches.delete(id)
    signal?.removeEventListener('abort', cancel)
    port.postMessage({ kind: 'cancel-fetch', id })
    reject(new Error('fetch aborted'))
  }
  pendingFetches.set(id, { resolve, reject, release: () => signal?.removeEventListener('abort', cancel) })
  signal?.addEventListener('abort', cancel, { once: true })
  const { signal: ignoredSignal, ...settings } = init
  const headers = []
  new Headers(init.headers).forEach((value, key) => headers.push([key, value]))
  port.postMessage({ kind: 'fetch', id, url: String(input), init: { ...settings, headers } })
})

async function handleRequest(message) {
  if (isClosing) throw new Error('work host closed')
  if (message.method === 'dispose') {
    isClosing = true
    await bridge.close()
    await Promise.allSettled([...tasks])
    host.dispose()
    return undefined
  }
  if (message.method === 'handle') return host.handle(...message.args)
  if (message.method === 'record') { host.store.journal?.record(...message.args); return undefined }
  throw new Error('unknown work host request')
}

port.on('message', message => {
  if (message.kind === 'fetch-result') {
    const task = pendingFetches.get(message.id)
    if (!task) return
    pendingFetches.delete(message.id)
    task.release()
    if (message.error) task.reject(new Error(message.error))
    else task.resolve(new Response([101, 204, 205, 304].includes(message.status) ? null : message.body,
      { status: message.status, headers: message.headers }))
    return
  }
  if (message.kind !== 'request') return
  const running = handleRequest(message).then(value => {
    port.postMessage({ kind: 'response', id: message.id, value })
  }, () => {
    port.postMessage({ kind: 'response', id: message.id, error: 'work host request failed; evidence preserved' })
  }).finally(() => tasks.delete(running))
  // dispose 自身不能等待自己；关闭期间不再接受新的路由。
  if (message.method !== 'dispose') tasks.add(running)
})

try {
  await recoverOpenCodeWork(workerData)
  host = await startHost(workerData.gameDir, workerData.statePath, {
    fetch: fetchFromMain, onSnapshot: value => port.postMessage({ kind: 'snapshot', value }),
  })
  bridge = await startOpenCodeWork({ ...workerData, host,
    announce: () => port.postMessage({ kind: 'changed' }),
    log: value => port.postMessage({ kind: 'log', value }),
  })
  port.postMessage({ kind: 'ready' })
} catch (error) {
  host?.dispose()
  port.postMessage({ kind: 'startup-error' })
}
