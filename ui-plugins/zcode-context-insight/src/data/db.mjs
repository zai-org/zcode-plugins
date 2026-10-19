/**
 * Read-only SQLite access to ZCode's local session store.
 *
 * Design rules:
 * - Never open the app's own store class; use `node:sqlite` with `query_only`.
 * - Never select whole `part.data` for a session listing: tool outputs can be megabytes. Only the
 *   fields a view needs plus bounded prefixes cross into JavaScript; full bodies are read on demand
 *   for one element at a time.
 * - A missing or unsupported schema raises a typed ContextError, never a stack trace to the panel.
 */

import { DatabaseSync } from 'node:sqlite'
import { readFileSync, statSync } from 'node:fs'
import { ContextError } from '../domain/errors.mjs'

const AGENT_SQL = "('main_turn','subagent','workflow_child')"

export function classifyDbError(error) {
  if (error instanceof ContextError) return error.code
  const message = String(error?.message ?? error)
  if (/no such table|no such column/i.test(message)) return 'schema_unsupported'
  if (/database is locked|SQLITE_BUSY/i.test(message)) return 'database_busy'
  if (/unable to open|ENOENT|not a database/i.test(message)) return 'database_unavailable'
  return 'read_failed'
}

export function openDatabase(dbPath) {
  let stat
  try {
    stat = statSync(dbPath)
  } catch {
    throw new ContextError('database_missing', 'ZCode session database was not found.')
  }
  if (!stat.isFile()) throw new ContextError('database_missing', 'Session database path is not a file.')
  let db
  try {
    db = new DatabaseSync(dbPath, { readOnly: true })
    db.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 250;')
    const tables = new Set(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map((row) => row.name),
    )
    if (!tables.has('session') || !tables.has('message') || !tables.has('part') || !tables.has('model_usage')) {
      throw new ContextError('schema_unsupported', 'This database does not expose the supported session tables.')
    }
    return db
  } catch (error) {
    try {
      db?.close()
    } catch {}
    throw new ContextError(classifyDbError(error), 'The ZCode session database could not be read.')
  }
}

function tableColumns(db, table) {
  try {
    return new Set(db.prepare('PRAGMA table_info(' + table + ')').all().map((row) => row.name))
  } catch {
    return new Set()
  }
}

export function readSessionRow(db, sessionId) {
  const row = db.prepare('SELECT * FROM session WHERE id = ?').get(sessionId)
  if (!row) throw new ContextError('session_missing', 'This session is not in the local ZCode store.')
  return row
}

export function readUsageRows(db, sessionId) {
  return db
    .prepare(
      `SELECT logical_request_id, attempt_index, assistant_message_id, parent_user_message_id, turn_id,
              query_source, provider_id, model_id, variant, agent, mode, task_type, status,
              started_at, first_token_at, completed_at, duration_ms, time_to_first_token_ms,
              finish_reason, tool_call_count, input_tokens, output_tokens, reasoning_tokens,
              cache_creation_input_tokens, cache_read_input_tokens, provider_total_tokens,
              computed_total_tokens, retry_count, cancelled_by_user, context_exceeded,
              error_type, error_code
       FROM model_usage WHERE session_id = ?
       ORDER BY started_at, attempt_index, logical_request_id`,
    )
    .all(sessionId)
}

export function readToolRows(db, sessionId) {
  return db
    .prepare(
      `SELECT tool_call_id, tool_name, status, started_at, first_output_at, completed_at, duration_ms,
              time_to_first_output_ms, output_bytes, truncated, error_type
       FROM tool_usage WHERE session_id = ? ORDER BY started_at`,
    )
    .all(sessionId)
}

export function readTurnRows(db, sessionId) {
  return db
    .prepare(
      `SELECT turn_id, user_message_id, status, started_at, first_model_start_at, first_token_at,
              completed_at, duration_ms, time_to_first_token_ms, model_request_count, model_retry_count,
              tool_call_count, tool_error_count, input_tokens, output_tokens, reasoning_tokens,
              cache_creation_input_tokens, cache_read_input_tokens, computed_total_tokens
       FROM turn_usage WHERE session_id = ? ORDER BY started_at`,
    )
    .all(sessionId)
}

