/**
 * The panel's data service. One read-only SQLite connection, one cached session view per revision.
 * Heavy collections stay in this process; every MCP result is fitted to the host's 64 KiB budget.
 */

import {
  openDatabase,
  readChildrenSessions,
  readConversation,
  readFullRetention,
  readFleetSessions,
  readInsights,
  readInsightsDailyModel,
  readLatestUsageForSessions,
  readProviderWindows,
  readSessionPreview,
  readSessionRow,
  readToolRows,
  readTurnRows,
  readUsageForSessions,
  readUsageRows,
} from './data/db.mjs'
import { readPreferences, writePreferences } from './data/preferences.mjs'
import { readRollout, rolloutStamp } from './data/rollout.mjs'
import { buildDnaDetail, buildDnaSeries, buildGroupDetail, buildReport, buildSessionView, buildStepDetail } from './domain/compose.mjs'
import { readElementDetail, readEventDetail } from './domain/detail.mjs'
import { ContextError } from './domain/errors.mjs'
import { currencyForLocale, priceCall, resolveModel } from './shared/pricing.mjs'
import { formatTokens } from './shared/estimate.mjs'

export const PART_ORDER = ['system', 'tools', 'user', 'inject', 'skill', 'assistant', 'tool', 'unknown']
const STATUS_CODES = { completed: 0, running: 1, error: 2, cancelled: 3, unknown: 4 }
const HEADER_CODES = { exact: 0, estimated: 1, missing: 2 }
const MAX_PAYLOAD_BYTES = 58 * 1024

function payloadBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

function statusCode(status) {
  return STATUS_CODES[status] ?? STATUS_CODES.unknown
}

function headerCode(request) {
  if (request.headerMissing) return HEADER_CODES.missing
  return request.headerEstimated ? HEADER_CODES.estimated : HEADER_CODES.exact
}

function compactRequest(request) {
  return [
    request.step,
    request.turn,
    request.time,
    Math.round(request.prompt),
    Math.round(request.output),
    Math.round(request.cacheRead),
    Math.round(request.cacheWrite),
    request.durationMs ?? 0,
    request.ttftMs ?? 0,
    request.toolCalls ?? 0,
    statusCode(request.status),
    PART_ORDER.map((cat) => Math.round(request.parts?.[cat] ?? 0)),
    headerCode(request),
  ]
}

function safeName(value, max = 240) {
  const text = String(value ?? '')
  return text.length > max ? text.slice(0, max) : text
}

function compactEvents(events, limit) {
  return events.slice(-limit).map((event) => {
    const out = { id: event.id, kind: event.kind, time: event.time }
    const put = (key, value) => {
      if (value != null && value !== '') out[key] = typeof value === 'string' ? safeName(value, 160) : value
    }
    put('status', event.status)
    put('trigger', event.trigger)
    put('from', event.from)
    put('to', event.to)
    put('name', event.name)
    put('form', event.form)
    put('sub', event.sub)
    put('tokens', event.tokens)
    put('delta', event.delta)
    put('summarizedCount', event.summarizedCount)
    put('keptCount', event.keptCount)
    put('preTokens', event.preTokens)
    put('postTokens', event.postTokens)
    put('durationMs', event.durationMs)
    put('turn', event.turn)
    put('step', event.step)
    put('itemKey', event.itemKey)
    put('text', event.text)
    put('detail', event.detail)
    return out
  })
}

function sessionInfoOf(view) {
  return {
    id: view.session.id,
    title: safeName(view.session.title, 300),
    directory: view.session.directory,
    projectId: view.session.projectId,
    parentId: view.session.parentId,
    taskType: view.session.taskType,
    createdAt: view.session.createdAt,
    updatedAt: view.session.updatedAt,
    model: view.session.model,
    provider: view.session.provider,
    contextWindow: view.session.contextWindow,
    contextWindowSource: view.session.contextWindowSource,
    maxOutputTokens: view.session.maxOutputTokens,
    currency: view.session.currency,
  }
}

