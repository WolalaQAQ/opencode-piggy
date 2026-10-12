// @ts-check
/** 本地桥客户端：持久发件箱、超时、认证与重连均不进入模型工作路径。 */
import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { link, lstat, mkdir, open, opendir, unlink } from 'node:fs/promises'
import { request } from 'node:http'
import { join } from 'node:path'
import { secureWorkDirectoryAsync, verifyPrivateWorkFileAsync } from '../opencode-bridge/files.js'
import { validateWorkEvent } from '../opencode-bridge/protocol.js'

const MAX_QUEUE = 4096
const WRITE_BATCH = 64
const MAX_SCAN = MAX_QUEUE * 2
const JSON_LIMIT = 1024
const REQUEST_MS = 1500
const SAFE_REASONS = new Set(['invalid bridge discovery', 'invalid bridge response', 'work file too large',
  'work file must be regular', 'outbox disk limit reached', 'outbox writer busy', 'bridge timeout'])

/** 解析器和系统异常的 message 可能含正文、凭据或路径；只允许固定原因和错误码。 */
const reason = error => SAFE_REASONS.has(error?.message) ? error.message
  : /^bridge status \d{3}$/.test(error?.message) ? error.message
    : ['ENOENT', 'EACCES', 'EPERM', 'EEXIST', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].includes(error?.code)
      ? error.code : 'operation failed'

/** 有界读取，不能先 readFile 再判断大小；损坏文件保留现场。 */
async function readJson(path) {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('work file must be regular')
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const data = Buffer.alloc(JSON_LIMIT + 1)
    const { bytesRead } = await file.read(data, 0, data.length, 0)
    if (bytesRead > JSON_LIMIT) throw new Error('work file too large')
    return JSON.parse(data.subarray(0, bytesRead).toString('utf8'))
  } finally { await file.close() }
}

