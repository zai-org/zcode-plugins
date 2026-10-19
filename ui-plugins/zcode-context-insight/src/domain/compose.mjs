/**
 * Session composition: turn the raw rows into the snapshot the Context panel renders.
 *
 * The session store is complete, so every request's message composition is reconstructed from it;
 * the model-I/O trajectory supplies the request header (system prompt + tool schemas) and is used
 * only when a record for that request exists. Category figures are heuristic; provider-reported
 * prompt tokens anchor each request's total, so the trend is comparable with the chat's bill.
 */

import { formatCost, formatTokens, oneLineOf, truncate } from '../shared/estimate.mjs'
import { buildConversationItems, buildHeaderItems } from './items.mjs'
import { buildEvents } from './events.mjs'
import { fileActivity } from './files.mjs'
import { recordFor, latestRecord } from '../data/rollout.mjs'
import { currencyForLocale, priceCall, resolveModel } from '../shared/pricing.mjs'
import { isAgentSource, nonnegative } from './session.mjs'

const CATS = ['system', 'tools', 'user', 'inject', 'skill', 'assistant', 'tool', 'unknown']
const MESSAGE_CATS = ['user', 'inject', 'skill', 'assistant', 'tool']

export const CATEGORY_META = [
  { key: 'system', color: 'var(--cat-system)' },
  { key: 'tools', color: 'var(--cat-tools)' },
  { key: 'user', color: 'var(--cat-user)' },
  { key: 'inject', color: 'var(--cat-inject)' },
  { key: 'skill', color: 'var(--cat-skill)' },
  { key: 'assistant', color: 'var(--cat-assistant)' },
  { key: 'tool', color: 'var(--cat-tool)' },
  { key: 'unknown', color: 'var(--cat-unknown)' },
]

function emptyParts() {
  return { system: 0, tools: 0, user: 0, inject: 0, skill: 0, assistant: 0, tool: 0, unknown: 0 }
}

function sumParts(parts) {
  let total = 0
  for (const cat of CATS) total += Number(parts[cat]) || 0
  return total
}

function addItem(parts, item) {
  const cat = CATS.includes(item.cat) ? item.cat : 'unknown'
  parts[cat] += Number(item.tokens) || 0
}

function roundParts(parts) {
  const out = {}
  for (const cat of CATS) out[cat] = Math.max(0, Math.round(Number(parts[cat]) || 0))
  return out
}

/** Keep the visual total equal to the provider's prompt count after rounding. */
function reconcile(parts, target) {
  if (!Number.isFinite(target) || target <= 0) return roundParts(parts)
  const out = roundParts(parts)
  let total = sumParts(out)
  let diff = Math.round(target) - total
  if (diff === 0) return out
  const order = [...CATS].sort((a, b) => out[b] - out[a])
  for (const cat of order) {
    if (diff === 0) break
    if (diff > 0) {
      out[cat] += diff
      diff = 0
    } else {
      const take = Math.min(out[cat], -diff)
      out[cat] -= take
      diff += take
    }
  }
  // If the target was smaller than every recorded bucket (rare), keep the target honestly in
  // `unknown` rather than silently zeroing a known category.
  if (diff !== 0) out.unknown = Math.max(0, out.unknown + diff)
  return out
}

function boundaryOf(row, conversation) {
  const assistant = row.assistant_message_id ? conversation.messageMap.get(row.assistant_message_id) : null
  const seq = Number.isFinite(assistant?.sequence) ? assistant.sequence : null
  return { seq, time: Number(row.started_at) || 0, assistantId: row.assistant_message_id ?? null }
}

function beforeBoundary(item, boundary) {
  if (item.header) return true
  if (boundary.seq !== null && Number.isFinite(item.messageSeq)) return item.messageSeq < boundary.seq
  return (item.time ?? 0) < boundary.time
}

function headerFor(row, rollout, fallback) {
  const exact = recordFor(rollout, row)
  const record = exact ?? fallback
  const header = buildHeaderItems(record)
  return {
    ...header,
    exact: Boolean(exact),
    estimated: !exact && Boolean(record),
    missing: !record,
    record,
    maxOutputTokens: header.maxOutputTokens ?? null,
  }
}