function summarizeStats(view) {
  const { timing, ...stats } = view.stats
  stats.skillNames = (stats.skillNames ?? []).slice(0, 20)
  return stats
}

function encodeSnapshot(view, { requestLimit = 260, eventLimit = 120, fileLimit = 120 } = {}) {
  const total = view.requests.length
  let shown = Math.min(total, requestLimit)
  let events = Math.min(view.events.length, eventLimit)
  let files = Math.min(view.files.entries.length, fileLimit)
  let payload
  for (;;) {
    const from = Math.max(0, total - shown)
    payload = {
      wire: { parts: PART_ORDER, status: STATUS_CODES, header: HEADER_CODES },
      session: sessionInfoOf(view),
      stats: summarizeStats(view),
      current: view.current,
      timing: { ...view.timing, spans: (view.timing?.spans ?? []).slice(0, 120) },
      coverage: view.coverage,
      preferences: view.preferences,
      requests: view.requests.slice(from).map(compactRequest),
      requestsTotal: total,
      requestsFrom: total === 0 ? 0 : from + 1,
      requestsTo: total,
      events: compactEvents(view.events, events),
      eventsTotal: view.events.length,
      files: {
        totals: view.files.totals,
        opCount: view.files.opCount,
        entries: view.files.entries.slice(0, files),
        truncated: view.files.entries.length > files,
      },
      generatedAt: view.generatedAt,
    }
    if (payloadBytes(payload) <= MAX_PAYLOAD_BYTES) break
    if (shown > 60) shown = Math.max(60, Math.floor(shown * 0.8))
    else if (events > 30) events = Math.max(30, Math.floor(events * 0.8))
    else if (files > 20) files = Math.max(20, Math.floor(files * 0.8))
    else break
  }
  return payload
}

function fitStep(detail) {
  if (!detail) return detail
  let groupCap = 24
  let dnaCap = 120
  let diffCap = 50
  let fileCap = 50
  let opsCap = 20
  let dropDna = false
  let out
  for (;;) {
    out = {
      ...detail,
      groups: detail.groups.map((group) => ({
        ...group,
        items: group.items.slice(0, groupCap),
        more: Math.max(group.more + Math.max(0, group.items.length - groupCap), 0),
      })),
      dna: dropDna ? [] : detail.dna.slice(0, dnaCap),
      dnaTotal: detail.dna.length,
      diff: {
        ...detail.diff,
        added: (detail.diff.added ?? []).slice(0, diffCap),
        removed: (detail.diff.removed ?? []).slice(0, diffCap),
        changed: (detail.diff.changed ?? []).slice(0, 20),
      },
      files: {
        ...detail.files,
        entries: detail.files.entries.slice(0, fileCap).map((entry) => ({
          ...entry,
          ops: (entry.ops ?? []).slice(0, opsCap),
        })),
        truncated: detail.files.truncated || detail.files.entries.length > fileCap || detail.files.entries.some((entry) => (entry.ops?.length ?? 0) > opsCap),
      },
    }
    if (payloadBytes(out) <= MAX_PAYLOAD_BYTES) break
    if (groupCap > 6) groupCap = Math.max(6, groupCap - 4)
    else if (!dropDna && detail.dna.length > 0) dropDna = true
    else if (fileCap > 6) fileCap = Math.max(6, fileCap - 4)
    else if (opsCap > 5) opsCap = Math.max(5, opsCap - 5)
    else if (diffCap > 10) diffCap = Math.max(10, diffCap - 10)
    else break
  }
  return out
}

function fitPagedItems(result, key, minimum = 20) {
  if (!result) return result
  while (payloadBytes(result) > MAX_PAYLOAD_BYTES && (result[key]?.length ?? 0) > minimum) {
    const keep = Math.max(minimum, Math.floor(result[key].length * 0.75))
    result[key] = result[key].slice(0, keep)
    result.nextOffset = (result.offset ?? 0) + keep
    result.more = Math.max(0, (result.total ?? keep) - (result.offset ?? 0) - keep)
    result.truncated = true
  }
  return result
}

