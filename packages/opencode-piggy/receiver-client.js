// @ts-check
/** 游戏侧只主动连接独立桥；应用与存档由调用者的唯一游戏宿主负责。 */
import { randomBytes } from 'node:crypto'
import { lstat, open } from 'node:fs/promises'
import { request } from 'node:http'
import { join } from 'node:path'
import { verifyPrivateWorkFileAsync } from '../opencode-bridge/files.js'
import { validateWorkEvent } from '../opencode-bridge/protocol.js'

const JSON_LIMIT = 1024
const REQUEST_MS = 1500
const POLL_MS = 5000

/** @param {{directory:string,receive:(event:import('../opencode-bridge/protocol.js').WorkEvent)=>any,
 * log?:(message:string)=>void}} options */
export function createReceiverClient(options) {
  const id = randomBytes(32).toString('hex')
  let endpoint = null
  let verifiedFile = ''
  let isClosed = false
  let timer = null
  let inFlight = null
  let closing = null

  async function discover() {
    const path = join(options.directory, 'bridge.json')
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || info.size > JSON_LIMIT) throw new Error('invalid bridge discovery')
    const identity = `${info.dev}:${info.ino}:${info.mtimeMs}:${info.ctimeMs}:${info.size}`
    if (identity !== verifiedFile) { await verifyPrivateWorkFileAsync(path); verifiedFile = identity }
    const file = await open(path, 'r')
    let value
    try {
      const buffer = Buffer.alloc(JSON_LIMIT + 1)
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
      if (bytesRead > JSON_LIMIT) throw new Error('invalid bridge discovery')
      value = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'))
    } finally { await file.close() }
    if (value?.version !== 1 || value.role !== 'opencode-bridge' || !Number.isInteger(value.port) ||
      value.port < 1 || value.port > 65535 || !/^[a-f0-9]{64}$/.test(value.token) ||
      !Number.isSafeInteger(value.pid) || value.pid <= 0) throw new Error('invalid bridge discovery')
    return value
  }

  function send(target, method, path, body) {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(body)
      const req = request({ hostname: '127.0.0.1', port: target.port, method, path, agent: false,
        maxHeaderSize: 4096, headers: { authorization: `Bearer ${target.token}`,
          'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } }, response => {
        const chunks = []
        let size = 0
        response.on('data', chunk => {
          size += chunk.length
          if (size > JSON_LIMIT) req.destroy(new Error('invalid bridge response'))
          else chunks.push(chunk)
        })
        response.on('error', reject)
        response.on('end', () => {
          try {
            if (response.statusCode !== 200 || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(response.headers['content-type'] ?? '')) {
              throw new Error('receiver request rejected')
            }
            const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            const keys = path === '/receiver/poll' ? 'events,ok' : 'ok'
            if (value?.ok !== true || Object.keys(value).sort().join(',') !== keys) throw new Error('invalid bridge response')
            resolve(value)
          } catch (error) { reject(error) }
        })
      })
      const deadline = setTimeout(() => req.destroy(new Error('receiver timeout')), REQUEST_MS)
      req.once('close', () => clearTimeout(deadline))
      req.on('error', reject)
      req.end(payload)
    })
  }

  async function drain() {
    endpoint = await discover()
    while (!isClosed) {
      const response = /** @type {{ok:true,events:unknown[]}} */ (await send(endpoint, 'POST', '/receiver/poll', { id }))
      if (!Array.isArray(response.events) || response.events.length > 1) throw new Error('invalid receiver event batch')
      if (!response.events.length || isClosed) return
      const event = response.events[0]
      validateWorkEvent(event, Date.now())
      // receive 只有完成游戏侧持久事务才能返回；桥入队 ACK 不代表奖励已经应用。
      await options.receive(event)
      await send(endpoint, 'POST', '/receiver/ack', { receiver: id, id: event.id, at: event.at })
    }
  }

  function flush() {
    if (isClosed) return closing ?? Promise.resolve()
    if (!inFlight) inFlight = drain().catch(() => {
      if (!isClosed) options.log?.('work receiver unavailable; pending events remain in bridge')
    }).finally(() => { inFlight = null })
    return inFlight
  }

  return {
    start() {
      if (isClosed || timer) return
      void flush()
      timer = setInterval(() => void flush(), POLL_MS)
      timer.unref?.()
    },
    flush,
    close() {
      if (closing) return closing
      isClosed = true
      clearInterval(timer)
      // 不打断已开始的游戏事务和 ACK；等待有绝对截止时间的在途请求完成。
      closing = (async () => {
        await inFlight
        if (endpoint) {
          try { await send(endpoint, 'DELETE', '/receiver/lease', { id }) }
          catch (error) { options.log?.('work receiver lease cleanup failed') }
        }
      })()
      return closing
    },
  }
}