function anchorRequest(header, messageItems, row) {
  const raw = emptyParts()
  for (const item of header.items) addItem(raw, item)
  const messageRaw = emptyParts()
  for (const item of messageItems) addItem(messageRaw, item)
  for (const cat of MESSAGE_CATS) raw[cat] += messageRaw[cat]

  const actual = Number(row.input_tokens) > 0 ? Number(row.input_tokens) : 0
  const headerRaw = (raw.system ?? 0) + (raw.tools ?? 0)
  const messageTotal = MESSAGE_CATS.reduce((sum, cat) => sum + messageRaw[cat], 0)
  const allRaw = sumParts(raw)
  let parts = { ...raw }
  let scale = 1
  let scaleAll = 1

  if (actual > 0 && allRaw > 0) {
    if (header.missing) {
      if (messageTotal > actual) {
        scale = actual / Math.max(1, messageTotal)
        for (const cat of MESSAGE_CATS) parts[cat] = messageRaw[cat] * scale
        parts.system = 0
        parts.tools = 0
      } else {
        parts.unknown = Math.max(0, actual - messageTotal)
      }
      parts = reconcile(parts, actual)
    } else {
      const targetMessages = actual - headerRaw
      if (targetMessages >= 0) {
        if (messageTotal > 0) {
          scale = targetMessages / messageTotal
          for (const cat of MESSAGE_CATS) parts[cat] = messageRaw[cat] * scale
          parts.unknown = 0
        } else {
          parts.unknown = targetMessages
        }
      } else {
        scaleAll = actual / allRaw
        scale = scaleAll
        for (const cat of CATS) parts[cat] = raw[cat] * scaleAll
        parts.unknown = 0
      }
      parts = reconcile(parts, actual)
    }
  } else if (header.missing && actual > 0) {
    parts.unknown = actual
    parts = reconcile(parts, actual)
  }

  const prompt = actual || sumParts(roundParts(raw))
  return {
    parts: roundParts(parts),
    prompt,
    rawParts: roundParts(raw),
    rawTotal: allRaw,
    scale,
    scaleAll,
    headerRaw,
    messageTotal,
    anchored: actual > 0,
  }
}

function requestRowView(row, index, turnNumber, boundary, header, messageItems, session, options) {
  const anchor = anchorRequest(header, messageItems, row)
  const provider = row.provider_id ?? ''
  const model = row.model_id ?? ''
  const info = resolveModel(provider, model, options)
  const cacheRead = nonnegative(row.cache_read_input_tokens) ?? 0
  const cacheWrite = nonnegative(row.cache_creation_input_tokens) ?? 0
  const output = nonnegative(row.output_tokens) ?? 0
  const reasoning = nonnegative(row.reasoning_tokens) ?? 0
  const input = nonnegative(row.input_tokens) ?? 0
  const cost = priceCall(
    provider,
    model,
    { input, cacheRead, cacheWrite, output },
    { priceFile: options.priceFile, currency: options.currency },
  )
  return {
    index,
    step: index,
    turn: turnNumber,
    time: row.started_at,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? null,
    model,
    provider,
    status: row.status ?? 'unknown',
    finishReason: row.finish_reason ?? null,
    prompt: anchor.prompt,
    input,
    output,
    reasoning,
    cacheRead,
    cacheWrite,
    total: input + output,
    parts: anchor.parts,
    rawParts: anchor.rawParts,
    rawTotal: anchor.rawTotal,
    anchorScale: anchor.scale,
    anchored: anchor.anchored,
    durationMs: nonnegative(row.duration_ms) ?? null,
    ttftMs: nonnegative(row.time_to_first_token_ms) ?? null,
    toolCalls: nonnegative(row.tool_call_count) ?? 0,
    querySource: row.query_source,
    headerEstimated: header.estimated,
    headerMissing: header.missing,
    contextWindow: info.contextWindow,
    contextPct: info.contextWindow ? (anchor.prompt / info.contextWindow) * 100 : null,
    cost,
    currency: options.currency,
    turnId: row.turn_id ?? null,
    assistantMessageId: row.assistant_message_id ?? null,
    parentUserMessageId: row.parent_user_message_id ?? null,
    boundary: boundary.seq,
    boundaryTime: boundary.time,
    complete: true,
  }
}

function turnNumbers(rows) {
  const map = new Map()
  let next = 0
  for (const row of rows) {
    const key = row.turn_id ?? '__row:' + row.started_at
    if (!map.has(key)) map.set(key, ++next)
  }
  return map
}

function assistantPreview(conversation, assistantMessageId) {
  if (!assistantMessageId) return { text: '', tools: [] }
  const parts = conversation.byMessage.get(assistantMessageId) ?? []
  let text = ''
  const tools = []
  for (const part of parts) {
    if (part.type === 'text' && !text) text = String(part.text_preview ?? '')
    if (part.type === 'tool') tools.push(String(part.tool ?? 'tool'))
  }
  return { text, tools }
}

function messageForTurn(conversation, row) {
  if (row.parent_user_message_id) {
    const message = conversation.messageMap.get(row.parent_user_message_id)
    if (message) return message
  }
  const boundary = boundaryOf(row, conversation)
  let best = null
  for (const message of conversation.messages) {
    if (message.role !== 'user' || message.kind !== 'user_prompt') continue
    if (boundary.seq !== null && message.sequence != null && message.sequence >= boundary.seq) continue
    if (boundary.seq === null && message.time_created >= boundary.time) continue
    best = message
  }
  return best
}

function humanInputCount(conversation) {
  return conversation.messages.filter(
    (message) =>
      message.role === 'user' &&
      message.kind === 'user_prompt' &&
      message.origin === 'real_user' &&
      message.visibility !== 'hidden',
  ).length
}

function answerCount(conversation) {
  let count = 0
  for (const message of conversation.messages) {
    if (message.role !== 'assistant' || message.visibility === 'hidden') continue
    const parts = conversation.byMessage.get(message.id) ?? []
    if (parts.some((part) => part.type === 'text' && Number(part.text_chars) > 0)) count++
  }
  return count
}

