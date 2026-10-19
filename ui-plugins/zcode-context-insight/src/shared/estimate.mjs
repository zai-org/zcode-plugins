/**
 * Shared token accounting and formatting.
 *
 * The estimator is deliberately tokenizer-free: it mirrors the fixed-density accounting used by
 * DeepSeek Harness / ZCode's context meter, with a script-weighted correction so CJK text is not
 * under-counted. Figures are labelled as estimates in the UI; provider-reported prompt/output
 * totals remain the authority and are used to anchor each request's composition.
 */

const BLOCK_OVERHEAD = 4
const ROLE_OVERHEAD = 4

const isWide = (code) =>
  (code >= 0x2e80 && code <= 0x9fff) ||
  (code >= 0xac00 && code <= 0xd7af) ||
  (code >= 0xf900 && code <= 0xfaff) ||
  (code >= 0xff00 && code <= 0xffef)

/** Script-weighted token estimate (~4 ASCII chars, ~1.5 CJK chars, ~2 other chars per token). */
export function estimateTokens(text) {
  const value = typeof text === 'string' ? text : text == null ? '' : String(text)
  let narrow = 0
  let wide = 0
  let other = 0
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code < 0x80) narrow++
    else if (isWide(code)) wide++
    else {
      other++
      if (code >= 0xd800 && code <= 0xdbff) i++
    }
  }
  return Math.ceil(narrow / 4 + wide / 1.5 + other / 2)
}

/** Stable JSON used for content identity and size accounting. */
export function canonical(value) {
  if (value === undefined) return 'null'
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value !== null && typeof value === 'object') {
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ':' + canonical(value[key]))
        .join(',') +
      '}'
    )
  }
  const json = JSON.stringify(value)
  return json === undefined ? 'null' : json
}

const CACHE_KEYS = new Set(['cacheControl', 'cache_control'])
function withoutCache(value) {
  if (Array.isArray(value)) return value.map(withoutCache)
  if (value !== null && typeof value === 'object') {
    const out = {}
    for (const [key, item] of Object.entries(value)) if (!CACHE_KEYS.has(key)) out[key] = withoutCache(item)
    return out
  }
  return value
}

/** Content identity for diffing: cache breakpoints move every request and are not content. */
export function contentKey(value) {
  return canonical(withoutCache(value))
}

export function estimateJson(value) {
  return estimateTokens(canonical(value))
}

export function estimateTextBlock(text) {
  return typeof text === 'string' && text.length > 0 ? estimateTokens(text) + BLOCK_OVERHEAD : 0
}

export function estimateToolCall(name, input) {
  if (!name && input == null) return 0
  return estimateTokens(String(name ?? '')) + estimateJson(input ?? {}) + BLOCK_OVERHEAD
}

export function estimateToolResult(output) {
  if (output == null) return 0
  const text = typeof output === 'string' ? output : canonical(output)
  return text.length > 0 ? estimateTokens(text) + BLOCK_OVERHEAD : 0
}

export function estimateSystemContent(system) {
  if (system == null) return 0
  if (typeof system === 'string') return estimateTokens(system) + ROLE_OVERHEAD
  if (Array.isArray(system)) {
    if (system.length === 0) return 0
    const text = system
      .map((block) =>
        block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string'
          ? block.text
          : canonical(block),
      )
      .join('\n')
    return estimateTokens(text) + ROLE_OVERHEAD
  }
  return estimateJson(system) + ROLE_OVERHEAD
}

export function estimateToolsTotal(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return 0
  return estimateJson(tools) + BLOCK_OVERHEAD
}

export function estimateToolSchema(tool) {
  return estimateJson(tool) + BLOCK_OVERHEAD
}

export function estimateBlocks(blocks) {
  if (!Array.isArray(blocks)) return 0
  let tokens = 0
  for (const block of blocks) {
    if (block === null || typeof block !== 'object') {
      tokens += BLOCK_OVERHEAD
      continue
    }
    switch (block.type) {
      case 'text':
      case 'reasoning':
        tokens += estimateTextBlock(block.text || '')
        break
      case 'tool-call':
      case 'tool_use':
        tokens += estimateToolCall(block.name || block.toolName, block.input ?? block.args ?? block.arguments)
        break
      case 'tool-result':
      case 'tool_result':
        tokens += estimateToolResult(block.output ?? block.result ?? block.content)
        break
      case 'image':
      case 'file': {
        const image = block.metadata?.image ?? block.image ?? block
        const width = Number(image?.width ?? image?.originalWidth)
        const height = Number(image?.height ?? image?.originalHeight)
        const priced = estimateImageTokens(width, height)
        tokens += (priced ?? Math.ceil(canonical(block).length / 4)) + BLOCK_OVERHEAD
        break
      }
      default:
        tokens += BLOCK_OVERHEAD + estimateJson(block)
    }
  }
  return tokens
}

