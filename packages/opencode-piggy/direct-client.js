// @ts-check
/** 插件直接投递官方本机 HTTP 接口，事件持久化不等待游戏响应。 */
import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { link, lstat, open, opendir, unlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createGameEndpoint } from './game-endpoint.js'
import { secureWorkDirectoryAsync } from './work-files.js'
import { validateWorkEvent } from './protocol.js'

const MAX_PENDING = 4096
const MAX_SCAN = 8192
const JSON_LIMIT = 1024
const RETRY_MS = 5000

/** @typedef {{directory:string,gameDirectory:string|string[],log?:(message:string)=>void}} DirectClientOptions */

/** 不展开解析异常、HTTP 正文、令牌或系统命令输出。 */
function reason(error) {
  if (['ENOENT', 'EACCES', 'EPERM', 'ENOSPC', 'EMFILE', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].includes(error?.code)) {
    return error.code
  }
  if (/^game status \d{3}$/.test(error?.message)) return `游戏 HTTP ${error.message.slice(-3)}`
  if (error?.message === 'game timeout') return '游戏请求超时'
  return '操作失败'
}

/** 有界读取；损坏记录不删除、不重写。 */
async function readEvent(path) {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('invalid event file')
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const data = Buffer.alloc(JSON_LIMIT + 1)
    const { bytesRead } = await file.read(data, 0, data.length, 0)
    if (bytesRead > JSON_LIMIT) throw new Error('event file too large')
    return JSON.parse(data.subarray(0, bytesRead).toString('utf8'))
  } finally { await file.close() }
}

