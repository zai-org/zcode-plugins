/**
 * ZCode model-I/O trajectory reader.
 *
 * One `model-io-<session>.jsonl` file per session, written to rollout/ (production) or debug/
 * (development). Bounded retention means records may be `full`, `delta` or `tail`; a tail is a new
 * baseline and cannot be joined to older records. The panel only uses this file for the request
 * header (system prompt and tool schemas) and provider-reported response usage; the message body
 * always comes from the session store, which is complete.
 */

import { open, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { sanitizeSessionSegment } from '../domain/session.mjs'

const MAX_READ_BYTES = 32 * 1024 * 1024

async function readTail(filePath) {
  const handle = await open(filePath, 'r')
  try {
    const info = await handle.stat()
    const start = Math.max(0, info.size - MAX_READ_BYTES)
    const length = info.size - start
    const buffer = Buffer.allocUnsafe(length)
    let read = 0
    while (read < length) {
      const result = await handle.read(buffer, read, length - read, start + read)
      if (result.bytesRead === 0) break
      read += result.bytesRead
    }
    let text = buffer.subarray(0, read).toString('utf8')
    if (start > 0) {
      const newline = text.indexOf('\n')
      text = newline === -1 ? '' : text.slice(newline + 1)
    }
    return { text, bytes: info.size, truncated: start > 0, mtime: info.mtimeMs }
  } finally {
    await handle.close()
  }
}

function expandRequests(records) {
  const expanded = []
  let previous
  for (const record of records) {
    const request = record?.request
    if (!request || typeof request !== 'object') {
      expanded.push(record)
      previous = record
      continue
    }
    const nextRequest = { ...request }
    expandCollection(nextRequest, 'messages', previous?.request)
    expandCollection(nextRequest, 'sdkMessages', previous?.request)
    if (nextRequest.body && typeof nextRequest.body === 'object') {
      const body = { ...nextRequest.body }
      expandCollection(body, 'messages', previous?.request?.body, nextRequest)
      nextRequest.body = body
    }
    const next = { ...record, request: nextRequest }
    expanded.push(next)
    previous = next
  }
  return expanded
}

function expandCollection(target, key, previous, metadataSource = target) {
  if (metadataSource?.[key + 'Kind'] === 'tail') return
  if (metadataSource?.[key + 'Kind'] !== 'delta') return
  const delta = target[key]
  const before = previous?.[key]
  const offset = metadataSource[key === 'messages' ? 'messageOffset' : key + 'Offset']
  if (!Array.isArray(delta) || !Array.isArray(before) || !Number.isInteger(offset) || offset < 0) return
  target[key] = [...before.slice(0, offset), ...delta]
}

async function candidateFiles(paths, sessionId) {
  const name = `model-io-${sanitizeSessionSegment(sessionId) || 'no-session'}.jsonl`
  const found = []
  for (const directory of paths.rolloutDirs ?? []) {
    const file = join(directory, name)
    try {
      const info = await stat(file)
      if (info.isFile()) found.push({ file, directory, mtime: info.mtimeMs, size: info.size })
    } catch {}
  }
  return found.sort((a, b) => b.mtime - a.mtime)
}

/** Cheap change detector for the rollout cache; no file contents are read. */
export async function rolloutStamp(paths, sessionId) {
  const candidates = await candidateFiles(paths, sessionId)
  if (candidates.length === 0) return 'none'
  return candidates.map((candidate) => candidate.file + ':' + candidate.mtime + ':' + candidate.size).join('|')
}

function parseRecords(text, sessionId) {
  const records = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let parsed
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (parsed?.sessionId !== sessionId) continue
    if (parsed.type !== undefined && parsed.type !== 'model_io') continue
    records.push(parsed)
  }
  return records
}

