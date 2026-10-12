// @ts-check
/** 独立桥的原子队列：事件入队和接收确认都先落盘，再公布内存状态。 */
import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { open, rename, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { verifyPrivateWorkFile } from './files.js'
import { EVENT_MAX_AGE_MS, WORK_ID, validateWorkEvent, workError } from './protocol.js'

const QUEUE_LIMIT = 4096
const RECEIPT_LIMIT = 20000
const STATE_LIMIT = 8 * 1024 * 1024

/** @typedef {import('./protocol.js').WorkEvent} WorkEvent */
/** @typedef {{event: WorkEvent, receiver: string|null}} Entry */
/** @typedef {{version: 1, pending: Entry[], confirmed: Entry[]}} QueueState */

/** @param {string} path @returns {Promise<unknown|null>} */
async function readState(path) {
  let handle
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > STATE_LIMIT) throw new Error('桥队列文件类型或大小无效')
    const buffer = Buffer.alloc(STATE_LIMIT + 1)
    let length = 0
    while (length < buffer.length) {
      const result = await handle.read(buffer, length, buffer.length - length, null)
      if (!result.bytesRead) break
      length += result.bytesRead
    }
    if (length > STATE_LIMIT) throw new Error('桥队列文件过大')
    const value = JSON.parse(buffer.subarray(0, length).toString('utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('桥队列损坏，保留原文件')
    return value
  } finally { await handle.close() }
}

/** @param {string} path @param {QueueState} value */
async function writeState(path, value) {
  const data = JSON.stringify(value)
  if (Buffer.byteLength(data) > STATE_LIMIT) throw new Error('桥队列超出持久化容量')
  const temporary = `${path}.${randomBytes(16).toString('hex')}.tmp`
  let handle
  let published = false
  try {
    handle = await open(temporary, 'wx', 0o600)
    await handle.writeFile(data, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporary, path)
    published = true
    if (process.platform !== 'win32') {
      const directory = await open(dirname(path), 'r')
      try { await directory.sync() } finally { await directory.close() }
    }
  } catch (error) {
    if (handle) await handle.close().catch(() => {})
    try { await unlink(temporary) } catch (cleanupError) {
      if (cleanupError?.code !== 'ENOENT') {
        throw Object.assign(new AggregateError([error, cleanupError], '桥队列原子写失败'), { published })
      }
    }
    throw Object.assign(error, { published })
  }
}

/** @param {unknown} value @returns {QueueState} */
function validateState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('桥队列损坏，保留原文件')
  const state = /** @type {Record<string, any>} */ (value)
  if (Object.keys(state).sort().join(',') !== 'confirmed,pending,version' || state.version !== 1 ||
      !Array.isArray(state.pending) || !Array.isArray(state.confirmed) ||
      state.pending.length > QUEUE_LIMIT || state.confirmed.length > RECEIPT_LIMIT) {
    throw new Error('桥队列结构或容量无效，保留原文件')
  }
  const ids = new Set()
  for (const [name, entries] of [['pending', state.pending], ['confirmed', state.confirmed]]) {
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
          Object.keys(entry).sort().join(',') !== 'event,receiver' ||
          (entry.receiver !== null && (typeof entry.receiver !== 'string' || !WORK_ID.test(entry.receiver))) ||
          (name === 'confirmed' && entry.receiver === null)) throw new Error('桥队列记录无效，保留原文件')
      // 用事件自身时间检查字段；过期记录随后按窗口清理，不当作损坏文件覆盖。
      validateWorkEvent(entry.event, entry.event?.at)
      if (ids.has(entry.event.id)) throw new Error('桥队列出现重复标识，保留原文件')
      ids.add(entry.event.id)
    }
  }
  return /** @type {QueueState} */ (state)
}

/** @param {QueueState} state @param {number} nowMs @returns {QueueState} */
function retained(state, nowMs) {
  const cutoff = nowMs - EVENT_MAX_AGE_MS
  return { version: 1, pending: state.pending.filter(entry => entry.event.at >= cutoff),
    confirmed: state.confirmed.filter(entry => entry.event.at >= cutoff) }
}