function toolCallCount(conversation) {
  let count = 0
  for (const part of conversation.parts) {
    if (part.type === 'tool') count++
  }
  return count
}

function imageCount(items) {
  return items.filter((item) => item.kind === 'image' && item.images).reduce((sum, item) => sum + item.images, 0)
}

function skillNames(items) {
  return [...new Set(items.filter((item) => item.cat === 'skill' && item.skill).map((item) => item.skill))]
}

function timingOf(rows, toolRows, conversation) {
  let modelMs = 0
  let ttftMs = 0
  let outputTokens = 0
  let calls = 0
  const spans = []
  for (const row of rows) {
    const duration = nonnegative(row.duration_ms) ?? 0
    modelMs += duration
    const ttft = nonnegative(row.time_to_first_token_ms) ?? 0
    ttftMs += ttft
    outputTokens += nonnegative(row.output_tokens) ?? 0
    if (duration > 0 || row.status === 'completed') calls++
    const start = Number(row.started_at) || 0
    const first = Number(row.first_token_at) || (ttft > 0 && start > 0 ? start + ttft : 0)
    const end = Number(row.completed_at) || 0
    if (start > 0 && first > start) spans.push({ kind: 'ttft', start, end: first })
    if (first > 0 && end > first) spans.push({ kind: 'text', start: first, end })
  }
  let toolsMs = 0
  let toolCalls = 0
  for (const tool of toolRows) {
    toolsMs += nonnegative(tool.duration_ms) ?? 0
    if (tool.tool_name) toolCalls++
    const start = Number(tool.started_at) || 0
    const end = Number(tool.completed_at) || 0
    if (start > 0 && end > start) spans.push({ kind: 'tools', start, end })
  }
  const starts = rows.map((row) => Number(row.started_at) || 0).filter(Boolean)
  const ends = rows.map((row) => Number(row.completed_at) || Number(row.started_at) || 0).filter(Boolean)
  const wallMs = starts.length && ends.length ? Math.max(0, Math.max(...ends) - Math.min(...starts)) : 0
  const genMs = Math.max(0, modelMs - ttftMs)
  const otherMs = Math.max(0, wallMs - modelMs - toolsMs)
  spans.sort((a, b) => a.start - b.start || a.end - b.end)
  return {
    wallMs,
    ttftMs,
    genMs,
    modelMs,
    toolsMs,
    otherMs,
    calls,
    toolCalls,
    outputTokens,
    speedTokens: outputTokens,
    speedMs: genMs,
    spans: spans.slice(0, 360),
  }
}

/** Compaction cuts: a request after a compaction must not count the messages it summarized. */
function compactionCuts(conversation) {
  const cuts = []
  for (const part of conversation.parts) {
    if (part.type !== 'compaction' && !(part.type === 'timeline' && part.timeline_type === 'context_compaction')) continue
    let data
    try {
      data = JSON.parse(part.raw_preview)
    } catch {
      continue
    }
    if (!data || typeof data !== 'object') continue
    const boundary = data.compactBoundary && typeof data.compactBoundary === 'object' ? data.compactBoundary : {}
    const lastId = boundary.lastSummarizedMessageId ?? data.lastSummarizedMessageId
    const lastMessage = lastId ? conversation.messageMap.get(lastId) : null
    if (!lastMessage || !Number.isFinite(lastMessage.sequence)) continue
    const summaryId = data.summaryMessageId ?? boundary.summaryMessageId ?? null
    const summaryMessage = summaryId ? conversation.messageMap.get(summaryId) : null
    cuts.push({
      time: Number(data.time?.start) || part.time_created,
      lastSeq: lastMessage.sequence,
      summarySeq: summaryMessage?.sequence ?? null,
    })
  }
  return cuts.sort((a, b) => a.time - b.time || a.lastSeq - b.lastSeq)
}

function cutFor(time, boundary, cuts) {
  let applied = null
  for (const cut of cuts) {
    if (cut.time > time) break
    if (boundary.seq !== null && cut.lastSeq >= boundary.seq) continue
    applied = cut
  }
  return applied
}

function coverageOf(rollout, rows, headers, fullRetention) {
  const exact = headers.filter((header) => header.exact).length
  const estimated = headers.filter((header) => header.estimated).length
  const missing = headers.filter((header) => header.missing).length
  const warnings = []
  if (missing > 0) warnings.push('header-missing')
  if (estimated > 0) warnings.push('header-estimated')
  if (fullRetention === false) warnings.push('retention-off')
  if (!rollout?.available) warnings.push('rollout-missing')
  return {
    rollout: rollout?.coverage ?? 'none',
    rolloutAvailable: Boolean(rollout?.available),
    fullRetention: fullRetention ?? null,
    headerExact: exact,
    headerEstimated: estimated,
    headerMissing: missing,
    messageSource: 'session-store',
    warnings,
  }
}

function lastUserItem(items) {
  let last = null
  for (const item of items) {
    if (item.cat === 'user' && item.kind === 'prompt') last = item
  }
  return last
}