function fitInsights(data) {
  const total = data.sessionCards.length
  let cards = Math.min(total, 140)
  let daily = Math.min(data.daily.length, 400)
  let out
  for (;;) {
    out = {
      ...data,
      sessionCards: data.sessionCards.slice(0, cards),
      sessionsTotal: total,
      truncated: cards < total,
      daily: data.daily.slice(-daily),
      dailyTotal: data.daily.length,
    }
    if (payloadBytes(out) <= MAX_PAYLOAD_BYTES) break
    if (cards > 40) cards = Math.max(40, Math.floor(cards * 0.8))
    else if (daily > 56) daily = Math.max(56, Math.floor(daily * 0.8))
    else break
  }
  return out
}

function currencyFor(preferences, locale) {
  return currencyForLocale(
    preferences?.language && preferences.language !== 'auto' ? preferences.language : locale,
    preferences?.currency,
  )
}

function emptyUsage() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, billed: 0, cost: null, unpriced: 0 }
}

function addUsage(total, row, cost, calls = 1) {
  total.input += Number(row.input_tokens) || 0
  total.output += Number(row.output_tokens) || 0
  total.cacheRead += Number(row.cache_read_input_tokens) || 0
  total.cacheWrite += Number(row.cache_creation_input_tokens) || 0
  if (cost != null) total.cost = (total.cost ?? 0) + cost
  else if ((Number(row.input_tokens) || 0) + (Number(row.output_tokens) || 0) > 0) total.unpriced++
  total.calls = (total.calls ?? 0) + (Number(calls) || 0)
  total.billed = total.input + total.output
  return total
}