const lineCountSql = (field) =>
  `CASE WHEN ${field} IS NULL THEN NULL WHEN length(${field}) = 0 THEN 0 ` +
  `ELSE length(${field}) - length(replace(${field}, char(10), '')) + ` +
  `CASE WHEN substr(${field}, -1, 1) = char(10) THEN 0 ELSE 1 END END`

const partField = (path) => `json_extract(p.data, '${path}')`

/**
 * Read the whole conversation with bounded fields. `parts` keeps only what the overview, browser
 * previews, file activity and event extraction need; full bodies are fetched by part id.
 */
export function readConversation(db, sessionId) {
  const partColumns = tableColumns(db, 'part')
  const messageColumns = tableColumns(db, 'message')
  const sequence = messageColumns.has('sequence') ? 'm.sequence' : 'NULL'
  const partSequence = partColumns.has('sequence') ? 'p.sequence' : 'NULL'

  const messages = db
    .prepare(
      `SELECT m.id, ${sequence} AS sequence, m.time_created, m.time_updated,
              json_extract(m.data,'$.role') AS role,
              json_extract(m.data,'$.semantics.kind') AS kind,
              json_extract(m.data,'$.semantics.origin') AS origin,
              json_extract(m.data,'$.semantics.source') AS source,
              json_extract(m.data,'$.semantics.providerVisibility') AS visibility,
              json_extract(m.data,'$.semantics.uiVisibility') AS ui_visibility,
              json_extract(m.data,'$.synthetic') AS synthetic,
              json_extract(m.data,'$.summary.title') AS summary_title,
              length(json_extract(m.data,'$.summary.body')) AS summary_chars,
              substr(json_extract(m.data,'$.summary.body'), 1, 6000) AS summary_preview,
              json_extract(m.data,'$.tokens.input') AS tokens_input,
              json_extract(m.data,'$.tokens.output') AS tokens_output,
              json_extract(m.data,'$.tokens.cache.read') AS cache_read,
              json_extract(m.data,'$.tokens.cache.write') AS cache_write,
              json_extract(m.data,'$.modelSelection.providerId') AS model_provider,
              json_extract(m.data,'$.modelSelection.modelId') AS model_id,
              json_extract(m.data,'$.model.providerID') AS model_provider_alt,
              json_extract(m.data,'$.model.modelID') AS model_id_alt,
              json_extract(m.data,'$.anchor.turnId') AS turn_id,
              json_extract(m.data,'$.metadata.source') AS metadata_source,
              json_extract(m.data,'$.time.completed') AS completed_at,
              substr(m.data, 1, 4000) AS data_preview
       FROM message m WHERE m.session_id = ? ORDER BY ${sequence}, m.time_created, m.id`,
    )
    .all(sessionId)

  const parts = db
    .prepare(
      `SELECT p.id, p.message_id, ${partSequence} AS sequence, p.time_created, p.time_updated,
              ${partField('$.type')} AS type,
              ${partField('$.tool')} AS tool,
              ${partField('$.callID')} AS call_id,
              ${partField('$.state.status')} AS status,
              ${partField('$.state.time.start')} AS tool_start,
              ${partField('$.state.time.end')} AS tool_end,
              length(${partField('$.text')}) AS text_chars,
              substr(${partField('$.text')}, 1, 600) AS text_preview,
              length(${partField('$.state.input')}) AS input_chars,
              substr(${partField('$.state.input')}, 1, 400) AS input_sample,
              length(${partField('$.state.output')}) AS output_chars,
              substr(${partField('$.state.output')}, 1, 800) AS output_preview,
              ${lineCountSql(partField('$.state.output'))} AS output_lines,
              ${lineCountSql(partField('$.state.input.content'))} AS write_lines,
              ${lineCountSql(partField('$.state.input.old_string'))} AS edit_old_lines,
              ${lineCountSql(partField('$.state.input.new_string'))} AS edit_new_lines,
              ${partField('$.state.input.file_path')} AS file_path,
              ${partField('$.state.input.path')} AS input_path,
              ${partField('$.state.input.pattern')} AS pattern,
              ${partField('$.state.input.command')} AS command,
              ${partField('$.state.input.skill')} AS skill,
              ${partField('$.state.input.description')} AS description,
              ${partField('$.state.input.query')} AS query,
              ${partField('$.state.input.url')} AS url,
              ${partField('$.state.input.prompt')} AS prompt,
              ${partField('$.state.input.name')} AS input_name,
              ${partField('$.metadata.display.additions')} AS additions,
              ${partField('$.metadata.display.deletions')} AS deletions,
              ${partField('$.metadata.readFileState.path')} AS read_path,
              ${partField('$.metadata.readFileState.offset')} AS read_offset,
              ${partField('$.metadata.readFileState.isPartialView')} AS read_partial,
              ${partField('$.metadata.readFileState.sizeBytes')} AS read_size,
              ${partField('$.metadata.serialization.originalBytes')} AS original_bytes,
              ${partField('$.mime')} AS mime,
              ${partField('$.metadata.image.width')} AS image_width,
              ${partField('$.metadata.image.height')} AS image_height,
              ${partField('$.metadata.image.originalWidth')} AS image_ow,
              ${partField('$.metadata.image.originalHeight')} AS image_oh,
              ${partField('$.metadata.image.transformedSizeBytes')} AS image_bytes,
              ${partField('$.timelineType')} AS timeline_type,
              substr(p.data, 1, 7000) AS raw_preview
       FROM part p JOIN message m ON m.id = p.message_id
       WHERE p.session_id = ?
       ORDER BY ${sequence}, ${partSequence}, p.time_created, p.id`,
    )
    .all(sessionId)

  const messageMap = new Map(messages.map((message) => [message.id, message]))
  const byMessage = new Map()
  for (const part of parts) {
    if (!messageMap.has(part.message_id)) continue
    const list = byMessage.get(part.message_id) ?? []
    list.push(part)
    byMessage.set(part.message_id, list)
  }

  return {
    messages,
    parts,
    messageMap,
    byMessage,
    branch: activeBranchSequences(db, sessionId),
  }
}