function timeOf(value) {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function usageOf(record) {
  const usage = record?.response?.usage
  if (!usage || typeof usage !== 'object') return null
  const pick = (name) => (typeof usage[name] === 'number' && Number.isFinite(usage[name]) ? usage[name] : null)
  return {
    inputTokens: pick('inputTokens'),
    outputTokens: pick('outputTokens'),
    totalTokens: pick('totalTokens'),
    cacheReadTokens: pick('cacheReadTokens'),
    cacheWriteTokens: pick('cacheWriteTokens'),
  }
}

function headerOf(record) {
  const body = record?.request?.body
  const system = body?.system ?? record?.request?.system ?? null
  const tools = Array.isArray(body?.tools) ? body.tools : null
  return {
    system,
    tools,
    maxOutputTokens: Number.isFinite(body?.max_tokens)
      ? body.max_tokens
      : Number.isFinite(record?.request?.maxOutputTokens)
        ? record.request.maxOutputTokens
        : null,
  }
}

/**
 * Read the trajectory for one session. Never throws on missing files: the caller shows the
 * database-derived view and marks the header as estimated.
 */
export async function readRollout(paths, sessionId) {
  const candidates = await candidateFiles(paths, sessionId)
  if (candidates.length === 0) {
    return { available: false, records: [], coverage: 'none', files: [], truncated: false, changedAt: 0 }
  }
  const chosen = candidates[0]
  let tail
  try {
    tail = await readTail(chosen.file)
  } catch {
    return { available: false, records: [], coverage: 'none', files: [], truncated: false, changedAt: 0 }
  }
  const raw = parseRecords(tail.text, sessionId)
  raw.sort((a, b) => timeOf(a.startedAt) - timeOf(b.startedAt) || String(a.requestId ?? '').localeCompare(String(b.requestId ?? '')))
  const records = expandRequests(raw).map((record) => {
    const startedAt = timeOf(record.startedAt)
    const usage = usageOf(record)
    const request = record.request ?? {}
    return {
      startedAt,
      completedAt: timeOf(record.completedAt),
      requestId: typeof record.requestId === 'string' ? record.requestId : '',
      turnId: record.turnId ?? null,
      querySource: record.querySource ?? null,
      model: record.model ?? {},
      attempt: Number.isInteger(record.attempt) ? record.attempt : 1,
      messagesKind: request.messagesKind ?? null,
      messageOffset: Number.isInteger(request.messageOffset) ? request.messageOffset : null,
      messageCount: Number.isInteger(request.messageCount) ? request.messageCount : null,
      messages: Array.isArray(request.messages) ? request.messages : [],
      header: headerOf(record),
      usage,
      responseText: typeof record.response?.text === 'string' ? record.response.text : '',
      responseCalls: Array.isArray(record.response?.toolCalls) ? record.response.toolCalls : [],
      hasError: Boolean(record.error),
    }
  })
  const hasFull = records.some((record) => record.messagesKind === 'full')
  const hasTail = records.some((record) => record.messagesKind === 'tail')
  const coverage = hasFull && !hasTail ? 'full' : records.length > 0 ? 'partial' : 'none'
  return {
    available: true,
    records,
    coverage,
    files: candidates.map((candidate) => candidate.file),
    file: chosen.file,
    truncated: tail.truncated,
    changedAt: chosen.mtime,
  }
}

/** The rollout record for a request, matched by turn id and start instant (never by message text). */
export function recordFor(rollout, usage) {
  if (!rollout?.records?.length || !usage) return null
  const started = Number(usage.started_at) || 0
  let best = null
  let bestDelta = Infinity
  for (const record of rollout.records) {
    if (usage.turn_id && record.turnId && usage.turn_id !== record.turnId) continue
    const delta = Math.abs(record.startedAt - started)
    if (delta < bestDelta) {
      best = record
      bestDelta = delta
    }
  }
  return best && bestDelta <= 5000 ? best : null
}

export function latestRecord(rollout) {
  if (!rollout?.records?.length) return null
  return rollout.records[rollout.records.length - 1]
}