async function remove(path) {
  try { await unlink(path) } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

/** @param {{directory:string,wake?:()=>Promise<void>,log?:(message:string)=>void,standalone?:boolean}} options */
export function createBridgeClient(options) {
  function report(message) {
    try {
      if (options.log) options.log(message)
      else console.warn(`[opencode-piggy] ${message}`)
    } catch (error) { console.warn('[opencode-piggy] log callback failed') }
  }
  const lease = randomBytes(32).toString('hex')
  const outbox = join(options.directory, 'outbox')
  const writerPath = join(options.directory, 'outbox.lock')
  /** @type {Map<string, import('../opencode-bridge/protocol.js').WorkEvent>} */
  const queue = new Map()
  const persisted = new Map()
  let isClosed = false
  let lastWake = 0
  let inFlight = null
  let heartbeatFlight = null
  let closing = null
  let ready = null
  let leasedEndpoint = null
  let verifiedDiscovery = ''
  let diskReader = null
  let timer = null

  function prepare() {
    if (!ready) ready = (async () => {
      await secureWorkDirectoryAsync(options.directory)
      await mkdir(outbox, { recursive: true, mode: 0o700 })
      const info = await lstat(outbox)
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('work file must be regular')
    })().catch(error => { ready = null; throw error })
    return ready
  }

  async function discover() {
    const path = join(options.directory, 'bridge.json')
    if (options.standalone) {
      const stat = await lstat(path)
      const identity = `${stat.dev}:${stat.ino}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`
      if (identity !== verifiedDiscovery) { await verifyPrivateWorkFileAsync(path); verifiedDiscovery = identity }
    }
    const info = await readJson(path)
    if (!info || info.version !== 1 || !Number.isInteger(info.port) || info.port < 1 || info.port > 65535
      || typeof info.token !== 'string' || !/^[a-f0-9]{64}$/.test(info.token)
      || (options.standalone && (info.role !== 'opencode-bridge' || !Number.isSafeInteger(info.pid) || info.pid <= 0))) {
      throw new Error('invalid bridge discovery')
    }
    if (options.standalone) await send(info, { method: 'GET', path: '/health', body: undefined })
    return info
  }

  /** 固定回环、绝对截止时间、无代理/重定向；只有协议 ACK 才能删除事件。 */
  function send(endpoint, message) {
    const { method, path, body } = message
    return new Promise((resolve, reject) => {
      const payload = body === undefined ? '' : JSON.stringify(body)
      if (Buffer.byteLength(payload) > JSON_LIMIT) return reject(new Error('work file too large'))
      const req = request({ hostname: '127.0.0.1', port: endpoint.port, path, method,
        agent: false, maxHeaderSize: 4096,
        headers: { authorization: `Bearer ${endpoint.token}`, 'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload) } }, res => {
        const chunks = []
        let size = 0
        res.on('data', chunk => {
          size += chunk.length
          if (size > JSON_LIMIT) return req.destroy(new Error('invalid bridge response'))
          chunks.push(chunk)
        })
        res.on('error', reject)
        res.on('end', () => {
          if (res.statusCode !== 200) return reject(new Error(`bridge status ${res.statusCode}`))
          try {
            const ack = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            const keys = path === '/events' ? 'duplicate,ok' : path === '/health' ? 'ok,queued,receiver,role' : 'ok'
            if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(res.headers['content-type'] ?? '')
              || !ack || Object.keys(ack).sort().join(',') !== keys || ack.ok !== true
              || (path === '/events' && typeof ack.duplicate !== 'boolean') ||
              (path === '/health' && (ack.role !== 'opencode-bridge' || !Number.isSafeInteger(ack.queued) ||
                ack.queued < 0 || typeof ack.receiver !== 'boolean'))) throw new Error('invalid bridge response')
            resolve(undefined)
          } catch (error) { reject(new Error('invalid bridge response')) }
        })
      })
      const deadline = setTimeout(() => req.destroy(new Error('bridge timeout')), REQUEST_MS)
      // close 始终发生于请求结束或销毁，包含慢速滴流和半截响应。
      req.once('close', () => clearTimeout(deadline))
      req.on('error', reject)
      req.end(payload)
    })
  }

  /** 多实例共享一个短写锁；死进程留下的锁在下次启动回收。 */
  async function acquireWriter() {
    const until = Date.now() + REQUEST_MS
    while (true) {
      try {
        const temporary = `${writerPath}.${lease}.tmp`
        const file = await open(temporary, 'wx', 0o600)
        try {
          try { await file.writeFile(JSON.stringify({ pid: process.pid, id: lease })); await file.sync() }
          finally { await file.close() }
          // 所有者信息写完整后才原子发布锁，崩溃不能留下半写的固定锁文件。
          await link(temporary, writerPath)
        } finally { await remove(temporary) }
        return
      } catch (error) {
        if (error.code !== 'EEXIST') throw error
        const owner = await readJson(writerPath).catch(() => null)
        if (owner && Number.isSafeInteger(owner.pid) && owner.pid > 0) {
          try { process.kill(owner.pid, 0) } catch (probeError) {
            const current = await readJson(writerPath).catch(() => null)
            if (probeError.code === 'ESRCH' && current?.id === owner.id) await remove(writerPath)
          }
        }
        if (Date.now() >= until) throw new Error('outbox writer busy')
        await new Promise(resolve => setTimeout(resolve, 10))
      }
    }
  }

  async function writeFirst(event) {
    const path = join(outbox, `${event.id}.json`)
    const temporary = `${path}.${lease}.tmp`
    const file = await open(temporary, 'wx', 0o600)
    try {
      try {
        await file.writeFile(JSON.stringify(event))
        await file.sync()
      } finally { await file.close() }
      // 2026-10-12：rename 会覆盖另一个项目已落盘的同 ID 首条记录；link 是原子的只创建。
      await link(temporary, path)
      if (process.platform !== 'win32') {
        const directory = await open(outbox, 'r')
        try { await directory.sync() } finally { await directory.close() }
      }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    } finally { await remove(temporary) }
  }

  async function persistBatch() {
    if (!queue.size) return 0
    let written = 0
    await acquireWriter()
    try {
      let count = 0
      const directory = await opendir(outbox)
      for await (const entry of directory) {
        if (++count >= MAX_QUEUE) break
      }
      for (const [id, event] of queue) {
        if (count >= MAX_QUEUE) {
          const exists = await lstat(join(outbox, `${id}.json`)).catch(error => {
            if (error.code !== 'ENOENT') throw error
            return null
          })
          if (!exists) break
        }
        await writeFirst(event)
        queue.delete(id)
        persisted.get(id)?.resolve(true)
        persisted.delete(id)
        count++
        written++
        if (written >= WRITE_BATCH) break
      }
    } finally {
      const owner = await readJson(writerPath)
      if (owner.id === lease) await remove(writerPath)
    }
    return written
  }

  /** 每批释放写锁，多个项目不能由一个满队列独占整个发件箱。 */
  async function persist() {
    let written = 0
    while (queue.size) {
      const count = await persistBatch()
      written += count
      if (!count) {
        report('outbox persist failed: outbox disk limit reached')
        rejectUnpersisted()
        break
      }
    }
    return written
  }

  /** 未落盘的入队不能被调用者当作成功；满盘或写入失败时明确退回。 */
  function rejectUnpersisted() {
    for (const entry of persisted.values()) entry.resolve(false)
    persisted.clear()
    queue.clear()
  }

  /** 保留目录游标，坏记录或扫描上限不能让排在后面的有效事件永远饥饿。 */
  async function deliver(endpoint) {
    if (!diskReader) diskReader = await opendir(outbox)
    let scanned = 0
    let sent = 0
    while (!isClosed && scanned++ < MAX_SCAN) {
      const entry = await diskReader.read()
      if (!entry) { await diskReader.close(); diskReader = null; return sent }
      if (!/^[a-f0-9]{64}\.json$/.test(entry.name)) continue
      const path = join(outbox, entry.name)
      let event
      try {
        event = await readJson(path)
        validateWorkEvent(event, Date.now())
        if (`${event.id}.json` !== entry.name) throw new Error('invalid outbox identity')
      } catch (error) {
        if (error.code === 'ENOENT') continue
        if (error.status === 422 && error.message === 'event outside receipt window' && `${event.id}.json` === entry.name) {
          await remove(path)
          continue
        }
        report(`outbox read failed: ${reason(error)}`)
        continue
      }
      await send(endpoint, { method: 'POST', path: '/events', body: event })
      await remove(path)
      sent++
    }
    return sent
  }

  async function drain() {
    try {
      await prepare()
      await persist()
      if (isClosed) return
      const endpoint = await discover()
      await send(endpoint, { method: 'POST', path: '/lease', body: { id: lease } })
      leasedEndpoint = endpoint
      do {
        const before = queue.size
        const written = await persist()
        if (written && diskReader) { await diskReader.close(); diskReader = null }
        const sent = await deliver(endpoint)
        if (before && !written && !sent && queue.size && !diskReader) throw new Error('outbox disk limit reached')
      } while (!isClosed && queue.size)
    } catch (error) {
      if (diskReader) { await diskReader.close(); diskReader = null }
      if (!isClosed && Date.now() - lastWake > 30000 && options.wake) {
        lastWake = Date.now()
        try { await options.wake() } catch (wakeError) { report(`wake failed: ${reason(wakeError)}`) }
      }
      // 即使当前 HTTP 失败，发送或唤醒期间入队的事件仍需落盘。
      try {
        await prepare()
        await persist()
        if (queue.size) report('outbox persist failed: outbox disk limit reached')
      } catch (persistError) { report(`outbox persist failed: ${reason(persistError)}`); rejectUnpersisted() }
      if (!timer) report(`bridge unavailable: ${reason(error)}`)
    }
  }

  function flush() {
    if (isClosed) return closing ?? Promise.resolve()
    if (!inFlight) inFlight = drain().catch(error => {
      report(`bridge unavailable: ${reason(error)}`)
    }).finally(() => { inFlight = null })
    return inFlight
  }

  /** 独立桥的生产者心跳不排在长时间事件投递后面，避免活跃项目租约过期。 */
  function renewLease() {
    if (isClosed || heartbeatFlight) return heartbeatFlight
    heartbeatFlight = (async () => {
      const endpoint = await discover()
      if (isClosed) return
      await send(endpoint, { method: 'POST', path: '/lease', body: { id: lease } })
      leasedEndpoint = endpoint
    })().catch(() => { if (!isClosed) report('bridge lease renewal failed') })
      .finally(() => { heartbeatFlight = null })
    return heartbeatFlight
  }

  async function finishClose() {
    await inFlight
    await heartbeatFlight
    try {
      await prepare()
      await persist()
      if (queue.size) report('outbox persist failed: outbox disk limit reached')
    } catch (error) { report(`outbox persist failed: ${reason(error)}`); rejectUnpersisted() }
    try {
      if (diskReader) { await diskReader.close(); diskReader = null }
      if (leasedEndpoint) await send(leasedEndpoint, { method: 'DELETE', path: '/lease', body: { id: lease } })
    } catch (error) { report(`bridge cleanup failed: ${reason(error)}`) }
  }

  return {
    /** 成功以发件箱落盘为准；等待发生在插件的装饰事件消费流，不阻塞模型工作。 */
    enqueue(event) {
      if (isClosed) return false
      try { validateWorkEvent(event, Date.now()) } catch (error) { report('outbox rejected: invalid event'); return false }
      if (queue.has(event.id)) return persisted.get(event.id).promise
      if (queue.size >= MAX_QUEUE) { report('outbox memory limit reached'); return false }
      queue.set(event.id, { id: event.id, type: event.type, at: event.at })
      let resolve
      const promise = new Promise(done => { resolve = done })
      persisted.set(event.id, { promise, resolve })
      void flush()
      return promise
    },
    start() {
      if (isClosed || timer) return
      void flush()
      timer = setInterval(() => {
        if (options.standalone) void renewLease()
        void flush()
      }, 5000)
      timer.unref?.()
    },
    close() {
      if (closing) return closing
      isClosed = true
      clearInterval(timer)
      timer = null
      closing = finishClose()
      return closing
    },
    flush,
  }
}