/**
 * Follow ZCode's active conversation branch after a rewind. A rewind deletes nothing; the abandoned
 * messages stay in the store and `session.revert` records which prefix/branch is live.
 */
function activeBranchSequences(db, sessionId) {
  if (!tableColumns(db, 'session').has('revert')) return null
  let raw
  try {
    raw = db.prepare('SELECT revert FROM session WHERE id = ?').get(sessionId)?.revert
  } catch {
    return null
  }
  if (raw == null) return null
  let revert
  try {
    revert = typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch {
    throw new ContextError('branch_unknown', 'The rewind state of this session is unreadable.')
  }
  if (!revert?.targetMessageID) return null
  const rows = db
    .prepare('SELECT id, sequence FROM message WHERE session_id = ? ORDER BY sequence, time_created, id')
    .all(sessionId)
  const index = (id) => rows.findIndex((row) => row.id === id)
  const target = index(revert.targetMessageID)
  const keptIds = Array.isArray(revert.keptMessageIDs) ? new Set(revert.keptMessageIDs) : null
  if (!keptIds && target < 0) return null
  const kept = keptIds ? rows.filter((row) => keptIds.has(row.id)) : rows.slice(0, target)
  const cut = revert.branchCutAfterMessageID ? index(revert.branchCutAfterMessageID) : -1
  const created = revert.createdMessageID ? index(revert.createdMessageID) : -1
  const from = revert.branchCutAfterMessageID ? (cut < 0 ? rows.length : cut + 1) : created < 0 ? rows.length : created
  return new Set([...kept, ...rows.slice(from)].map((row) => row.sequence))
}

export function readFullPart(db, sessionId, partId) {
  const row = db
    .prepare('SELECT id, message_id, time_created, time_updated, data FROM part WHERE session_id = ? AND id = ?')
    .get(sessionId, partId)
  if (!row) throw new ContextError('element_missing', 'That context element is no longer in the session store.')
  let data
  try {
    data = JSON.parse(row.data)
  } catch {
    data = null
  }
  return { ...row, data }
}

export function readFullMessage(db, sessionId, messageId) {
  const row = db
    .prepare('SELECT id, time_created, time_updated, data FROM message WHERE session_id = ? AND id = ?')
    .get(sessionId, messageId)
  if (!row) throw new ContextError('element_missing', 'That message is no longer in the session store.')
  let data
  try {
    data = JSON.parse(row.data)
  } catch {
    data = null
  }
  return { ...row, data }
}

/** Messages a compaction summarized, on the active branch, with the fields the drill-down needs. */
export function readSummarizedMessages(db, sessionId, { after = -1, through, summary = null } = {}) {
  if (!Number.isFinite(through)) throw new ContextError('event_incomplete', 'This compaction has no summarized boundary.')
  const active = activeBranchSequences(db, sessionId)
  const live = (sequence) => active === null || active.has(sequence)
  if (!live(through) || (summary != null && !live(summary))) {
    throw new ContextError('rewound_branch', 'This compaction is no longer on the active branch.')
  }
  const boundaries = db
    .prepare('SELECT id, sequence FROM message WHERE session_id = ? AND sequence > ? AND sequence <= ? ORDER BY sequence')
    .all(sessionId, Number.isFinite(after) ? after : -1, through)
    .filter((row) => live(row.sequence))
  if (boundaries.length === 0) return { messages: [], total: 0, available: true }
  const capped = boundaries.slice(0, 500)
  const messageStmt = db.prepare(
    `SELECT m.id, m.sequence, m.time_created, m.time_updated,
            json_extract(m.data,'$.role') AS role,
            json_extract(m.data,'$.semantics.kind') AS kind,
            json_extract(m.data,'$.semantics.origin') AS origin,
            json_extract(m.data,'$.semantics.source') AS source,
            json_extract(m.data,'$.semantics.providerVisibility') AS visibility,
            json_extract(m.data,'$.synthetic') AS synthetic,
            substr(json_extract(m.data,'$.summary.body'), 1, 4000) AS summary_preview
     FROM message m WHERE m.session_id = ? AND m.id = ?`,
  )
  const partStmt = db.prepare(
    `SELECT p.id, p.message_id, p.time_created,
            ${partField('$.type')} AS type,
            ${partField('$.tool')} AS tool,
            ${partField('$.callID')} AS call_id,
            ${partField('$.state.status')} AS status,
            length(${partField('$.text')}) AS text_chars,
            substr(${partField('$.text')}, 1, 1200) AS text_preview,
            length(${partField('$.state.input')}) AS input_chars,
            substr(${partField('$.state.input')}, 1, 400) AS input_sample,
            length(${partField('$.state.output')}) AS output_chars,
            substr(${partField('$.state.output')}, 1, 400) AS output_preview,
            ${partField('$.state.input.description')} AS description,
            ${partField('$.state.input.command')} AS command,
            ${partField('$.state.input.file_path')} AS file_path,
            ${partField('$.state.input.skill')} AS skill
     FROM part p WHERE p.session_id = ? AND p.message_id = ? ORDER BY p.time_created, p.id`,
  )
  const messages = capped
    .map((boundary) => {
      const message = messageStmt.get(sessionId, boundary.id)
      if (!message) return null
      return { ...message, parts: partStmt.all(sessionId, boundary.id) }
    })
    .filter(Boolean)
  return { messages, total: boundaries.length, available: true, truncated: boundaries.length > capped.length }
}

/** Per-session aggregate over agent requests in a time range (cross-session insights). */
export function readInsights(db, { since, limit = 500 } = {}) {
  const cutoff = Number.isFinite(since) ? since : Date.now() - 30 * 86_400_000
  const perModel = db
    .prepare(
      `SELECT session_id, provider_id, model_id,
              COUNT(*) AS calls,
              SUM(input_tokens) AS input_tokens,
              SUM(output_tokens) AS output_tokens,
              SUM(cache_read_input_tokens) AS cache_read,
              SUM(cache_creation_input_tokens) AS cache_write,
              MIN(started_at) AS first_at,
              MAX(COALESCE(completed_at, started_at)) AS last_at
       FROM model_usage
       WHERE started_at >= ? AND query_source IN ${AGENT_SQL}
       GROUP BY session_id, provider_id, model_id
       ORDER BY last_at DESC`,
    )
    .all(cutoff)
  const daily = db
    .prepare(
      `SELECT session_id,
              date(started_at / 1000, 'unixepoch', 'localtime') AS day,
              SUM(input_tokens) AS input_tokens,
              SUM(output_tokens) AS output_tokens,
              SUM(cache_read_input_tokens) AS cache_read,
              SUM(cache_creation_input_tokens) AS cache_write,
              COUNT(*) AS calls
       FROM model_usage
       WHERE started_at >= ? AND query_source IN ${AGENT_SQL}
       GROUP BY session_id, day
       ORDER BY day`,
    )
    .all(cutoff)
  const latest = db
    .prepare(
      `SELECT * FROM (
         SELECT session_id, provider_id, model_id, input_tokens, output_tokens,
                cache_read_input_tokens, cache_creation_input_tokens, started_at, completed_at,
                duration_ms, time_to_first_token_ms, turn_id, status,
                ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY started_at DESC) AS rn
         FROM model_usage
         WHERE started_at >= ? AND query_source IN ${AGENT_SQL}
       ) WHERE rn = 1`,
    )
    .all(cutoff)
  const ids = [...new Set(perModel.map((row) => row.session_id))].slice(0, limit)
  const idSet = new Set(ids)
  const placeholders = ids.map(() => '?').join(',') || 'NULL'
  const sessions = ids.length
    ? db
        .prepare(
          `SELECT id, parent_id, title, directory, project_id, task_type, time_created, time_updated,
                  time_archived, title_source
           FROM session WHERE id IN (${placeholders})`,
        )
        .all(...ids)
    : []
  return {
    since: cutoff,
    perModel: perModel.filter((row) => idSet.has(row.session_id)),
    daily: daily.filter((row) => idSet.has(row.session_id)),
    latest: latest.filter((row) => idSet.has(row.session_id)),
    sessions,
    truncated: new Set(perModel.map((row) => row.session_id)).size > ids.length,
  }
}

/** The current session, its ancestor chain, and its/its family's descendants. */
export function readFleetSessions(db, sessionId, { maxNodes = 80 } = {}) {
  const current = db.prepare('SELECT * FROM session WHERE id = ?').get(sessionId)
  if (!current) return { sessions: [], truncated: false, currentId: sessionId }
  const byId = new Map([[current.id, current]])
  let cursor = current
  for (let depth = 0; depth < 12 && cursor?.parent_id; depth++) {
    const parent = db.prepare('SELECT * FROM session WHERE id = ?').get(cursor.parent_id)
    if (!parent || byId.has(parent.id)) break
    byId.set(parent.id, parent)
    cursor = parent
  }
  const roots = [...byId.values()].filter((row) => !row.parent_id || !byId.has(row.parent_id))
  const queue = roots.length > 0 ? [...roots] : [current]
  const seen = new Set([...byId.keys()])
  let truncated = false
  while (queue.length > 0) {
    if (byId.size >= maxNodes) {
      truncated = true
      break
    }
    const node = queue.shift()
    const children = db
      .prepare('SELECT * FROM session WHERE parent_id = ? ORDER BY time_created, id LIMIT ?')
      .all(node.id, Math.max(1, maxNodes - byId.size))
    for (const child of children) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      byId.set(child.id, child)
      queue.push(child)
    }
  }
  return { sessions: [...byId.values()], truncated, currentId: sessionId }
}

