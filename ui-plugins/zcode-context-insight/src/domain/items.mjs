/**
 * Build the flat, ordered list of everything a request carries: header items (system prompt and
 * tool schemas) followed by every model-visible conversation element. The list is built once per
 * session; each request slices it at its assistant-message boundary.
 */

import {
  estimateImageTokens,
  estimateSystemContent,
  estimateTextBlock,
  estimateTokens,
  estimateToolCall,
  estimateToolSchema,
  estimateToolResult,
  firstLineOf,
  oneLineOf,
  truncate,
} from '../shared/estimate.mjs'

const IMAGE_MIME = /^image\//i
const BUILTIN_TOOLS = new Set([
  'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'LS', 'TodoWrite', 'TodoRead', 'Skill',
  'WebSearch', 'WebFetch', 'Task', 'Agent', 'TaskOutput', 'TaskStop', 'AskUserQuestion',
  'EnterPlanMode', 'ExitPlanMode', 'SendMessage', 'ReadSessionContext', 'ListModels',
  'CreateWorkflow', 'AmendWorkflow', 'SaveWorkflow', 'EvalWorkflowSnippet', 'ListWorkflowRuns',
  'GetWorkflowRun', 'ResumeWorkflowRun', 'ResolveWorkflowQuestion', 'FillWorkflowHole',
  'OffPeakCreate', 'OffPeakList', 'CronCreate', 'CronDelete', 'CronList', 'CronUpdate',
])

/** A bounded sample's token density scaled to the full recorded character count. */
export function estimateFromChars(sample, chars) {
  const length = Number(chars)
  if (!Number.isFinite(length) || length <= 0) return 0
  const text = typeof sample === 'string' ? sample : ''
  if (text.length === 0) return Math.ceil(length / 4) + 4
  if (length <= text.length) return estimateTokens(text.slice(0, length)) + 4
  return Math.max(1, Math.round(estimateTokens(text) * (length / text.length))) + 4
}

export function toolSourceOf(name) {
  const value = String(name ?? '')
  if (value.startsWith('mcp__')) {
    const rest = value.slice(5)
    const split = rest.lastIndexOf('__')
    return 'mcp:' + (split > 0 ? rest.slice(0, split) : rest)
  }
  return BUILTIN_TOOLS.has(value) ? 'built-in' : 'plugin'
}

export function summaryOfPart(part) {
  const keys = ['file_path', 'read_path', 'input_path', 'path']
  for (const key of keys) {
    const value = part[key]
    if (typeof value === 'string' && value) return value
  }
  if (typeof part.pattern === 'string' && part.pattern) {
    return part.input_path ? part.pattern + ' · ' + part.input_path : part.pattern
  }
  if (typeof part.description === 'string' && part.description.trim()) return oneLineOf(part.description, 120)
  if (typeof part.command === 'string' && part.command.trim()) return oneLineOf(part.command.split('\n')[0], 120)
  if (typeof part.skill === 'string' && part.skill) return part.skill
  if (typeof part.query === 'string' && part.query) return oneLineOf(part.query, 120)
  if (typeof part.url === 'string' && part.url) return oneLineOf(part.url, 120)
  if (typeof part.input_name === 'string' && part.input_name) return oneLineOf(part.input_name, 120)
  if (typeof part.prompt === 'string' && part.prompt) return oneLineOf(part.prompt, 120)
  return firstLineOf(part.input_sample, 120)
}

function partCount(part) {
  return {
    chars: Math.max(0, Number(part.text_chars ?? 0) + Number(part.output_chars ?? 0) + Number(part.input_chars ?? 0)),
    textChars: Math.max(0, Number(part.text_chars ?? 0)),
    outputChars: Math.max(0, Number(part.output_chars ?? 0)),
    inputChars: Math.max(0, Number(part.input_chars ?? 0)),
  }
}

const isInjectedMessage = (message) => {
  const kind = String(message.kind ?? '')
  const origin = String(message.origin ?? '')
  return (
    message.synthetic === 1 ||
    kind === 'system_reminder' ||
    kind === 'todo_reminder' ||
    kind === 'agent_listing_delta' ||
    kind === 'compact_summary' ||
    origin === 'agent_runtime' && message.role === 'user'
  )
}

function injectionForm(message) {
  const kind = String(message.kind ?? '')
  if (kind === 'compact_summary') return 'compaction'
  if (kind === 'todo_reminder') return 'todo'
  if (kind === 'system_reminder') return 'reminder'
  if (kind === 'agent_listing_delta') return 'agents'
  return kind || 'context'
}