function compactEvent(event) {
  return {
    id: event.id,
    kind: event.kind,
    time: event.time,
    endedAt: event.endedAt ?? null,
    status: event.status ?? null,
    trigger: event.trigger ?? null,
    reason: event.reason ?? null,
    phase: event.phase ?? null,
    from: event.from ?? null,
    to: event.to ?? null,
    name: event.name ?? null,
    source: event.source ?? null,
    form: event.form ?? null,
    sub: event.sub ?? null,
    tokens: event.tokens ?? null,
    delta: event.delta ?? null,
    summarizedCount: event.summarizedCount ?? null,
    keptCount: event.keptCount ?? null,
    preTokens: event.preTokens ?? null,
    postTokens: event.postTokens ?? null,
    durationMs: event.durationMs ?? null,
    turn: event.turn ?? null,
    step: event.step ?? null,
    fromTurn: event.fromTurn ?? null,
    fromStep: event.fromStep ?? null,
    itemKey: event.itemKey ?? null,
    text: truncate(event.text ?? '', 300),
    summarySequence: event.summarySequence ?? null,
    lastSequence: event.lastSequence ?? null,
    queryId: event.queryId ?? null,
    detail: event.detail ?? null,
  }
}

/**
 * Build the complete session view. The heavy underlying collections are attached as non-enumerable
 * properties so a JSON response for the panel's summary never carries every request element.
 */
export function buildSessionView({
  session,
  usageRows,
  toolRows = [],
  turnRows = [],
  conversation,
  rollout,
  preferences,
  providerWindows,
  fullRetention = null,
  subagentStats = null,
  now = Date.now(),
}) {
  const currency = currencyForLocale(preferences?.language === 'zh' ? 'zh' : preferences?.locale, preferences?.currency)
  const options = {
    priceFile: preferences?.priceFile ?? '',
    windowOverride: preferences?.contextWindow ?? 0,
    providerWindows,
    currency,
  }
  const rows = usageRows
    .filter((row) => isAgentSource(row.query_source))
    .sort(
      (a, b) =>
        (Number(a.started_at) || 0) - (Number(b.started_at) || 0) ||
        String(a.logical_request_id ?? '').localeCompare(String(b.logical_request_id ?? '')) ||
        (Number(a.attempt_index) || 0) - (Number(b.attempt_index) || 0),
    )
  const items = buildConversationItems(conversation)
  const cuts = compactionCuts(conversation)
  const fallback = latestRecord(rollout)
  const turnMap = turnNumbers(rows)
  const headers = []
  const requestItems = []
  const requests = []

  for (const [index, row] of rows.entries()) {
    const boundary = boundaryOf(row, conversation)
    const header = headerFor(row, rollout, fallback)
    headers.push(header)
    const cut = cutFor(Number(row.started_at) || 0, boundary, cuts)
    const messageItems = items.filter((item) => beforeBoundary(item, boundary) && (cut === null || item.messageSeq == null || item.messageSeq > cut.lastSeq))
    requestItems.push({ row, boundary, header, messageItems })
    requests.push(requestRowView(row, index + 1, turnMap.get(row.turn_id ?? '__row:' + row.started_at), boundary, header, messageItems, session, options))
  }

  const current = requests[requests.length - 1] ?? null
  const currentBundle = requestItems[requestItems.length - 1] ?? null
  const currentItems = currentBundle ? [...currentBundle.header.items, ...currentBundle.messageItems] : []
  const currentModel = current ? resolveModel(current.provider, current.model, options) : null
  const window = currentModel?.contextWindow ?? null
  const maxOutputTokens = currentBundle?.header.maxOutputTokens ?? currentModel?.maxOutput ?? null
  const lastUser = lastUserItem(currentItems)
  const currentParts = current?.parts ?? emptyParts()

  let cost = null
  let costCurrency = currency
  let pricedCalls = 0
  for (const request of requests) {
    if (request.cost != null) {
      cost = (cost ?? 0) + request.cost
      pricedCalls++
    }
  }
  const stats = {
    turns: turnMap.size,
    steps: requests.length,
    humanInputs: humanInputCount(conversation),
    answers: answerCount(conversation),
    toolCalls: toolCallCount(conversation),
    images: imageCount(currentItems),
    skills: skillNames(items).length,
    skillNames: skillNames(items).slice(0, 20),
    promptTokens: requests.reduce((sum, request) => sum + request.prompt, 0),
    outputTokens: requests.reduce((sum, request) => sum + request.output, 0),
    billedTokens: requests.reduce((sum, request) => sum + request.prompt + request.output, 0),
    cacheRead: requests.reduce((sum, request) => sum + request.cacheRead, 0),
    cacheWrite: requests.reduce((sum, request) => sum + request.cacheWrite, 0),
    cacheHitRate: null,
    cost,
    currency: costCurrency,
    pricedCalls,
    unpricedCalls: requests.length - pricedCalls,
    timing: timingOf(rows, toolRows, conversation),
    subagents: subagentStats ?? { count: 0, usage: null },
    currentMessages: currentBundle?.messageItems.length ?? 0,
  }
  const billedPrompt = stats.promptTokens
  stats.cacheHitRate = billedPrompt > 0 ? (stats.cacheRead / billedPrompt) * 100 : null

  const eventList = buildEvents(conversation, items, requests)
  const fileSummary = fileActivity(conversation, current?.boundary ?? null)
  const toolTally = new Map()
  for (const part of conversation.parts) {
    if (part.type !== 'tool' || !part.tool) continue
    toolTally.set(part.tool, (toolTally.get(part.tool) ?? 0) + 1)
  }
  stats.toolTally = [...toolTally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8)
  for (const header of headers) {
    for (const item of header.items) {
      if (item.cat === 'tools') item.calls = toolTally.get(item.tool) ?? 0
    }
  }
  stats.files = fileSummary.totals
  const eventCounts = { inject: 0, compaction: 0, prune: 0, model: 0, mode: 0, rewind: 0, mcp: 0 }
  for (const event of eventList) if (eventCounts[event.kind] != null) eventCounts[event.kind]++
  stats.eventCounts = eventCounts
  const coverage = coverageOf(rollout, rows, headers, fullRetention)
  const currentPct = window ? (current?.prompt ?? 0) / window * 100 : null

  const view = {
    session: {
      id: session.id,
      title: session.title,
      directory: session.directory,
      projectId: session.project_id,
      parentId: session.parent_id ?? null,
      taskType: session.task_type ?? null,
      createdAt: session.time_created,
      updatedAt: session.time_updated,
      model: current?.model ?? null,
      provider: current?.provider ?? null,
      contextWindow: window,
      contextWindowSource: currentModel?.windowSource ?? null,
      maxOutputTokens,
      currency,
    },
    stats,
    current: current
      ? {
          index: current.index,
          step: current.step,
          turn: current.turn,
          time: current.time,
          model: current.model,
          provider: current.provider,
          status: current.status,
          prompt: current.prompt,
          total: current.total,
          output: current.output,
          reasoning: current.reasoning,
          cacheRead: current.cacheRead,
          cacheWrite: current.cacheWrite,
          window,
          pct: currentPct,
          reserve: maxOutputTokens,
          parts: currentParts,
          headerEstimated: current.headerEstimated,
          headerMissing: current.headerMissing,
          lastUser: lastUser?.preview ?? lastUser?.title ?? null,
          lastUserTitle: lastUser?.title ?? null,
          toolCalls: currentItems.filter((item) => item.kind === 'tool-result').length,
          messages: currentBundle?.messageItems.length ?? 0,
          images: imageCount(currentItems),
          skills: skillNames(currentItems),
          contextWindowSource: currentModel?.windowSource ?? null,
          maxOutputTokens,
        }
      : null,
    requests,
    events: eventList.map(compactEvent),
    files: {
      totals: fileSummary.totals,
      opCount: fileSummary.opCount,
      entries: fileSummary.entries.slice(0, 300).map((entry) => ({
        path: entry.path,
        form: entry.form,
        reads: entry.reads,
        writes: entry.writes,
        searches: entry.searches,
        added: entry.added,
        removed: entry.removed,
        pattern: entry.pattern ?? false,
        latest: entry.latest,
        ops: entry.ops.length,
      })),
      truncated: fileSummary.entries.length > 300,
    },
    coverage,
    preferences: preferences ?? {},
    generatedAt: now,
    timing: stats.timing,
  }

  Object.defineProperty(view, '_items', { value: items, enumerable: false })
  Object.defineProperty(view, '_rows', { value: rows, enumerable: false })
  Object.defineProperty(view, '_requestItems', { value: requestItems, enumerable: false })
  Object.defineProperty(view, '_headers', { value: headers, enumerable: false })
  Object.defineProperty(view, '_conversation', { value: conversation, enumerable: false })
  Object.defineProperty(view, '_rollout', { value: rollout, enumerable: false })
  Object.defineProperty(view, '_options', { value: options, enumerable: false })
  Object.defineProperty(view, '_session', { value: session, enumerable: false })
  return view
}

