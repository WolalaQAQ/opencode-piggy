// @ts-check
/** 官方工作事件的元数据约束，不接受工作正文。 */
export const EVENT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
export const EVENT_FUTURE_MS = 5 * 60 * 1000
export const WORK_ID = /^[a-f0-9]{64}$/
const EVENT_TYPES = new Set(['message', 'turn', 'tool', 'toolError', 'agentError'])

/** @typedef {{id: string, type: 'message'|'turn'|'tool'|'toolError'|'agentError', at: number}} WorkEvent */

/** @param {string} reason @param {number} status @returns {Error & {status: number}} */
export function workError(reason, status) {
  return Object.assign(new Error(reason), { status })
}

/** @param {unknown} value @param {number} nowMs @returns {asserts value is WorkEvent} */
export function validateWorkEvent(value, nowMs) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw workError('invalid event', 400)
  const event = /** @type {Record<string, any>} */ (value)
  if (Object.keys(event).sort().join(',') !== 'at,id,type' || typeof event.id !== 'string' ||
      !WORK_ID.test(event.id) || !EVENT_TYPES.has(event.type) || !Number.isSafeInteger(event.at) || event.at < 0) {
    throw workError('invalid event', 400)
  }
  if (event.at < nowMs - EVENT_MAX_AGE_MS) throw workError('event outside receipt window', 422)
  if (event.at > nowMs + EVENT_FUTURE_MS) throw workError('event from future', 422)
}
