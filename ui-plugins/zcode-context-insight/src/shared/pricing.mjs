/**
 * Offline model catalog, price book and context-window resolution.
 *
 * `models.json` is a compact snapshot of https://models.dev/api.json generated at build time
 * (see scripts/update-models.mjs). Nothing is fetched at runtime. ZCode's own provider config is
 * preferred for context windows because it describes the exact deployment the user runs.
 */

import modelsData from './models.json' with { type: 'json' }
import { readFileSync } from 'node:fs'

const PROVIDERS = modelsData.providers ?? {}

const PROVIDER_ALIASES = {
  bigmodel: 'zhipuai',
  'bigmodel-api': 'zhipuai',
  'bigmodel-team-coding-plan': 'zhipuai',
  'bigmodel-individual-coding-plan': 'zhipuai',
  zai: 'zhipuai',
  'zai-coding-plan': 'zhipuai',
  zhipu: 'zhipuai',
  zhipuai: 'zhipuai',
  glm: 'zhipuai',
  kimi: 'moonshotai',
  moonshot: 'moonshotai',
  'moonshot-cn': 'moonshotai-cn',
  'kimi-code-plan-global': 'moonshotai',
  'kimi-code-plan-cn': 'moonshotai-cn',
  deepseek: 'deepseek',
  minimax: 'minimax',
  'minimax-cn': 'minimax-cn',
  qwen: 'alibaba',
  alibaba: 'alibaba',
  dashscope: 'alibaba',
  'alibaba-cn': 'alibaba-cn',
  anthropic: 'anthropic',
  claude: 'anthropic',
  openai: 'openai',
  gpt: 'openai',
  google: 'google',
  gemini: 'google',
  vertex: 'google-vertex',
  openrouter: 'openrouter',
}

/** Lower-case provider id without ZCode's `builtin:` / `account:` / `custom:` prefixes. */
export function normalizeProviderId(provider) {
  let value = String(provider ?? '').trim().toLowerCase()
  value = value.replace(/^(builtin|account|custom|provider):/, '')
  const at = value.lastIndexOf('@')
  if (at >= 0) value = value.slice(0, at)
  const slash = value.lastIndexOf('/')
  if (slash >= 0 && value.startsWith('account:')) value = value.slice(slash + 1)
  return value
}

function providerCandidates(provider) {
  const normalized = normalizeProviderId(provider)
  const out = new Set()
  if (normalized) out.add(normalized)
  if (PROVIDER_ALIASES[normalized]) out.add(PROVIDER_ALIASES[normalized])
  if (PROVIDERS[normalized]) out.add(normalized)
  return [...out]
}

/** model id (lower-case) → candidate provider entries carrying that model. */
const MODEL_INDEX = new Map()
function pushIndex(key, candidate) {
  if (!key) return
  const list = MODEL_INDEX.get(key)
  if (list === undefined) MODEL_INDEX.set(key, [candidate])
  else if (!list.some((c) => c.pid === candidate.pid && c.mid === candidate.mid)) list.push(candidate)
}
for (const [pid, provider] of Object.entries(PROVIDERS)) {
  for (const [mid, model] of Object.entries(provider.models ?? {})) {
    const candidate = { pid, mid, model, provider }
    const lower = mid.toLowerCase()
    pushIndex(lower, candidate)
    const parts = lower.split('-')
    for (let i = 1; i < parts.length; i++) pushIndex(parts.slice(i).join('-'), candidate)
  }
}

function candidateFor(provider, model) {
  const id = String(model ?? '').trim().toLowerCase()
  if (!id) return null
  const aliases = providerCandidates(provider)
  const collect = (key) => {
    const direct = MODEL_INDEX.get(key) ?? []
    if (direct.length > 0) return direct
    // Prefix/suffix tolerance for deployment aliases such as `k3-256k` → `kimi-k3` and
    // `deepseek-v4.1-flash` → `deepseek-flash` (exact matches always win above).
    const matches = []
    for (const [indexed, candidates] of MODEL_INDEX) {
      if (indexed.length < 3) continue
      if (id.startsWith(indexed + '-') || indexed.startsWith(id + '-')) matches.push(...candidates)
    }
    return matches
  }
  const candidates = collect(id)
  if (candidates.length === 0) return null
  const preferred = candidates.filter((c) => aliases.includes(c.pid))
  const pool = preferred.length > 0 ? preferred : candidates
  const exact = pool.filter((c) => c.mid.toLowerCase() === id)
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) {
    const firstParty = exact.find((c) => c.provider.npm === `@ai-sdk/${c.pid}`)
    return firstParty ?? exact[0]
  }
  if (pool.length === 1) return pool[0]
  const firstParty = pool.find((c) => c.provider.npm === `@ai-sdk/${c.pid}`)
  if (firstParty) return firstParty
  return pool[0]
}

