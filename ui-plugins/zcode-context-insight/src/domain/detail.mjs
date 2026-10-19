/**
 * One element's full content, read on demand and chunked for the 64 KiB MCP result budget.
 */

import { canonical, lineCountOf, oneLineOf, truncate } from '../shared/estimate.mjs'
import { readFullMessage, readFullPart, readSummarizedMessages } from '../data/db.mjs'
import { ContextError } from './errors.mjs'
import { summaryOfPart } from './items.mjs'

const DEFAULT_LIMIT = 12_000
const MAX_LIMIT = 24_000

function stringify(value) {
  if (typeof value === 'string') return value
  if (value == null) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function chunk(text, offset, limit) {
  const value = String(text ?? '')
  const start = Math.max(0, Math.min(value.length, Number(offset) || 0))
  let size = Math.max(1, Math.min(MAX_LIMIT, Number(limit) || DEFAULT_LIMIT))
  let content = value.slice(start, start + size)
  // MCP Apps caps a structured result at 64 KiB of UTF-8, not characters. CJK and emoji can be 3-4x.
  while (Buffer.byteLength(content, 'utf8') > 48 * 1024 && size > 256) {
    size = Math.floor(size * 0.8)
    content = value.slice(start, start + size)
  }
  const nextOffset = start + content.length
  return {
    content,
    totalChars: value.length,
    offset: start,
    nextOffset,
    truncated: nextOffset < value.length,
    lines: lineCountOf(value),
  }
}

function fieldsOf(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  return Object.entries(input)
    .slice(0, 24)
    .map(([name, value]) => {
      const full = typeof value === 'string' ? value : stringify(value)
      return { name, value: truncate(full, 1200), truncated: full.length > 1200 }
    })
}

function headerItemOf(view, stepIndex, key) {
  const bundle = view._requestItems[Math.max(0, Math.min(view._requestItems.length - 1, Number(stepIndex) - 1))]
  if (!bundle) return null
  return bundle.header.items.find((item) => item.key === key) ?? null
}

/** Resolve one browser element. */
export function readElementDetail({ db, view, stepIndex, key, format = 'readable', offset = 0, limit = DEFAULT_LIMIT }) {
  const value = String(key ?? '')
  if (!value) throw new ContextError('element_missing', 'No context element was selected.')
  const header = headerItemOf(view, stepIndex, value)
  if (header) {
    const raw = header.cat === 'system' ? header.text ?? '' : stringify(header.value)
    const shown = format === 'raw' ? raw : header.cat === 'system' ? raw : raw
    return {
      key: value,
      cat: header.cat,
      kind: header.kind,
      title: header.title,
      tool: header.tool ?? null,
      source: header.source ?? null,
      format,
      markdown: header.cat === 'system',
      ...chunk(shown, offset, limit),
    }
  }

  if (value === 'sys') {
    const bundle = view._requestItems[Math.max(0, Math.min(view._requestItems.length - 1, Number(stepIndex) - 1))]
    const system = bundle?.header?.items?.find((item) => item.key === 'sys')
    if (!system) throw new ContextError('element_missing', 'The system prompt was not recorded for this request.')
    return {
      key: value,
      cat: 'system',
      kind: 'system',
      title: 'System prompt',
      format,
      markdown: true,
      ...chunk(system.text ?? '', offset, limit),
    }
  }

  if (value.startsWith('p:')) {
    const partId = value.split(':')[1]
    if (!partId) throw new ContextError('element_missing', 'Malformed element key.')
    const part = readFullPart(db, view.session.id, partId)
    const data = part.data ?? {}
    const type = String(data.type ?? '')
    const tool = String(data.tool ?? '')
    const summary = summaryOfPart({
      file_path: data.state?.input?.file_path,
      path: data.state?.input?.path,
      pattern: data.state?.input?.pattern,
      command: data.state?.input?.command,
      description: data.state?.input?.description,
      skill: data.state?.input?.skill,
      query: data.state?.input?.query,
      url: data.state?.input?.url,
      prompt: data.state?.input?.prompt,
      input_sample: stringify(data.state?.input).slice(0, 400),
    })
    const title = summary ? tool + ' · ' + summary : tool || type
    const status = data.state?.status ?? null
    if (format === 'raw') {
      const raw = stringify(data)
      return { key: value, cat: 'tool', kind: type, title, tool, status, format, markdown: false, ...chunk(raw, offset, limit) }
    }
    if (type === 'text') {
      const text = String(data.text ?? '')
      return { key: value, cat: 'assistant', kind: 'text', title: oneLineOf(text, 120) || 'Text', tool: null, status: null, format, markdown: true, ...chunk(text, offset, limit) }
    }
    if (type === 'reasoning') {
      const text = String(data.text ?? '')
      return { key: value, cat: 'assistant', kind: 'thinking', title: 'Thinking', tool: null, status: null, format, markdown: true, ...chunk(text, offset, limit) }
    }
    if (type === 'tool') {
      const input = data.state?.input
      const output = data.state?.output
      const call = {
        name: tool,
        status,
        fields: fieldsOf(input),
        input: truncate(format === 'raw' ? canonical(input ?? null) : stringify(input ?? null), 4000),
        title,
      }
      if (value.endsWith(':call') || value.endsWith(':skill')) {
        const text = value.endsWith(':skill') && output != null ? stringify(output) : stringify(input ?? null)
        return {
          key: value,
          cat: value.endsWith(':skill') ? 'skill' : 'assistant',
          kind: value.endsWith(':skill') ? 'skill' : 'tool-call',
          title,
          tool,
          status,
          format,
          markdown: false,
          call,
          ...chunk(text, offset, limit),
        }
      }
      const text = output == null ? '' : typeof output === 'string' ? output : stringify(output)
      return {
        key: value,
        cat: 'tool',
        kind: 'tool-result',
        title,
        tool,
        status,
        format,
        markdown: true,
        call,
        ...chunk(text, offset, limit),
      }
    }
    if (type === 'file') {
      const metadata = data.metadata ?? null
      const image = metadata?.image ?? {}
      return {
        key: value,
        cat: 'tool',
        kind: 'attachment',
        title: image.width && image.height ? `Image ${image.width}×${image.height}` : 'Attachment',
        tool: null,
        status: null,
        format,
        markdown: false,
        attachment: {
          mime: data.mime ?? null,
          url: data.url ?? null,
          width: image.width ?? image.originalWidth ?? null,
          height: image.height ?? image.originalHeight ?? null,
          bytes: metadata?.sizeBytes ?? metadata?.transformedSizeBytes ?? null,
          artifactUri: metadata?.artifactUri ?? null,
        },
        ...chunk(stringify(metadata), offset, limit),
      }
    }
    const raw = stringify(data)
    return { key: value, cat: 'tool', kind: type || 'unknown', title, tool, status, format, markdown: false, ...chunk(raw, offset, limit) }
  }

  if (value.startsWith('m:')) {
    const messageId = value.split(':')[1]
    if (!messageId) throw new ContextError('element_missing', 'Malformed element key.')
    const message = readFullMessage(db, view.session.id, messageId)
    const data = message.data ?? {}
    const body = String(data.summary?.body ?? '')
    const text = body || stringify(data)
    return {
      key: value,
      cat: 'inject',
      kind: 'compaction',
      title: data.summary?.title || 'Compaction summary',
      format,
      markdown: true,
      ...chunk(text, offset, limit),
    }
  }

  throw new ContextError('element_missing', 'That context element is not available in this request.')
}

/** All summarized messages for a compaction event. */
export function readEventDetail({ db, view, event, offset = 0, limit = 40 }) {
  if (!event || event.kind !== 'compaction') {
    throw new ContextError('event_incomplete', 'Only compaction events have a summarized-message detail.')
  }
  let through = Number.isFinite(event.lastSequence) ? event.lastSequence : null
  if (through == null) {
    return {
      event: {
        id: event.id, kind: event.kind, time: event.time, status: event.status,
        preTokens: event.preTokens, postTokens: event.postTokens,
        summarizedCount: event.summarizedCount, keptCount: event.keptCount,
        reason: event.reason, trigger: event.trigger,
      },
      available: false,
      reason: 'no_boundary',
      total: 0,
      offset: 0,
      nextOffset: null,
      messages: [],
      truncated: false,
    }
  }
  const summarySequence = Number.isFinite(event.summarySequence) ? event.summarySequence : null
  // The summary message replaces the summarized range; it must not appear inside it.
  if (summarySequence != null && summarySequence > 0 && summarySequence <= through) through = summarySequence - 1
  const afterCandidates = view.events
    .filter((candidate) => candidate.kind === 'compaction' && candidate.time < event.time && Number.isFinite(candidate.lastSequence))
    .map((candidate) => candidate.lastSequence)
  const after = afterCandidates.length ? Math.max(...afterCandidates) : -1
  const result = readSummarizedMessages(db, view.session.id, { after, through, summary: summarySequence })
  const start = Math.max(0, Number(offset) || 0)
  const size = Math.max(1, Math.min(200, Number(limit) || 40))
  return {
    event: {
      id: event.id,
      kind: event.kind,
      time: event.time,
      status: event.status,
      preTokens: event.preTokens,
      postTokens: event.postTokens,
      summarizedCount: event.summarizedCount,
      keptCount: event.keptCount,
      reason: event.reason,
      trigger: event.trigger,
    },
    total: result.total,
    offset: start,
    nextOffset: start + size < result.total ? start + size : null,
    messages: result.messages.slice(start, start + size).map((message) => ({
      id: message.id,
      sequence: message.sequence,
      time: message.time_created,
      role: message.role,
      kind: message.kind,
      source: message.source,
      summary: message.summary_preview ?? null,
      parts: (message.parts ?? []).map((part) => ({
        id: part.id,
        type: part.type,
        tool: part.tool ?? null,
        status: part.status ?? null,
        text: part.text_preview ?? null,
        textChars: part.text_chars ?? 0,
        inputSample: part.input_sample ?? null,
        inputChars: part.input_chars ?? 0,
        outputPreview: part.output_preview ?? null,
        outputChars: part.output_chars ?? 0,
        description: part.description ?? null,
        command: part.command ?? null,
        filePath: part.file_path ?? null,
        skill: part.skill ?? null,
      })),
    })),
    truncated: result.truncated || start + size < result.total,
  }
}