export function readUsageForSessions(db, sessionIds) {
  if (sessionIds.length === 0) return []
  const placeholders = sessionIds.map(() => '?').join(',')
  return db
    .prepare(
      `SELECT session_id, provider_id, model_id, COUNT(*) AS calls,
              SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
              SUM(cache_read_input_tokens) AS cache_read,
              SUM(cache_creation_input_tokens) AS cache_write,
              SUM(computed_total_tokens) AS total_tokens,
              MIN(started_at) AS first_at, MAX(COALESCE(completed_at, started_at)) AS last_at,
              COUNT(DISTINCT turn_id) AS turns
       FROM model_usage WHERE session_id IN (${placeholders}) AND query_source IN ${AGENT_SQL}
       GROUP BY session_id, provider_id, model_id`,
    )
    .all(...sessionIds)
}

export function readLatestUsageForSessions(db, sessionIds) {
  if (sessionIds.length === 0) return []
  const placeholders = sessionIds.map(() => '?').join(',')
  return db
    .prepare(
      `SELECT * FROM (
         SELECT session_id, provider_id, model_id, input_tokens, output_tokens,
                cache_read_input_tokens, cache_creation_input_tokens, computed_total_tokens,
                started_at, completed_at, duration_ms, time_to_first_token_ms, status, turn_id,
                ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY started_at DESC) AS rn
         FROM model_usage WHERE session_id IN (${placeholders}) AND query_source IN ${AGENT_SQL}
       ) WHERE rn = 1`,
    )
    .all(...sessionIds)
}

