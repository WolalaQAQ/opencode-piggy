// @ts-check
/** 独立 Node 桥只收事件元数据，不导入或启动桌宠及游戏存档模块。 */
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { removeWorkFile, writeWorkJson } from './files.js'
import { acquireBridgeLock } from './lock.js'
import { openBridgeQueue } from './queue.js'
import { WORK_ID, validateLease, validateWorkEvent, workError } from './protocol.js'

const BODY_LIMIT = 16 * 1024
const REQUEST_TIMEOUT_MS = 10000
const LEASE_TTL_MS = 90 * 1000
const LEASE_LIMIT = 20000

/** @param {import('node:http').ServerResponse} response @param {number} status @param {unknown} body */
function send(response, status, body) {
  if (response.destroyed || response.writableEnded) return
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  response.end(JSON.stringify(body))
}

/** @param {import('node:http').IncomingMessage} request @param {{host:string,token:string}} expected */
function authorize(request, expected) {
  const counts = new Map()
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const name = request.rawHeaders[index].toLowerCase()
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  if (counts.has('origin')) throw workError('origin forbidden', 403)
  if (counts.get('host') !== 1 || request.headers.host !== expected.host) throw workError('invalid host', 403)
  if (counts.get('authorization') !== 1) throw workError('unauthorized', 401)
  const provided = Buffer.from(request.headers.authorization ?? '')
  const wanted = Buffer.from(`Bearer ${expected.token}`)
  if (provided.length !== wanted.length || !timingSafeEqual(provided, wanted)) throw workError('unauthorized', 401)
  if (counts.has('content-encoding')) throw workError('content encoding forbidden', 415)
  if ((counts.get('content-type') ?? 0) > 1) throw workError('invalid content type', 415)
}

/** @param {import('node:http').IncomingMessage} request @returns {Promise<unknown>} */
async function readBody(request) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '')) {
    throw workError('json required', 415)
  }
  const length = request.headers['content-length']
  if (length !== undefined && !/^\d+$/.test(length)) throw workError('invalid content length', 400)
  if (Number(length ?? 0) > BODY_LIMIT) throw workError('body too large', 413)
  const timer = setTimeout(() => request.destroy(workError('request timeout', 408)), REQUEST_TIMEOUT_MS)
  const chunks = []
  let size = 0
  try {
    for await (const chunk of request) {
      size += chunk.length
      if (size > BODY_LIMIT) throw workError('body too large', 413)
      chunks.push(chunk)
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch {
      throw workError('invalid json', 400)
    }
  } finally { clearTimeout(timer) }
}

/** @param {unknown} value @returns {{receiver:string,id:string,at:number}} */
function validateAck(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw workError('invalid ack', 400)
  const ack = /** @type {Record<string, any>} */ (value)
  if (Object.keys(ack).sort().join(',') !== 'at,id,receiver' || typeof ack.receiver !== 'string' ||
      !WORK_ID.test(ack.receiver) || typeof ack.id !== 'string' || !WORK_ID.test(ack.id) ||
      !Number.isSafeInteger(ack.at) || ack.at < 0) throw workError('invalid ack', 400)
  return /** @type {{receiver:string,id:string,at:number}} */ (ack)
}

/**
 * @param {{directory:string, log?:(message:string)=>void, onIdle?:()=>unknown, now?:()=>number}} options
 * @returns {Promise<{endpoint:string,close:()=>Promise<void>}>}
 */