/** @param {WorkEvent} left @param {WorkEvent} right */
function sameEvent(left, right) {
  return left.id === right.id && left.type === right.type && left.at === right.at
}

/** @param {{directory:string, now?:()=>number}} options */
export async function openBridgeQueue({ directory, now = Date.now }) {
  const path = join(directory, 'queue.json')
  // 只核对自己实际读取的队列，不干预正在写入的插件发件箱或启动锁。
  try { verifyPrivateWorkFile(path) } catch (error) { if (error?.code !== 'ENOENT') throw error }
  const existing = await readState(path)
  let state = existing === null ? /** @type {QueueState} */ ({ version: 1, pending: [], confirmed: [] }) : validateState(existing)
  const initial = retained(state, now())
  if (initial.pending.length !== state.pending.length || initial.confirmed.length !== state.confirmed.length) {
    await writeState(path, initial)
    state = initial
  }
  let serial = Promise.resolve()
  let failure = null

  /** @template T @param {()=>Promise<T>} operation @returns {Promise<T>} */
  function transact(operation) {
    const result = serial.then(() => {
      if (failure) throw workError('queue unavailable', 503)
      return operation()
    })
    serial = result.then(() => undefined, () => undefined)
    return result
  }

  /** 写盘不确定时停止后续写入，防止旧内存覆盖已经 rename 的新快照。 @param {QueueState} next */
  async function commit(next) {
    try { await writeState(path, next) } catch (error) {
      // rename 前失败没有改变上一份快照，允许下一次重试；发布后的同步失败必须重启恢复。
      if (error?.published === true) failure = error
      throw error
    }
    state = next
  }

  /** @param {WorkEvent} event */
  function enqueue(event) {
    return transact(async () => {
      validateWorkEvent(event, now())
      const next = retained(state, now())
      const previous = [...next.pending, ...next.confirmed].find(entry => entry.event.id === event.id)
      if (previous) {
        if (!sameEvent(previous.event, event)) throw workError('event id conflict', 409)
        return { duplicate: true }
      }
      if (next.pending.length >= QUEUE_LIMIT) throw workError('queue capacity reached', 429)
      next.pending.push({ event: { id: event.id, type: event.type, at: event.at }, receiver: null })
      await commit(next)
      return { duplicate: false }
    })
  }

  /** 一次只发第一条；未确认的事件始终保留，重连或重启后可以再次投递。
   * @param {string} receiver @param {()=>void} [authorize] */
  function poll(receiver, authorize = () => {}) {
    return transact(async () => {
      authorize()
      const next = retained(state, now())
      const first = next.pending[0]
      const changed = next.pending.length !== state.pending.length || next.confirmed.length !== state.confirmed.length
      if (first && first.receiver !== receiver) {
        next.pending[0] = { event: first.event, receiver }
        await commit(next)
      } else if (changed) await commit(next)
      return first ? [{ ...first.event }] : []
    })
  }

  /** @param {string} receiver @param {string} id @param {number} at @param {()=>void} [authorize] */
  function acknowledge(receiver, id, at, authorize = () => {}) {
    return transact(async () => {
      authorize()
      const next = retained(state, now())
      const receipt = next.confirmed.find(entry => entry.event.id === id)
      if (receipt) {
        if (receipt.event.at !== at || receipt.receiver !== receiver) throw workError('ack conflict', 409)
        return
      }
      const index = next.pending.findIndex(entry => entry.event.id === id)
      if (index < 0) throw workError('event not delivered', 409)
      const entry = next.pending[index]
      if (entry.receiver !== receiver || entry.event.at !== at) throw workError('event not delivered', 409)
      // 窗口内不能逐出确认记录；容量满时保留待投递事件并让接收端重试。
      if (next.confirmed.length >= RECEIPT_LIMIT) throw workError('receipt capacity reached', 429)
      next.pending.splice(index, 1)
      next.confirmed.push(entry)
      await commit(next)
    })
  }

  return {
    enqueue, poll, acknowledge,
    get queued() { return state.pending.filter(entry => entry.event.at >= now() - EVENT_MAX_AGE_MS).length },
    async drain() { await serial },
  }
}