/**
 * Build one item per model-visible content element. `baseSeq` is the message sequence used to
 * slice this element into a request; parts inherit their message's sequence.
 */
export function buildConversationItems(conversation) {
  const items = []
  const active = conversation.branch
  let order = 1000
  const messages = [...conversation.messages].sort(
    (a, b) =>
      (a.sequence ?? Number.MAX_SAFE_INTEGER) - (b.sequence ?? Number.MAX_SAFE_INTEGER) ||
      a.time_created - b.time_created ||
      a.id.localeCompare(b.id),
  )

  for (const [messageIndex, message] of messages.entries()) {
    if (message.visibility === 'hidden') continue
    if (active !== null && message.sequence != null && !active.has(message.sequence)) continue
    if (message.kind === 'timeline_event') continue
    const seq = message.sequence ?? 1_000_000 + messageIndex
    const parts = conversation.byMessage.get(message.id) ?? []
    const injected = isInjectedMessage(message)
    const compactSummary = message.kind === 'compact_summary'
    const role = message.role
    let messageOverheadUsed = false
    const overhead = () => {
      if (messageOverheadUsed) return 0
      messageOverheadUsed = true
      return 4
    }

    let emittedText = false
    for (const part of parts) {
      const counts = partCount(part)
      if (part.type === 'text' && Number(part.text_chars ?? 0) > 0) {
        const text = String(part.text_preview ?? '')
        const cat = compactSummary || injected ? 'inject' : role === 'user' ? 'user' : 'assistant'
        const kind = compactSummary ? 'compaction' : injected ? 'injection' : role === 'user' ? 'prompt' : 'answer'
        items.push({
          key: 'p:' + part.id,
          cat,
          kind,
          tokens: estimateFromChars(text, counts.textChars) + overhead(),
          chars: counts.textChars,
          title: compactSummary ? 'Compaction summary' : firstLineOf(text, 160) || (role === 'user' ? 'User message' : 'Assistant reply'),
          preview: oneLineOf(text, 240),
          messageId: message.id,
          partId: part.id,
          messageSeq: seq,
          order: order++,
          time: message.time_created,
          role,
          messageKind: message.kind,
          source: message.source ?? message.metadata_source ?? null,
          form: compactSummary ? 'compaction' : injected ? injectionForm(message) : null,
          synthetic: message.synthetic === 1,
          lineCount: Number(part.output_lines ?? 0) || undefined,
        })
        emittedText = true
        continue
      }

      if (part.type === 'reasoning' && Number(part.text_chars ?? 0) > 0) {
        const text = String(part.text_preview ?? '')
        items.push({
          key: 'p:' + part.id,
          cat: 'assistant',
          kind: 'thinking',
          tokens: estimateFromChars(text, counts.textChars) + overhead(),
          chars: counts.textChars,
          title: 'Thinking',
          preview: oneLineOf(text, 240),
          messageId: message.id,
          partId: part.id,
          messageSeq: seq,
          order: order++,
          time: message.time_created,
          role,
          messageKind: message.kind,
        })
        continue
      }

      if (part.type === 'tool') {
        const tool = String(part.tool ?? 'tool')
        const summary = summaryOfPart(part)
        const title = summary ? tool + ' · ' + summary : tool
        const callTokens = estimateTokens(tool) + estimateFromChars(part.input_sample, counts.inputChars) + 4
        const resultTokens = estimateFromChars(part.output_preview, counts.outputChars)
        if (tool === 'Skill') {
          const skill = typeof part.skill === 'string' && part.skill ? part.skill : summary || 'skill'
          items.push({
            key: 'p:' + part.id + ':skill',
            cat: 'skill',
            kind: 'skill',
            tokens: callTokens + resultTokens + overhead(),
            chars: counts.inputChars + counts.outputChars,
            title: 'Skill · ' + skill,
            preview: oneLineOf(part.input_sample, 200) || skill,
            messageId: message.id,
            partId: part.id,
            messageSeq: seq,
            order: order++,
            time: part.tool_end ?? message.time_created,
            role,
            tool,
            skill,
            status: part.status ?? null,
            toolCallId: part.call_id ?? null,
          })
          continue
        }
        items.push({
          key: 'p:' + part.id + ':call',
          cat: 'assistant',
          kind: 'tool-call',
          tokens: callTokens + overhead(),
          chars: counts.inputChars + tool.length,
          title: 'Tool call · ' + title,
          preview: oneLineOf(part.input_sample, 240),
          messageId: message.id,
          partId: part.id,
          messageSeq: seq,
          order: order++,
          time: part.tool_start ?? message.time_created,
          role,
          tool,
          toolCallId: part.call_id ?? null,
          status: part.status ?? null,
          source: toolSourceOf(tool),
        })
        if (counts.outputChars > 0 || part.output_preview) {
          items.push({
            key: 'p:' + part.id + ':result',
            cat: 'tool',
            kind: 'tool-result',
            tokens: resultTokens,
            chars: counts.outputChars,
            title: 'Tool result · ' + title,
            preview: oneLineOf(part.output_preview, 240),
            messageId: message.id,
            partId: part.id,
            messageSeq: seq,
            order: order++,
            time: part.tool_end ?? message.time_updated ?? message.time_created,
            role,
            tool,
            toolCallId: part.call_id ?? null,
            status: part.status ?? null,
            err: part.status === 'error',
            source: toolSourceOf(tool),
            lineCount: Number(part.output_lines ?? 0) || undefined,
          })
        }
        continue
      }

      if (part.type === 'file') {
        const width = Number(part.image_width ?? part.image_ow ?? 0)
        const height = Number(part.image_height ?? part.image_oh ?? 0)
        const image = IMAGE_MIME.test(String(part.mime ?? ''))
        const tokens = image ? estimateImageTokens(width, height) ?? 320 : 32
        items.push({
          key: 'p:' + part.id,
          cat: role === 'user' ? 'user' : 'tool',
          kind: image ? 'image' : 'attachment',
          tokens: tokens + overhead(),
          chars: 0,
          title: image ? 'Image' : 'Attachment',
          preview: width && height ? width + '×' + height : String(part.mime ?? ''),
          messageId: message.id,
          partId: part.id,
          messageSeq: seq,
          order: order++,
          time: message.time_created,
          role,
          mime: part.mime ?? null,
          images: image ? 1 : 0,
          imageWidth: width || null,
          imageHeight: height || null,
          bytes: Number(part.image_bytes ?? part.read_size ?? 0) || null,
        })
        continue
      }
    }

    // A compaction summary may have no text part (or a text part that the retention window
    // trimmed): its summary body is still model-visible context.
    if (compactSummary && !emittedText && Number(message.summary_chars ?? 0) > 0) {
      const text = String(message.summary_preview ?? '')
      items.push({
        key: 'm:' + message.id + ':summary',
        cat: 'inject',
        kind: 'compaction',
        tokens: estimateFromChars(text, Number(message.summary_chars ?? 0)) + 4,
        chars: Number(message.summary_chars ?? 0),
        title: message.summary_title || 'Compaction summary',
        preview: oneLineOf(text, 240),
        messageId: message.id,
        partId: null,
        messageSeq: seq,
        order: order++,
        time: message.time_created,
        role,
        messageKind: message.kind,
        source: message.source ?? null,
        form: 'compaction',
      })
    }
  }
  return items
}