function enterStamp(item, requests) {
  if (item.header) return { step: null, turn: null, live: true }
  for (const request of requests) {
    if (item.messageSeq != null && request.boundary != null && item.messageSeq < request.boundary) {
      return { step: request.step, turn: request.turn, live: request.index === requests[requests.length - 1]?.index }
    }
    if (item.messageSeq == null && (item.time ?? 0) < (request.startedAt ?? 0)) {
      return { step: request.step, turn: request.turn, live: false }
    }
  }
  return { step: null, turn: null, live: false }
}

export function itemSummary(item, requests) {
  return {
    key: item.key,
    cat: item.cat,
    kind: item.kind,
    tokens: Math.round(item.tokens ?? 0),
    chars: item.chars ?? 0,
    title: truncate(item.title ?? '', 180),
    preview: truncate(item.preview ?? '', 160),
    tool: item.tool ?? null,
    toolCallId: item.toolCallId ?? null,
    status: item.status ?? null,
    source: item.source ?? null,
    skill: item.skill ?? null,
    form: item.form ?? null,
    time: item.time ?? null,
    messageId: item.messageId ?? null,
    partId: item.partId ?? null,
    messageSeq: item.messageSeq ?? null,
    order: item.order ?? 0,
    lineCount: item.lineCount ?? null,
    images: item.images ?? 0,
    calls: item.calls ?? null,
    enter: enterStamp(item, requests),
    header: Boolean(item.header),
  }
}

