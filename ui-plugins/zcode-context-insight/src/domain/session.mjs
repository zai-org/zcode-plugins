import { ContextError } from './errors.mjs'

const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/

/**
 * The ONLY authority for which session a panel call belongs to: the host's namespaced request
 * metadata. An MCP transport id, a widget-state value or a browser-storage value never grants a
 * session. Missing metadata fails closed.
 */
export function readSessionContext(meta) {
  const value = meta?.['com.zcode/request-context']
  const sessionId = value?.session_id
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) {
    throw new ContextError('binding_unavailable', 'Host session metadata is missing or invalid.')
  }
  return Object.freeze({ sessionId })
}

export function sanitizeSessionSegment(value) {
  return String(value ?? '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

export function nonnegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

export const AGENT_SOURCES = new Set(['main_turn', 'subagent', 'workflow_child'])

export function isAgentSource(value) {
  return AGENT_SOURCES.has(value)
}

export function toMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}