/** First real user prompt and latest assistant text for a fleet member's detail drawer. */
export function readSessionPreview(db, sessionId) {
  const first = db
    .prepare(
      `SELECT m.id, m.time_created,
              json_extract(m.data,'$.role') AS role,
              json_extract(m.data,'$.semantics.kind') AS kind,
              json_extract(m.data,'$.semantics.providerVisibility') AS visibility
       FROM message m WHERE m.session_id = ?
       ORDER BY m.sequence, m.time_created, m.id LIMIT 1`,
    )
    .get(sessionId)
  const firstText = first
    ? db
        .prepare(
          `SELECT substr(json_extract(data,'$.text'),1,1200) AS text FROM part
           WHERE message_id = ? AND json_extract(data,'$.type')='text' ORDER BY time_created, id LIMIT 1`,
        )
        .get(first.id)?.text ?? ''
    : ''
  const last = db
    .prepare(
      `SELECT m.id, m.time_created FROM message m
       WHERE m.session_id = ? AND json_extract(m.data,'$.role')='assistant'
         AND json_extract(m.data,'$.semantics.providerVisibility')='visible'
       ORDER BY m.sequence DESC, m.time_created DESC, m.id DESC LIMIT 1`,
    )
    .get(sessionId)
  const lastText = last
    ? db
        .prepare(
          `SELECT substr(json_extract(data,'$.text'),1,1200) AS text FROM part
           WHERE message_id = ? AND json_extract(data,'$.type')='text'
           ORDER BY time_created DESC, id DESC LIMIT 1`,
        )
        .get(last.id)?.text ?? ''
    : ''
  return {
    initialPrompt: String(firstText ?? '').trim(),
    lastReply: last ? { time: last.time_created, text: String(lastText ?? '').trim() } : null,
  }
}