export async function startStandaloneBridge({ directory, log = () => {}, onIdle, now = Date.now }) {
  const releaseLock = await acquireBridgeLock(directory)
  let server
  try {
    const queue = await openBridgeQueue({ directory, now })
    const token = randomBytes(32).toString('hex')
    const discoveryPath = join(directory, 'bridge.json')
    const leases = new Map()
    const startupDeadline = now() + LEASE_TTL_MS
    let hadProducer = false
    let receiver = null
    let closing = false
    let closePromise = null
    let idleScheduled = false
    let expected = { host: '', token }
    const inFlight = new Set()

    function expireLeases() {
      const nowMs = now()
      for (const [id, expires] of leases) if (expires <= nowMs) leases.delete(id)
      if (receiver && receiver.expires <= nowMs) receiver = null
    }

    function isIdle() {
      return leases.size === 0 && (hadProducer || now() >= startupDeadline)
    }

    function scheduleIdle() {
      expireLeases()
      if (closing || idleScheduled || !isIdle()) return
      idleScheduled = true
      setImmediate(() => {
        idleScheduled = false
        expireLeases()
        // 退出前重新核对；此前排队的退出不能误关刚续租或注册的新生产者。
        if (closing || !isIdle()) return
        close().then(() => onIdle?.()).catch(() => log('独立桥空闲关闭失败'))
      })
    }

    /** @param {string} id */
    function requireReceiver(id) {
      expireLeases()
      if (!receiver || receiver.id !== id) throw workError('receiver lease required', 409)
    }

    /** @param {import('node:http').IncomingMessage} request @param {import('node:http').ServerResponse} response */
    async function handle(request, response) {
      authorize(request, expected)
      if (closing) throw workError('bridge closing', 503)
      expireLeases()
      if (request.method === 'GET' && request.url === '/health') {
        if (request.headers['transfer-encoding'] || Number(request.headers['content-length'] ?? 0) !== 0) {
          throw workError('unexpected body', 400)
        }
        return send(response, 200, { ok: true, role: 'opencode-bridge', queued: queue.queued, receiver: receiver !== null })
      }
      const isEvent = request.method === 'POST' && request.url === '/events'
      const isLease = (request.method === 'POST' || request.method === 'DELETE') && request.url === '/lease'
      const isPoll = request.method === 'POST' && request.url === '/receiver/poll'
      const isAck = request.method === 'POST' && request.url === '/receiver/ack'
      const isRelease = request.method === 'DELETE' && request.url === '/receiver/lease'
      if (!isEvent && !isLease && !isPoll && !isAck && !isRelease) throw workError('not found', 404)
      const body = await readBody(request)
      if (closing) throw workError('bridge closing', 503)
      expireLeases()
      if (isEvent) {
        validateWorkEvent(body, now())
        const result = await queue.enqueue(body)
        return send(response, 200, { ok: true, duplicate: result.duplicate })
      }
      if (isAck) {
        const ack = validateAck(body)
        requireReceiver(ack.receiver)
        await queue.acknowledge(ack.receiver, ack.id, ack.at, () => requireReceiver(ack.receiver))
        return send(response, 200, { ok: true })
      }
      const id = validateLease(body)
      if (isLease) {
        if (request.method === 'DELETE') leases.delete(id)
        else {
          if (!leases.has(id) && leases.size >= LEASE_LIMIT) throw workError('lease capacity reached', 429)
          leases.set(id, now() + LEASE_TTL_MS)
          hadProducer = true
        }
        send(response, 200, { ok: true })
        scheduleIdle()
        return
      }
      if (isRelease) {
        if (receiver && receiver.id === id) receiver = null
        return send(response, 200, { ok: true })
      }
      if (receiver && receiver.id !== id) throw workError('receiver busy', 409)
      receiver = { id, expires: now() + LEASE_TTL_MS }
      const events = await queue.poll(id, () => requireReceiver(id))
      requireReceiver(id)
      return send(response, 200, { ok: true, events })
    }

    server = createServer({ maxHeaderSize: BODY_LIMIT }, (request, response) => {
      const pending = handle(request, response).catch(error => {
        const status = Number.isInteger(error?.status) ? error.status : 503
        if (status === 503) log('独立桥请求处理失败')
        if (!response.headersSent) send(response, status, { ok: false, reason: status === 503 ? 'unavailable' : error.message })
        request.resume()
      }).finally(() => inFlight.delete(pending))
      inFlight.add(pending)
    })
    server.requestTimeout = REQUEST_TIMEOUT_MS
    server.headersTimeout = REQUEST_TIMEOUT_MS
    server.timeout = REQUEST_TIMEOUT_MS
    server.keepAliveTimeout = 5000
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(undefined) })
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('独立桥缺少监听地址')
    expected = { host: `127.0.0.1:${address.port}`, token }
    const endpoint = `http://${expected.host}`
    writeWorkJson(discoveryPath, { version: 1, role: 'opencode-bridge', port: address.port, token, pid: process.pid })
    const interval = setInterval(scheduleIdle, 1000)
    interval.unref()

    /** 先停止接收并等候已在执行的持久化，再移除自己的发现文件及进程锁。 */
    function close() {
      if (closePromise) return closePromise
      closing = true
      clearInterval(interval)
      closePromise = (async () => {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve(undefined)))
        await Promise.allSettled([...inFlight])
        await queue.drain()
        const current = JSON.parse(await readFile(discoveryPath, 'utf8').catch(error => {
          if (error?.code === 'ENOENT') return 'null'
          throw error
        }))
        if (current?.token === token && current?.role === 'opencode-bridge') removeWorkFile(discoveryPath)
        await releaseLock()
      })()
      server.closeIdleConnections()
      return closePromise
    }
    return { endpoint, close }
  } catch (error) {
    if (server?.listening) {
      const stopped = new Promise(resolve => server.close(resolve))
      server.closeAllConnections()
      await stopped
    }
    await releaseLock()
    throw error
  }
}