function groupItems(items, requests) {
  const groups = []
  for (const meta of CATEGORY_META) {
    const list = items.filter((item) => item.cat === meta.key)
    if (list.length === 0) continue
    const sorted = [...list].sort((a, b) => (b.tokens ?? 0) - (a.tokens ?? 0) || (a.order ?? 0) - (b.order ?? 0))
    groups.push({
      cat: meta.key,
      color: meta.color,
      count: list.length,
      tokens: Math.round(list.reduce((sum, item) => sum + (item.tokens ?? 0), 0)),
      items: sorted.slice(0, 100).map((item) => itemSummary(item, requests)),
      more: Math.max(0, sorted.length - 100),
    })
  }
  return groups
}

function diffOf(currentItems, baselineItems, currentRequest, baselineRequest) {
  if (!baselineRequest) {
    return { available: false, reason: 'no-baseline', added: [], removed: [], categories: [] }
  }
  const keyOf = (item) => item.key
  const before = new Map(baselineItems.map((item) => [keyOf(item), item]))
  const after = new Map(currentItems.map((item) => [keyOf(item), item]))
  const added = currentItems.filter((item) => !before.has(keyOf(item)))
  const removed = baselineItems.filter((item) => !after.has(keyOf(item)))
  const categories = CATEGORY_META.map((meta) => {
    const beforeTokens = baselineRequest.parts[meta.key] ?? 0
    const afterTokens = currentRequest.parts[meta.key] ?? 0
    return {
      cat: meta.key,
      before: beforeTokens,
      after: afterTokens,
      delta: afterTokens - beforeTokens,
      added: added.filter((item) => item.cat === meta.key).length,
      removed: removed.filter((item) => item.cat === meta.key).length,
    }
  }).filter((row) => row.before || row.after || row.added || row.removed)
  const changed = []
  for (const item of currentItems) {
    const previous = before.get(keyOf(item))
    if (!previous) continue
    if (Math.abs((item.tokens ?? 0) - (previous.tokens ?? 0)) > Math.max(8, (previous.tokens ?? 0) * 0.05)) {
      changed.push({
        before: { ...itemSummary(previous, []) },
        after: { ...itemSummary(item, []) },
      })
    }
  }
  return {
    available: true,
    reason: null,
    added: added.slice(0, 200).map((item) => itemSummary(item, currentRequest ? [currentRequest] : [])),
    removed: removed.slice(0, 200).map((item) => itemSummary(item, baselineRequest ? [baselineRequest] : [])),
    categories,
    changed: changed.slice(0, 60),
    addedCount: added.length,
    removedCount: removed.length,
  }
}

function briefOf(currentBundle, previousBundle, conversation, request) {
  const userMessage = messageForTurn(conversation, request ? { ...request, started_at: request.startedAt } : {})
  const userParts = userMessage ? conversation.byMessage.get(userMessage.id) ?? [] : []
  const userText = userParts.find((part) => part.type === 'text' && Number(part.text_chars) > 0)?.text_preview ?? ''
  const previousKeys = new Set(previousBundle ? [...previousBundle.header.items, ...previousBundle.messageItems].map((item) => item.key) : [])
  const currentItems = [...currentBundle.header.items, ...currentBundle.messageItems]
  const incoming = currentItems
    .filter((item) => !item.header && !previousKeys.has(item.key))
    .sort((a, b) => (b.tokens ?? 0) - (a.tokens ?? 0))
  const response = assistantPreview(conversation, currentBundle.row.assistant_message_id)
  return {
    user: {
      title: userMessage ? oneLineOf(userText || userMessage.summary_title || 'User message', 180) : '',
      messageId: userMessage?.id ?? null,
      turnId: request?.turnId ?? null,
    },
    incoming: incoming.slice(0, 5).map((item) => itemSummary(item, [])),
    incomingCount: incoming.length,
    response: {
      title: oneLineOf(response.text, 220),
      tools: response.tools.slice(0, 8),
      toolCount: response.tools.length,
    },
  }
}

/**
 * Detail for one selected request: category groups, a diff against a baseline, the step brief,
 * the flat DNA order, and the file activity up to this request.
 */