/** Context windows configured in ZCode's own provider config (model/provider rules only). */
export function readProviderWindows(path) {
  const map = new Map()
  if (!path) return map
  let parsed
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return map
  }
  const rules = parsed?.config?.modelConfigRules?.providerModelRules
  if (Array.isArray(rules)) {
    for (const rule of rules) {
      const model = String(rule?.modelId ?? '').toLowerCase()
      const provider = String(rule?.providerId ?? '').toLowerCase()
      const window = Number(rule?.config?.properties?.contextWindow)
      if (!model || !Number.isFinite(window) || window <= 0) continue
      if (provider) map.set(provider + '/' + model, window)
      if (!map.has(model)) map.set(model, window)
    }
  }
  const legacy = parsed?.config?.legacyModelConfigs
  if (Array.isArray(legacy)) {
    for (const rule of legacy) {
      const model = String(rule?.modelId ?? rule?.id ?? '').toLowerCase()
      const window = Number(rule?.contextWindow ?? rule?.properties?.contextWindow)
      if (model && Number.isFinite(window) && window > 0 && !map.has(model)) map.set(model, window)
    }
  }
  return map
}

/** App-level "keep complete model I/O" preference; null when the setting file is unreadable. */
export function readFullRetention(path) {
  if (!path) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return typeof parsed?.modelIoFullRetentionEnabled === 'boolean' ? parsed.modelIoFullRetentionEnabled : false
  } catch {
    return null
  }
}

/** Per-day, per-model billed buckets for cross-session cost bars. */
export function readInsightsDailyModel(db, since) {
  return db
    .prepare(
      `SELECT session_id,
              date(started_at / 1000, 'unixepoch', 'localtime') AS day,
              provider_id, model_id,
              SUM(input_tokens) AS input_tokens,
              SUM(output_tokens) AS output_tokens,
              SUM(cache_read_input_tokens) AS cache_read,
              SUM(cache_creation_input_tokens) AS cache_write,
              COUNT(*) AS calls
       FROM model_usage
       WHERE started_at >= ? AND query_source IN ${AGENT_SQL}
       GROUP BY session_id, day, provider_id, model_id
       ORDER BY day`,
    )
    .all(since)
}

export function readChildrenSessions(db, sessionId) {
  return db
    .prepare(
      `SELECT id, parent_id, title, directory, task_type, time_created, time_updated
       FROM session WHERE parent_id = ? ORDER BY time_created, id`,
    )
    .all(sessionId)
}