export function createService(paths) {
  const db = openDatabase(paths.dbPath)
  const cache = new Map()
  let providerWindows = readProviderWindows(paths.providerConfigPath)
  let providerLoadedAt = Date.now()

  function refreshProviderWindows() {
    if (Date.now() - providerLoadedAt > 30_000) {
      providerWindows = readProviderWindows(paths.providerConfigPath)
      providerLoadedAt = Date.now()
    }
    return providerWindows
  }

  async function revisionOf(sessionId) {
    const session = db.prepare('SELECT time_updated FROM session WHERE id = ?').get(sessionId)
    const messages = db
      .prepare('SELECT count(*) AS n, COALESCE(max(time_updated),0) AS u FROM message WHERE session_id = ?')
      .get(sessionId)
    const parts = db
      .prepare('SELECT count(*) AS n, COALESCE(max(time_updated),0) AS u FROM part WHERE session_id = ?')
      .get(sessionId)
    const usage = db
      .prepare('SELECT count(*) AS n, COALESCE(max(COALESCE(completed_at, started_at)),0) AS u FROM model_usage WHERE session_id = ?')
      .get(sessionId)
    const tools = db.prepare('SELECT count(*) AS n, COALESCE(max(COALESCE(completed_at, started_at)),0) AS u FROM tool_usage WHERE session_id = ?').get(sessionId)
    const children = db
      .prepare('SELECT count(*) AS n, COALESCE(max(time_updated),0) AS u FROM session WHERE parent_id = ?')
      .get(sessionId)
    const rollout = await rolloutStamp(paths, sessionId)
    return [
      session?.time_updated ?? 0,
      messages?.n ?? 0,
      messages?.u ?? 0,
      parts?.n ?? 0,
      parts?.u ?? 0,
      usage?.n ?? 0,
      usage?.u ?? 0,
      tools?.n ?? 0,
      tools?.u ?? 0,
      children?.n ?? 0,
      children?.u ?? 0,
      rollout,
    ].join('|')
  }

  async function ensureView(sessionId, { withSubagents = true, locale = '' } = {}) {
    const basePreferences = readPreferences(paths)
    const preferences = locale ? { ...basePreferences, locale } : basePreferences
    const cacheKey = sessionId + ':' + (withSubagents ? 'family' : 'self')
    const revision = (await revisionOf(sessionId)) + '|' + JSON.stringify(preferences)
    const hit = cache.get(cacheKey)
    if (hit && hit.revision === revision) return hit
    const session = readSessionRow(db, sessionId)
    const usageRows = readUsageRows(db, sessionId)
    const toolRows = readToolRows(db, sessionId)
    const turnRows = readTurnRows(db, sessionId)
    const conversation = readConversation(db, sessionId)
    const rollout = await readRollout(paths, sessionId)
    const fullRetention = readFullRetention(paths.settingPath)
    const windows = refreshProviderWindows()
    let subagentStats = { count: 0, usage: null }
    if (withSubagents) {
      const family = readFleetSessions(db, sessionId)
      const descendants = new Set()
      const queue = [sessionId]
      while (queue.length) {
        const parent = queue.shift()
        for (const candidate of family.sessions) {
          if (candidate.parent_id === parent && !descendants.has(candidate.id)) {
            descendants.add(candidate.id)
            queue.push(candidate.id)
          }
        }
      }
      const children = family.sessions.filter((session) => descendants.has(session.id))
      if (children.length > 0) {
        const ids = children.map((child) => child.id)
        const usage = readUsageForSessions(db, ids)
        const total = emptyUsage()
        const currency = currencyFor(preferences, locale || preferences.language)
        for (const row of usage) {
          const cost = priceCall(
            row.provider_id,
            row.model_id,
            {
              input: Number(row.input_tokens) || 0,
              cacheRead: Number(row.cache_read) || 0,
              cacheWrite: Number(row.cache_write) || 0,
              output: Number(row.output_tokens) || 0,
            },
            { priceFile: preferences.priceFile, currency },
          )
          addUsage(total, {
            input_tokens: row.input_tokens,
            output_tokens: row.output_tokens,
            cache_read_input_tokens: row.cache_read,
            cache_creation_input_tokens: row.cache_write,
          }, cost, row.calls)
        }
        subagentStats = { count: children.length, usage: total, currency }
      }
    }
    const view = buildSessionView({
      session,
      usageRows,
      toolRows,
      turnRows,
      conversation,
      rollout,
      preferences,
      providerWindows: windows,
      fullRetention,
      subagentStats,
    })
    const entry = { revision, view, conversation, rollout, session, preferences, withSubagents }
    cache.set(cacheKey, entry)
    // One warm session per viewer is enough; keep the cache bounded.
    if (cache.size > 8) {
      const oldest = [...cache.entries()].sort((a, b) => (a[1].view.generatedAt ?? 0) - (b[1].view.generatedAt ?? 0))[0]
      if (oldest && oldest[0] !== cacheKey) cache.delete(oldest[0])
    }
    return entry
  }

  async function snapshot(sessionId, { locale = 'en' } = {}) {
    const entry = await ensureView(sessionId, { locale })
    return encodeSnapshot(entry.view)
  }

  async function history(sessionId, { beforeStep = 0, limit = 160 } = {}) {
    const entry = await ensureView(sessionId)
    const total = entry.view.requests.length
    const end = Math.max(0, Math.min(total, Number(beforeStep) || total))
    const start = Math.max(0, end - Math.max(1, Math.min(260, Number(limit) || 160)))
    return {
      wire: { parts: PART_ORDER, status: STATUS_CODES, header: HEADER_CODES },
      requests: entry.view.requests.slice(start, end).map(compactRequest),
      requestsFrom: start + 1,
      requestsTo: end,
      requestsTotal: total,
      hasEarlier: start > 0,
    }
  }

  async function step(sessionId, stepIndex, options = {}) {
    const entry = await ensureView(sessionId, { locale: options.locale })
    const detail = buildStepDetail(entry.view, stepIndex, {
      baselineMode: options.baselineMode === 'off' ? 'off' : options.baselineMode === 'turn' ? 'turn' : 'step',
      search: typeof options.search === 'string' ? options.search : '',
      sort: ['size', 'order', 'name', 'calls'].includes(options.sort) ? options.sort : 'size',
    })
    return fitStep(detail)
  }

  async function group(sessionId, stepIndex, cat, options = {}) {
    const entry = await ensureView(sessionId, { locale: options.locale })
    return fitPagedItems(buildGroupDetail(entry.view, stepIndex, String(cat), {
      offset: Number(options.offset) || 0,
      limit: Math.min(60, Number(options.limit) || 40),
      search: typeof options.search === 'string' ? options.search : '',
      sort: ['size', 'order', 'name', 'calls'].includes(options.sort) ? options.sort : 'size',
    }), 'items')
  }

  async function dna(sessionId, stepIndex, options = {}) {
    const entry = await ensureView(sessionId, { locale: options.locale })
    return fitPagedItems(buildDnaDetail(entry.view, stepIndex, {
      offset: Number(options.offset) || 0,
      limit: Math.min(200, Number(options.limit) || 120),
    }), 'items')
  }

  async function dnaSeries(sessionId, options = {}) {
    const entry = await ensureView(sessionId, { locale: options.locale })
    let fromStep = Number(options.fromStep) || 1
    let toStep = Number(options.toStep) || 1_000_000
    let maxBands = Math.max(8, Math.min(80, Number(options.maxBands) || 36))
    let result = buildDnaSeries(entry.view, { fromStep, toStep, maxBands })
    // Keep the tool result under the host budget: drop the oldest bars first, then coarsen bands.
    while (payloadBytes(result) > MAX_PAYLOAD_BYTES) {
      if (result.steps.length > 40) {
        fromStep = result.steps[Math.floor(result.steps.length * 0.25)]?.step ?? fromStep
        result = buildDnaSeries(entry.view, { fromStep, toStep, maxBands })
      } else if (maxBands > 16) {
        maxBands -= 8
        result = buildDnaSeries(entry.view, { fromStep, toStep, maxBands })
      } else {
        break
      }
    }
    return result
  }

  async function element(sessionId, stepIndex, key, options = {}) {
    const entry = await ensureView(sessionId, { locale: options.locale })
    return readElementDetail({
      db,
      view: entry.view,
      stepIndex,
      key,
      format: options.format === 'raw' ? 'raw' : 'readable',
      offset: Number(options.offset) || 0,
      limit: Number(options.limit) || 12_000,
    })
  }

  async function eventDetail(sessionId, eventId, options = {}) {
    const entry = await ensureView(sessionId, { locale: options.locale })
    const event = entry.view.events.find((candidate) => candidate.id === eventId)
    if (!event) throw new ContextError('event_missing', 'That event is no longer in this session.')
    const detail = readEventDetail({
      db,
      view: entry.view,
      event,
      offset: Number(options.offset) || 0,
      limit: Math.min(20, Number(options.limit) || 12),
    })
    if (detail?.messages) {
      while (payloadBytes(detail) > MAX_PAYLOAD_BYTES && detail.messages.length > 4) {
        const keep = Math.max(4, Math.floor(detail.messages.length * 0.75))
        detail.messages = detail.messages.slice(0, keep)
        detail.nextOffset = (detail.offset ?? 0) + keep
        detail.truncated = true
      }
    }
    return detail
  }

  async function fleet(sessionId, { locale = '' } = {}) {
    const preferences = readPreferences(paths)
    const currency = currencyFor(preferences, locale || preferences.language)
    const family = readFleetSessions(db, sessionId)
    const ids = family.sessions.map((session) => session.id)
    const usage = readUsageForSessions(db, ids)
    const latest = readLatestUsageForSessions(db, ids)
    const latestBy = new Map(latest.map((row) => [row.session_id, row]))
    const totals = new Map(ids.map((id) => [id, emptyUsage()]))
    for (const row of usage) {
      const total = totals.get(row.session_id)
      if (!total) continue
      const cost = priceCall(
        row.provider_id,
        row.model_id,
        {
          input: Number(row.input_tokens) || 0,
          cacheRead: Number(row.cache_read) || 0,
          cacheWrite: Number(row.cache_write) || 0,
          output: Number(row.output_tokens) || 0,
        },
        { priceFile: preferences.priceFile, currency },
      )
      addUsage(total, {
        input_tokens: row.input_tokens,
        output_tokens: row.output_tokens,
        cache_read_input_tokens: row.cache_read,
        cache_creation_input_tokens: row.cache_write,
      }, cost, row.calls)
    }
    const byId = new Map(family.sessions.map((session) => [session.id, session]))
    const depthOf = (session) => {
      let depth = 0
      let cursor = session
      const seen = new Set()
      while (cursor.parent_id && byId.has(cursor.parent_id) && !seen.has(cursor.parent_id)) {
        seen.add(cursor.parent_id)
        cursor = byId.get(cursor.parent_id)
        depth++
      }
      return depth
    }
    const descendants = new Set()
    const queue = [sessionId]
    while (queue.length) {
      const parent = queue.shift()
      for (const session of family.sessions) {
        if (session.parent_id === parent && !descendants.has(session.id)) {
          descendants.add(session.id)
          queue.push(session.id)
        }
      }
    }
    const ancestorIds = new Set()
    let ancestorCursor = byId.get(sessionId)
    while (ancestorCursor?.parent_id && byId.has(ancestorCursor.parent_id)) {
      ancestorIds.add(ancestorCursor.parent_id)
      ancestorCursor = byId.get(ancestorCursor.parent_id)
    }
    const nodes = family.sessions.map((session) => {
      const total = totals.get(session.id) ?? emptyUsage()
      const last = latestBy.get(session.id) ?? null
      const info = last ? resolveModel(last.provider_id, last.model_id, { priceFile: preferences.priceFile, providerWindows, windowOverride: preferences.contextWindow }) : null
      const window = info?.contextWindow ?? null
      const prompt = Number(last?.input_tokens) || 0
      return {
        id: session.id,
        parentId: session.parent_id ?? null,
        title: safeName(session.title, 300),
        directory: session.directory,
        taskType: session.task_type ?? null,
        depth: depthOf(session),
        role: session.id === sessionId ? 'self' : descendants.has(session.id) ? 'child' : ancestorIds.has(session.id) ? 'ancestor' : 'sibling',
        createdAt: session.time_created,
        updatedAt: session.time_updated,
        model: last?.model_id ?? null,
        provider: last?.provider_id ?? null,
        status: last?.status ?? null,
        running: last?.status === 'running',
        usage: total,
        latestPrompt: prompt,
        latestAt: last?.started_at ?? null,
        contextWindow: window,
        contextPct: window ? (prompt / window) * 100 : null,
        cacheHitRate: total.input > 0 ? (total.cacheRead / total.input) * 100 : null,
        currency,
        calls: usage.filter((row) => row.session_id === session.id).reduce((sum, row) => sum + Number(row.calls ?? 0), 0),
      }
    })
    nodes.sort((a, b) => a.depth - b.depth || a.createdAt - b.createdAt)
    const edges = nodes
      .filter((node) => node.parentId && byId.has(node.parentId))
      .map((node) => ({ from: node.parentId, to: node.id }))
    return {
      nodes,
      edges,
      currentId: sessionId,
      truncated: family.truncated,
      currency,
    }
  }

  async function fleetMember(sessionId, targetId, { locale = '' } = {}) {
    if (!targetId) throw new ContextError('member_missing', 'No fleet member was selected.')
    const family = readFleetSessions(db, sessionId)
    const target = family.sessions.find((session) => session.id === targetId)
    if (!target) throw new ContextError('member_missing', 'That agent is not part of this family.')
    const preferences = readPreferences(paths)
    const currency = currencyFor(preferences, locale || preferences.language)
    const usage = readUsageForSessions(db, [targetId])
    const latest = readLatestUsageForSessions(db, [targetId])[0] ?? null
    const total = emptyUsage()
    for (const row of usage) {
      const cost = priceCall(
        row.provider_id,
        row.model_id,
        {
          input: Number(row.input_tokens) || 0,
          cacheRead: Number(row.cache_read) || 0,
          cacheWrite: Number(row.cache_write) || 0,
          output: Number(row.output_tokens) || 0,
        },
        { priceFile: preferences.priceFile, currency },
      )
      addUsage(total, {
        input_tokens: row.input_tokens,
        output_tokens: row.output_tokens,
        cache_read_input_tokens: row.cache_read,
        cache_creation_input_tokens: row.cache_write,
      }, cost, row.calls)
    }
    const info = latest ? resolveModel(latest.provider_id, latest.model_id, { priceFile: preferences.priceFile, providerWindows, windowOverride: preferences.contextWindow }) : null
    const children = db
      .prepare('SELECT id, title, task_type FROM session WHERE parent_id = ? ORDER BY time_created')
      .all(targetId)
    const preview = readSessionPreview(db, targetId)
    return {
      session: {
        id: target.id,
        parentId: target.parent_id ?? null,
        title: safeName(target.title, 300),
        directory: target.directory,
        taskType: target.task_type ?? null,
        createdAt: target.time_created,
        updatedAt: target.time_updated,
      },
      preview,
      usage: total,
      latest: latest
        ? {
            model: latest.model_id,
            provider: latest.provider_id,
            status: latest.status,
            prompt: latest.input_tokens,
            output: latest.output_tokens,
            startedAt: latest.started_at,
            durationMs: latest.duration_ms,
            contextWindow: info?.contextWindow ?? null,
            contextPct: info?.contextWindow ? (latest.input_tokens / info.contextWindow) * 100 : null,
          }
        : null,
      children,
      currency,
    }
  }

  async function insights({ range = '30d', includeComposition = false, locale = '' } = {}) {
    const preferences = readPreferences(paths)
    const currency = currencyFor(preferences, locale || preferences.language)
    const now = Date.now()
    const days = range === '7d' ? 7 : range === 'all' ? 3650 : 30
    const since = range === 'all' ? 0 : now - days * 86_400_000
    const data = readInsights(db, { since, limit: 500 })
    const dailyModel = readInsightsDailyModel(db, since)
    const sessions = new Map(data.sessions.map((session) => [session.id, session]))
    const totals = new Map()
    for (const row of data.perModel) {
      const total = totals.get(row.session_id) ?? emptyUsage()
      const cost = priceCall(
        row.provider_id,
        row.model_id,
        {
          input: Number(row.input_tokens) || 0,
          cacheRead: Number(row.cache_read) || 0,
          cacheWrite: Number(row.cache_write) || 0,
          output: Number(row.output_tokens) || 0,
        },
        { priceFile: preferences.priceFile, currency },
      )
      addUsage(total, {
        input_tokens: row.input_tokens,
        output_tokens: row.output_tokens,
        cache_read_input_tokens: row.cache_read,
        cache_creation_input_tokens: row.cache_write,
      }, cost, row.calls)
      total.firstAt = total.firstAt ? Math.min(total.firstAt, row.first_at) : row.first_at
      total.lastAt = total.lastAt ? Math.max(total.lastAt, row.last_at) : row.last_at
      totals.set(row.session_id, total)
    }
    const latestBy = new Map(data.latest.map((row) => [row.session_id, row]))
    const daily = new Map()
    for (const row of dailyModel) {
      const bucket = daily.get(row.day) ?? { day: row.day, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0, cost: null, unpriced: 0 }
      const cost = priceCall(
        row.provider_id,
        row.model_id,
        {
          input: Number(row.input_tokens) || 0,
          cacheRead: Number(row.cache_read) || 0,
          cacheWrite: Number(row.cache_write) || 0,
          output: Number(row.output_tokens) || 0,
        },
        { priceFile: preferences.priceFile, currency },
      )
      bucket.input += Number(row.input_tokens) || 0
      bucket.output += Number(row.output_tokens) || 0
      bucket.cacheRead += Number(row.cache_read) || 0
      bucket.cacheWrite += Number(row.cache_write) || 0
      bucket.calls += Number(row.calls) || 0
      if (cost != null) bucket.cost = (bucket.cost ?? 0) + cost
      else if ((Number(row.input_tokens) || 0) + (Number(row.output_tokens) || 0) > 0) bucket.unpriced++
      daily.set(row.day, bucket)
    }
    const cards = data.sessions.map((session) => {
      const total = totals.get(session.id) ?? emptyUsage()
      const last = latestBy.get(session.id) ?? null
      const info = last ? resolveModel(last.provider_id, last.model_id, { priceFile: preferences.priceFile, providerWindows, windowOverride: preferences.contextWindow }) : null
      const window = info?.contextWindow ?? null
      const prompt = Number(last?.input_tokens) || 0
      return {
        id: session.id,
        parentId: session.parent_id ?? null,
        title: safeName(session.title, 300),
        directory: session.directory,
        projectId: session.project_id,
        taskType: session.task_type ?? null,
        createdAt: session.time_created,
        updatedAt: session.time_updated,
        usage: total,
        latestPrompt: prompt,
        latestAt: last?.started_at ?? null,
        model: last?.model_id ?? null,
        provider: last?.provider_id ?? null,
        status: last?.status ?? null,
        contextWindow: window,
        contextPct: window ? (prompt / window) * 100 : null,
        cacheHitRate: total.input > 0 ? (total.cacheRead / total.input) * 100 : null,
        calls: total.calls ?? 0,
        currency,
      }
    })
    cards.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    const kpi = {
      sessions: cards.length,
      billed: cards.reduce((sum, card) => sum + card.usage.billed, 0),
      input: cards.reduce((sum, card) => sum + card.usage.input, 0),
      output: cards.reduce((sum, card) => sum + card.usage.output, 0),
      cacheRead: cards.reduce((sum, card) => sum + card.usage.cacheRead, 0),
      cost: cards.some((card) => card.usage.cost != null) ? cards.reduce((sum, card) => sum + (card.usage.cost ?? 0), 0) : null,
      unpriced: cards.reduce((sum, card) => sum + card.usage.unpriced, 0),
      currency,
    }
    kpi.cacheHitRate = kpi.input > 0 ? (kpi.cacheRead / kpi.input) * 100 : null
    kpi.calls = cards.reduce((sum, card) => sum + (card.calls ?? 0), 0)
    const weighted = cards.filter((card) => card.contextPct != null)
    const weight = weighted.reduce((sum, card) => sum + Math.max(1, card.usage?.billed ?? 0), 0)
    kpi.avgContextPct = weight > 0 ? weighted.reduce((sum, card) => sum + card.contextPct * Math.max(1, card.usage?.billed ?? 0), 0) / weight : null
    let composition = null
    let compositionSessions = 0
    if (includeComposition) {
      const candidates = [...cards].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).slice(0, 12)
      const sum = Object.fromEntries(PART_ORDER.map((cat) => [cat, 0]))
      for (const card of candidates) {
        try {
          const entry = await ensureView(card.id, { withSubagents: false })
          if (!entry.view.current) continue
          compositionSessions++
          for (const cat of PART_ORDER) sum[cat] += entry.view.current.parts?.[cat] ?? 0
        } catch {}
      }
      if (compositionSessions > 0) composition = sum
    }
    return fitInsights({
      range,
      days,
      since,
      kpi,
      daily: [...daily.values()].sort((a, b) => a.day.localeCompare(b.day)),
      sessionCards: cards.slice(0, 500),
      composition,
      compositionSessions,
      compositionPartial: composition != null && compositionSessions < cards.length,
      coverageNote:
        'Daily and heatmap figures only cover sessions whose usage rows are still retained locally; context composition is computed for the 12 most recent sessions, so older headers may be missing.',
      currency,
      generatedAt: now,
    })
  }

  async function preferencesGet() {
    return readPreferences(paths)
  }

  async function preferencesSet(patch) {
    return writePreferences(paths, patch)
  }

  async function report(sessionId) {
    const entry = await ensureView(sessionId)
    return { text: buildReport(entry.view), sessionId, step: entry.view.current?.step ?? null }
  }

  function close() {
    try {
      db.close()
    } catch {}
  }

  return {
    snapshot,
    history,
    step,
    group,
    dna,
    dnaSeries,
    element,
    eventDetail,
    fleet,
    fleetMember,
    insights,
    preferencesGet,
    preferencesSet,
    report,
    close,
  }
}