export function buildStepDetail(view, stepIndex, { baselineMode = 'step', search = '', sort = 'size' } = {}) {
  const index = Math.max(0, Math.min(view._rows.length - 1, Number(stepIndex) - 1))
  const bundle = view._requestItems[index]
  if (!bundle) return null
  const request = view.requests[index]
  const items = [...bundle.header.items, ...bundle.messageItems]
  let baselineIndex = baselineMode === 'off' ? -1 : index - 1
  if (baselineMode === 'turn') {
    const turn = request.turn
    while (baselineIndex >= 0 && view.requests[baselineIndex].turn === turn) baselineIndex--
  }
  const baselineBundle = baselineIndex >= 0 ? view._requestItems[baselineIndex] : null
  const baselineRequest = baselineIndex >= 0 ? view.requests[baselineIndex] : null
  const baselineItems = baselineBundle ? [...baselineBundle.header.items, ...baselineBundle.messageItems] : []
  let filtered = items
  if (typeof search === 'string' && search.trim()) {
    const needle = search.trim().toLowerCase()
    filtered = items.filter(
      (item) =>
        String(item.title ?? '').toLowerCase().includes(needle) ||
        String(item.preview ?? '').toLowerCase().includes(needle) ||
        String(item.tool ?? '').toLowerCase().includes(needle) ||
        String(item.skill ?? '').toLowerCase().includes(needle),
    )
  }
  if (sort === 'order') filtered = [...filtered].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  else if (sort === 'name') filtered = [...filtered].sort((a, b) => String(a.title).localeCompare(String(b.title)))
  else if (sort === 'calls') filtered = [...filtered].sort((a, b) => (b.calls ?? -1) - (a.calls ?? -1) || (b.tokens ?? 0) - (a.tokens ?? 0))
  const groups = groupItems(filtered, view.requests)
  const diff = diffOf(items, baselineItems, request, baselineRequest)
  const brief = briefOf(bundle, baselineBundle, view._conversation, request)
  const files = fileActivity(view._conversation, bundle.boundary.seq)
  const dna = items
    .filter((item) => (item.tokens ?? 0) > 0)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((item, position) => ({
      ...itemSummary(item, view.requests),
      position: position + 1,
      dnaCat: item.header ? (item.cat === 'system' ? 'system' : 'tools') : item.cat,
    }))
  return {
    step: request.step,
    turn: request.turn,
    index: request.index,
    request,
    baseline: baselineRequest
      ? { step: baselineRequest.step, turn: baselineRequest.turn, mode: baselineMode }
      : null,
    groups,
    diff,
    brief,
    dna,
    files: {
      totals: files.totals,
      opCount: files.opCount,
      entries: files.entries.slice(0, 300).map((entry) => ({
        ...entry,
        ops: entry.ops.slice(0, 100),
      })),
      truncated: files.entries.length > 300,
    },
    header: {
      exact: bundle.header.exact,
      estimated: bundle.header.estimated,
      missing: bundle.header.missing,
      maxOutputTokens: bundle.header.maxOutputTokens,
    },
    coverage: view.coverage,
    generatedAt: Date.now(),
  }
}

/**
 * One category's page of elements for the selected request. The full step detail is intentionally
 * capped; the browser loads more from here on demand.
 */
export function buildGroupDetail(view, stepIndex, cat, { offset = 0, limit = 40, search = '', sort = 'size' } = {}) {
  const index = Math.max(0, Math.min(view._rows.length - 1, Number(stepIndex) - 1))
  const bundle = view._requestItems[index]
  if (!bundle) return null
  const all = [...bundle.header.items, ...bundle.messageItems].filter((item) => item.cat === cat)
  let filtered = all
  if (typeof search === 'string' && search.trim()) {
    const needle = search.trim().toLowerCase()
    filtered = all.filter(
      (item) =>
        String(item.title ?? '').toLowerCase().includes(needle) ||
        String(item.preview ?? '').toLowerCase().includes(needle) ||
        String(item.tool ?? '').toLowerCase().includes(needle) ||
        String(item.skill ?? '').toLowerCase().includes(needle),
    )
  }
  if (sort === 'order') filtered = [...filtered].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  else if (sort === 'name') filtered = [...filtered].sort((a, b) => String(a.title).localeCompare(String(b.title)))
  else if (sort === 'calls') filtered = [...filtered].sort((a, b) => (b.calls ?? -1) - (a.calls ?? -1) || (b.tokens ?? 0) - (a.tokens ?? 0))
  else filtered = [...filtered].sort((a, b) => (b.tokens ?? 0) - (a.tokens ?? 0) || (a.order ?? 0) - (b.order ?? 0))
  const start = Math.max(0, Number(offset) || 0)
  const size = Math.max(1, Math.min(100, Number(limit) || 40))
  const items = filtered.slice(start, start + size).map((item) => itemSummary(item, view.requests))
  return {
    step: view.requests[index].step,
    turn: view.requests[index].turn,
    cat,
    total: filtered.length,
    tokens: Math.round(filtered.reduce((sum, item) => sum + (item.tokens ?? 0), 0)),
    offset: start,
    items,
    nextOffset: start + items.length < filtered.length ? start + items.length : null,
    more: Math.max(0, filtered.length - start - items.length),
  }
}

/** Flattened prompt-order DNA list for one request, paginated. */
export function buildDnaDetail(view, stepIndex, { offset = 0, limit = 120 } = {}) {
  const index = Math.max(0, Math.min(view._rows.length - 1, Number(stepIndex) - 1))
  const bundle = view._requestItems[index]
  if (!bundle) return null
  const all = [...bundle.header.items, ...bundle.messageItems]
    .filter((item) => (item.tokens ?? 0) > 0)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const start = Math.max(0, Number(offset) || 0)
  const size = Math.max(1, Math.min(200, Number(limit) || 120))
  const items = all.slice(start, start + size).map((item, position) => {
    const summary = itemSummary(item, view.requests)
    return {
      key: summary.key,
      cat: summary.cat,
      kind: summary.kind,
      tokens: summary.tokens,
      title: summary.title,
      tool: summary.tool,
      skill: summary.skill,
      enter: summary.enter,
      position: start + position + 1,
      dnaCat: item.header ? (item.cat === 'system' ? 'system' : 'tools') : item.cat,
    }
  })
  return {
    step: view.requests[index].step,
    turn: view.requests[index].turn,
    total: all.length,
    offset: start,
    items,
    nextOffset: start + items.length < all.length ? start + items.length : null,
  }
}

