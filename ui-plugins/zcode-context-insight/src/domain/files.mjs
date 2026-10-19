/**
 * File activity: one row per touched file, aggregated from settled tool calls.
 *
 * Read/Write/Edit carry exact structured metadata in ZCode (read window, file state, and edit
 * addition/deletion counts). Bash is included only for unambiguous path-bearing commands and is
 * marked as an estimate; the card never pretends to know more than the recorded call says.
 */

import { lineCountOf, oneLineOf } from '../shared/estimate.mjs'

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i
const CODE_EXT = /\.(tsx?|jsx?|mjs|cjs|py|go|rs|java|kt|rb|php|c|h|cpp|cs|scala|lua|dart|swift|vue|svelte|sh|bash|zsh|html|css|scss|sass|less|sql|md|mdx|json|ya?ml|toml)$/i

function formOf(path, tool) {
  if (tool === 'Read' && typeof path === 'string' && IMAGE_EXT.test(path)) return 'image'
  if (typeof path === 'string' && IMAGE_EXT.test(path)) return 'image'
  if (typeof path === 'string' && path.endsWith('/')) return 'dir'
  return 'text'
}

function finiteNumber(value) {
  if (value === null || value === undefined) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function barePath(value) {
  const path = String(value ?? '').trim()
  if (!path) return ''
  return path.replace(/^['"]|['"]$/g, '')
}

function pathFromInput(part) {
  for (const key of ['file_path', 'read_path', 'input_path', 'path']) {
    const value = barePath(part[key])
    if (value) return value
  }
  return ''
}

/** Conservative shell parse: only explicit path operands, never a guessed file from free text. */
function shellOps(part) {
  const command = typeof part.command === 'string' ? part.command : ''
  if (!command || command.includes('\n') || /<<-?\s*['"]?\w/.test(command)) return []
  const ops = []
  const detail = oneLineOf(command, 180)
  const add = (kind, path) => {
    const value = barePath(path)
    if (!value || value.startsWith('-') || /^[|&;<>]/.test(value)) return
    ops.push({ kind, path: value, tool: 'Bash', detail, est: true })
  }
  for (const match of command.matchAll(/(?:^|[;&|]\s*)(?:sudo\s+)?(?:rg|grep)\s+([^;&|]+)/g)) {
    const args = match[1].split(/\s+/).filter(Boolean)
    const pattern = args.find((arg) => !arg.startsWith('-') && !arg.includes('='))
    const paths = args.filter((arg) => !arg.startsWith('-') && arg !== pattern)
    if (pattern && paths.length > 0) for (const path of paths) add('search', path)
    else if (pattern && /\s(-r|--recursive)\b/.test(match[0])) add('search', '.')
  }
  for (const match of command.matchAll(/(?:^|[;&|]\s*)(?:sudo\s+)?(?:cat|head|tail|less|more|bat)\s+([^;&|]+)/g)) {
    const args = match[1].split(/\s+/).filter((arg) => !arg.startsWith('-'))
    for (const path of args) add('read', path.replace(/^['"]|['"]$/g, ''))
  }
  for (const match of command.matchAll(/(?:^|[;&|]\s*)(?:sudo\s+)?sed\s+(?:-n\s+)?(?:['"][^'"]+['"]\s+)?([^;&|]+)/g)) {
    const args = match[1].split(/\s+/).filter((arg) => !arg.startsWith('-') && !/^\d+(,\d+)?p?$/.test(arg))
    for (const path of args) add('read', path.replace(/^['"]|['"]$/g, ''))
  }
  for (const match of command.matchAll(/(?:^|[;&|]\s*)(?:sudo\s+)?tee\s+(?:-a\s+)?([^;&|]+)/g)) {
    for (const path of match[1].split(/\s+/).filter((arg) => !arg.startsWith('-'))) add('write', path)
  }
  for (const match of command.matchAll(/(?:^|[^<])(?:>>?)\s*([^\s;&|]+)/g)) {
    if (!/[12]?>&/.test(match[0])) add('write', match[1])
  }
  return ops
}

/** One record per executed file op. */
export function buildFileOps(conversation) {
  const ops = []
  for (const part of conversation.parts) {
    if (part.type !== 'tool') continue
    const message = conversation.messageMap.get(part.message_id)
    if (!message || message.visibility === 'hidden') continue
    const seq = message.sequence ?? Number.MAX_SAFE_INTEGER
    const time = part.tool_end ?? part.tool_start ?? part.time_created
    const base = {
      seq,
      time,
      err: part.status === 'error',
      key: 'p:' + part.id + ':result',
      partId: part.id,
      messageId: message.id,
      toolCallId: part.call_id ?? null,
    }
    const tool = String(part.tool ?? '')
    const path = pathFromInput(part)
    if (tool === 'Read' && path) {
      ops.push({
        ...base,
        path,
        kind: 'read',
        tool,
        added: 0,
        removed: 0,
        read: {
          start: Number(part.read_offset) > 0 ? Number(part.read_offset) : undefined,
          count: Number(part.output_lines) > 0 ? Number(part.output_lines) : undefined,
        },
      })
      continue
    }
    if (tool === 'Write' && path) {
      ops.push({
        ...base,
        path,
        kind: 'write',
        tool,
        added: finiteNumber(part.additions) ?? (Number(part.write_lines) || 0),
        removed: finiteNumber(part.deletions) ?? 0,
      })
      continue
    }
    if (tool === 'Edit' && path) {
      ops.push({
        ...base,
        path,
        kind: 'write',
        tool,
        added: finiteNumber(part.additions) ?? (Number(part.edit_new_lines) || 0),
        removed: finiteNumber(part.deletions) ?? (Number(part.edit_old_lines) || 0),
        diff: true,
      })
      continue
    }
    if (tool === 'MultiEdit' && path) {
      ops.push({
        ...base,
        path,
        kind: 'write',
        tool,
        added: finiteNumber(part.additions) ?? 0,
        removed: finiteNumber(part.deletions) ?? 0,
        diff: true,
      })
      continue
    }
    if (tool === 'Grep' && path) {
      ops.push({ ...base, path, kind: 'search', tool, added: 0, removed: 0, detail: part.pattern ?? undefined })
      continue
    }
    if (tool === 'Glob' && path) {
      ops.push({ ...base, path, kind: 'search', tool, added: 0, removed: 0, detail: part.pattern ?? undefined, pattern: true })
      continue
    }
    if (tool === 'Bash') {
      for (const op of shellOps(part)) ops.push({ ...base, ...op })
    }
  }
  return ops
}

function surfaceOp(op) {
  return { ...op }
}

/** Aggregate ops up to a step boundary (exclusive message sequence, or all when null). */
export function fileActivity(conversation, beforeSeq = null) {
  const ops = buildFileOps(conversation)
    .filter((op) => beforeSeq === null || op.seq < beforeSeq)
    .sort((a, b) => b.time - a.time || b.seq - a.seq)
  const totals = {
    read: { files: 0, ops: 0 },
    write: { files: 0, ops: 0 },
    search: { files: 0, ops: 0 },
    image: { files: 0, ops: 0 },
    added: 0,
    removed: 0,
  }
  const byPath = new Map()
  for (const op of ops) {
    const entry = byPath.get(op.path) ?? {
      path: op.path,
      form: formOf(op.path, op.tool),
      reads: 0,
      writes: 0,
      searches: 0,
      added: 0,
      removed: 0,
      ops: [],
      ...(op.pattern ? { pattern: true } : {}),
      latest: op.time,
    }
    if (op.kind === 'read') entry.reads++
    else if (op.kind === 'write') entry.writes++
    else entry.searches++
    entry.added += Number(op.added) || 0
    entry.removed += Number(op.removed) || 0
    entry.latest = Math.max(entry.latest ?? 0, op.time ?? 0)
    entry.ops.push(surfaceOp(op))
    byPath.set(op.path, entry)
    totals[op.kind].ops++
  }
  const entries = [...byPath.values()]
  for (const entry of entries) {
    entry.ops.sort((a, b) => b.time - a.time || b.seq - a.seq)
    if (entry.reads > 0) totals.read.files++
    if (entry.writes > 0) totals.write.files++
    if (entry.searches > 0) totals.search.files++
    if (entry.form === 'image') {
      totals.image.files++
      totals.image.ops += entry.ops.length
    }
    totals.added += entry.added
    totals.removed += entry.removed
  }
  entries.sort((a, b) => (b.latest ?? 0) - (a.latest ?? 0) || a.path.localeCompare(b.path))
  return { entries, totals, opCount: ops.length }
}

/** Display form relative to the session's workspace, keeping absolute paths verbatim. */
export function displayPathOf(path, workspace) {
  const root = typeof workspace === 'string' && workspace.length > 0 ? workspace.replace(/\/+$/, '') : ''
  if (root && path === root) return './'
  if (root && path.startsWith(root + '/')) return path.slice(root.length + 1)
  return path
}

const GLYPH_BY_EXT = [
  [['tsx', 'ts'], 'TS', '#3178c6'],
  [['js', 'jsx', 'mjs', 'cjs'], 'JS', '#f7df1e'],
  [['py', 'pyi'], 'PY', '#3572a5'],
  [['go'], 'GO', '#00add8'],
  [['rs'], 'RS', '#dea584'],
  [['java'], 'JV', '#b07219'],
  [['kt', 'kts'], 'KT', '#a97bff'],
  [['rb'], 'RB', '#701516'],
  [['php'], 'PHP', '#4f5d95'],
  [['c', 'h'], 'C', '#555555'],
  [['cpp', 'cc', 'cxx', 'hpp'], 'C++', '#f34b7d'],
  [['cs'], 'C#', '#178600'],
  [['sh', 'bash', 'zsh', 'fish'], 'SH', '#89e051'],
  [['html', 'htm'], 'HT', '#e34c26'],
  [['css', 'scss', 'sass', 'less'], 'CSS', '#563d7c'],
  [['sql'], 'SQL', '#e38c00'],
  [['json', 'jsonc'], '{}', '#cbcb41'],
  [['md', 'mdx'], 'MD', '#519aba'],
]

export function fileGlyph(path, form) {
  if (form === 'image') return { glyph: '🖼', label: 'image' }
  if (form === 'dir') return { glyph: '📁', label: 'directory' }
  const name = String(path ?? '').split('/').pop()?.toLowerCase() ?? ''
  if (name.endsWith('.lock') || /^(package-lock\.json|pnpm-lock\.yaml)$/.test(name)) return { glyph: '🔒', label: 'lock' }
  if (/(^|[^a-z0-9])test([^a-z0-9]|$)|\.test\./.test(name)) return { glyph: '🧪', label: 'test' }
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot + 1) : ''
  for (const [exts, label, color] of GLYPH_BY_EXT) {
    if (exts.includes(ext)) return { glyph: label, label: ext, color, text: '#fff' }
  }
  if (CODE_EXT.test(name)) return { glyph: '⌘', label: 'code' }
  return { glyph: '📄', label: ext || 'file' }
}

export function looksLikeImage(path) {
  return IMAGE_EXT.test(String(path ?? ''))
}