export function estimateMessage(message, emptyIsZero = false) {
  if (emptyIsZero && (!message || !Array.isArray(message.content) || message.content.length === 0)) return 0
  return estimateBlocks(message?.content) + ROLE_OVERHEAD
}

export function lineCountOf(text) {
  if (typeof text !== 'string' || text.length === 0) return 0
  let lines = 0
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lines++
  return text.endsWith('\n') ? lines : lines + 1
}

export function firstLineOf(text, max = 160) {
  for (const line of String(text ?? '').split('\n')) {
    const value = line.trim()
    if (value && !/^<\/?[a-z][\w-]*>$/i.test(value)) return value.slice(0, max)
  }
  return ''
}

export function oneLineOf(text, max = 160) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

export function truncate(text, max) {
  const value = String(text ?? '')
  return value.length <= max ? value : value.slice(0, max)
}

export function formatTokens(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n === 0) return '0'
  const abs = Math.abs(n)
  if (abs >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B'
  if (abs >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'
  if (abs >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k'
  return String(Math.round(n))
}

export function formatCount(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '0'
  return Math.round(n).toLocaleString('en-US')
}

export function formatDuration(ms) {
  const n = Number(ms)
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n < 1000) return Math.round(n) + 'ms'
  if (n < 60_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '') + 's'
  if (n < 3_600_000) {
    const minutes = Math.floor(n / 60_000)
    const seconds = Math.round((n % 60_000) / 1000)
    return seconds > 0 ? minutes + 'm' + seconds + 's' : minutes + 'm'
  }
  const hours = Math.floor(n / 3_600_000)
  const minutes = Math.round((n % 3_600_000) / 60_000)
  return minutes > 0 ? hours + 'h' + minutes + 'm' : hours + 'h'
}

export function formatShare(value, total) {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return '0.0'
  return ((value / total) * 100).toFixed(1)
}

export function formatBytes(bytes) {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  if (n < 1024) return Math.round(n) + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KiB'
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MiB'
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GiB'
}

const USD_PER_CNY = 0.15

/** USD list-price total for one model's billed buckets (rates are USD per 1M tokens). */
export function costOfBuckets(rate, buckets, currency = 'usd') {
  if (!rate || !buckets) return null
  const uncached = Math.max(0, Number(buckets.uncached) || 0)
  const cacheRead = Math.max(0, Number(buckets.cacheRead) || 0)
  const cacheWrite = Math.max(0, Number(buckets.cacheWrite) || 0)
  const output = Math.max(0, Number(buckets.output) || 0)
  const usd =
    (uncached * Number(rate.miss ?? 0) +
      cacheRead * Number(rate.hit ?? 0) +
      cacheWrite * Number(rate.write ?? 0) +
      output * Number(rate.out ?? 0)) /
    1e6
  return currency === 'cny' ? usd / USD_PER_CNY : usd
}

export function formatCost(value, currency = 'usd') {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  const symbol = currency === 'cny' ? '¥' : '$'
  const abs = Math.abs(n)
  if (abs === 0) return symbol + '0'
  if (abs < 0.001) return symbol + n.toFixed(5)
  if (abs < 0.01) return symbol + n.toFixed(4)
  if (abs < 1) return symbol + n.toFixed(3)
  return symbol + n.toFixed(2)
}

/* ------------------------------------------------------------------------------------------------
 * DeepSeek vision token estimate — a port of the official image-token calculator (aspect-preserving
 * rescale, 14px patches with 3:1 downsampling, 384-token cap). Used only for attachment cards.
 * ---------------------------------------------------------------------------------------------- */

const PATCH_SIZE = 14
const DOWNSAMPLE_RATIO = 3
const MAX_TOKENS = 384
const COMPRESS_PAD_TO = 4
const MAX_WH_RATIO = 8
const MIN_PIXELS = 147456

const floorDiv = (a, b) => Math.floor(a / b)
const ceilDiv = (a, b) => Math.floor((a + b - 1) / b)

function gridTokens(rows, cols) {
  let n = rows * (cols + 1) + 2
  if (rows % 2 === 1) n += cols + 1
  n += ((ceilDiv(rows, 2) * (cols + 1)) % 2) * 2
  return n
}

function solveResizeRatio(height, width, budget) {
  const ratio = height / width
  const gridW = Math.sqrt((budget - 2) / ratio + 0.25) - 0.5
  const gridH = gridW * ratio
  const unit = PATCH_SIZE * DOWNSAMPLE_RATIO
  let bestHeight
  let bestWidth
  if (gridW < 1) {
    let rows = floorDiv(budget - 2, 2)
    if (rows % 2 === 1) rows -= 1
    bestWidth = unit
    bestHeight = rows * unit
  } else if (gridH < 2) {
    const cols = floorDiv(budget - 2, 2) - 1
    if (cols <= 1) throw new Error('image tokens: budget too small')
    bestHeight = 2 * unit
    bestWidth = cols * unit
  } else {
    const cols = Math.trunc(gridW)
    let rows = Math.trunc(gridH)
    if (rows % 2 === 1) rows -= 1
    const scale = Math.min((cols * unit) / width, (rows * unit) / height)
    bestWidth = Math.trunc((width * scale) / PATCH_SIZE) * PATCH_SIZE
    bestHeight = Math.trunc((height * scale) / PATCH_SIZE) * PATCH_SIZE
  }
  const nLlmH = ceilDiv(floorDiv(bestHeight, PATCH_SIZE), DOWNSAMPLE_RATIO)
  const nLlmW = ceilDiv(floorDiv(bestWidth, PATCH_SIZE), DOWNSAMPLE_RATIO)
  return { nLlmH, nLlmW, bestHeight, bestWidth, numTokens: gridTokens(nLlmH, nLlmW) }
}

function safeResize(height, width, paddedHeight, paddedWidth) {
  const nLlmH = ceilDiv(floorDiv(paddedHeight, PATCH_SIZE), DOWNSAMPLE_RATIO)
  const nLlmW = ceilDiv(floorDiv(paddedWidth, PATCH_SIZE), DOWNSAMPLE_RATIO)
  const pad = COMPRESS_PAD_TO - 1
  const budget = MAX_TOKENS - pad
  let result = {
    nLlmH,
    nLlmW,
    bestHeight: paddedHeight,
    bestWidth: paddedWidth,
    numTokens: gridTokens(nLlmH, nLlmW),
  }
  if (result.numTokens > budget) {
    result = solveResizeRatio(height, width, budget)
    let nextBudget = budget
    while (result.numTokens > budget) {
      nextBudget -= 1
      result = solveResizeRatio(height, width, nextBudget)
    }
  }
  result.numTokens += pad
  return result
}

function calcResizeInner(width, height) {
  let w = width
  let h = height
  if (w > h * MAX_WH_RATIO) w = h * MAX_WH_RATIO
  const pixels = w * h
  if (pixels < MIN_PIXELS && pixels > 0) {
    const scale = Math.sqrt(MIN_PIXELS / pixels)
    w = Math.trunc(w * scale)
    h = Math.trunc(h * scale)
  }
  const paddedWidth = ceilDiv(w, PATCH_SIZE) * PATCH_SIZE
  const paddedHeight = ceilDiv(h, PATCH_SIZE) * PATCH_SIZE
  return safeResize(h, w, paddedHeight, paddedWidth)
}

export function estimateImageTokens(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  try {
    let result = calcResizeInner(width, height)
    for (let i = 1; i < 10; i++) {
      const next = calcResizeInner(result.bestWidth, result.bestHeight)
      if (
        next.nLlmH === result.nLlmH &&
        next.nLlmW === result.nLlmW &&
        next.bestHeight === result.bestHeight &&
        next.bestWidth === result.bestWidth &&
        next.numTokens === result.numTokens
      ) {
        return result.numTokens
      }
      result = next
    }
    return null
  } catch {
    return null
  }
}