/**
 * Per-request DNA fingerprints for the trend bars: each band is one item (or a merged run of adjacent
 * items) in prompt order, encoded as [categoryIndex, tokens]. Bars remain scaled by the request's
 * actual prompt; this series only supplies the internal texture. Compressed to `maxBands` so a long
 * session stays inside the host payload budget.
 */
export function buildDnaSeries(view, { fromStep = 1, toStep = 1_000_000, maxBands = 36 } = {}) {
  const limit = Math.max(8, Math.min(80, Number(maxBands) || 36))
  const from = Math.max(1, Number(fromStep) || 1)
  const to = Math.max(from, Number(toStep) || 1_000_000)
  const steps = []
  for (const [index, request] of view.requests.entries()) {
    if (request.step < from || request.step > to) continue
    const bundle = view._requestItems[index]
    if (!bundle) continue
    const items = [...bundle.header.items, ...bundle.messageItems].filter((item) => (item.tokens ?? 0) > 0)
    let bands = items.map((item) => ({ cat: CATS.indexOf(item.cat), tokens: Math.max(0, item.tokens ?? 0) }))
    // Keep item boundaries (the fingerprint's stripes); merge only when the count exceeds the budget.
    while (bands.length > limit) {
      let best = 0
      let bestScore = Infinity
      for (let i = 0; i + 1 < bands.length; i++) {
        const score = bands[i].tokens + bands[i + 1].tokens + (bands[i].cat === bands[i + 1].cat ? 0 : 1e9)
        if (score < bestScore) {
          bestScore = score
          best = i
        }
      }
      if (!Number.isFinite(bestScore) || bestScore >= 1e9) {
        // No adjacent same-category pair: merge the smallest adjacent pair, keeping the larger share.
        best = 0
        bestScore = Infinity
        for (let i = 0; i + 1 < bands.length; i++) {
          const score = bands[i].tokens + bands[i + 1].tokens
          if (score < bestScore) {
            bestScore = score
            best = i
          }
        }
      }
      const left = bands[best]
      const right = bands[best + 1]
      bands.splice(best, 2, {
        cat: left.tokens >= right.tokens ? left.cat : right.cat,
        tokens: left.tokens + right.tokens,
      })
    }
    steps.push({
      step: request.step,
      turn: request.turn,
      prompt: request.prompt,
      bands: bands.map((band) => [band.cat, Math.round(band.tokens)]),
    })
  }
  return { categories: CATS, steps, maxBands: limit }
}

/** A compact, model-readable report for the `/context` command. */
export function buildReport(view) {
  const current = view.current
  if (!current) return 'No agent requests are recorded for this session yet.'
  const cats = CATEGORY_META.filter((meta) => (current.parts[meta.key] ?? 0) > 0)
    .map((meta) => `${meta.key} ${formatTokens(current.parts[meta.key])}`)
    .join(', ')
  const events = view.events.slice(-5).map((event) => {
    if (event.kind === 'compaction') {
      return `compaction ${event.status ?? ''} ${event.preTokens ?? '?'}→${event.postTokens ?? '?'} tokens`
    }
    if (event.kind === 'inject') return `injection ${event.name ?? event.form ?? ''} ${event.tokens ? formatTokens(event.tokens) : ''}`.trim()
    if (event.kind === 'model') return `model ${event.from} → ${event.to}`
    return event.kind
  })
  const lines = [
    `# Context · ${view.session.title ?? view.session.id}`,
    `Model: ${current.provider}/${current.model}`,
    `Current request: ${formatTokens(current.prompt)} prompt tokens${current.window ? ` / ${formatTokens(current.window)} (${(current.pct ?? 0).toFixed(1)}%)` : ''}`,
    `Composition: ${cats || 'no recorded categories'}`,
    `Session: ${view.stats.turns} turns · ${view.stats.steps} steps · ${view.stats.toolCalls} tool calls · cache hit ${view.stats.cacheHitRate == null ? '—' : view.stats.cacheHitRate.toFixed(1) + '%'}`,
  ]
  if (view.stats.cost != null) {
    lines.push(`Estimated cost: ${formatCost(view.stats.cost, view.stats.currency ?? 'usd')} (list price; provider billing may differ)`)
  }
  if (events.length) lines.push('Recent events: ' + events.join('; '))
  if (view.coverage.warnings.length) {
    lines.push(`Coverage: ${view.coverage.warnings.join(', ')}; message composition is reconstructed from the session store.`)
  }
  lines.push('Open the Context panel in the session side pane for the full trend, browser, events and file activity.')
  return lines.join('\n')
}
