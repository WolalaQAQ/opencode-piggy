// @ts-check
/** OpenCode 模式的宿主代理：主线程不持有 Store，也不执行工作事件的同步落盘。 */
import { Worker } from 'node:worker_threads'

/** @param {{directory:string,bridgeDirectory?:string,statePath:string,gameDir:string,fetch?:typeof globalThis.fetch,
 * onSnapshot?:(view:any)=>void,announce:()=>void,quit?:()=>void,log:(message:string)=>void}} options
 */
export async function startWorkHost(options) {
  const worker = new Worker(new URL('./work-host-worker.js', import.meta.url), {
    workerData: { directory: options.directory, bridgeDirectory: options.bridgeDirectory,
      statePath: options.statePath, gameDir: options.gameDir },
  })
  const pending = new Map()
  const fetches = new Map()
  let sequence = 0
  let closing = null
  let hasClosed = false
  let failure = null
  let resolveReady, rejectReady
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject })

  function fail(error) {
    failure = error
    rejectReady(error)
    for (const task of pending.values()) task.reject(error)
    pending.clear()
    for (const controller of fetches.values()) controller.abort()
    fetches.clear()
    if (!hasClosed) options.log('work host stopped; unacknowledged events remain in bridge')
  }

  function request(method, args = []) {
    if (failure) return Promise.reject(failure)
    if (hasClosed || (closing && method !== 'dispose')) return Promise.reject(new Error('work host closed'))
    return new Promise((resolve, reject) => {
      const id = ++sequence
      pending.set(id, { resolve, reject })
      try { worker.postMessage({ kind: 'request', id, method, args }) } catch (error) { pending.delete(id); reject(error) }
    })
  }

  /** 扩展下载仍走原 Chromium net.fetch 和系统代理，signal 在两端转成取消消息。 */
  async function forwardFetch(message) {
    const controller = new AbortController()
    fetches.set(message.id, controller)
    try {
      const response = await (options.fetch ?? globalThis.fetch)(message.url, { ...message.init, signal: controller.signal })
      const body = await response.arrayBuffer()
      const headers = []
      response.headers.forEach((value, key) => headers.push([key, value]))
      worker.postMessage({ kind: 'fetch-result', id: message.id, status: response.status,
        headers, body }, [body])
    } catch (error) {
      worker.postMessage({ kind: 'fetch-result', id: message.id, error: controller.signal.aborted ? 'fetch aborted' : 'fetch failed' })
    } finally { fetches.delete(message.id) }
  }

  worker.on('message', message => {
    if (message.kind === 'ready') resolveReady(undefined)
    else if (message.kind === 'startup-error') fail(new Error('work host startup failed; evidence preserved'))
    else if (message.kind === 'response') {
      const task = pending.get(message.id)
      if (!task) return
      pending.delete(message.id)
      if (message.error) task.reject(new Error(message.error))
      else task.resolve(message.value)
    } else if (message.kind === 'snapshot') options.onSnapshot?.(message.value)
    else if (message.kind === 'changed') options.announce()
    else if (message.kind === 'disconnect') options.quit?.()
    else if (message.kind === 'log') options.log(message.value)
    else if (message.kind === 'fetch') void forwardFetch(message).catch(() => options.log('work host fetch transport failed'))
    else if (message.kind === 'cancel-fetch') fetches.get(message.id)?.abort()
  })
  worker.on('error', () => fail(new Error('work host worker failed; evidence preserved')))
  worker.on('exit', () => { if (!hasClosed) fail(new Error('work host exited; evidence preserved')) })

  try { await ready } catch (error) { await worker.terminate(); throw error }
  return {
    handle: (method, url, body) => request('handle', [method, url, body]),
    store: { journal: { record: (...args) => {
      if (!closing && !failure) void request('record', args).catch(() => options.log('work host journal transport failed'))
    } } },
    dispose() {
      if (closing) return closing
      closing = request('dispose').then(async () => {
        hasClosed = true
        for (const controller of fetches.values()) controller.abort()
        await worker.terminate()
      })
      return closing
    },
  }
}
