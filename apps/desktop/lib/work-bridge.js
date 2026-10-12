// @ts-check
/** 独立的 loopback 工作事件桥，不转发游戏路由；发现文件与令牌只留本机私有目录。 */
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { readWorkJson, removeWorkFile, secureWorkDirectory, writeWorkJson } from './work-files.js'
import { validateLease, validateWorkEvent, workError } from './work-protocol.js'

const BODY_LIMIT = 16 * 1024
const LEASE_TTL_MS = 90 * 1000
const LEASE_LIMIT = 20000

function send(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  response.end(JSON.stringify(body))
}

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
}

async function readBody(request) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '')) {
    throw workError('json required', 415)
  }
  if (Number(request.headers['content-length'] ?? 0) > BODY_LIMIT) throw workError('body too large', 413)
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > BODY_LIMIT) throw workError('body too large', 413)
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch (error) {
    throw workError('invalid json', 400)
  }
}

/**
 * @param {{directory: string, receive: (event: import('./work-protocol.js').WorkEvent) => any,
 * onDisconnect?: () => any, now?: () => number, log?: (message: string) => void}} options
 * @returns {Promise<{endpoint: string, close: () => Promise<void>}>}
 */
export async function startWorkBridge(options) {
  const { directory, receive, onDisconnect, now = Date.now, log = () => {} } = options
  secureWorkDirectory(directory)
  const token = randomBytes(32).toString('hex')
  const discoveryPath = join(directory, 'bridge.json')
  // 旧发现文件可能有独立 ACL；拒绝异主、公开或链接文件，不能直接覆盖。
  readWorkJson(discoveryPath)
  const leases = new Map()
  let hasLeased = false
  let isClosed = false
  let expected = { host: '', token }

  function expireLeases() {
    const nowMs = now()
    for (const [id, expiresAt] of leases) if (expiresAt <= nowMs) leases.delete(id)
    if (!hasLeased || leases.size !== 0 || isClosed) return
    hasLeased = false
    // 回调出错不能影响 OpenCode，也不能把请求或令牌写进日志。
    Promise.resolve().then(() => onDisconnect?.()).catch(() => log('work bridge disconnect callback failed'))
  }

  async function handle(request, response) {
    authorize(request, expected)
    expireLeases()
    if (request.method === 'GET' && request.url === '/health') return send(response, 200, { ok: true })
    const isEvent = request.method === 'POST' && request.url === '/events'
    const isLease = ['POST', 'DELETE'].includes(request.method) && request.url === '/lease'
    if (!isEvent && !isLease) throw workError('not found', 404)
    const body = await readBody(request)
    if (isEvent) {
      validateWorkEvent(body, now())
      const result = await receive(body)
      return send(response, 200, { ok: true, duplicate: result?.duplicate === true })
    }
    const id = validateLease(body)
    if (request.method === 'DELETE') leases.delete(id)
    else {
      if (!leases.has(id) && leases.size >= LEASE_LIMIT) throw workError('lease capacity reached', 429)
      leases.set(id, now() + LEASE_TTL_MS)
      hasLeased = true
    }
    expireLeases()
    send(response, 200, { ok: true })
  }

  const server = createServer((request, response) => {
    handle(request, response).catch(error => {
      const status = Number.isInteger(error?.status) ? error.status : 503
      if (status === 503) log('work bridge receive failed')
      if (!response.headersSent) send(response, status, { ok: false, reason: status === 503 ? 'unavailable' : error.message })
      request.resume()
    })
  })
  server.requestTimeout = 10000
  server.headersTimeout = 10000
  server.timeout = 10000
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(undefined) })
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('work bridge missing address')
  expected = { host: `127.0.0.1:${address.port}`, token }
  const endpoint = `http://${expected.host}`
  const interval = setInterval(expireLeases, 1000)
  interval.unref()
  try { writeWorkJson(discoveryPath, { version: 1, port: address.port, token, pid: process.pid }) } catch (error) {
    clearInterval(interval)
    await new Promise(resolve => server.close(resolve))
    throw error
  }

  /** 关闭只移除自己的发现文件，避免迟到的关闭误删新实例。 */
  async function close() {
    if (isClosed) return
    isClosed = true
    clearInterval(interval)
    const stopped = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve(undefined)))
    server.closeIdleConnections()
    await stopped
    const current = readWorkJson(discoveryPath)
    if (current?.token === token) removeWorkFile(discoveryPath)
  }
  return { endpoint, close }
}
