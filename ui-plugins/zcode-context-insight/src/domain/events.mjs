/**
 * Context events: everything that entered or rewrote the window, derived from ZCode's own records.
 *
 * Compactions, model switches, injections and skill loads are authoritative rows in the conversation
 * store. The rich compaction parts carry the boundary, token counts, summarized/kept counts and the
 * summary message; failed attempts (a timeline-only part) are kept as their own event.
 */

import { oneLineOf } from '../shared/estimate.mjs'

const COMPACTION_STATUS_RANK = {
  unknown: 0,
  started: 1,
  retrying: 2,
  skipped: 3,
  interrupted: 4,
  completed: 5,
  failed: 5,
}

function parseJson(text) {
  try {
    const value = JSON.parse(text)
    return value && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

function modelLabel(selection) {
  if (!selection || typeof selection !== 'object') return null
  return (
    selection.label ??
    ([selection.providerId ?? selection.providerID, selection.modelId ?? selection.modelID]
      .filter(Boolean)
      .join('/') ||
      null)
  )
}

function stampFor(time, requests) {
  if (!Number.isFinite(time) || requests.length === 0) return { turn: null, step: null, fromTurn: null, fromStep: null }
  let from = null
  let next = null
  for (const request of requests) {
    if (request.startedAt <= time) from = request
    else {
      next = request
      break
    }
  }
  const target = next ?? from ?? requests[requests.length - 1]
  return {
    turn: target?.turn ?? null,
    step: target?.step ?? null,
    fromTurn: from?.turn ?? null,
    fromStep: from?.step ?? null,
  }
}

function compactionKey(data, part) {
  return (
    data?.operationId ??
    data?.boundaryId ??
    data?.compactBoundary?.boundaryId ??
    data?.sourceCommandId ??
    'part:' + part.id
  )
}

function mergeCompaction(group, data, part) {
  if (!data) return group
  const boundary = data.compactBoundary && typeof data.compactBoundary === 'object' ? data.compactBoundary : {}
  const status = String(data.status ?? data.timelineStatus ?? boundary.status ?? group.status ?? 'unknown').toLowerCase()
  if ((COMPACTION_STATUS_RANK[status] ?? 0) >= (COMPACTION_STATUS_RANK[group.status] ?? 0)) group.status = status
  const start = Number(data.time?.start ?? boundary.time?.start)
  const end = Number(data.time?.end ?? boundary.time?.end)
  if (Number.isFinite(start) && start > 0) group.time = Math.min(group.time || start, start)
  if (Number.isFinite(end) && end > 0) group.endedAt = Math.max(group.endedAt || 0, end)
  group.trigger ??= data.trigger ?? boundary.trigger ?? null
  group.reason ??= data.compactReason ?? boundary.compactReason ?? data.reason ?? null
  group.phase ??= data.phase ?? boundary.phase ?? null
  group.preTokens ??= Number(data.preCompactTokenCount ?? boundary.preCompactTokenCount) || null
  group.postTokens ??=
    Number(data.truePostCompactTokenCount ?? boundary.truePostCompactTokenCount) ||
    Number(data.postCompactTokenCount ?? boundary.postCompactTokenCount) ||
    null
  group.summarizedCount ??= Number(boundary.summarizedMessageCount ?? data.summarizedMessageCount) || null
  group.keptCount ??= Number(boundary.keptMessageCount ?? data.keptMessageCount) || null
  group.lastSummarizedMessageId ??= boundary.lastSummarizedMessageId ?? data.lastSummarizedMessageId ?? null
  group.summaryMessageId ??= data.summaryMessageId ?? boundary.summaryMessageId ?? null
  group.queryId ??= data.sourceCommandId ?? data.operationId ?? null
  group.attempt ??= Number(data.attempt) || null
  group.maxAttempts ??= Number(data.maxAttempts) || null
  group.auto = data.auto === true || group.trigger === 'auto' || group.auto === true
  group.part = group.part ?? part
  return group
}

/**
 * Build the whole event log. `items` must be the conversation item list so an injection event can
 * point at the exact browser element.
 */
export function buildEvents(conversation, items, requests) {
  const events = []
  const groups = new Map()

  for (const part of conversation.parts) {
    if (part.type !== 'compaction' && !(part.type === 'timeline' && part.timeline_type === 'context_compaction')) {
      continue
    }
    const data = parseJson(part.raw_preview)
    if (!data) continue
    const key = String(compactionKey(data, part))
    const group =
      groups.get(key) ??
      {
        id: 'c:' + key,
        kind: 'compaction',
        time: part.time_created,
        endedAt: null,
        status: 'unknown',
        trigger: null,
        reason: null,
        phase: null,
        preTokens: null,
        postTokens: null,
        summarizedCount: null,
        keptCount: null,
        lastSummarizedMessageId: null,
        summaryMessageId: null,
        queryId: null,
        attempt: null,
        maxAttempts: null,
        auto: false,
        part,
      }
    mergeCompaction(group, data, part)
    groups.set(key, group)
  }

  for (const group of groups.values()) {
    const summarySequence = group.summaryMessageId
      ? conversation.messageMap.get(group.summaryMessageId)?.sequence ?? null
      : null
    const lastSequence = group.lastSummarizedMessageId
      ? conversation.messageMap.get(group.lastSummarizedMessageId)?.sequence ?? null
      : null
    const stamp = stampFor(group.time, requests)
    const delta =
      Number.isFinite(group.preTokens) && Number.isFinite(group.postTokens)
        ? group.postTokens - group.preTokens
        : null
    events.push({
      ...group,
      ...stamp,
      time: group.time,
      endedAt: group.endedAt,
      durationMs: group.endedAt && group.time ? Math.max(0, group.endedAt - group.time) : null,
      delta,
      tokens: delta != null ? Math.abs(delta) : null,
      status: group.status === 'unknown' && (group.summaryMessageId || group.summarizedCount) ? 'completed' : group.status,
      summarySequence,
      lastSequence,
      detail:
        group.trigger === 'auto'
          ? group.reason || 'auto compaction'
          : group.trigger || group.reason || 'compaction',
    })
  }

  for (const item of items) {
    if (item.cat === 'inject' && item.kind !== 'compaction') {
      events.push({
        id: 'i:' + item.key,
        kind: 'inject',
        form: item.form ?? 'context',
        name: item.source ?? item.form ?? null,
        source: item.source ?? null,
        tokens: item.tokens,
        time: item.time ?? 0,
        text: item.preview ?? '',
        itemKey: item.key,
        messageId: item.messageId,
        partId: item.partId,
        ...stampFor(item.time ?? 0, requests),
      })
    } else if (item.cat === 'skill') {
      events.push({
        id: 's:' + item.key,
        kind: 'inject',
        form: 'skill',
        sub: 'skill',
        name: item.skill ?? null,
        tokens: item.tokens,
        time: item.time ?? 0,
        text: item.title,
        itemKey: item.key,
        messageId: item.messageId,
        partId: item.partId,
        ...stampFor(item.time ?? 0, requests),
      })
    }
  }

  for (const part of conversation.parts) {
    if (part.type !== 'timeline' || part.timeline_type !== 'model_change') continue
    const data = parseJson(part.raw_preview)
    if (!data) continue
    const from = modelLabel(data.fromModelSelection ?? data.fromModel)
    const to = modelLabel(data.toModelSelection ?? data.toModel)
    if (!to || from === to) continue
    const time = Number(data.time?.start) || part.time_created
    events.push({
      id: 'm:' + part.id,
      kind: 'model',
      time,
      from: from ?? '—',
      to,
      ...stampFor(time, requests),
    })
  }

  // A rewound conversation is a context event in its own right. The store keeps the abandoned
  // branch, so the card can say the current window was narrowed even without a per-message stamp.
  if (conversation.branch && conversation.branch.size > 0) {
    const last = requests[requests.length - 1]
    if (last) {
      events.push({
        id: 'rewind:session',
        kind: 'rewind',
        time: last.completedAt ?? last.startedAt,
        keptCount: conversation.branch.size,
        ...stampFor(last.startedAt, requests),
      })
    }
  }

  events.sort((a, b) => a.time - b.time || String(a.id).localeCompare(String(b.id)))
  return events
}

export function eventPreview(event) {
  if (event.kind === 'compaction') {
    return [event.trigger, event.reason, event.phase].filter(Boolean).join(' · ')
  }
  if (event.kind === 'inject') return event.name || event.form || ''
  if (event.kind === 'model') return event.from + ' → ' + event.to
  if (event.kind === 'rewind') return event.keptCount ? event.keptCount + ' kept' : ''
  return oneLineOf(event.detail, 160)
}