async function remove(path) {
  try { await unlink(path) } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

/** @param {DirectClientOptions} options */
export function createDirectClient(options) {
  const events = join(options.directory, 'events')
  const endpoint = createGameEndpoint({ directory: options.gameDirectory })
  /** @type {Map<string, Promise<boolean>>} */
  const pending = new Map()
  let writing = Promise.resolve()
  let ready = null
  let delivery = null
  let diskReader = null
  let timer = null
  let isClosed = false
  let closing = null
  let reportedExpired = false

  function report(message) {
    try {
      if (options.log) options.log(message)
      else console.warn(`[opencode-piggy] ${message}`)
    } catch (error) { console.warn('[opencode-piggy] 日志回调失败') }
  }

  function prepare() {
    if (!ready) ready = (async () => {
      await secureWorkDirectoryAsync(options.directory)
      await secureWorkDirectoryAsync(events)
    })().catch(error => { ready = null; throw error })
    return ready
  }

  /** 同 ID 原子只创建，不覆盖其他项目或进程已发布的首条记录。 */
  async function writeFirst(event) {
    const path = join(events, `${event.id}.json`)
    const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`
    const file = await open(temporary, 'wx', 0o600)
    try {
      try {
        await file.writeFile(JSON.stringify(event))
        await file.sync()
      } finally { await file.close() }
      try { await link(temporary, path) } catch (error) {
        if (error.code !== 'EEXIST') throw error
        const existing = await readEvent(path)
        validateWorkEvent(existing, Date.now())
        if (existing.id !== event.id || existing.at !== event.at || existing.type !== event.type) {
          throw new Error('event identity conflict')
        }
      }
    } finally { await remove(temporary) }
    if (process.platform !== 'win32') {
      const directory = await open(events, 'r')
      try { await directory.sync() } finally { await directory.close() }
    }
  }

  async function closeReader() {
    if (diskReader) { await diskReader.close(); diskReader = null }
  }

  /** 保留扫描游标，坏记录或单轮上限不能饿死后续有效记录。 */
  async function deliver() {
    if (!diskReader) diskReader = await opendir(events)
    let scanned = 0
    while (!isClosed && scanned++ < MAX_SCAN) {
      const entry = await diskReader.read()
      if (!entry) { await closeReader(); return }
      if (!/^[a-f0-9]{64}\.json$/.test(entry.name)) continue
      const path = join(events, entry.name)
      let event
      try {
        event = await readEvent(path)
        validateWorkEvent(event, Date.now())
        if (`${event.id}.json` !== entry.name) throw new Error('invalid event identity')
      } catch (error) {
        if (error.code === 'ENOENT') continue
        // 官方不再接收超过七天的事件；停止自动投递，但不在确认前删除现场。
        if (error.status === 422 && error.message === 'event outside receipt window' && `${event.id}.json` === entry.name) {
          if (!reportedExpired) report('发件箱存在超过七天接收窗口的事件，已保留，不再自动投递')
          reportedExpired = true
          continue
        }
        report(`发件箱记录读取失败，已保留：${reason(error)}`)
        continue
      }
      if (isClosed) return
      await endpoint.receive(event)
      await remove(path)
    }
  }

  function flush() {
    if (isClosed) return closing ?? Promise.resolve()
    if (!delivery) delivery = (async () => {
      await writing
      if (isClosed) return
      await prepare()
      if (!isClosed) await deliver()
    })().catch(error => { report(`游戏投递暂不可用，将重试：${reason(error)}`) })
      .finally(() => { delivery = null })
    return delivery
  }

  return {
    /** 成功只表示异步落盘完成；写入链独立于 HTTP 投递链。
     * @param {import('./protocol.js').WorkEvent} event
     * @returns {Promise<boolean>}
     */
    enqueue(event) {
      if (isClosed) return Promise.resolve(false)
      try { validateWorkEvent(event, Date.now()) } catch (error) {
        report('发件箱拒绝无效工作事件')
        return Promise.resolve(false)
      }
      if (pending.has(event.id)) return pending.get(event.id)
      if (pending.size >= MAX_PENDING) { report('发件箱待写入数量已达上限'); return Promise.resolve(false) }
      const value = { id: event.id, type: event.type, at: event.at }
      const persisted = writing.then(async () => {
        await prepare()
        await writeFirst(value)
        return true
      }).catch(error => { report(`发件箱落盘失败：${reason(error)}`); return false })
      pending.set(value.id, persisted)
      writing = persisted.then(() => { pending.delete(value.id) })
      void persisted.then(success => { if (success && !isClosed) void flush() })
      return persisted
    },
    start() {
      if (isClosed || timer) return
      void flush()
      timer = setInterval(() => { void flush() }, RETRY_MS)
      timer.unref?.()
    },
    flush,
    close() {
      if (closing) return closing
      isClosed = true
      clearInterval(timer)
      timer = null
      closing = (async () => {
        await writing
        await delivery
        await closeReader()
      })()
      return closing
    },
  }
}

/** @type {Map<string, {client:ReturnType<typeof createDirectClient>, gameDirectory:string, users:number, closing:Promise<void>|null}>} */
const sharedClients = new Map()

function directoryKey(directory) {
  const path = resolve(directory)
  return process.platform === 'win32' ? path.toLowerCase() : path
}

/** 同一服务中的项目共用队列与投递器；一个队列不能投向不同的游戏。
 * @param {DirectClientOptions} options
 */
export async function retainDirectClient(options) {
  const key = directoryKey(options.directory)
  const directories = Array.isArray(options.gameDirectory) ? options.gameDirectory : [options.gameDirectory]
  const gameKey = JSON.stringify(directories.map(directoryKey))
  let shared = sharedClients.get(key)
  // 项目切换可与最后一个旧实例的 HTTP 收尾重叠；等待交接，不让新插件永久停用。
  while (shared?.closing) {
    await shared.closing
    shared = sharedClients.get(key)
  }
  if (shared && shared.gameDirectory !== gameKey) throw new Error('发件箱目录已绑定其他游戏目录')
  if (!shared) {
    const client = createDirectClient(options)
    client.start()
    shared = { client, gameDirectory: gameKey, users: 0, closing: null }
    sharedClients.set(key, shared)
  }
  shared.users++
  let released = false
  return {
    client: shared.client,
    release() {
      if (!released) {
        released = true
        if (--shared.users === 0) shared.closing = shared.client.close().finally(() => { sharedClients.delete(key) })
      }
      return shared.closing ?? Promise.resolve()
    },
  }
}