function loadCustomBook(path) {
  if (!path) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (parsed && typeof parsed === 'object') return parsed.providers ?? parsed
  } catch {
    // A broken user price file falls back to the bundled book; the UI shows cost as estimated.
  }
  return null
}

let customBook = null
let customBookPath = null
function customProviders(path) {
  if (path === customBookPath) return customBook
  customBookPath = path
  customBook = loadCustomBook(path)
  return customBook
}

export function modelInfo(provider, model, priceFile = '') {
  const custom = customProviders(priceFile)
  let candidate = null
  if (custom) {
    const aliases = providerCandidates(provider)
    const id = String(model ?? '').trim().toLowerCase()
    for (const pid of aliases) {
      const providerEntry = custom[pid]
      if (!providerEntry?.models) continue
      for (const [mid, entry] of Object.entries(providerEntry.models)) {
        if (mid.toLowerCase() === id) {
          candidate = { pid, mid, model: entry, provider: providerEntry }
          break
        }
      }
      if (candidate) break
    }
  }
  if (!candidate) candidate = candidateFor(provider, model)
  if (!candidate) return null
  const { pid, mid, model: entry, provider: providerEntry } = candidate
  const cost = entry?.cost
  const limit = entry?.limit
  const rate =
    cost && typeof cost.input === 'number' && typeof cost.output === 'number'
      ? {
          miss: cost.input,
          hit: typeof cost.cache_read === 'number' ? cost.cache_read : cost.input,
          write: typeof cost.cache_write === 'number' ? cost.cache_write : cost.input,
          out: cost.output,
        }
      : null
  return {
    providerId: pid,
    providerName: providerEntry?.name ?? pid,
    modelId: mid,
    name: entry?.name ?? mid,
    rate,
    contextWindow: typeof limit?.context === 'number' && limit.context > 0 ? limit.context : null,
    maxOutput: typeof limit?.output === 'number' && limit.output > 0 ? limit.output : null,
    updated: entry?.updated ?? null,
  }
}

/**
 * Resolve a model's price and window.
 * `providerWindows` is the map read from ZCode's own provider config (provider/model → window).
 */
export function resolveModel(provider, model, { priceFile = '', windowOverride = 0, providerWindows = null } = {}) {
  const info = modelInfo(provider, model, priceFile)
  const normalizedProvider = normalizeProviderId(provider)
  const key = normalizedProvider + '/' + String(model ?? '').toLowerCase()
  const altKey = providerCandidates(provider)
    .map((pid) => pid + '/' + String(model ?? '').toLowerCase())
    .find((candidate) => providerWindows?.has(candidate))
  const configured =
    windowOverride > 0
      ? windowOverride
      : (providerWindows?.get(key) ??
        (altKey ? providerWindows.get(altKey) : null) ??
        providerWindows?.get(String(model ?? '').toLowerCase()) ??
        null)
  return {
    ...(info ?? {
      providerId: normalizedProvider,
      providerName: normalizedProvider,
      modelId: String(model ?? ''),
      name: String(model ?? ''),
      rate: null,
      contextWindow: null,
      maxOutput: null,
      updated: null,
    }),
    contextWindow: configured ?? info?.contextWindow ?? null,
    windowSource: configured ? 'provider-config' : info?.contextWindow ? 'models.dev' : null,
    priceSource: info?.rate ? 'models.dev' : null,
  }
}

/** USD (or CNY) list-price cost for one call. */
export function priceCall(provider, model, { input = 0, cacheRead = 0, cacheWrite = 0, output = 0 }, { priceFile = '', currency = 'usd' } = {}) {
  const info = modelInfo(provider, model, priceFile)
  if (!info?.rate) return null
  const usd =
    (Math.max(0, input - cacheRead - cacheWrite) * info.rate.miss +
      Math.max(0, cacheRead) * info.rate.hit +
      Math.max(0, cacheWrite) * info.rate.write +
      Math.max(0, output) * info.rate.out) /
    1e6
  return currency === 'cny' ? usd / 0.15 : usd
}

export function currencyForLocale(locale, preference = 'auto') {
  if (preference === 'usd' || preference === 'cny') return preference
  return String(locale ?? '').toLowerCase().startsWith('zh') ? 'cny' : 'usd'
}

export const catalogMeta = {
  source: modelsData.source,
  generatedAt: modelsData.generatedAt,
  providers: Object.keys(PROVIDERS).length,
}