function toolNameOf(tool) {
  return (
    tool?.function?.name ??
    tool?.name ??
    tool?.toolName ??
    tool?.function?.name ??
    null
  )
}

function toolDescriptionOf(tool) {
  return tool?.function?.description ?? tool?.description ?? ''
}

/** Header items: one system-prompt element and one item per tool schema. */
export function buildHeaderItems(record) {
  const items = []
  if (!record) return { items, tokens: 0, known: false, maxOutputTokens: null }
  const system = record.header?.system
  let systemText = ''
  if (typeof system === 'string') systemText = system
  else if (Array.isArray(system)) {
    systemText = system
      .map((block) => (typeof block === 'string' ? block : block?.type === 'text' ? block.text ?? '' : ''))
      .filter(Boolean)
      .join('\n\n')
  }
  if (systemText) {
    items.push({
      key: 'sys',
      cat: 'system',
      kind: 'system',
      tokens: estimateSystemContent(system),
      chars: systemText.length,
      title: 'System prompt',
      preview: oneLineOf(systemText, 240),
      order: 0,
      header: true,
      text: systemText,
    })
  }
  const tools = Array.isArray(record.header?.tools) ? record.header.tools : []
  let order = 1
  for (const tool of tools) {
    const name = toolNameOf(tool) ?? 'tool'
    items.push({
      key: 't:' + name + ':' + order,
      cat: 'tools',
      kind: 'schema',
      tokens: estimateToolSchema(tool),
      chars: JSON.stringify(tool).length,
      title: name,
      preview: oneLineOf(toolDescriptionOf(tool), 220),
      order: order++,
      header: true,
      tool: name,
      source: toolSourceOf(name),
      value: tool,
    })
  }
  return {
    items,
    tokens: items.reduce((sum, item) => sum + item.tokens, 0),
    known: true,
    maxOutputTokens: record.header?.maxOutputTokens ?? null,
    record,
  }
}
