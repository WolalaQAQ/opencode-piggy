// @ts-check
/** V2 公共流按位置和语义身份裁剪；只交付事件标识、类型及时间。 */
import { createHash } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'

/** @typedef {{id:string,type:'message'|'turn'|'tool'|'toolError'|'agentError',at:number}} WorkEvent */
/** @typedef {{isVerified:boolean,isTopLevel?:boolean}} SessionScope */
const MAX_SESSIONS = 1024
const MAX_EVENTS = 4096

/** @param {unknown} value @returns {Record<string, unknown>} */
function fetchRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value) : {}
}

/** @param {unknown} value @returns {string | undefined} */
function fetchId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(value) ? value : undefined
}

function normalizeDirectory(directory) {
  const result = resolve(directory)
  return process.platform === 'win32' ? result.toLowerCase() : result
}

/** 固定容量仅减少当前实例重复工作；跨实例、重启后的幂等由后端收据负责。 */
function remember(cache, key, value, limit) {
  cache.delete(key)
  cache.set(key, value)
  if (cache.size > limit) cache.delete(cache.keys().next().value)
}

/** @param {Record<string,unknown>} value @returns {boolean | undefined} */
function fetchTopLevel(value) {
  if (value.parentID === undefined) return true
  return fetchId(value.parentID) ? false : undefined
}

/** @param {Record<string,unknown>} event @returns {string | undefined} */
function fetchExecutionIdentity(event) {
  const durable = fetchRecord(event.durable)
  const sessionID = fetchId(fetchRecord(event.data).sessionID)
  if (durable.aggregateID === sessionID && Number.isSafeInteger(durable.seq) && Number(durable.seq) >= 0) {
    // 同一 durable 终态的版本变化不是第二次工作；不从 idle 或断线前的 started 猜测身份。
    return `seq:${durable.seq}`
  }
  const eventID = fetchId(event.id)
  return eventID ? `event:${eventID}` : undefined
}

/** @param {Record<string,unknown>} event @returns {{type:WorkEvent['type'],key:unknown[]} | undefined} */
function fetchSemanticEvent(event) {
  const data = fetchRecord(event.data)
  const sessionID = fetchId(data.sessionID)
  if (!sessionID) return undefined
  if (event.type === 'session.inbox.enqueued') {
    const inboxID = fetchId(data.inboxID)
    if (fetchRecord(data.item).type !== 'user' || !inboxID) return undefined
    return { type: 'message', key: ['inbox', sessionID, inboxID] }
  }
  if (event.type === 'session.tool.success' || event.type === 'session.tool.failed') {
    const messageID = fetchId(data.assistantMessageID)
    const callID = fetchId(data.id)
    if (!messageID || !callID || typeof data.executed !== 'boolean') return undefined
    return { type: event.type === 'session.tool.success' ? 'tool' : 'toolError', key: ['tool', sessionID, messageID, callID] }
  }
  if (event.type !== 'session.execution.succeeded' && event.type !== 'session.execution.failed') return undefined
  const identity = fetchExecutionIdentity(event)
  return identity ? { type: event.type === 'session.execution.succeeded' ? 'turn' : 'agentError', key: ['execution', sessionID, identity] } : undefined
}

/**
 * 2026-10-12：真实 execution 终态可无 location。只关联已核实位置或 session.get，绝不能放行任意 session。
 * @param {{location:{directory:string,workspaceID?:string},fetchSession?:(sessionID:string)=>Promise<unknown>,log?:(message:string)=>void}} options
 * @returns {{map:(value:unknown)=>Promise<WorkEvent | undefined>,forget:(id:string)=>void,clear:()=>void}}
 */
export function createEventAdapter(options) {
  const directory = normalizeDirectory(options.location.directory)
  /** @type {Map<string,SessionScope>} */
  const sessions = new Map()
  const seen = new Map()

  function matchesLocation(value) {
    const location = fetchRecord(value)
    return typeof location.directory === 'string' && isAbsolute(location.directory) && !location.directory.includes('\0')
      && normalizeDirectory(location.directory) === directory
      && location.workspaceID === options.location.workspaceID
  }

  /** 查询仅用于确认位置和父会话，不读取 outcome 来补发未知区间奖励。 */
  async function fetchScope(sessionID) {
    if (!options.fetchSession) return sessions.get(sessionID)
    try {
      const session = fetchRecord(await options.fetchSession(sessionID))
      const scope = { isVerified: session.id === sessionID && matchesLocation(session.location), isTopLevel: fetchTopLevel(session) }
      remember(sessions, sessionID, scope, MAX_SESSIONS)
      return scope
    } catch (error) {
      options.log?.('session scope lookup failed')
      return undefined
    }
  }

  function recordScope(event, sessionID) {
    if (event.type === 'session.moved' || event.type === 'session.deleted') {
      remember(sessions, sessionID, { isVerified: false }, MAX_SESSIONS)
      return false
    }
    if (event.location !== undefined) {
      if (!matchesLocation(event.location)) {
        remember(sessions, sessionID, { isVerified: false }, MAX_SESSIONS)
        return false
      }
      const scope = sessions.get(sessionID) ?? { isVerified: true }
      scope.isVerified = true
      // 2026-10-12：forked.parentID 是 fork 来源，不证明子 agent 关系；只信 created 或实际 Session.Info。
      if (event.type === 'session.created') {
        scope.isTopLevel = fetchTopLevel(fetchRecord(event.data))
      }
      remember(sessions, sessionID, scope, MAX_SESSIONS)
      return true
    }
    return typeof event.type === 'string' && event.type.startsWith('session.execution.')
  }

  /** @param {unknown} value @returns {Promise<WorkEvent | undefined>} */
  async function map(value) {
    const event = fetchRecord(value)
    if (typeof event.type !== 'string' || !event.type.startsWith('session.')) return undefined
    const sessionID = fetchId(fetchRecord(event.data).sessionID)
    if (!sessionID || !recordScope(event, sessionID)) return undefined
    const semantic = fetchSemanticEvent(event)
    if (!semantic || !Number.isSafeInteger(event.created) || Number(event.created) < 0) return undefined
    let scope = sessions.get(sessionID)
    if (!scope || (scope.isVerified && semantic.type === 'message' && scope.isTopLevel === undefined)) {
      scope = await fetchScope(sessionID)
    }
    if (!scope?.isVerified || (semantic.type === 'message' && scope.isTopLevel !== true)) return undefined
    // BLAKE2 语义标识在重连和重启后保持一致，由官方收据去重。
    const id = createHash('blake2s256').update(JSON.stringify(['opencode-piggy:v2', ...semantic.key])).digest('hex')
    if (seen.has(id)) return undefined
    remember(seen, id, true, MAX_EVENTS)
    // 缓存淘汰或实例重启不重写原事件时间；相同 {id,at} 再到达仍由后端持久收据幂等处理。
    return { id, type: semantic.type, at: Number(event.created) }
  }

  return { map, forget(id) { seen.delete(id) }, clear() { sessions.clear(); seen.clear() } }
}
