// @ts-check
/** 工作事件的幂等账本：WAL 把原存档与独立 receipt 串成可恢复事务，不改变游戏结构。 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { readWorkJson, removeWorkFile, secureWorkDirectory, writeWorkJson } from './work-files.js'
import { EVENT_MAX_AGE_MS, WORK_ID, validateWorkEvent, workError } from './work-protocol.js'

const RECEIPT_LIMIT = 20000
const RECEIPT_FILE = 'work-receipts.json'
const WAL_FILE = 'work-wal.json'

/** @typedef {{id: string, at: number}} Receipt */
/** @typedef {{version: 2,statePath:string,beforeState:any,nextState:any,receipt:Receipt}} WorkWal */
/** @typedef {{directory: string, statePath: string, writeStateFile: (path: string, state: any) => void}} RecoveryOptions */

/** 对键顺序不敏感，兼容原存档的缩进与 Store 内存对象的键插入顺序。 */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]))
}

/** 直接比较规范化完整状态，不生成或校验摘要。 */
const stateIdentity = state => JSON.stringify(canonicalize(state))

function readSavedState(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

function isReceipt(value) {
  return value && typeof value === 'object' && Object.keys(value).sort().join(',') === 'at,id' &&
    typeof value.id === 'string' && WORK_ID.test(value.id) && Number.isSafeInteger(value.at) && value.at >= 0
}

/** @returns {Map<string, Receipt>} */
function readReceipts(directory) {
  const saved = readWorkJson(join(directory, RECEIPT_FILE))
  if (saved === null) return new Map()
  if (saved.version !== 1 || !Array.isArray(saved.receipts) || saved.receipts.length > RECEIPT_LIMIT) {
    throw new Error('work receipt file invalid; evidence preserved')
  }
  const receipts = new Map()
  for (const receipt of saved.receipts) {
    if (!isReceipt(receipt) || receipts.has(receipt.id)) throw new Error('work receipt invalid; evidence preserved')
    receipts.set(receipt.id, receipt)
  }
  return receipts
}

/** @returns {WorkWal|null} */
function readWal(options) {
  const wal = readWorkJson(join(options.directory, WAL_FILE))
  if (wal === null) return null
  if (wal.version === 1) throw new Error('legacy work WAL requires manual reconciliation; evidence preserved')
  const isState = value => value === null || (typeof value === 'object' && !Array.isArray(value))
  if (wal.version !== 2 || wal.statePath !== resolve(options.statePath) || !isReceipt(wal.receipt) ||
      !isState(wal.beforeState) || !isState(wal.nextState) ||
      Object.keys(wal).sort().join(',') !== 'beforeState,nextState,receipt,statePath,version') {
    throw new Error('work WAL invalid; evidence preserved')
  }
  return wal
}

function appendReceipt(options, receipt, receipts = readReceipts(options.directory)) {
  const existing = receipts.get(receipt.id)
  if (existing && existing.at !== receipt.at) throw new Error('work receipt conflict; evidence preserved')
  if (existing) return receipts
  if (receipts.size >= RECEIPT_LIMIT) throw new Error('work receipt capacity exceeded; evidence preserved')
  // 写盘成功才发布新缓存，否则重试不能把一次失败写入当成 durable ACK。
  const next = new Map(receipts)
  next.set(receipt.id, receipt)
  writeWorkJson(join(options.directory, RECEIPT_FILE), { version: 1, receipts: [...next.values()] })
  return next
}

/** 仅接受完整状态等于事务前/后的两种情况，其他玩家操作不能被静默回滚。
 * @param {RecoveryOptions} options
 * @param {WorkWal} wal
 * @param {{receipts?:Map<string,Receipt>,install?:()=>void}} [completion]
 */
function completeWal(options, wal, completion = {}) {
  const diskState = stateIdentity(readSavedState(options.statePath))
  const beforeState = stateIdentity(wal.beforeState)
  const afterState = stateIdentity(wal.nextState)
  if (diskState !== beforeState && diskState !== afterState) {
    throw new Error('work WAL state conflict; evidence preserved')
  }
  if (diskState === beforeState && wal.nextState !== null) options.writeStateFile(options.statePath, wal.nextState)
  const receipts = appendReceipt(options, wal.receipt, completion.receipts)
  completion.install?.()
  removeWorkFile(join(options.directory, WAL_FILE))
  return receipts
}

/**
 * 必须在 createStore/startHost 之前执行；写盘函数从当前游戏包的 store/state-file.js 加载。
 * @param {RecoveryOptions} options
 * @returns {{recovered: boolean}}
 */
export function recoverWorkLedger(options) {
  secureWorkDirectory(options.directory)
  const wal = readWal(options)
  if (wal === null) return { recovered: false }
  completeWal(options, wal)
  return { recovered: true }
}

/**
 * 同步事务不让宿主的其他 Store 操作穿插；单实例由 Electron 调用方负责锁定。
 * @param {RecoveryOptions & {store:any,feed:(state:any,type:string,nowMs:number)=>any,
 * settleAchievements:(state:any,nowMs:number)=>any,
 * now?: () => number, log?: (message: string) => void}} options
 * @returns {{receive: (event: import('./work-protocol.js').WorkEvent) => {duplicate: boolean}}}
 */
export function createWorkLedger(options) {
  const { directory, statePath, store, feed, now = Date.now, log = () => {} } = options
  secureWorkDirectory(directory)
  if (readWal(options) !== null) throw new Error('recover work WAL before opening Store')
  let receipts = readReceipts(directory)
  /** @type {{wal:WorkWal,beforeMemory:string,isInstalled:boolean}|null} */
  let pending = null

  function installPending() {
    if (pending === null || pending.isInstalled) return
    if (stateIdentity(store.state) !== pending.beforeMemory) throw new Error('work WAL memory conflict; evidence preserved')
    if (pending.wal.nextState !== null) {
      const nextState = structuredClone(pending.wal.nextState)
      const result = store.mutate(live => {
        for (const key of Object.keys(live)) delete live[key]
        Object.assign(live, nextState)
        return { ok: true }
      })
      if (result?.ok !== true) throw new Error('work Store install failed; WAL preserved')
    }
    pending.isInstalled = true
  }

  function finishPending() {
    if (pending === null) return
    // 2026-10-12：原 Store 的 mutate 会结算成就并安排写盘，必须在 durable receipt 之后调用。
    const expectedMemory = pending.isInstalled ? stateIdentity(pending.wal.nextState) : pending.beforeMemory
    // GUI 在失败后继续操作时只能拒绝重试；不能用旧快照覆盖玩家，也不能 ACK 已丢失的奖励。
    if (stateIdentity(store.state) !== expectedMemory) {
      throw new Error('work WAL memory conflict; evidence preserved')
    }
    // 2026-10-12：单实例已在启动时校验并加载收据，事件处理中不能重新启动同步 PowerShell。
    // Windows 鼠标穿透钩子也在这个主线程；约 180ms 的权限子进程会卡住全局鼠标。
    receipts = completeWal(options, pending.wal, { receipts, install: installPending })
    pending = null
  }

  function pruneReceipts(nowMs) {
    const kept = new Map([...receipts].filter(([, receipt]) => receipt.at >= nowMs - EVENT_MAX_AGE_MS))
    if (kept.size !== receipts.size) {
      writeWorkJson(join(directory, RECEIPT_FILE), { version: 1, receipts: [...kept.values()] })
      receipts = kept
    }
  }

  function receive(event) {
    try {
      const nowMs = now()
      validateWorkEvent(event, nowMs)
      finishPending()
      const existing = receipts.get(event.id)
      if (existing) {
        if (existing.at !== event.at) throw workError('event id conflict', 409)
        return { duplicate: true }
      }
      pruneReceipts(nowMs)
      // 不逐出窗口内的 receipt：否则同一个合法事件重放会再次获得奖励。
      if (receipts.size >= RECEIPT_LIMIT) throw workError('receipt capacity reached', 429)
      const beforeMemory = stateIdentity(store.state)
      const nextState = structuredClone(store.state)
      if (nextState !== null) {
        feed(nextState, event.type, nowMs)
        // 原 Store.mutate 会结算成就；先在副本完成同样结算，再发布完整 WAL。
        options.settleAchievements(nextState, nowMs)
      }
      // 先刷 Store 的当前基线（可能有尚未节流落盘的玩家操作），再记录 WAL。
      if (store.state !== null) options.writeStateFile(statePath, store.state)
      const wal = {
        version: /** @type {const} */ (2), statePath: resolve(statePath), beforeState: readSavedState(statePath),
        nextState, receipt: { id: event.id, at: event.at },
      }
      writeWorkJson(join(directory, WAL_FILE), wal)
      pending = { wal, beforeMemory, isInstalled: false }
      finishPending()
      return { duplicate: false }
    } catch (error) {
      if (!error?.status) log('work ledger transaction failed; evidence preserved')
      throw error
    }
  }
  return { receive }
}
