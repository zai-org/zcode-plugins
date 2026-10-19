/**
 * zcode-context-insight panel — a single-file MCP App UI.
 *
 * The host binds the panel to a session; the UI never receives the session id as a URL or global.
 * Every read is an app-only MCP tool call; the host attaches `com.zcode/request-context` on each
 * call. Preview mode (scripts/preview.mjs) talks to the same service over a local HTTP endpoint.
 */

import { App } from '@modelcontextprotocol/ext-apps'
import brandSvg from './icon.svg'
import { makeT } from './i18n.mjs'
import {
  formatBytes,
  formatCost,
  formatCount,
  formatDuration,
  formatShare,
  formatTokens,
} from '../src/shared/estimate.mjs'

const PREVIEW = window.__ZCODE_CONTEXT_PREVIEW__ ?? null
const VERSION = '0.1.0'
const CATS = ['system', 'tools', 'user', 'inject', 'skill', 'assistant', 'tool', 'unknown']
const CAT_COLOR = {
  system: 'var(--cat-system)',
  tools: 'var(--cat-tools)',
  user: 'var(--cat-user)',
  inject: 'var(--cat-inject)',
  skill: 'var(--cat-skill)',
  assistant: 'var(--cat-assistant)',
  tool: 'var(--cat-tool)',
  unknown: 'var(--cat-unknown)',
  output: 'var(--cat-output)',
  ttft: 'var(--timing-ttft)',
  reasoning: 'var(--timing-reasoning)',
  text: 'var(--timing-text)',
  toolarg: 'var(--timing-toolarg)',
  gen: 'var(--timing-reasoning)',
  other: 'var(--timing-other)',
}
const TIMING_COLOR = {
  ttft: 'var(--timing-ttft)',
  gen: 'var(--timing-reasoning)',
  reasoning: 'var(--timing-reasoning)',
  text: 'var(--timing-text)',
  toolarg: 'var(--timing-toolarg)',
  tools: 'var(--timing-tools)',
  other: 'var(--timing-other)',
}
const STATUS = ['completed', 'running', 'error', 'cancelled', 'unknown']
const HEADER = ['exact', 'estimated', 'missing']
const root = document.getElementById('root')

// Direct Element.append() stringifies null/undefined; the panel builds many conditional children.
// Skipping those here keeps every conditional branch from leaving a literal "null" text node.
if (!Element.prototype.__zcAppendPatched) {
  const nativeAppend = Element.prototype.append
  Object.defineProperty(Element.prototype, '__zcAppendPatched', { value: true })
  Element.prototype.append = function (...nodes) {
    nativeAppend.apply(this, nodes.filter((node) => node != null && node !== false))
  }
}

const state = {
  snapshot: null,
  history: [],
  step: null,
  pinned: false,
  stepDetail: null,
  stepLoading: false,
  stepError: null,
  stepCache: new Map(),
  stepToken: 0,
  detailToken: 0,
  dnaToken: 0,
  baselineMode: 'step',
  granularity: 'step',
  trendMode: 'total',
  durationCurve: true,
  adaptive: true,
  overview: false,
  trendDna: false,
  browserMode: 'categories',
  browserSearch: '',
  browserSort: 'size',
  kindFilter: null,
  groupExtra: new Map(),
  dnaData: null,
  dnaLoading: false,
  dnaSeries: null,
  dnaSeriesLoading: false,
  expandedCats: new Set(['system', 'tools', 'user', 'inject', 'skill', 'assistant', 'tool']),
  eventKinds: new Set(['inject', 'compaction', 'model', 'rewind', 'mcp', 'mode', 'prune']),
  eventsAll: false,
  fileKinds: new Set(['read', 'write', 'search', 'image']),
  fileSearch: '',
  fileSort: 'count',
  filesAll: false,
  expandedFiles: new Set(),
  detailsView: null,
  statsOpen: false,
  detail: null,
  detailLoading: false,
  detailError: null,
  settingsOpen: false,
  settingsDraft: null,
  fleet: null,
  fleetLoading: false,
  fleetError: null,
  member: null,
  memberLoading: false,
  insights: null,
  insightsLoading: false,
  insightsError: null,
  insightsRange: '30d',
  insightsSearch: '',
  insightsSort: 'recent',
  insightsGroup: 'none',
  insightsDay: null,
  insightsCompositionLoading: false,
  tab: 'context',
  loading: true,
  error: null,
  prefs: {},
  t: makeT('en'),
  lang: 'en',
  theme: 'light',
  toast: null,
  unchanged: 0,
  lastRefresh: 0,
  followTimer: null,
  searchTimer: null,
  saveTimer: null,
  hoverCat: null,
}

let app = null
let hostContext = null
let transport = null
let pollTimer = null

/* ------------------------------------------------------------------------------------------------
 * DOM helpers
 * ---------------------------------------------------------------------------------------------- */

function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
}

function h(tag, attrs = null, ...children) {
  const el = document.createElement(tag)
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue
      if (key === 'class') el.className = value
      else if (key === 'dataset') Object.assign(el.dataset, value)
      else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value)
      else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value)
      else if (key === 'text') el.textContent = String(value)
      else if (key in el && key !== 'list' && typeof value !== 'string') el[key] = value
      else if (key in el && key !== 'list' && key !== 'className') el[key] = value
      else el.setAttribute(key, value === true ? '' : String(value))
    }
  }
  append(el, children)
  return el
}

const NS = 'http://www.w3.org/2000/svg'
function sv(tag, attrs = null, ...children) {
  const el = document.createElementNS(NS, tag)
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue
      if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value)
      else el.setAttribute(key, value === true ? '' : String(value))
    }
  }
  append(el, children)
  return el
}

const ICON_PATHS = {
  chart: 'M3 3v18h18M7 15l3-4 3 2 4-6',
  refresh: 'M20 11a8 8 0 1 0-2.3 6M20 4v7h-7',
  settings: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 11v6M12 7h.01',
  left: 'm15 18-6-6 6-6',
  right: 'm9 18 6-6-6-6',
  down: 'm6 9 6 6 6-6',
  copy: 'M8 8V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-3M5 8h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z',
  close: 'M18 6 6 18M6 6l12 12',
  search: 'M21 21l-4.3-4.3M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  pin: 'M12 17v5M5 9l7-7 7 7-3 3-1 4H9l-1-4-3-3Z',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  check: 'm5 12 4 4L19 6',
  alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  scissors: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12',
  switch: 'M7 7h11l-3-3M17 17H6l3 3',
  rewind: 'M3 7v6h6M3 13a9 9 0 1 0 3-7',
  zap: 'm13 2-9 12h7l-1 8 9-12h-7l1-8Z',
  folder: 'M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z',
  branch: 'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM18 9a9 9 0 0 1-9 9',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 6v6l4 2',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6ZM14 2v6h6',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  external: 'M14 3h7v7M21 3l-9 9M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5',
  filter: 'M3 5h18l-7 8v6l-4 2v-8L3 5Z',
}

function icon(name, size = 15, className = '') {
  return sv(
    'svg',
    {
      class: 'zc-icon ' + className,
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.8,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
    },
    sv('path', { d: ICON_PATHS[name] ?? ICON_PATHS.info }),
  )
}

function brandMark(size = 24) {
  const template = document.createElement('template')
  template.innerHTML = brandSvg.trim()
  const svg = template.content.firstElementChild
  if (!svg) return icon('chart', size)
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('aria-hidden', 'true')
  svg.classList.add('zc-icon', 'zc-brand-icon')
  return svg
}

function button(label, { onClick, class: cls = '', title, icon: iconName, active = false, disabled = false, aria } = {}) {
  return h(
    'button',
    {
      type: 'button',
      class: 'zc-btn ' + cls + (active ? ' is-active' : ''),
      title: title ?? label,
      'aria-label': aria ?? title ?? label,
      disabled,
      onclick: onClick,
    },
    iconName ? icon(iconName, 14) : null,
    label ? h('span', null, label) : null,
  )
}

function iconButton(name, title, onClick, cls = '') {
  return h(
    'button',
    { type: 'button', class: 'zc-iconbtn ' + cls, title, 'aria-label': title, onclick: onClick },
    icon(name, 16),
  )
}

function pill(text, cls = '', title = null) {
  return h('span', { class: 'zc-pill ' + cls, title: title ?? undefined }, text)
}

function clearNode(node) {
  while (node.firstChild) node.removeChild(node.firstChild)
}

/* ------------------------------------------------------------------------------------------------
 * Formatting and decoding
 * ---------------------------------------------------------------------------------------------- */

const locale = () => (state.lang === 'zh' ? 'zh-CN' : 'en-US')

function relativeTime(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return state.t('common.none')
  const diff = Date.now() - ms
  if (diff < 60_000) return state.t('time.justNow')
  if (diff < 3_600_000) return state.t('time.minute', { n: Math.floor(diff / 60_000) })
  if (diff < 86_400_000) return state.t('time.hour', { n: Math.floor(diff / 3_600_000) })
  if (diff < 7 * 86_400_000) return state.t('time.day', { n: Math.floor(diff / 86_400_000) })
  const date = new Date(ms)
  return state.t('time.date', { month: date.getMonth() + 1, day: date.getDate() })
}

function clockTime(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const date = new Date(ms)
  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()
  return sameDay
    ? date.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString(locale(), { month: 'short', day: 'numeric' }) +
        ' ' +
        date.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })
}

function dateKey(ms) {
  const date = new Date(ms)
  return (
    date.getFullYear() +
    '-' +
    String(date.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(date.getDate()).padStart(2, '0')
  )
}

function currency() {
  return state.snapshot?.session?.currency ?? 'usd'
}

function costText(value) {
  if (value == null || !Number.isFinite(Number(value))) return state.t('common.none')
  return formatCost(Number(value), currency())
}

function pct(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(1) + '%' : state.t('common.none')
}

function catLabel(cat) {
  return state.t('cat.' + cat)
}

function decodeRequest(raw) {
  const wire = state.snapshot?.wire ?? { parts: CATS, status: STATUS, header: HEADER }
  const [step, turn, time, prompt, output, cacheRead, cacheWrite, durationMs, ttftMs, toolCalls, statusCode, partValues, headerCode] = raw
  const parts = {}
  for (const [index, cat] of wire.parts.entries()) parts[cat] = partValues[index] ?? 0
  return {
    step,
    turn,
    time,
    prompt,
    output,
    cacheRead,
    cacheWrite,
    durationMs,
    ttftMs,
    toolCalls,
    status: wire.status[statusCode] ?? 'unknown',
    parts,
    header: wire.header[headerCode] ?? 'missing',
    total: prompt + output,
  }
}

function requests() {
  const current = (state.snapshot?.requests ?? []).map(decodeRequest)
  const older = state.history.map(decodeRequest)
  return [...older, ...current].sort((a, b) => a.step - b.step)
}

function selectedRequest() {
  return requests().find((request) => request.step === state.step) ?? null
}

function selectedStep() {
  return state.step ?? state.snapshot?.current?.step ?? null
}

function currentStep() {
  return state.snapshot?.current?.step ?? state.snapshot?.requestsTotal ?? null
}

function eventCounts() {
  const counts = { inject: 0, compaction: 0, model: 0, rewind: 0, mcp: 0, mode: 0, prune: 0 }
  for (const event of state.snapshot?.events ?? []) if (counts[event.kind] != null) counts[event.kind]++
  return counts
}

function toolSourceLabel(source) {
  if (!source) return ''
  if (source === 'built-in') return state.t('tool.built-in')
  if (source === 'plugin') return state.t('tool.plugin')
  if (source.startsWith('mcp:')) return 'MCP · ' + source.slice(4)
  return source
}

/* ------------------------------------------------------------------------------------------------
 * Transport, app handshake and lifecycle
 * ---------------------------------------------------------------------------------------------- */

class UiError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

async function call(name, args = {}) {
  if (PREVIEW) {
    const response = await fetch(PREVIEW.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, arguments: args }),
    })
    const payload = await response.json()
    if (payload?.error) throw new UiError(payload.error.code ?? 'read_failed', payload.error.message ?? 'Read failed.')
    return payload.structuredContent ?? payload
  }
  const result = await app.callServerTool({ name, arguments: args })
  if (result?.isError) {
    const error = result.structuredContent?.error ?? {}
    throw new UiError(error.code ?? 'read_failed', error.message ?? 'Read failed.')
  }
  return result?.structuredContent ?? result
}

function hostTheme() {
  const raw = hostContext?.theme ?? PREVIEW?.theme
  if (raw === 'dark' || raw === 'light') return raw
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function hostLocale() {
  return hostContext?.locale ?? PREVIEW?.locale ?? navigator.language ?? 'en-US'
}

function applyHost() {
  state.theme = hostTheme()
  document.documentElement.dataset.theme = state.theme
  const prefLang = state.prefs?.language
  const lang =
    prefLang === 'zh' || prefLang === 'en'
      ? prefLang
      : String(hostLocale()).toLowerCase().startsWith('zh')
        ? 'zh'
        : 'en'
  if (lang !== state.lang) {
    state.lang = lang
    state.t = makeT(lang)
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
  }
}

function applyPreferences(prefs) {
  state.prefs = prefs ?? {}
  if (state.prefs.granularity) state.granularity = state.prefs.granularity
  if (state.prefs.trendMode) state.trendMode = state.prefs.trendMode
  if (state.prefs.deltaBase) state.baselineMode = state.prefs.deltaBase
  if (typeof state.prefs.durationCurve === 'boolean') state.durationCurve = state.prefs.durationCurve
  if (state.prefs.fileSort) state.fileSort = state.prefs.fileSort
  if (state.prefs.toolSort === 'name') state.browserSort = 'name'
  else if (state.prefs.toolSort === 'count') state.browserSort = 'calls'
  else if (state.prefs.toolSort === 'size') state.browserSort = 'size'
  if (state.trendDna) state.trendMode = 'total'
  applyHost()
}

function viewKey(sessionId) {
  return 'zcode-context-insight:view:' + sessionId
}

function saveView() {
  if (!state.snapshot?.session?.id) return
  clearTimeout(state.saveTimer)
  state.saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(
        viewKey(state.snapshot.session.id),
        JSON.stringify({
          tab: state.tab,
          step: state.step,
          pinned: state.pinned,
          granularity: state.granularity,
          trendMode: state.trendMode,
          baselineMode: state.baselineMode,
          durationCurve: state.durationCurve,
          adaptive: state.adaptive,
          trendDna: state.trendDna,
          browserMode: state.browserMode,
          fileSort: state.fileSort,
          insightsRange: state.insightsRange,
        }),
      )
    } catch {}
  }, 250)
}

function restoreView() {
  if (!state.snapshot?.session?.id) return
  let saved = null
  try {
    saved = JSON.parse(localStorage.getItem(viewKey(state.snapshot.session.id)) || 'null')
  } catch {}
  if (!saved || typeof saved !== 'object') {
    if (['context', 'fleet', 'insights'].includes(state.prefs?.defaultView)) state.tab = state.prefs.defaultView
    return
  }
  if (['context', 'fleet', 'insights'].includes(saved.tab)) state.tab = saved.tab
  if (['step', 'turn'].includes(saved.granularity)) state.granularity = saved.granularity
  if (['total', 'delta'].includes(saved.trendMode)) state.trendMode = saved.trendMode
  if (['step', 'turn'].includes(saved.baselineMode)) state.baselineMode = saved.baselineMode
  if (typeof saved.durationCurve === 'boolean') state.durationCurve = saved.durationCurve
  if (typeof saved.adaptive === 'boolean') state.adaptive = saved.adaptive
  if (typeof saved.trendDna === 'boolean') state.trendDna = saved.trendDna
  if (state.trendDna) state.trendMode = 'total'
  if (['categories', 'changes', 'dna'].includes(saved.browserMode)) state.browserMode = saved.browserMode
  if (['7d', '30d', 'all'].includes(saved.insightsRange)) state.insightsRange = saved.insightsRange
  if (saved.pinned === true && Number.isInteger(saved.step) && saved.step > 0 && saved.step <= (state.snapshot.stats.steps ?? 0)) {
    state.step = saved.step
    state.pinned = saved.step !== state.snapshot?.current?.step
  } else {
    state.pinned = false
    state.step = state.snapshot?.current?.step ?? null
  }
}

async function refresh({ silent = false } = {}) {
  if (!transport) return
  try {
    if (!silent) state.loading = true
    const snapshot = await call('get_context_snapshot', { locale: hostLocale() })
    const previous = state.snapshot
    state.snapshot = snapshot
    if (!previous) {
      applyPreferences(snapshot.preferences)
      restoreView()
      if (!state.step) state.step = snapshot.current?.step ?? null
      if (state.tab === 'context') await loadStep(state.step, { force: true })
      if (state.trendDna) loadDnaSeries()
      if (state.tab === 'fleet') await loadFleet()
      if (state.tab === 'insights') await loadInsights()
    } else {
      const changed = JSON.stringify({ ...previous, generatedAt: 0 }) !== JSON.stringify({ ...snapshot, generatedAt: 0 })
      if (changed) {
        const switched = previous.session?.id !== snapshot.session?.id
        state.unchanged = 0
        state.stepCache.clear()
        state.groupExtra.clear()
        if (switched) {
          state.history = []
          state.stepDetail = null
          state.step = snapshot.current?.step ?? null
          state.pinned = false
          state.fleet = null
          state.insights = null
          state.detail = null
          state.member = null
          state.dnaData = null
          state.dnaSeries = null
        }
        applyPreferences(snapshot.preferences)
        if (!state.pinned || state.step == null) state.step = snapshot.current?.step ?? state.step
        if (state.tab === 'context' && state.step) await loadStep(state.step)
        if (state.trendDna) loadDnaSeries()
        if (state.tab === 'fleet' && !state.fleet) await loadFleet()
        if (state.tab === 'insights' && !state.insights) await loadInsights()
      } else {
        state.unchanged++
      }
    }
    state.loading = false
    state.error = null
    state.lastRefresh = Date.now()
    if (!(state.settingsOpen || state.detail || state.member)) render()
    schedulePoll()
  } catch (error) {
    state.loading = false
    state.error = error instanceof UiError ? error : new UiError('read_failed', String(error?.message ?? error))
    render()
    schedulePoll()
  }
}

function schedulePoll() {
  clearTimeout(pollTimer)
  const delay = document.hidden ? 10_000 : state.unchanged > 3 ? 6_000 : 3_000
  pollTimer = setTimeout(() => {
    refresh({ silent: true })
  }, delay)
}

async function loadStep(step, { force = false, baseline = state.baselineMode, search = '' } = {}) {
  if (!step || !transport) return
  const key = [step, baseline, search, state.browserSort].join('|')
  if (!force && state.stepCache.has(key)) {
    state.stepDetail = state.stepCache.get(key)
    state.stepLoading = false
    state.stepError = null
    render()
    return
  }
  const token = ++state.stepToken
  state.stepLoading = true
  state.stepError = null
  render()
  try {
    const detail = await call('get_context_step', {
      step,
      baselineMode: baseline,
      search,
      sort: state.browserSort,
      locale: hostLocale(),
    })
    if (token !== state.stepToken) return
    state.stepDetail = detail
    state.stepCache.set(key, detail)
    state.stepLoading = false
    state.stepError = null
    if (state.browserMode === 'dna' || state.trendDna) {
      state.dnaData = null
      render()
      loadDna()
    } else render()
  } catch (error) {
    if (token !== state.stepToken) return
    state.stepLoading = false
    state.stepError = error instanceof UiError ? error : new UiError('read_failed', String(error?.message ?? error))
    render()
  }
}

async function selectStep(step, { pin = true } = {}) {
  if (!step) return
  state.step = Number(step)
  state.pinned = pin && state.step !== currentStep()
  state.kindFilter = null
  state.dnaData = null
  saveView()
  render()
  await loadStep(state.step)
  requestAnimationFrame(() => {
    document.querySelector(`[data-step-bar="${state.step}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center' })
  })
}

async function followLatest() {
  state.pinned = false
  state.step = currentStep()
  state.kindFilter = null
  saveView()
  render()
  await loadStep(state.step)
}

async function loadEarlier() {
  const list = requests()
  const first = list[0]?.step
  if (!first || first <= 1) return
  try {
    const data = await call('get_context_history', {
      beforeStep: first,
      limit: 200,
      locale: hostLocale(),
    })
    state.history = [...data.requests, ...state.history]
    if (state.trendDna) loadDnaSeries()
    render()
  } catch (error) {
    showToast(error?.message ?? state.t.error.generic)
  }
}

async function loadGroup(cat) {
  const detail = state.stepDetail
  if (!detail) return
  const current = state.groupExtra.get(cat) ?? { items: [], nextOffset: 0, total: 0 }
  try {
    const page = await call('get_context_group', {
      step: detail.step,
      cat,
      offset: current.nextOffset ?? 0,
      limit: 50,
      search: state.browserSearch,
      sort: state.browserSort,
      locale: hostLocale(),
    })
    const existing = new Set(current.items.map((item) => item.key))
    state.groupExtra.set(cat, {
      items: [...current.items, ...(page.items ?? []).filter((item) => !existing.has(item.key))],
      nextOffset: page.nextOffset,
      total: page.total,
    })
    render()
  } catch (error) {
    showToast(error?.message ?? state.t.error.generic)
  }
}

async function loadDna({ append = false } = {}) {
  const detail = state.stepDetail
  if (!detail || state.dnaLoading) return
  const token = ++state.dnaToken
  state.dnaLoading = true
  state.dnaData = append ? state.dnaData : null
  render()
  try {
    const page = await call('get_context_dna', {
      step: detail.step,
      offset: append ? state.dnaData?.nextOffset ?? 0 : 0,
      limit: 150,
      locale: hostLocale(),
    })
    if (token !== state.dnaToken) return
    const existing = append ? state.dnaData?.items ?? [] : []
    const seen = new Set(existing.map((item) => item.key))
    state.dnaData = {
      ...page,
      items: [...existing, ...(page.items ?? []).filter((item) => !seen.has(item.key))],
    }
    state.dnaLoading = false
    render()
  } catch (error) {
    if (token !== state.dnaToken) return
    state.dnaLoading = false
    showToast(error?.message ?? state.t.error.generic)
    render()
  }
}

function setTrendDna() {
  state.trendDna = !state.trendDna
  if (state.trendDna) {
    state.trendMode = 'total'
    state.overview = false
    state.browserMode = 'dna'
    state.detailsView = 'browser'
    state.dnaData = null
    loadDna()
    if (!state.dnaSeries) loadDnaSeries()
  }
  saveView()
  render()
}

function openDnaBrowser() {
  state.browserMode = 'dna'
  if (!state.dnaData) loadDna()
  else render()
  requestAnimationFrame(() => document.querySelector('.zc-card-browser')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
}

async function loadDnaSeries() {
  if (state.dnaSeriesLoading) return
  const list = requests()
  if (!list.length) return
  const last = list[list.length - 1].step
  const from = Math.max(list[0].step, last - 119)
  state.dnaSeriesLoading = true
  render()
  try {
    const data = await call('get_context_dna_series', {
      fromStep: from,
      toStep: last,
      maxBands: 36,
      locale: hostLocale(),
    })
    state.dnaSeries = new Map((data.steps ?? []).map((entry) => [entry.step, entry.bands ?? []]))
    state.dnaSeriesLoading = false
    render()
  } catch (error) {
    state.dnaSeriesLoading = false
    showToast(error?.message ?? state.t.error.generic)
    render()
  }
}

function dnaGradient(bands) {
  if (!Array.isArray(bands) || bands.length === 0) return null
  const total = bands.reduce((sum, band) => sum + Math.max(0, band[1] || 0), 0)
  if (total <= 0) return null
  let acc = 0
  const stops = []
  for (const [catIndex, tokens] of bands) {
    const value = Math.max(0, tokens || 0)
    if (value <= 0) continue
    const start = (acc / total) * 100
    acc += value
    const end = (acc / total) * 100
    const color = CAT_COLOR[CATS[catIndex] ?? 'unknown']
    stops.push(`${color} ${start.toFixed(2)}% ${end.toFixed(2)}%`)
  }
  return stops.length ? `linear-gradient(to top, ${stops.join(', ')})` : null
}

function setBrowserMode(mode) {
  state.browserMode = mode
  if (mode === 'dna' && !state.dnaData) loadDna()
  else render()
}

async function openElement(key, step = state.step) {
  if (!key) return
  const token = ++state.detailToken
  state.detail = { kind: 'element', key, step, loading: true, data: null, format: 'readable', offset: 0, find: '' }
  render()
  try {
    const data = await call('get_context_element', {
      step,
      key,
      format: 'readable',
      offset: 0,
      limit: 12_000,
      locale: hostLocale(),
    })
    if (token !== state.detailToken) return
    state.detail = { ...state.detail, loading: false, data }
    render()
  } catch (error) {
    if (token !== state.detailToken) return
    state.detail = { ...state.detail, loading: false, error: error?.message ?? state.t.error.detail }
    render()
  }
}

async function loadMoreElement() {
  const detail = state.detail
  if (!detail?.data?.truncated) return
  try {
    const next = await call('get_context_element', {
      step: detail.step,
      key: detail.key,
      format: detail.format,
      offset: detail.data.nextOffset,
      limit: 24_000,
      locale: hostLocale(),
    })
    state.detail = {
      ...detail,
      data: {
        ...next,
        content: (detail.data.content ?? '') + (next.content ?? ''),
      },
    }
    render()
  } catch (error) {
    showToast(error?.message ?? state.t.error.detail)
  }
}

async function loadMoreEvent() {
  const detail = state.detail
  if (!detail?.data?.nextOffset) return
  try {
    const next = await call('get_context_event', {
      eventId: detail.event.id,
      offset: detail.data.nextOffset,
      limit: 20,
      locale: hostLocale(),
    })
    state.detail = {
      ...detail,
      data: {
        ...next,
        messages: [...(detail.data.messages ?? []), ...(next.messages ?? [])],
      },
    }
    render()
  } catch (error) {
    showToast(error?.message ?? state.t.error.event)
  }
}

async function switchElementFormat(format) {
  const detail = state.detail
  if (!detail?.key) return
  try {
    const data = await call('get_context_element', {
      step: detail.step,
      key: detail.key,
      format,
      offset: 0,
      limit: 24_000,
      locale: hostLocale(),
    })
    state.detail = { ...detail, format, data }
    render()
  } catch (error) {
    showToast(error?.message ?? state.t.error.detail)
  }
}

async function openEvent(event) {
  if (!event) return
  if (event.kind !== 'compaction') {
    if (event.step) await selectStep(event.step, { pin: false })
    if (event.itemKey) await openElement(event.itemKey, event.step ?? state.step)
    return
  }
  state.detail = { kind: 'event', event, loading: true, data: null }
  render()
  try {
    const data = await call('get_context_event', {
      eventId: event.id,
      offset: 0,
      limit: 12,
      locale: hostLocale(),
    })
    state.detail = { kind: 'event', event, loading: false, data }
    render()
  } catch (error) {
    state.detail = { kind: 'event', event, loading: false, error: error?.message ?? state.t.error.event }
    render()
  }
}

function closeDetail() {
  state.detail = null
  state.member = null
  state.settingsOpen = false
  render()
}

async function loadFleet() {
  if (state.fleetLoading) return
  state.fleetLoading = true
  state.fleetError = null
  render()
  try {
    state.fleet = await call('get_context_fleet', { locale: hostLocale() })
    state.fleetLoading = false
    render()
  } catch (error) {
    state.fleetLoading = false
    state.fleetError = error?.message ?? state.t.error.generic
    render()
  }
}

async function openMember(id) {
  state.member = { id, loading: true, data: null }
  state.memberLoading = true
  render()
  try {
    const data = await call('get_context_fleet_member', { targetId: id, locale: hostLocale() })
    state.member = { id, loading: false, data }
    state.memberLoading = false
    render()
  } catch (error) {
    state.member = { id, loading: false, error: error?.message ?? state.t.error.generic }
    state.memberLoading = false
    render()
  }
}

async function loadInsights({ composition = false } = {}) {
  if (state.insightsLoading) return
  state.insightsLoading = true
  state.insightsError = null
  state.insightsCompositionLoading = composition
  render()
  try {
    const data = await call('get_context_insights', {
      range: state.insightsRange,
      includeComposition: composition,
      locale: hostLocale(),
    })
    state.insights = data
    state.insightsLoading = false
    state.insightsCompositionLoading = false
    render()
    if (!composition && data.composition == null && !state.insightsCompositionLoading) {
      state.insightsCompositionLoading = true
      render()
      call('get_context_insights', { range: state.insightsRange, includeComposition: true, locale: hostLocale() })
        .then((withComposition) => {
          if (state.insights?.range === withComposition.range) {
            state.insights = { ...state.insights, ...withComposition }
          }
          state.insightsCompositionLoading = false
          render()
        })
        .catch(() => {
          state.insightsCompositionLoading = false
          render()
        })
    }
  } catch (error) {
    state.insightsLoading = false
    state.insightsCompositionLoading = false
    state.insightsError = error?.message ?? state.t.error.generic
    render()
  }
}

async function setTab(tab) {
  if (state.tab === tab) return
  state.tab = tab
  saveView()
  render()
  if (tab === 'fleet' && !state.fleet) await loadFleet()
  if (tab === 'insights' && !state.insights) await loadInsights()
}

function showToast(message) {
  state.toast = { message, time: Date.now() }
  render()
  setTimeout(() => {
    if (state.toast && Date.now() - state.toast.time >= 1800) {
      state.toast = null
      render()
    }
  }, 2000)
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(String(text ?? ''))
    showToast(state.t('action.copied'))
  } catch {
    showToast(state.t('action.copied'))
  }
}

/* ------------------------------------------------------------------------------------------------
 * Render root
 * ---------------------------------------------------------------------------------------------- */

function render() {
  hideTrendTip()
  const scrollTop = document.querySelector('.zc-main')?.scrollTop ?? 0
  const drawerScroll = document.querySelector('.zc-drawer-body')?.scrollTop ?? 0
  clearNode(root)
  applyHost()
  root.dataset.density = state.prefs?.compactCards ? 'compact' : 'comfortable'
  if (state.loading && !state.snapshot) {
    root.append(renderSkeleton())
    return
  }
  if (state.error && !state.snapshot) {
    root.append(renderError(state.error))
    return
  }
  if (!state.snapshot) {
    root.append(renderError(new UiError('offline', state.t('error.offline'))))
    return
  }
  root.append(renderHeader())
  const main = h('main', { class: 'zc-main' })
  if (state.tab === 'context') main.append(renderContext())
  else if (state.tab === 'fleet') main.append(renderFleet())
  else main.append(renderInsights())
  root.append(main, renderFooter())
  if (state.toast) root.append(h('div', { class: 'zc-toast', role: 'status' }, state.toast.message))
  if (state.settingsOpen) root.append(renderSettings())
  else if (state.detail) root.append(renderDrawer())
  else if (state.member) root.append(renderMember())
  requestAnimationFrame(() => {
    const next = document.querySelector('.zc-main')
    if (next) next.scrollTop = scrollTop
    const drawer = document.querySelector('.zc-drawer-body')
    if (drawer && state.detail?.kind === 'element') drawer.scrollTop = drawerScroll
  })
}

function renderSkeleton() {
  return h(
    'div',
    { class: 'zc-shell' },
    h('div', { class: 'zc-skel zc-skel-head' }),
    h(
      'div',
      { class: 'zc-skel-grid' },
      h('div', { class: 'zc-skel zc-skel-card' }),
      h('div', { class: 'zc-skel zc-skel-card' }),
      h('div', { class: 'zc-skel zc-skel-card' }),
    ),
    h('div', { class: 'zc-skel zc-skel-wide' }),
  )
}

function renderError(error) {
  const message =
    error.code === 'binding_unavailable'
      ? state.t('error.binding')
      : error.code === 'database_missing' || error.code === 'database_unavailable'
        ? state.t('error.database')
        : error.code === 'read_timeout'
          ? state.t('error.timeout')
          : error.code === 'worker_unavailable'
            ? state.t('error.worker')
            : error.message || state.t('error.generic')
  return h(
    'div',
    { class: 'zc-error' },
    h('div', { class: 'zc-error-icon' }, icon('alert', 26)),
    h('h2', null, state.t('error.title')),
    h('p', null, message),
    button(state.t('action.retry'), { onClick: () => refresh(), icon: 'refresh', class: 'zc-btn-primary' }),
  )
}

function renderHeader() {
  const snapshot = state.snapshot
  const session = snapshot.session
  const header = h('header', { class: 'zc-header' })
  header.append(
    h(
      'div',
      { class: 'zc-brand' },
      h('div', { class: 'zc-brand-mark' }, brandMark(24)),
      h(
        'div',
        { class: 'zc-brand-text' },
        h('div', { class: 'zc-title-row' }, h('span', { class: 'zc-title' }, state.t('app.title')), pill(state.t('app.readonly'), 'zc-pill-soft')),
        h('div', { class: 'zc-session-title', title: session.title }, session.title || session.id),
        h(
          'div',
          { class: 'zc-session-meta' },
          session.model ? h('span', null, (session.provider ? session.provider + '/' : '') + session.model) : null,
          session.contextWindow ? h('span', null, formatTokens(session.contextWindow) + ' window') : null,
          h('span', null, relativeTime(session.updatedAt)),
        ),
      ),
      h(
        'div',
        { class: 'zc-actions' },
        iconButton('refresh', state.t('action.refresh'), () => refresh(), state.loading ? 'is-spinning' : ''),
        iconButton('settings', state.t('action.settings'), () => {
          state.settingsDraft = { ...state.prefs }
          state.settingsOpen = true
          render()
        }),
        iconButton('info', state.t('action.about'), () => {
          state.detail = { kind: 'about' }
          render()
        }),
      ),
    ),
  )
  const tabs = h('div', { class: 'zc-tabs', role: 'tablist' })
  for (const tab of ['context', 'fleet', 'insights']) {
    tabs.append(
      h(
        'button',
        {
          type: 'button',
          role: 'tab',
          'aria-selected': state.tab === tab ? 'true' : 'false',
          class: 'zc-tab' + (state.tab === tab ? ' is-active' : ''),
          onclick: () => setTab(tab),
        },
        state.t('tab.' + tab),
        tab === 'fleet' && state.fleet ? h('span', { class: 'zc-tab-badge' }, state.fleet.nodes.length) : null,
        tab === 'insights' && state.insights ? h('span', { class: 'zc-tab-badge' }, state.insights.kpi?.sessions ?? 0) : null,
      ),
    )
  }
  header.append(tabs)
  if (state.tab === 'context') header.append(renderStepBar())
  return header
}

function renderStepBar() {
  const total = state.snapshot.requestsTotal ?? state.snapshot.stats.steps ?? 0
  const selected = selectedStep()
  const bar = h('div', { class: 'zc-stepbar' })
  const select = h('select', {
    class: 'zc-select zc-step-select',
    'aria-label': state.t('steps.pick'),
    onchange: (event) => selectStep(Number(event.target.value)),
  })
  if ((state.snapshot.requestsFrom ?? 1) > 1) {
    select.append(h('option', { value: '', disabled: true }, state.t('steps.unrecorded')))
  }
  for (const request of requests()) {
    select.append(
      h(
        'option',
        { value: request.step, selected: request.step === selected },
        '#' + request.step + ' · T' + request.turn + ' · ' + clockTime(request.time),
      ),
    )
  }
  bar.append(
    h(
      'div',
      { class: 'zc-stepnav' },
      iconButton('left', state.t('steps.prev'), () => selectStep(Math.max(1, (selected ?? 1) - 1)), 'zc-step-prev'),
      select,
      iconButton('right', state.t('steps.next'), () => selectStep(Math.min(total, (selected ?? 1) + 1)), 'zc-step-next'),
    ),
    h(
      'div',
      { class: 'zc-stepstatus' },
      state.pinned
        ? h('span', { class: 'zc-pin is-pinned', title: state.t('steps.pinned', { step: selected }) }, icon('pin', 12), '#' + selected)
        : h('span', { class: 'zc-pin', title: state.t('steps.following') }, h('span', { class: 'zc-live-dot' }), state.t('steps.live')),
      state.pinned && selected != null && total > selected
        ? button(state.t('steps.newer', { n: total - selected }), {
            onClick: followLatest,
            class: 'zc-btn-tiny zc-btn-accent',
            icon: 'arrow',
          })
        : null,
      state.pinned ? button(state.t('steps.latest'), { onClick: followLatest, class: 'zc-btn-tiny', icon: 'arrow', title: state.t('steps.jumpLatest') }) : null,
    ),
    h(
      'div',
      { class: 'zc-stepmeta' },
      h('span', null, state.t('steps.steps', { n: total })),
      iconButton('copy', state.t('action.copy') + ' session id', () => copyText(state.snapshot.session.id), 'zc-iconbtn-soft'),
    ),
  )
  return bar
}

function renderFooter() {
  const coverage = state.snapshot.coverage
  return h(
    'footer',
    { class: 'zc-footer' },
    h('span', null, state.t('app.footer')),
    h(
      'span',
      { class: 'zc-footer-right' },
      coverage?.warnings?.length
        ? h('button', { class: 'zc-linkbtn', type: 'button', onclick: () => openCoverage() }, state.t('coverage.details'))
        : null,
      h('span', null, state.t('app.version', { version: VERSION })),
    ),
  )
}

function openCoverage() {
  state.detail = { kind: 'coverage' }
  render()
}

/* ------------------------------------------------------------------------------------------------
 * Context view
 * ---------------------------------------------------------------------------------------------- */

function renderContext() {
  const wrapper = h('div', { class: 'zc-context' })
  wrapper.append(renderStatsStrip())
  if (state.statsOpen) wrapper.append(renderStatsCard())
  wrapper.append(renderTokensCard(), renderTimingCard(), renderCurrentCard(), renderTrendCard())
  wrapper.append(renderDetailsTabs())
  if (state.detailsView === 'browser') wrapper.append(renderBrowserCard())
  else if (state.detailsView === 'events') wrapper.append(renderEventsCard())
  else if (state.detailsView === 'files') wrapper.append(renderFilesCard())
  return wrapper
}

function renderStatsStrip() {
  const stats = state.snapshot.stats
  const family = stats.subagents ?? { count: 0 }
  const item = (label, value) => h('span', { class: 'zc-summary-item' }, h('span', null, label), h('b', null, value))
  return h(
    'div',
    { class: 'zc-summary-strip' },
    item(state.t('stats.turns'), formatCount(stats.turns)),
    item(state.t('stats.steps'), formatCount(stats.steps)),
    item(state.t('stats.toolCalls'), formatCount(stats.toolCalls)),
    item(state.t('stats.family'), formatCount(family.count ?? 0)),
    item(state.t('stats.cacheHit'), pct(stats.cacheHitRate)),
    item(state.t('stats.cost'), costText(stats.cost)),
    h('button', {
      type: 'button',
      class: 'zc-summary-toggle' + (state.statsOpen ? ' is-active' : ''),
      onclick: () => { state.statsOpen = !state.statsOpen; render() },
      'aria-expanded': state.statsOpen ? 'true' : 'false',
    }, state.t('stats.details'), icon(state.statsOpen ? 'down' : 'right', 12)),
  )
}

function renderDetailsTabs() {
  const detail = state.stepDetail
  const itemCount = (detail?.groups ?? []).reduce((sum, group) => sum + (group.count ?? 0), 0)
  const eventCount = state.snapshot.eventsTotal ?? state.snapshot.events?.length ?? 0
  const fileCount = state.snapshot.files?.entries?.length ?? 0
  const tab = (key, label, count) => h('button', {
    type: 'button',
    class: 'zc-detail-tab' + (state.detailsView === key ? ' is-active' : ''),
    onclick: () => { state.detailsView = state.detailsView === key ? null : key; render() },
    'aria-pressed': state.detailsView === key ? 'true' : 'false',
  }, label, h('b', null, formatCount(count)))
  return h('div', { class: 'zc-detail-tabs' },
    tab('browser', state.t('browser.title'), itemCount),
    tab('events', state.t('events.title'), eventCount),
    tab('files', state.t('files.title'), fileCount),
  )
}

function card(title, { subtitle = null, right = null, className = '', body = null } = {}) {
  return h(
    'section',
    { class: 'zc-card ' + className },
    h(
      'div',
      { class: 'zc-card-head' },
      h('div', { class: 'zc-card-titlewrap' }, h('h2', { class: 'zc-card-title' }, title), subtitle ? h('div', { class: 'zc-card-sub' }, subtitle) : null),
      right ? h('div', { class: 'zc-card-right' }, right) : null,
    ),
    body,
  )
}

function metric(label, value, { hint = null, onClick = null, className = '' } = {}) {
  const node = h(
    'button',
    {
      type: 'button',
      class: 'zc-metric ' + className + (onClick ? ' is-clickable' : ''),
      title: hint ?? undefined,
      onclick: onClick ?? undefined,
      disabled: !onClick,
    },
    h('span', { class: 'zc-metric-value' }, value),
    h('span', { class: 'zc-metric-label' }, label),
  )
  return node
}

function renderStatsCard() {
  const stats = state.snapshot.stats
  const counts = stats.eventCounts ?? eventCounts()
  const family = stats.subagents ?? { count: 0, usage: null }
  const tools = stats.toolTally ?? []
  const files = stats.files ?? { read: { files: 0 }, write: { files: 0 }, search: { files: 0 }, image: { files: 0 } }
  const jumpTo = (target) => {
    if (target === 'inputs') {
      state.browserMode = 'categories'
      state.kindFilter = null
      state.expandedCats.add('user')
      openElement(detailFirstKey('user'), state.step)
    } else if (target === 'files-read' || target === 'files-write' || target === 'files-search' || target === 'files-images') {
      state.fileKinds = new Set([target.split('-')[1] === 'written' ? 'write' : target.split('-')[1] === 'images' ? 'image' : target.split('-')[1]])
      state.filesAll = true
      render()
      document.querySelector('[data-card="files"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } else if (target === 'fleet') {
      setTab('fleet')
    }
  }
  const flow = h('div', { class: 'zc-flow' })
  const node = (key, label, value, onClick, className = '') =>
    h(
      'button',
      {
        type: 'button',
        class: 'zc-flow-node ' + className,
        onclick: onClick ?? undefined,
        title: onClick ? state.t('stats.jump') + ' ' + label : undefined,
        disabled: !onClick,
      },
      h('span', { class: 'zc-flow-label' }, label),
      h('span', { class: 'zc-flow-value' }, value),
    )
  flow.append(
    node('inputs', state.t('stats.inputs'), formatCount(stats.humanInputs), () => jumpTo('inputs'), 'tone-user'),
    node('events', state.t('stats.events'), formatCount((counts.inject ?? 0) + (counts.compaction ?? 0)), null, 'tone-inject'),
    node('session', state.t('stats.billed'), formatTokens(stats.billedTokens), () => setTab('insights'), 'tone-session is-center'),
    node('tools', state.t('stats.tools'), formatCount(stats.toolCalls), null, 'tone-tool'),
    node('cost', state.t('stats.cost'), costText(stats.cost), null, 'tone-cost'),
  )
  const toolPills = h('div', { class: 'zc-pills-row' })
  for (const [name, count] of tools.slice(0, 5)) {
    toolPills.append(h('span', { class: 'zc-mini-pill', title: name }, name, h('b', null, formatCount(count))))
  }
  if (tools.length > 5) toolPills.append(h('span', { class: 'zc-mini-pill zc-mini-pill-more' }, state.t('stats.moreTools', { n: tools.length - 5 })))
  const filePills = h('div', { class: 'zc-pills-row' })
  const fileSpec = [
    ['read', state.t('stats.read'), files.read?.files ?? 0, 'files-read'],
    ['write', state.t('stats.written'), files.write?.files ?? 0, 'files-write'],
    ['search', state.t('stats.searched'), files.search?.files ?? 0, 'files-search'],
    ['image', state.t('stats.imagesShort'), files.image?.files ?? 0, 'files-images'],
  ]
  for (const [kind, label, count, target] of fileSpec) {
    filePills.append(
      h(
        'button',
        {
          type: 'button',
          class: 'zc-mini-pill is-clickable',
          title: state.t('stats.filesTip'),
          onclick: () => jumpTo(target),
        },
        label,
        h('b', null, formatCount(count)),
      ),
    )
  }
  const familyNode = h(
    'button',
    {
      type: 'button',
      class: 'zc-family-cell',
      title: state.t('stats.familyTip'),
      onclick: () => jumpTo('fleet'),
    },
    h('span', { class: 'zc-family-icon' }, icon('branch', 15)),
    h(
      'span',
      { class: 'zc-family-text' },
      h('b', null, state.t('stats.familyValue', { n: family.count ?? 0, tokens: formatTokens(family.usage?.billed ?? 0) })),
      h('small', null, family.count ? costText(family.usage?.cost) : state.t('stats.familyTip')),
    ),
  )
  const body = h(
    'div',
    { class: 'zc-stats-body' },
    flow,
    h('div', { class: 'zc-stats-lower' }, toolPills, filePills),
    familyNode,
    h(
      'div',
      { class: 'zc-stats-foot' },
      h('span', null, state.t('stats.cacheHit') + ' ' + pct(stats.cacheHitRate)),
      h('span', null, state.t('stats.answers') + ' ' + formatCount(stats.answers)),
      h('span', null, state.t('stats.images') + ' ' + formatCount(stats.images)),
      h('span', null, state.t('stats.skills') + ' ' + formatCount(stats.skills)),
      stats.unpricedCalls ? h('span', { class: 'zc-muted' }, state.t('stats.unpriced', { n: stats.unpricedCalls })) : null,
    ),
  )
  return card(state.t('stats.title'), { className: 'zc-card-stats', body })
}

function detailFirstKey(cat) {
  const group = state.stepDetail?.groups?.find((candidate) => candidate.cat === cat)
  return group?.items?.[0]?.key ?? null
}

function renderTokensCard() {
  const current = state.snapshot.current
  const stats = state.snapshot.stats
  const parts = [
    ...CATS.filter((cat) => (current?.parts?.[cat] ?? 0) > 0).map((cat) => ({
      key: cat,
      label: catLabel(cat),
      value: current.parts[cat],
      color: CAT_COLOR[cat],
    })),
    ...(current?.output ? [{ key: 'output', label: state.t('tokens.output'), value: current.output, color: CAT_COLOR.output }] : []),
  ]
  const total = parts.reduce((sum, part) => sum + part.value, 0)
  const body = h('div', { class: 'zc-donut-body' })
  if (parts.length === 0) {
    body.append(h('div', { class: 'zc-empty' }, state.t('tokens.empty')))
  } else {
    body.append(
      h(
        'div',
        { class: 'zc-donut-row' },
        renderDonut(parts, {
          size: 104,
          centerTop: formatTokens(total),
          centerSub: state.t('tokens.total'),
        }),
        renderSliceList(parts, total),
      ),
    )
  }
  return card(state.t('tokens.title'), {
    className: 'zc-card-donut',
    right: stats.cacheHitRate != null ? pill(state.t('stats.cacheHit') + ' ' + pct(stats.cacheHitRate), 'zc-pill-accent', state.t('tokens.cacheTip')) : null,
    body,
  })
}

function renderTimingCard() {
  const timing = state.snapshot.timing
  if (!timing || (!timing.wallMs && !timing.calls)) {
    return card(state.t('timing.title'), { className: 'zc-card-donut', body: h('div', { class: 'zc-empty' }, state.t('timing.empty')) })
  }
  const wall = timing.wallMs || timing.modelMs + timing.toolsMs + timing.otherMs || 0
  const slice = (key, label, value, color) => ({ key, label, value, color })
  const parts = [
    slice('ttft', state.t('timing.ttft'), timing.ttftMs, TIMING_COLOR.ttft),
    slice('gen', state.t('timing.gen'), timing.genMs, TIMING_COLOR.gen),
    slice('tools', state.t('timing.tools'), timing.toolsMs, TIMING_COLOR.tools),
    slice('other', state.t('timing.other'), timing.otherMs, TIMING_COLOR.other),
  ].filter((part) => part.value > 0)
  const tps = timing.speedMs > 0 ? timing.speedTokens / (timing.speedMs / 1000) : null
  const body = h(
    'div',
    { class: 'zc-timing-body' },
    h(
      'div',
      { class: 'zc-donut-row' },
      renderDonut(parts, { size: 104, centerTop: formatDuration(wall), centerSub: state.t('timing.total') }),
      renderSliceList(parts, wall, { ttft: timing.calls, tools: timing.toolCalls }),
    ),
    renderTimingStrip(timing.spans ?? []),
  )
  return card(state.t('timing.title'), {
    className: 'zc-card-donut',
    right: tps != null ? pill(state.t('timing.tps', { n: Math.round(tps) }), 'zc-pill-soft') : null,
    body,
  })
}

function renderSliceList(parts, total, counts = {}) {
  const list = h('div', { class: 'zc-slices' })
  for (const part of parts) {
    const count = counts[part.key]
    list.append(
      h(
        'div',
        { class: 'zc-slice', dataset: { cat: part.key } },
        h('i', { class: 'zc-dot', style: { background: part.color } }),
        h('span', { class: 'zc-slice-label' }, part.label),
        h('span', { class: 'zc-slice-value' }, (part.key === 'output' ? '' : '≈') + formatTokens(part.value)),
        h('span', { class: 'zc-slice-share' }, formatShare(part.value, total) + '%'),
        count != null ? h('span', { class: 'zc-slice-count' }, formatCount(count)) : null,
      ),
    )
  }
  return list
}

function renderCurrentCard() {
  const current = state.snapshot.current
  if (!current) return card(state.t('current.title'), { body: h('div', { class: 'zc-empty' }, state.t('steps.empty')) })
  const parts = CATS.filter((cat) => (current.parts?.[cat] ?? 0) > 0).map((cat) => ({
    key: cat,
    label: catLabel(cat),
    value: current.parts[cat],
    color: CAT_COLOR[cat],
  }))
  const window = current.window || 0
  const total = current.prompt || parts.reduce((sum, part) => sum + part.value, 0)
  const max = window || total || 1
  const reserve = current.reserve ?? 0
  const body = h(
    'div',
    { class: 'zc-current' },
    h(
      'div',
      { class: 'zc-current-head' },
      h(
        'div',
        { class: 'zc-current-num' },
        h('b', null, formatTokens(total)),
        h('span', null, window ? ' / ' + formatTokens(window) + ' tokens' : ' ' + state.t('current.estimate')),
        current.pct != null ? h('em', null, pct(current.pct) + ' ' + state.t('current.used')) : h('em', { class: 'zc-muted' }, state.t('current.windowUnknown')),
      ),
      h('div', { class: 'zc-current-meta' }, current.model ?? '', current.headerEstimated ? h('span', { class: 'zc-warn-dot', title: state.t('current.headerEstimated') }) : null),
    ),
    renderStackedBar(parts, { max, reserve, height: 18 }),
    h(
      'div',
      { class: 'zc-legend' },
      parts.map((part) =>
        h(
          'span',
          { class: 'zc-legend-item', dataset: { cat: part.key } },
          h('i', { style: { background: part.color } }),
          h('span', null, part.label),
          h('b', null, formatTokens(part.value)),
          h('em', null, formatShare(part.value, total) + '%'),
        ),
      ),
    ),
    reserve > 0 || window
      ? h(
          'div',
          { class: 'zc-current-foot' },
          reserve > 0 ? h('span', null, state.t('current.reserve') + ' ' + formatTokens(reserve)) : null,
          window ? h('span', null, state.t('current.headroom') + ' ' + formatTokens(Math.max(0, window - total - reserve))) : null,
          current.lastUser ? h('span', { class: 'zc-lastuser', title: current.lastUser }, state.t('current.lastUser') + ' · ' + current.lastUser) : null,
        )
      : null,
  )
  return card(state.t('current.title'), {
    className: 'zc-card-current',
    subtitle: current.step ? state.t('current.subtitle', { step: current.step, turn: current.turn }) : null,
    body,
  })
}

function renderStackedBar(parts, { max = 0, reserve = 0, height = 16, mode = 'total' } = {}) {
  const bar = h('div', { class: 'zc-stacked', style: { height: height + 'px' } })
  if (mode === 'total') {
    const scale = max > 0 ? 100 / max : 0
    for (const part of parts) {
      if (!(part.value > 0)) continue
      bar.append(
        h('span', {
          class: 'zc-stacked-seg',
          dataset: { cat: part.key },
          style: { width: Math.max(0.15, part.value * scale) + '%', background: part.color },
          title: part.label + ' · ' + formatTokens(part.value),
        }),
      )
    }
    if (reserve > 0 && max > 0) {
      bar.append(
        h('span', {
          class: 'zc-stacked-reserve',
          style: { width: Math.min(100, (reserve / max) * 100) + '%' },
          title: state.t('current.reserve') + ' · ' + formatTokens(reserve),
        }),
      )
    }
  }
  return bar
}

function renderDonut(parts, { size = 104, centerTop = '', centerSub = '' } = {}) {
  const total = parts.reduce((sum, part) => sum + Math.max(0, part.value), 0)
  const radius = size / 2 - 8
  const circumference = 2 * Math.PI * radius
  const svg = sv('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, class: 'zc-donut', role: 'img' })
  svg.append(sv('circle', { cx: size / 2, cy: size / 2, r: radius, fill: 'none', stroke: 'var(--track)', 'stroke-width': 11 }))
  let offset = 0
  for (const part of parts) {
    const share = total > 0 ? Math.max(0, part.value) / total : 0
    if (share <= 0) continue
    const dash = share * circumference
    svg.append(
      sv('circle', {
        cx: size / 2,
        cy: size / 2,
        r: radius,
        fill: 'none',
        stroke: part.color,
        'stroke-width': 11,
        'stroke-dasharray': `${Math.max(0, dash - 1.5)} ${circumference - Math.max(0, dash - 1.5)}`,
        'stroke-dashoffset': -offset * circumference,
        transform: `rotate(-90 ${size / 2} ${size / 2})`,
        'stroke-linecap': 'butt',
        dataset: { cat: part.key },
      }),
    )
    offset += share
  }
  const wrap = h(
    'div',
    { class: 'zc-donut-wrap', style: { width: size + 'px', height: size + 'px' } },
    svg,
    h('div', { class: 'zc-donut-center' }, h('b', null, centerTop), h('span', null, centerSub)),
  )
  return wrap
}

function renderTimingStrip(spans) {
  if (!Array.isArray(spans) || spans.length === 0) return null
  const width = 100
  const strip = h('div', { class: 'zc-strip', title: state.t('timing.stripTip') })
  const sorted = [...spans].sort((a, b) => a.start - b.start)
  const start = sorted[0]?.start ?? 0
  const end = Math.max(...sorted.map((span) => span.end)) || start + 1
  const total = Math.max(1, end - start)
  let cursor = start
  for (const span of sorted.slice(0, 260)) {
    if (span.start > cursor) {
      strip.append(h('span', { class: 'zc-strip-gap', style: { width: ((span.start - cursor) / total) * width + '%' } }))
    }
    const widthPct = Math.max(0.08, ((span.end - span.start) / total) * width)
    strip.append(
      h('span', {
        class: 'zc-strip-seg',
        dataset: { cat: span.kind },
        style: { width: widthPct + '%', background: TIMING_COLOR[span.kind] ?? TIMING_COLOR.other },
        title: span.kind + ' · ' + formatDuration(span.end - span.start),
      }),
    )
    cursor = Math.max(cursor, span.end)
  }
  return strip
}

/* ------------------------------------------------------------------------------------------------
 * Trend
 * ---------------------------------------------------------------------------------------------- */

function trendEntries() {
  const list = requests()
  if (state.granularity === 'step') {
    return list.map((request) => ({ ...request, label: 'S' + request.step, count: 1, firstStep: request.step }))
  }
  const byTurn = new Map()
  for (const request of list) {
    const current = byTurn.get(request.turn)
    if (!current) byTurn.set(request.turn, { ...request, label: 'T' + request.turn, count: 1, firstStep: request.step, durationMs: request.durationMs, ttftMs: request.ttftMs, toolCalls: request.toolCalls })
    else {
      current.count++
      current.durationMs += request.durationMs ?? 0
      current.ttftMs += request.ttftMs ?? 0
      current.toolCalls += request.toolCalls ?? 0
      current.output = request.output
      current.prompt = request.prompt
      current.parts = request.parts
      current.cacheRead = request.cacheRead
      current.cacheWrite = request.cacheWrite
      current.time = request.time
      current.step = request.step
      current.header = request.header
      current.total = request.total
    }
  }
  return [...byTurn.values()]
}

function diffParts(parts, previous) {
  const out = {}
  for (const cat of CATS) out[cat] = (parts?.[cat] ?? 0) - (previous?.parts?.[cat] ?? 0)
  return out
}

function eventsFor(entry) {
  const events = state.snapshot?.events ?? []
  if (state.granularity === 'step') return events.filter((event) => event.step === entry.step && ['compaction', 'model', 'rewind'].includes(event.kind))
  return events.filter((event) => event.turn === entry.turn && ['compaction', 'model', 'rewind'].includes(event.kind))
}

function renderTrendCard() {
  const entries = trendEntries()
  const controls = h('div', { class: 'zc-trend-controls' })
  const seg = (value, label, current, onClick) =>
    h('button', {
      type: 'button',
      class: 'zc-segbtn' + (current === value ? ' is-active' : ''),
      onclick: onClick,
      'aria-pressed': current === value ? 'true' : 'false',
    }, label)
  controls.append(
    h('div', { class: 'zc-segmented' },
      seg('step', state.t('trend.steps'), state.granularity, () => { state.granularity = 'step'; saveView(); render() }),
      seg('turn', state.t('trend.turns'), state.granularity, () => { state.granularity = 'turn'; saveView(); render() }),
    ),
    h('div', { class: 'zc-segmented' },
      seg('total', state.t('trend.total'), state.trendMode, () => { state.trendMode = 'total'; saveView(); render() }),
      seg('delta', state.t('trend.delta'), state.trendMode, () => { state.trendMode = 'delta'; state.trendDna = false; saveView(); render() }),
    ),
    h('div', { class: 'zc-toggles' },
      h('button', { type: 'button', class: 'zc-toggle' + (state.overview ? ' is-active' : ''), title: state.t('trend.overviewTip'), onclick: () => { state.overview = !state.overview; if (state.overview) state.trendDna = false; render() } }, state.t('trend.overview')),
      h('button', { type: 'button', class: 'zc-toggle' + (state.trendDna ? ' is-active' : ''), title: state.t('trend.dnaTip'), onclick: setTrendDna }, state.t('trend.dna')),
      h('button', { type: 'button', class: 'zc-toggle' + (state.adaptive ? ' is-active' : ''), title: state.t('trend.adaptiveTip'), onclick: () => { state.adaptive = !state.adaptive; render() } }, state.t('trend.adaptive')),
      h('button', { type: 'button', class: 'zc-toggle' + (state.durationCurve ? ' is-active' : ''), title: state.t('trend.durationTip'), onclick: () => { state.durationCurve = !state.durationCurve; saveView(); render() } }, state.t('trend.duration')),
    ),
  )
  const body = h('div', { class: 'zc-trend-body' })
  if (entries.length === 0) {
    body.append(h('div', { class: 'zc-empty' }, state.t('trend.empty')))
  } else if (state.overview) {
    body.append(renderTrendOverview(entries))
  } else {
    body.append(renderTrendBars(entries))
  }
  const brief = renderBrief()
  if (brief) body.append(brief)
  const earlier = (state.snapshot.requestsFrom ?? 1) > 1
  return card(state.t('trend.title'), {
    className: 'zc-card-trend',
    right: earlier ? button(state.t('action.loadEarlier'), { onClick: loadEarlier, class: 'zc-btn-tiny', icon: 'left' }) : null,
    body: h('div', null, controls, body),
  })
}

function renderTrendBars(entries) {
  const wrap = h('div', { class: 'zc-trend-wrap' })
  const chart = h('div', { class: 'zc-trend-chart' })
  const scroll = h('div', { class: 'zc-trend-scroll', title: state.t('trend.scrollTip') })
  const inner = h('div', { class: 'zc-trend-inner' })
  const maxBase = state.adaptive
    ? Math.max(1, ...entries.map((entry) => (state.trendMode === 'delta' ? 0 : entry.prompt)))
    : state.snapshot.current?.window || Math.max(1, ...entries.map((entry) => entry.prompt))
  let maxDelta = 1
  if (state.trendMode === 'delta') {
    for (const [index, entry] of entries.entries()) {
      const delta = diffParts(entry.parts, entries[index - 1]?.parts)
      maxDelta = Math.max(maxDelta, ...Object.values(delta).map((value) => Math.abs(value)))
    }
  }
  const max = state.trendMode === 'delta' ? maxDelta : maxBase
  const bars = h('div', { class: 'zc-bars', style: { width: Math.max(entries.length * 18, 320) + 'px' } })
  const markers = h('div', { class: 'zc-markers', style: { width: Math.max(entries.length * 18, 320) + 'px' } })
  const turnMap = new Map()
  for (const [index, entry] of entries.entries()) {
    const previous = entries[index - 1]
    const selected = entry.step === state.step || (entry.firstStep <= state.step && entry.step >= state.step)
    const bar = h('div', {
      class: 'zc-bar' + (selected ? ' is-selected' : ''),
      dataset: { stepBar: entry.step, step: state.granularity === 'turn' ? entry.firstStep : entry.step },
      role: 'button',
      tabindex: 0,
      'aria-label': '#' + entry.step + ' ' + formatTokens(entry.prompt) + ' prompt tokens',
      onclick: () => selectStep(state.granularity === 'turn' ? entry.step : entry.step, { pin: true }),
      onkeydown: (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          selectStep(entry.step, { pin: true })
        }
      },
      onmouseenter: (event) => showTrendTip(event, entry, previous),
      onmousemove: (event) => moveTrendTip(event),
      onmouseleave: hideTrendTip,
    })
    if (state.trendMode === 'total') {
      const bands = state.trendDna ? state.dnaSeries?.get(entry.step) : null
      const gradient = dnaGradient(bands)
      if (gradient) {
        bar.append(h('div', {
          class: 'zc-bar-stack zc-bar-dna',
          style: { height: Math.min(100, ((entry.prompt || 0) / max) * 100) + '%', background: gradient },
          title: state.t('trend.dnaTip'),
        }))
      } else {
        const stack = h('div', { class: 'zc-bar-stack' })
        for (const cat of CATS) {
          const value = entry.parts?.[cat] ?? 0
          if (value <= 0) continue
          stack.append(h('span', {
            class: 'zc-bar-seg',
            dataset: { cat },
            style: { height: (value / max) * 100 + '%', background: CAT_COLOR[cat] },
          }))
        }
        bar.append(stack)
      }
    } else {
      const delta = previous ? diffParts(entry.parts, previous.parts) : {}
      const up = h('div', { class: 'zc-bar-up' })
      const down = h('div', { class: 'zc-bar-down' })
      for (const cat of CATS) {
        const value = delta[cat] ?? 0
        if (value === 0) continue
        const target = value > 0 ? up : down
        target.append(h('span', {
          class: 'zc-bar-seg',
          dataset: { cat },
          style: { height: (Math.abs(value) / max) * 50 + '%', background: CAT_COLOR[cat] },
        }))
      }
      bar.append(h('div', { class: 'zc-bar-delta' }, up, h('span', { class: 'zc-zero' }), down))
    }
    bars.append(bar)
    const turnKey = entry.turn
    if (!turnMap.has(turnKey)) turnMap.set(turnKey, { start: index, count: 0, turn: turnKey })
    turnMap.get(turnKey).count++
    const events = eventsFor(entry)
    if (events.length) {
      const marker = h('div', { class: 'zc-marker', style: { left: index * 18 + 9 + 'px' } })
      for (const event of events.slice(0, 3)) {
        marker.append(h('span', { class: 'zc-marker-dot', dataset: { kind: event.kind }, title: state.t('trend.' + event.kind) }, event.kind === 'compaction' ? '✂' : event.kind === 'model' ? '⇄' : '↶'))
      }
      markers.append(marker)
    }
  }
  const axis = h('div', { class: 'zc-axis' }, ...[1, 0.75, 0.5, 0.25, 0].map((fraction) => h('span', null, formatTokens(max * fraction))))
  const turnBand = h('div', { class: 'zc-turnband', style: { width: Math.max(entries.length * 18, 320) + 'px' } })
  for (const [turn, info] of turnMap) {
    turnBand.append(h('span', { class: 'zc-turnlabel', style: { left: info.start * 18 + 'px', width: info.count * 18 + 'px' } }, 'T' + turn))
  }
  const duration = state.durationCurve ? renderDurationCurve(entries) : null
  chart.append(markers, h('div', { class: 'zc-bars-row' }, axis, bars), duration ? duration : null)
  inner.append(chart, turnBand)
  scroll.append(inner)
  wrap.append(scroll)
  return wrap
}

function renderDurationCurve(entries) {
  const maxDuration = Math.max(1, ...entries.map((entry) => entry.durationMs ?? 0))
  const width = Math.max(entries.length * 18, 320)
  const height = 30
  const points = entries.map((entry, index) => {
    const x = index * 18 + 9
    const y = height - ((entry.durationMs ?? 0) / maxDuration) * (height - 4)
    return x + ',' + y.toFixed(1)
  })
  return sv(
    'svg',
    { class: 'zc-duration', width, height, viewBox: `0 0 ${width} ${height}`, 'aria-hidden': 'true' },
    sv('polyline', { points: points.join(' '), fill: 'none', stroke: 'var(--timing-text)', 'stroke-width': 1.5, 'stroke-linejoin': 'round' }),
  )
}

function renderTrendOverview(entries) {
  const n = entries.length
  if (n === 0) return h('div', { class: 'zc-empty' }, state.t('trend.empty'))
  const delta = state.trendMode === 'delta'
  const deltas = entries.map((entry, index) => {
    const previous = entries[index - 1]
    const out = {}
    for (const cat of CATS) out[cat] = previous ? (entry.parts?.[cat] ?? 0) - (previous.parts?.[cat] ?? 0) : 0
    return out
  })
  let maxUp = 0
  let maxDown = 0
  let maxTotal = 1
  for (const [index, entry] of entries.entries()) {
    maxTotal = Math.max(maxTotal, entry.prompt || 0)
    const values = delta ? deltas[index] : entry.parts
    let up = 0
    let down = 0
    for (const cat of CATS) {
      const value = values?.[cat] ?? 0
      if (value > 0) up += value
      else down -= value
    }
    maxUp = Math.max(maxUp, up)
    maxDown = Math.max(maxDown, down)
  }
  const width = 1000
  const height = 112
  const span = delta ? Math.max(1, maxUp + maxDown) : maxTotal
  const zeroY = delta ? (maxUp / span) * height : height
  const scale = delta ? height / span : height / Math.max(1, maxTotal)
  const xAt = (index) => (n > 1 ? (index / (n - 1)) * width : width / 2)
  const yAt = (value, direction = 1) => Math.round((zeroY - direction * value * scale) * 100) / 100
  const svg = sv('svg', {
    class: 'zc-overview-svg',
    viewBox: `0 0 ${width} ${height}`,
    preserveAspectRatio: 'none',
    role: 'img',
    'aria-label': state.t('trend.overviewTip'),
  })
  svg.append(sv('rect', { x: 0, y: 0, width, height, fill: 'var(--track)', rx: 3 }))
  if (delta) {
    const upCum = new Array(n).fill(0)
    const downCum = new Array(n).fill(0)
    for (const cat of CATS) {
      const upPrev = upCum.slice()
      const downPrev = downCum.slice()
      for (let i = 0; i < n; i++) {
        const value = deltas[i][cat] ?? 0
        if (value > 0) upCum[i] += value
        else downCum[i] += -value
      }
      const polygon = (upper, lower) => {
        const points = []
        for (let i = 0; i < n; i++) points.push(`${xAt(i)},${yAt(upper[i], 1)}`)
        for (let i = n - 1; i >= 0; i--) points.push(`${xAt(i)},${yAt(lower[i], 1)}`)
        return points.join(' ')
      }
      if (upCum.some((value, i) => value !== upPrev[i])) svg.append(sv('polygon', { points: polygon(upCum, upPrev), fill: CAT_COLOR[cat] }))
      if (downCum.some((value, i) => value !== downPrev[i])) svg.append(sv('polygon', { points: polygon(downCum, downPrev), fill: CAT_COLOR[cat], opacity: 0.72 }))
    }
    svg.append(sv('line', { x1: 0, y1: zeroY, x2: width, y2: zeroY, stroke: 'var(--border-strong)', 'stroke-dasharray': '3 3', 'stroke-width': 1 }))
  } else {
    const cum = new Array(n).fill(0)
    for (const cat of CATS) {
      const prev = cum.slice()
      for (let i = 0; i < n; i++) cum[i] += entries[i].parts?.[cat] ?? 0
      const points = []
      for (let i = 0; i < n; i++) points.push(`${xAt(i)},${yAt(cum[i])}`)
      for (let i = n - 1; i >= 0; i--) points.push(`${xAt(i)},${yAt(prev[i])}`)
      svg.append(sv('polygon', { points: points.join(' '), fill: CAT_COLOR[cat] }))
    }
  }
  if (state.durationCurve) {
    const maxDuration = Math.max(1, ...entries.map((entry) => entry.durationMs ?? 0))
    const points = entries.map((entry, index) => `${xAt(index)},${Math.round(height - 5 - ((entry.durationMs ?? 0) / maxDuration) * (height - 16))}`).join(' ')
    if (points) svg.append(sv('polyline', { points, fill: 'none', stroke: 'var(--overview-duration)', 'stroke-width': 1.6, 'stroke-linejoin': 'round', opacity: 0.95 }))
  }
  const selectedIndex = entries.findIndex((entry) => entry.step === state.step || (entry.firstStep != null && entry.firstStep <= state.step && entry.step >= state.step))
  if (selectedIndex >= 0) {
    svg.append(sv('line', { x1: xAt(selectedIndex), y1: 0, x2: xAt(selectedIndex), y2: height, stroke: 'var(--accent)', 'stroke-width': 1, 'stroke-dasharray': '2 2' }))
  }
  svg.append(sv('rect', { x: 0, y: 0, width, height, fill: 'transparent', style: 'cursor:crosshair' }))
  const axisValues = delta
    ? [maxUp, maxUp * 0.75, maxUp * 0.5, maxUp * 0.25, 0]
    : [maxTotal, maxTotal * 0.75, maxTotal * 0.5, maxTotal * 0.25, 0]
  const axis = h('div', { class: 'zc-overview-axis' }, axisValues.map((value) => h('span', null, (delta && value > 0 ? '+' : '') + formatTokens(value))))
  const turnBand = h('div', { class: 'zc-overview-turnband' })
  let lastTurn = null
  for (const [index, entry] of entries.entries()) {
    if (entry.turn === lastTurn) continue
    lastTurn = entry.turn
    const count = entries.filter((candidate) => candidate.turn === entry.turn).length
    turnBand.append(h('span', { style: { left: (index / Math.max(1, n)) * 100 + '%', width: (count / Math.max(1, n)) * 100 + '%' } }, 'T' + entry.turn))
  }
  const wrap = h('div', { class: 'zc-overview' },
    h('div', { class: 'zc-overview-main' }, axis, svg),
    turnBand,
    h('div', { class: 'zc-overview-note' }, state.t('trend.overviewTip')),
  )
  const pick = (event) => {
    const rect = svg.getBoundingClientRect()
    if (rect.width <= 0) return 0
    return Math.max(0, Math.min(n - 1, Math.round(((event.clientX - rect.left) / rect.width) * (n - 1))))
  }
  svg.addEventListener('mousemove', (event) => {
    const index = pick(event)
    const entry = entries[index]
    showTrendTip(event, entry, entries[index - 1])
  })
  svg.addEventListener('mouseleave', hideTrendTip)
  svg.addEventListener('click', (event) => {
    const entry = entries[pick(event)]
    if (entry) selectStep(entry.step, { pin: true })
  })
  return wrap
}

function renderTrendDna() {
  const detail = state.stepDetail
  const items = state.dnaData?.items ?? detail?.dna ?? []
  const wrap = h('div', { class: 'zc-trend-dna' })
  wrap.append(
    h('div', { class: 'zc-trend-dna-head' },
      h('b', null, state.t('trend.dna')),
      h('span', null, 'request #' + (detail?.step ?? state.step ?? '—')),
      state.dnaLoading ? h('span', { class: 'zc-muted' }, state.t('app.tagline')) : null,
      button(state.t('action.open'), { onClick: openDnaBrowser, class: 'zc-btn-tiny', icon: 'arrow' }),
    ),
  )
  if (!items.length) {
    wrap.append(h('div', { class: 'zc-note' }, state.dnaLoading ? state.t('app.tagline') : state.t('browser.empty')))
    return wrap
  }
  const total = Math.max(1, items.reduce((sum, item) => sum + (item.tokens ?? 0), 0))
  const strip = h('div', { class: 'zc-dna-strip', title: state.t('trend.dnaTip') })
  for (const item of items) {
    const segment = h('button', {
      type: 'button',
      class: 'zc-dna-band',
      style: { width: Math.max(0.08, ((item.tokens ?? 0) / total) * 100) + '%', background: CAT_COLOR[item.cat] },
      title: '#' + item.position + ' · ' + catLabel(item.cat) + ' · ' + formatTokens(item.tokens) + ' · ' + item.title,
      onclick: () => openElement(item.key, state.step),
    })
    strip.append(segment)
  }
  wrap.append(strip)
  const top = [...items].sort((a, b) => (b.tokens ?? 0) - (a.tokens ?? 0)).slice(0, 6)
  wrap.append(h('div', { class: 'zc-dna-top' }, top.map((item) =>
    h('button', { type: 'button', class: 'zc-dna-toprow', onclick: () => openElement(item.key, state.step), title: item.title },
      h('span', { class: 'zc-dna-pos' }, '#' + item.position),
      h('i', { class: 'zc-dot', style: { background: CAT_COLOR[item.cat] } }),
      h('span', { class: 'zc-dna-cat' }, catLabel(item.cat)),
      h('span', { class: 'zc-dna-title' }, item.title),
      h('b', null, formatTokens(item.tokens)),
    ),
  )))
  return wrap
}

function showTrendTip(event, entry, previous) {
  hideTrendTip()
  const total = entry.prompt
  const delta = previous ? total - previous.prompt : null
  const tip = h(
    'div',
    { class: 'zc-tip' },
    h('div', { class: 'zc-tip-head' }, h('b', null, '#' + entry.step + ' · T' + entry.turn), h('span', null, clockTime(entry.time))),
    h('div', { class: 'zc-tip-row' }, h('span', null, state.t('trend.prompt')), h('b', null, formatTokens(total))),
    delta != null ? h('div', { class: 'zc-tip-row' }, h('span', null, state.t('trend.deltaNet')), h('b', { class: delta >= 0 ? 'zc-pos' : 'zc-neg' }, (delta >= 0 ? '+' : '') + formatTokens(delta))) : null,
    h('div', { class: 'zc-tip-row' }, h('span', null, state.t('trend.output')), h('b', null, formatTokens(entry.output))),
    h('div', { class: 'zc-tip-row' }, h('span', null, state.t('trend.cacheRead')), h('b', null, formatTokens(entry.cacheRead))),
    h('div', { class: 'zc-tip-parts' }, CATS.filter((cat) => (entry.parts?.[cat] ?? 0) > 0).map((cat) =>
      h('span', { class: 'zc-tip-part' }, h('i', { style: { background: CAT_COLOR[cat] } }), catLabel(cat), ' ', formatTokens(entry.parts[cat])),
    )),
    h('div', { class: 'zc-tip-foot' }, entry.model, entry.status),
  )
  tip.dataset.trendTip = '1'
  document.body.append(tip)
  state._tip = tip
  moveTrendTip(event)
}

function moveTrendTip(event) {
  const tip = state._tip
  if (!tip) return
  const width = 280
  const left = Math.min(window.innerWidth - width - 8, Math.max(8, event.clientX + 12))
  const top = Math.min(window.innerHeight - tip.offsetHeight - 8, Math.max(8, event.clientY + 12))
  tip.style.left = left + 'px'
  tip.style.top = top + 'px'
}

function hideTrendTip() {
  state._tip?.remove()
  state._tip = null
}

function renderBrief() {
  const detail = state.stepDetail
  if (!detail) {
    return state.stepLoading
      ? h('div', { class: 'zc-brief is-loading' }, h('div', { class: 'zc-skel-line' }), h('div', { class: 'zc-skel-line' }), h('div', { class: 'zc-skel-line' }))
      : null
  }
  if (state.stepError) return h('div', { class: 'zc-inline-error' }, state.stepError.message)
  const brief = detail.brief
  if (!brief) return null
  const row = (label, content, onClick = null) =>
    h(
      'div',
      { class: 'zc-brief-row' + (onClick ? ' is-clickable' : ''), onclick: onClick ?? undefined, title: onClick ? state.t('brief.jump') : undefined },
      h('span', { class: 'zc-brief-label' }, label),
      content,
    )
  const incoming = brief.incoming?.length
    ? h('div', { class: 'zc-brief-in' },
        brief.incoming.slice(0, 3).map((item) =>
          h('span', { class: 'zc-brief-chip', title: item.preview, dataset: { cat: item.cat } },
            h('i', { style: { background: CAT_COLOR[item.cat] } }),
            item.title,
            h('b', null, formatTokens(item.tokens)),
          ),
        ),
        brief.incomingCount > 3 ? h('span', { class: 'zc-muted' }, '+' + (brief.incomingCount - 3)) : null,
      )
    : h('span', { class: 'zc-muted' }, state.t('common.none'))
  const request = detail.request
  const actual = request
    ? h('div', { class: 'zc-brief-actual' },
        h('span', null, state.t('trend.actual')),
        h('b', null, formatTokens(request.prompt)),
        h('span', null, state.t('trend.output')),
        h('b', null, formatTokens(request.output)),
        request.prompt > 0 ? h('span', null, 'cache ' + pct((request.cacheRead / request.prompt) * 100)) : null,
      )
    : null
  return h(
    'div',
    { class: 'zc-brief' },
    h('div', { class: 'zc-brief-head' }, state.t('trend.brief'), h('span', null, '#' + detail.step + ' · T' + detail.turn)),
    actual,
    row(state.t('brief.user'), h('span', { class: 'zc-brief-text', title: brief.user?.title }, brief.user?.title || state.t('common.none'))),
    row(state.t('brief.in'), incoming),
    row(
      state.t('brief.response'),
      h('span', { class: 'zc-brief-text', title: brief.response?.title },
        (brief.response?.title || state.t('brief.noResponse')) +
          (brief.response?.toolCount ? ' · ' + state.t('brief.tools', { n: brief.response.toolCount }) : ''),
      ),
      () => {
        const key = brief.response?.tools?.length ? detailFirstKey('tool') : detailFirstKey('assistant')
        if (key) openElement(key, detail.step)
      },
    ),
  )
}

/* ------------------------------------------------------------------------------------------------
 * Browser
 * ---------------------------------------------------------------------------------------------- */

function renderBrowserCard() {
  const detail = state.stepDetail
  const head = h('div', { class: 'zc-browser-controls' })
  head.append(
    h('div', { class: 'zc-segmented zc-segmented-wide' },
      ['categories', 'changes', 'dna'].map((mode) =>
        h('button', {
          type: 'button',
          class: 'zc-segbtn' + (state.browserMode === mode ? ' is-active' : ''),
          onclick: () => setBrowserMode(mode),
          'aria-pressed': state.browserMode === mode ? 'true' : 'false',
        }, state.t('browser.mode.' + mode)),
      ),
    ),
    state.browserMode !== 'dna'
      ? h('label', { class: 'zc-field zc-field-inline' },
          h('span', null, state.t('browser.baseline')),
          h('select', {
            class: 'zc-select',
            onchange: (event) => {
              const value = event.target.value
              state.baselineMode = value
              saveView()
              loadStep(state.step, { force: true, baseline: value })
            },
          },
          h('option', { value: 'off', selected: state.baselineMode === 'off' }, state.t('browser.baseline.off')),
          h('option', { value: 'step', selected: state.baselineMode === 'step' }, state.t('browser.baseline.step')),
          h('option', { value: 'turn', selected: state.baselineMode === 'turn' }, state.t('browser.baseline.turn')),
          ),
        )
      : null,
    h('div', { class: 'zc-browser-filters' },
      h('label', { class: 'zc-search' }, icon('search', 14), h('input', {
        type: 'search',
        placeholder: state.t('browser.search'),
        value: state.browserSearch,
        oninput: (event) => {
          state.browserSearch = event.target.value
          clearTimeout(state.searchTimer)
          state.searchTimer = setTimeout(() => {
            state.groupExtra.clear()
            loadStep(state.step, { force: true, search: state.browserSearch })
          }, 350)
        },
      })),
      h('select', {
        class: 'zc-select zc-select-small',
        'aria-label': state.t('browser.sort'),
        onchange: (event) => {
          state.browserSort = event.target.value
          loadStep(state.step, { force: true })
        },
      },
      h('option', { value: 'size', selected: state.browserSort === 'size' }, state.t('browser.sort.size')),
      h('option', { value: 'name', selected: state.browserSort === 'name' }, state.t('browser.sort.name')),
      h('option', { value: 'order', selected: state.browserSort === 'order' }, state.t('browser.sort.order')),
      h('option', { value: 'calls', selected: state.browserSort === 'calls' }, state.t('browser.sort.calls')),
      ),
    ),
  )
  const body = h('div', { class: 'zc-browser-body' })
  if (detail?.request) {
    body.append(
      h('div', { class: 'zc-browser-summary' },
        h('span', null, state.t('browser.estimated') + ' ≈' + formatTokens(detail.request.rawTotal ?? 0)),
        h('b', null, state.t('browser.actual') + ' ' + formatTokens(detail.request.prompt ?? 0)),
        detail.request.cacheRead > 0 ? h('span', null, 'cache ' + pct((detail.request.cacheRead / Math.max(1, detail.request.prompt)) * 100)) : null,
      ),
    )
  }
  if (state.stepLoading && !detail) body.append(h('div', { class: 'zc-empty' }, state.t('browser.loadFailed')))
  else if (state.stepError) body.append(h('div', { class: 'zc-inline-error' }, state.stepError.message, button(state.t('action.retry'), { onClick: () => loadStep(state.step, { force: true }), class: 'zc-btn-tiny' })))
  else if (!detail) body.append(h('div', { class: 'zc-empty' }, state.t('browser.empty')))
  else {
    if (detail.header?.missing) body.append(h('div', { class: 'zc-note' }, state.t('browser.headerMissing')))
    else if (detail.header?.estimated) body.append(h('div', { class: 'zc-note' }, state.t('browser.headerEstimated')))
    if (state.browserMode === 'changes') body.append(renderChanges(detail))
    else if (state.browserMode === 'dna') body.append(renderDna(detail))
    else body.append(renderCategories(detail))
  }
  return card(state.t('browser.title'), {
    className: 'zc-card-browser',
    subtitle: detail ? state.t('browser.subtitle', { step: detail.step, count: (detail.groups ?? []).reduce((sum, group) => sum + (group.count ?? 0), 0), tokens: formatTokens(detail.request?.prompt ?? 0) }) : null,
    body: h('div', null, head, body),
  })
}

function groupItems(detail, group) {
  const extra = state.groupExtra.get(group.cat)?.items ?? []
  const seen = new Set()
  const items = [...(group.items ?? []), ...extra].filter((item) => {
    if (seen.has(item.key)) return false
    seen.add(item.key)
    return true
  })
  const search = state.browserSearch.trim().toLowerCase()
  return items.filter((item) => {
    if (search && ![item.title, item.preview, item.tool, item.skill].some((value) => String(value ?? '').toLowerCase().includes(search))) return false
    if (group.cat === 'assistant' && state.kindFilter) {
      if (state.kindFilter === 'thinking' && item.kind !== 'thinking') return false
      if (state.kindFilter === 'tools' && item.kind !== 'tool-call') return false
      if (state.kindFilter === 'answer' && item.kind !== 'answer') return false
    }
    return true
  })
}

function renderCategories(detail) {
  const wrap = h('div', { class: 'zc-cats' })
  if (!detail.groups?.length) {
    wrap.append(h('div', { class: 'zc-empty' }, state.t('browser.empty')))
    return wrap
  }
  for (const group of detail.groups) {
    const items = groupItems(detail, group)
    if (items.length === 0 && state.browserSearch) continue
    const open = state.expandedCats.has(group.cat)
    const diff = detail.diff?.categories?.find((row) => row.cat === group.cat)
    const head = h(
      'button',
      {
        type: 'button',
        class: 'zc-cat-head',
        'aria-expanded': open ? 'true' : 'false',
        onclick: () => {
          if (open) state.expandedCats.delete(group.cat)
          else state.expandedCats.add(group.cat)
          render()
        },
      },
      h('i', { class: 'zc-dot', style: { background: CAT_COLOR[group.cat] } }),
      h('span', { class: 'zc-cat-name' }, catLabel(group.cat)),
      h('span', { class: 'zc-cat-count' }, group.count),
      h('span', { class: 'zc-cat-tokens' }, formatTokens(group.tokens)),
      diff && (diff.added || diff.removed || diff.delta)
        ? h('span', { class: 'zc-diff-badges' },
            diff.added ? h('em', { class: 'zc-badge-add' }, '+' + diff.added) : null,
            diff.removed ? h('em', { class: 'zc-badge-remove' }, '−' + diff.removed) : null,
            diff.delta ? h('em', { class: diff.delta > 0 ? 'zc-badge-add' : 'zc-badge-remove' }, (diff.delta > 0 ? '+' : '') + formatTokens(diff.delta)) : null,
          )
        : null,
      h('span', { class: 'zc-cat-chevron' }, icon(open ? 'down' : 'right', 14)),
    )
    const body = h('div', { class: 'zc-cat-body' })
    if (open) {
      if (group.cat === 'assistant') {
        body.append(
          h('div', { class: 'zc-kindchips' },
            [['thinking', state.t('browser.kind.thinking')], ['tools', state.t('browser.kind.tools')], ['answer', state.t('browser.kind.answer')]].map(([kind, label]) =>
              h('button', {
                type: 'button',
                class: 'zc-kindchip' + (state.kindFilter === kind ? ' is-active' : ''),
                onclick: () => { state.kindFilter = state.kindFilter === kind ? null : kind; render() },
              }, label),
            ),
          ),
        )
      }
      for (const item of items.slice(0, 60)) body.append(renderItemRow(item))
      const extra = state.groupExtra.get(group.cat)
      if (group.more > 0 && !state.browserSearch) {
        body.append(
          h('button', { type: 'button', class: 'zc-morebtn', onclick: () => loadGroup(group.cat) },
            state.t('browser.more', { n: extra ? Math.max(0, group.more - (extra.items?.length ?? 0)) : group.more }),
            icon('down', 14),
          ),
        )
      }
    }
    wrap.append(h('div', { class: 'zc-cat' }, head, body))
  }
  if (state.browserSearch && !wrap.querySelector('.zc-cat')) wrap.append(h('div', { class: 'zc-empty' }, state.t('browser.searchEmpty')))
  return wrap
}

function renderItemRow(item) {
  const enter = item.enter?.step
    ? h('span', { class: 'zc-enter' }, item.enter.live ? state.t('browser.enterLive') : state.t('browser.enter', { step: item.enter.step }))
    : null
  const status = item.status
    ? h('span', { class: 'zc-status-dot', dataset: { status: item.status }, title: item.status })
    : null
  return h(
    'button',
    {
      type: 'button',
      class: 'zc-itemrow',
      title: item.preview || item.title,
      onclick: () => openElement(item.key, state.step),
    },
    h('span', { class: 'zc-item-token' }, formatTokens(item.tokens)),
    h(
      'span',
      { class: 'zc-item-main' },
      h('span', { class: 'zc-item-title' }, item.title || item.key),
      item.preview ? h('span', { class: 'zc-item-preview' }, item.preview) : null,
      h('span', { class: 'zc-item-meta' },
        item.tool ? h('span', { class: 'zc-chip' }, item.tool, item.source ? h('em', null, toolSourceLabel(item.source)) : null) : null,
        item.skill ? h('span', { class: 'zc-chip' }, item.skill) : null,
        item.form ? h('span', { class: 'zc-chip' }, state.t('form.' + item.form)) : null,
        item.calls != null && item.cat === 'tools' ? h('span', { class: 'zc-chip' }, state.t('browser.calls', { n: formatCount(item.calls) })) : null,
        item.kind ? h('span', { class: 'zc-chip zc-chip-soft' }, state.t('kind.' + item.kind)) : null,
        status,
        enter,
      ),
    ),
    h('span', { class: 'zc-item-go' }, icon('right', 14)),
  )
}

function renderChanges(detail) {
  const diff = detail.diff
  const wrap = h('div', { class: 'zc-changes' })
  if (!diff?.available) {
    wrap.append(h('div', { class: 'zc-empty' }, state.t('browser.changes.unavailable')))
    return wrap
  }
  wrap.append(h('div', { class: 'zc-changes-cats' }, diff.categories.map((row) =>
    h('div', { class: 'zc-change-cat' },
      h('i', { class: 'zc-dot', style: { background: CAT_COLOR[row.cat] } }),
      h('span', null, catLabel(row.cat)),
      h('em', { class: row.delta > 0 ? 'zc-pos' : row.delta < 0 ? 'zc-neg' : '' }, (row.delta > 0 ? '+' : '') + formatTokens(row.delta)),
      row.added ? h('span', { class: 'zc-badge-add' }, '+' + row.added) : null,
      row.removed ? h('span', { class: 'zc-badge-remove' }, '−' + row.removed) : null,
    ),
  )))
  const section = (title, items, cls) => {
    if (!items?.length) return null
    return h('div', { class: 'zc-change-section' },
      h('div', { class: 'zc-change-title ' + cls }, title, h('b', null, items.length)),
      items.slice(0, 60).map((item) => renderItemRow(item)),
    )
  }
  const added = section(state.t('browser.changes.added'), diff.added, 'tone-add')
  const removed = section(state.t('browser.changes.removed'), diff.removed, 'tone-remove')
  if (!added && !removed && !diff.changed?.length) wrap.append(h('div', { class: 'zc-empty' }, state.t('browser.changes.empty')))
  if (added) wrap.append(added)
  if (removed) wrap.append(removed)
  if (diff.changed?.length) {
    wrap.append(h('div', { class: 'zc-change-section' },
      h('div', { class: 'zc-change-title' }, state.t('browser.changes.changed'), h('b', null, diff.changed.length)),
      diff.changed.slice(0, 20).map((pair) => h('div', { class: 'zc-changed-row' },
        h('span', null, pair.after?.title),
        h('span', { class: 'zc-muted' }, formatTokens(pair.before?.tokens) + ' → ' + formatTokens(pair.after?.tokens)),
      )),
    ))
  }
  wrap.append(h('div', { class: 'zc-note' }, state.t('browser.changes.note')))
  return wrap
}

function renderDna(detail) {
  const wrap = h('div', { class: 'zc-dna' })
  const items = state.dnaData?.items ?? detail.dna ?? []
  if (state.dnaLoading && !items.length) {
    wrap.append(h('div', { class: 'zc-empty' }, state.t('app.tagline')))
    return wrap
  }
  if (!items.length) {
    wrap.append(h('div', { class: 'zc-empty' }, state.t('browser.empty')))
    return wrap
  }
  wrap.append(h('div', { class: 'zc-note' }, state.t('browser.dnaTip')))
  for (const item of [...items].reverse()) {
    wrap.append(
      h('button', { type: 'button', class: 'zc-dna-row', onclick: () => openElement(item.key, state.step), title: item.preview },
        h('span', { class: 'zc-dna-pos' }, state.t('browser.dnaPos', { n: item.position })),
        h('i', { class: 'zc-dot', style: { background: CAT_COLOR[item.cat] } }),
        h('span', { class: 'zc-dna-cat' }, catLabel(item.cat)),
        item.enter?.step ? h('span', { class: 'zc-enter' }, 'T' + item.enter.turn + ' S' + item.enter.step) : null,
        h('span', { class: 'zc-dna-title' }, item.title),
        h('span', { class: 'zc-dna-token' }, formatTokens(item.tokens)),
      ),
    )
  }
  if (state.dnaData?.nextOffset != null) {
    wrap.append(h('button', { type: 'button', class: 'zc-morebtn', onclick: () => loadDna({ append: true }) }, state.t('action.loadMore'), icon('down', 14)))
  }
  return wrap
}

/* ------------------------------------------------------------------------------------------------
 * Events and files
 * ---------------------------------------------------------------------------------------------- */

function renderEventsCard() {
  const events = state.snapshot.events ?? []
  const counts = eventCounts()
  const kinds = ['inject', 'compaction', 'model', 'rewind', 'mcp', 'mode', 'prune'].filter((kind) => counts[kind] > 0)
  const head = h('div', { class: 'zc-event-filters' })
  const activeKinds = () => kinds.filter((kind) => state.eventKinds.has(kind))
  head.append(
    h('button', {
      type: 'button',
      class: 'zc-kindchip' + (activeKinds().length === kinds.length ? ' is-active' : ''),
      onclick: () => { state.eventKinds = new Set(kinds); render() },
    }, state.t('events.all')),
  )
  for (const kind of kinds) {
    head.append(
      h('button', {
        type: 'button',
        class: 'zc-kindchip' + (state.eventKinds.has(kind) ? ' is-active' : ''),
        onclick: () => {
          const active = activeKinds()
          if (active.length === kinds.length) state.eventKinds = new Set([kind])
          else if (state.eventKinds.has(kind)) {
            if (active.length === 1) state.eventKinds = new Set(kinds)
            else state.eventKinds.delete(kind)
          } else state.eventKinds.add(kind)
          render()
        },
      }, state.t('events.' + kind), h('b', null, counts[kind])),
    )
  }
  const filtered = events.filter((event) => state.eventKinds.has(event.kind)).slice().reverse()
  const shown = state.eventsAll ? filtered : filtered.slice(0, 12)
  const list = h('div', { class: 'zc-events' })
  if (filtered.length === 0) list.append(h('div', { class: 'zc-empty' }, events.length ? state.t('events.noneMatch') : state.t('events.empty')))
  for (const event of shown) list.append(renderEventRow(event))
  if (!state.eventsAll && filtered.length > 12) {
    list.append(h('button', { type: 'button', class: 'zc-morebtn', onclick: () => { state.eventsAll = true; render() } }, state.t('events.showAll', { n: filtered.length }), icon('down', 14)))
  } else if (state.eventsAll && filtered.length > 12) {
    list.append(h('button', { type: 'button', class: 'zc-morebtn', onclick: () => { state.eventsAll = false; render() } }, state.t('action.showLess')))
  }
  return card(state.t('events.title'), { className: 'zc-card-events', right: h('div', { class: 'zc-card-right' }, state.t('events.showAll', { n: filtered.length })), body: h('div', null, head, list) })
}

function renderEventRow(event) {
  const iconChar = event.kind === 'compaction' ? '✂' : event.kind === 'model' ? '⇄' : event.kind === 'rewind' ? '↶' : event.kind === 'mcp' ? '⚙' : event.kind === 'mode' ? '◐' : '↳'
  const title =
    event.kind === 'inject'
      ? event.name || state.t('form.' + (event.form ?? 'context'))
      : event.kind === 'compaction'
        ? state.t('events.trigger.' + (event.trigger === 'auto' ? 'auto' : 'manual')) + ' · ' + state.t('events.status.' + (event.status ?? 'unknown'))
        : event.kind === 'model'
          ? event.from + ' → ' + event.to
          : event.kind === 'rewind'
            ? state.t('events.rewindDetail')
            : event.kind === 'mcp'
              ? event.name || state.t('events.mcpDetail')
              : state.t('events.' + event.kind)
  const detail =
    event.kind === 'inject'
      ? event.text || state.t('events.injectDetail')
      : event.kind === 'compaction'
        ? (event.summarizedCount != null ? state.t('events.summarized', { n: event.summarizedCount, kept: event.keptCount ?? '—' }) : event.reason || state.t('events.compactionDetail'))
        : event.kind === 'model'
          ? state.t('events.modelDetail')
          : event.detail || ''
  const delta = event.delta != null ? h('span', { class: event.delta > 0 ? 'zc-pos' : 'zc-neg' }, (event.delta > 0 ? '+' : '') + formatTokens(event.delta)) : null
  return h(
    'button',
    { type: 'button', class: 'zc-eventrow', onclick: () => openEvent(event), title: detail },
    h('span', { class: 'zc-event-icon', dataset: { kind: event.kind } }, iconChar),
    h('span', { class: 'zc-event-main' },
      h('span', { class: 'zc-event-title' }, title, delta),
      h('span', { class: 'zc-event-detail' }, detail),
      h('span', { class: 'zc-event-meta' },
        event.step ? state.t('events.atStep', { step: event.step }) : null,
        h('span', null, clockTime(event.time)),
        event.kind === 'compaction' && event.preTokens != null ? h('span', null, formatTokens(event.preTokens) + ' → ' + formatTokens(event.postTokens)) : null,
        event.kind === 'inject' && event.tokens != null ? h('span', null, '≈' + formatTokens(event.tokens)) : null,
      ),
    ),
    h('span', { class: 'zc-event-go' }, icon('right', 14)),
  )
}

function fileEntries() {
  const detail = state.stepDetail?.files
  if (detail?.entries?.length) return detail.entries
  return state.snapshot.files?.entries ?? []
}

function fileSummary() {
  return state.stepDetail?.files ?? state.snapshot.files ?? { totals: {}, entries: [] }
}

function renderFilesCard() {
  const summary = fileSummary()
  const totals = summary.totals ?? {}
  const head = h('div', { class: 'zc-file-filters' })
  const kindSpec = [
    ['read', state.t('files.read'), totals.read?.files ?? 0],
    ['write', state.t('files.written'), totals.write?.files ?? 0],
    ['search', state.t('files.searched'), totals.search?.files ?? 0],
    ['image', state.t('files.images'), totals.image?.files ?? 0],
  ]
  head.append(h('button', {
    type: 'button',
    class: 'zc-kindchip' + (state.fileKinds.size === 4 ? ' is-active' : ''),
    onclick: () => { state.fileKinds = new Set(['read', 'write', 'search', 'image']); render() },
  }, state.t('files.all')))
  for (const [kind, label, count] of kindSpec) {
    head.append(h('button', {
      type: 'button',
      class: 'zc-kindchip' + (state.fileKinds.has(kind) ? ' is-active' : ''),
      dataset: { fileKind: kind },
      onclick: () => {
        if (state.fileKinds.size === 4) state.fileKinds = new Set([kind])
        else if (state.fileKinds.has(kind)) {
          if (state.fileKinds.size === 1) state.fileKinds = new Set(['read', 'write', 'search', 'image'])
          else state.fileKinds.delete(kind)
        } else state.fileKinds.add(kind)
        render()
      },
    }, label, h('b', null, count)))
  }
  head.append(
    h('label', { class: 'zc-search zc-search-small' }, icon('search', 14), h('input', {
      type: 'search',
      placeholder: state.t('files.search'),
      value: state.fileSearch,
      oninput: (event) => { state.fileSearch = event.target.value; render() },
    })),
    h('select', {
      class: 'zc-select zc-select-small',
      'aria-label': state.t('files.sort'),
      onchange: (event) => { state.fileSort = event.target.value; saveView(); render() },
    },
    ...[['count', state.t('files.sort.count')], ['latest', state.t('files.sort.latest')], ['path', state.t('files.sort.path')], ['name', state.t('files.sort.name')], ['added', state.t('files.sort.added')]].map(([value, label]) =>
      h('option', { value, selected: state.fileSort === value }, label),
    ),
    ),
  )
  let entries = fileEntries().filter((entry) => {
    if (!state.fileKinds.has('image') && entry.form === 'image') return false
    if (!state.fileKinds.has('read') && entry.reads) return false
    if (!state.fileKinds.has('write') && entry.writes) return false
    if (!state.fileKinds.has('search') && entry.searches) return false
    if (entry.form === 'image' && !state.fileKinds.has('image')) return false
    if (state.fileSearch && !entry.path.toLowerCase().includes(state.fileSearch.toLowerCase())) return false
    return true
  })
  entries = [...entries].sort((a, b) => {
    if (state.fileSort === 'path') return a.path.localeCompare(b.path)
    if (state.fileSort === 'name') return (a.path.split('/').pop() ?? '').localeCompare(b.path.split('/').pop() ?? '')
    if (state.fileSort === 'latest') return (b.latest ?? 0) - (a.latest ?? 0)
    if (state.fileSort === 'added') return (b.added ?? 0) - (a.added ?? 0)
    return (b.reads + b.writes + b.searches) - (a.reads + a.writes + a.searches)
  })
  const shown = state.filesAll ? entries : entries.slice(0, 12)
  const list = h('div', { class: 'zc-files' })
  if (entries.length === 0) list.append(h('div', { class: 'zc-empty' }, fileEntries().length ? state.t('files.noneMatch') : state.t('files.empty')))
  for (const entry of shown) list.append(renderFileRow(entry, summary))
  if (!state.filesAll && entries.length > 12) list.append(h('button', { type: 'button', class: 'zc-morebtn', onclick: () => { state.filesAll = true; render() } }, state.t('events.showAll', { n: entries.length }), icon('down', 14)))
  else if (state.filesAll && entries.length > 12) list.append(h('button', { type: 'button', class: 'zc-morebtn', onclick: () => { state.filesAll = false; render() } }, state.t('action.showLess')))
  return card(state.t('files.title'), {
    className: 'zc-card-files',
    subtitle: state.step ? state.t('files.subtitle', { step: state.step }) : null,
    body: h('div', { class: 'zc-files-body' }, head, list),
    right: null,
  })
}

function fileGlyph(entry) {
  if (entry.form === 'image') return h('span', { class: 'zc-fileglyph' }, '🖼')
  const name = entry.path.split('/').pop() ?? ''
  if (/\.(tsx?|jsx?|mjs|cjs)$/i.test(name)) return h('span', { class: 'zc-fileglyph zc-fileglyph-code' }, name.endsWith('x') && name.includes('t') ? 'TSX' : 'TS')
  if (/\.(py)$/i.test(name)) return h('span', { class: 'zc-fileglyph zc-fileglyph-code' }, 'PY')
  if (/\.(md|mdx)$/i.test(name)) return h('span', { class: 'zc-fileglyph' }, '📝')
  if (/\.(json|ya?ml|toml)$/i.test(name)) return h('span', { class: 'zc-fileglyph' }, '⚙')
  if (/package-lock|pnpm-lock/.test(name)) return h('span', { class: 'zc-fileglyph' }, '🔒')
  return h('span', { class: 'zc-fileglyph' }, '📄')
}

function renderFileRow(entry, summary) {
  const open = state.expandedFiles.has(entry.path)
  const detailEntry = state.stepDetail?.files?.entries?.find((candidate) => candidate.path === entry.path)
  const row = h('div', { class: 'zc-filerow' + (open ? ' is-open' : '') })
  const head = h(
    'button',
    {
      type: 'button',
      class: 'zc-filehead',
      onclick: () => {
        if (open) state.expandedFiles.delete(entry.path)
        else state.expandedFiles.add(entry.path)
        if (!state.stepDetail && state.step) loadStep(state.step)
        render()
      },
      title: entry.path,
    },
    fileGlyph(entry),
    h('span', { class: 'zc-filemain' },
      h('span', { class: 'zc-filepath' }, entry.path),
      h('span', { class: 'zc-filemeta' },
        entry.reads ? h('span', { class: 'zc-chip' }, state.t('files.read') + ' ' + entry.reads) : null,
        entry.writes ? h('span', { class: 'zc-chip' }, state.t('files.written') + ' ' + entry.writes) : null,
        entry.searches ? h('span', { class: 'zc-chip' }, state.t('files.searched') + ' ' + entry.searches) : null,
        entry.pattern ? h('span', { class: 'zc-chip zc-chip-soft' }, state.t('files.pattern')) : null,
        entry.added ? h('span', { class: 'zc-pos' }, state.t('files.added', { n: entry.added })) : null,
        entry.removed ? h('span', { class: 'zc-neg' }, state.t('files.removed', { n: entry.removed })) : null,
      ),
    ),
    h('span', { class: 'zc-fileops' }, Array.isArray(entry.ops) ? entry.ops.length : entry.ops ?? ''),
    icon(open ? 'down' : 'right', 14),
  )
  row.append(head)
  if (open) {
    const ops = detailEntry?.ops ?? []
    const body = h('div', { class: 'zc-fileops-body' })
    if (ops.length === 0) body.append(h('div', { class: 'zc-note' }, state.stepDetail ? state.t('files.opsTitle') : state.t('browser.loadFailed')))
    for (const op of ops.slice(0, 60)) {
      body.append(h('button', {
        type: 'button',
        class: 'zc-oprow',
        onclick: () => op.key && openElement(op.key, state.step),
        title: op.detail ?? op.tool,
      },
        h('span', { class: 'zc-opkind', dataset: { kind: op.kind } }, state.t('files.op' + (op.kind === 'read' ? 'Read' : op.kind === 'write' ? 'Write' : 'Search'))),
        h('span', { class: 'zc-optool' }, op.tool),
        h('span', { class: 'zc-optime' }, clockTime(op.time)),
        op.added ? h('span', { class: 'zc-pos' }, '+' + op.added) : null,
        op.removed ? h('span', { class: 'zc-neg' }, '−' + op.removed) : null,
        op.est ? h('span', { class: 'zc-chip zc-chip-soft' }, state.t('files.shellEstimate')) : null,
        h('span', { class: 'zc-opgo' }, icon('right', 12)),
      ))
    }
    if (ops.length > 60) body.append(h('div', { class: 'zc-note' }, '…'))
    body.append(h('div', { class: 'zc-file-actions' },
      button(state.t('action.copyPath'), { onClick: () => copyText(entry.path), class: 'zc-btn-tiny' }),
    ))
    row.append(body)
  }
  return row
}

/* ------------------------------------------------------------------------------------------------
 * Coverage card
 * ---------------------------------------------------------------------------------------------- */

function renderCoverageCard() {
  const coverage = state.snapshot.coverage ?? {}
  const warnings = coverage.warnings ?? []
  const body = h('div', { class: 'zc-coverage' })
  if (warnings.length === 0) body.append(h('div', { class: 'zc-good' }, icon('check', 15), state.t('coverage.good')))
  if (warnings.includes('retention-off')) body.append(h('div', { class: 'zc-note zc-note-warn' }, state.t('coverage.retentionOff')))
  if (warnings.includes('rollout-missing')) body.append(h('div', { class: 'zc-note zc-note-warn' }, state.t('coverage.rolloutMissing')))
  if (warnings.includes('header-estimated')) body.append(h('div', { class: 'zc-note' }, state.t('coverage.headerEstimated', { n: coverage.headerEstimated })))
  if (warnings.includes('header-missing')) body.append(h('div', { class: 'zc-note zc-note-warn' }, state.t('coverage.headerMissing', { n: coverage.headerMissing })))
  body.append(
    h('div', { class: 'zc-coverage-grid' },
      h('span', null, state.t('coverage.rollout', { value: state.t('coverage.rollout.' + (coverage.rollout ?? 'none')) })),
      h('span', null, state.t('coverage.retention', { value: coverage.fullRetention == null ? state.t('coverage.unknown') : coverage.fullRetention ? state.t('coverage.on') : state.t('coverage.off') })),
      h('span', null, state.t('coverage.headerExact', { n: coverage.headerExact ?? 0 })),
      h('span', null, state.t('coverage.headerApprox', { n: coverage.headerEstimated ?? 0 })),
    ),
  )
  body.append(h('div', { class: 'zc-note' }, state.t('coverage.learn')))
  return card(state.t('coverage.title'), { className: 'zc-card-coverage', body })
}

/* ------------------------------------------------------------------------------------------------
 * Fleet
 * ---------------------------------------------------------------------------------------------- */

function renderFleet() {
  const wrapper = h('div', { class: 'zc-fleet' })
  if (state.fleetLoading && !state.fleet) {
    wrapper.append(h('div', { class: 'zc-empty' }, state.t('app.tagline')))
    return wrapper
  }
  if (state.fleetError) {
    wrapper.append(h('div', { class: 'zc-inline-error' }, state.fleetError, button(state.t('action.retry'), { onClick: loadFleet, class: 'zc-btn-tiny' })))
    return wrapper
  }
  const fleet = state.fleet
  if (!fleet) return wrapper
  const bill = fleet.nodes.reduce((sum, node) => sum + (node.usage?.billed ?? 0), 0)
  const cost = fleet.nodes.some((node) => node.usage?.cost != null) ? fleet.nodes.reduce((sum, node) => sum + (node.usage?.cost ?? 0), 0) : null
  const running = fleet.nodes.filter((node) => node.running).length
  const kpis = h('div', { class: 'zc-fleet-kpis' },
    h('div', { class: 'zc-kpi' }, h('b', null, fleet.nodes.length), h('span', null, state.t('fleet.agents'))),
    h('div', { class: 'zc-kpi' }, h('b', null, running), h('span', null, state.t('fleet.running'))),
    h('div', { class: 'zc-kpi' }, h('b', null, formatTokens(bill)), h('span', null, state.t('fleet.billed'))),
    h('div', { class: 'zc-kpi' }, h('b', null, costText(cost)), h('span', null, state.t('fleet.cost'))),
  )
  wrapper.append(kpis)
  const tree = h('div', { class: 'zc-agent-tree' })
  const roots = fleet.nodes.filter((node) => !node.parentId || !fleet.nodes.some((candidate) => candidate.id === node.parentId))
  const byParent = new Map()
  for (const node of fleet.nodes) {
    if (!node.parentId) continue
    const list = byParent.get(node.parentId) ?? []
    list.push(node)
    byParent.set(node.parentId, list)
  }
  const emit = (node, depth) => {
    tree.append(renderAgentCard(node, depth))
    for (const child of byParent.get(node.id) ?? []) emit(child, depth + 1)
  }
  for (const root of roots) emit(root, 0)
  if (!roots.length) wrapper.append(h('div', { class: 'zc-empty' }, state.t('fleet.empty')))
  wrapper.append(tree)
  wrapper.append(h('div', { class: 'zc-note' }, state.t('fleet.noSwitch')))
  if (fleet.truncated) wrapper.append(h('div', { class: 'zc-note zc-note-warn' }, state.t('fleet.truncated', { n: fleet.nodes.length })))
  return wrapper
}

function renderAgentCard(node, depth) {
  const status = node.running ? 'running' : node.status ?? (node.calls ? 'completed' : 'idle')
  const role = node.role === 'self' ? state.t('fleet.self') : node.role === 'ancestor' ? state.t('fleet.ancestor') : node.role === 'sibling' ? state.t('fleet.sibling') : state.t('fleet.child')
  return h(
    'div',
    { class: 'zc-agent-node', style: { paddingLeft: depth * 16 + 'px' }, dataset: { role: node.role } },
    depth > 0 ? h('span', { class: 'zc-agent-rail', style: { left: (depth - 1) * 18 + 9 + 'px' } }) : null,
    h(
      'button',
      { type: 'button', class: 'zc-agent-card' + (node.id === state.snapshot.session.id ? ' is-self' : ''), onclick: () => openMember(node.id), title: state.t('fleet.open') },
      h('span', { class: 'zc-agent-status ' + status }, h('i', null), status === 'running' ? h('em', { class: 'zc-pulse' }) : null),
      h('span', { class: 'zc-agent-main' },
        h('span', { class: 'zc-agent-title' }, node.title || node.id),
        h('span', { class: 'zc-agent-meta' },
          h('span', { class: 'zc-chip' }, role),
          node.taskType ? h('span', { class: 'zc-chip zc-chip-soft' }, node.taskType) : null,
          node.model ? h('span', { class: 'zc-chip zc-chip-soft' }, node.model) : null,
          h('span', { class: 'zc-muted' }, state.t('fleet.calls', { n: node.calls ?? 0 })),
        ),
        h('span', { class: 'zc-agent-usage' },
          h('span', null, formatTokens(node.usage?.billed ?? 0)),
          h('span', { class: 'zc-muted' }, costText(node.usage?.cost)),
          node.cacheHitRate != null ? h('span', { class: 'zc-muted' }, state.t('stats.cacheHit') + ' ' + pct(node.cacheHitRate)) : null,
        ),
        node.contextPct != null
          ? h('span', { class: 'zc-agent-bar', title: state.t('fleet.context') + ' ' + pct(node.contextPct) },
              h('span', { class: 'zc-agent-bar-fill', style: { width: Math.min(100, node.contextPct) + '%' } }),
              h('em', null, pct(node.contextPct)),
            )
          : null,
      ),
      icon('right', 14),
    ),
  )
}

/* ------------------------------------------------------------------------------------------------
 * Insights
 * ---------------------------------------------------------------------------------------------- */

function renderInsights() {
  const wrapper = h('div', { class: 'zc-insights' })
  const controls = h('div', { class: 'zc-insights-controls' },
    h('div', { class: 'zc-segmented' },
      [['7d', state.t('insights.range.7d')], ['30d', state.t('insights.range.30d')], ['all', state.t('insights.range.all')]].map(([range, label]) =>
        h('button', {
          type: 'button',
          class: 'zc-segbtn' + (state.insightsRange === range ? ' is-active' : ''),
          onclick: () => {
            if (state.insightsRange === range) return
            state.insightsRange = range
            state.insights = null
            state.insightsDay = null
            saveView()
            loadInsights()
          },
        }, label),
      ),
    ),
    h('label', { class: 'zc-search zc-search-small' }, icon('search', 14), h('input', {
      type: 'search', placeholder: state.t('insights.search'), value: state.insightsSearch,
      oninput: (event) => { state.insightsSearch = event.target.value; render() },
    })),
    h('select', { class: 'zc-select zc-select-small', onchange: (event) => { state.insightsSort = event.target.value; render() } },
      h('option', { value: 'recent', selected: state.insightsSort === 'recent' }, state.t('insights.sort.recent')),
      h('option', { value: 'tokens', selected: state.insightsSort === 'tokens' }, state.t('insights.sort.tokens')),
      h('option', { value: 'context', selected: state.insightsSort === 'context' }, state.t('insights.sort.context')),
    ),
    h('select', { class: 'zc-select zc-select-small', onchange: (event) => { state.insightsGroup = event.target.value; render() } },
      h('option', { value: 'none', selected: state.insightsGroup === 'none' }, state.t('insights.group.none')),
      h('option', { value: 'workspace', selected: state.insightsGroup === 'workspace' }, state.t('insights.group.workspace')),
    ),
    iconButton('refresh', state.t('action.refresh'), () => { state.insights = null; state.insightsDay = null; loadInsights() }, 'zc-iconbtn-soft'),
  )
  wrapper.append(controls)
  if (state.insightsLoading && !state.insights) {
    wrapper.append(h('div', { class: 'zc-empty' }, state.t('app.tagline')))
    return wrapper
  }
  if (state.insightsError) {
    wrapper.append(h('div', { class: 'zc-inline-error' }, state.insightsError, button(state.t('action.retry'), { onClick: () => loadInsights(), class: 'zc-btn-tiny' })))
    return wrapper
  }
  const insights = state.insights
  if (!insights) return wrapper
  const kpi = insights.kpi
  wrapper.append(
    h('div', { class: 'zc-kpi-grid' },
      h('div', { class: 'zc-kpi' }, h('b', null, formatCount(kpi.sessions)), h('span', null, state.t('insights.sessions'))),
      h('div', { class: 'zc-kpi' }, h('b', null, formatTokens(kpi.billed)), h('span', null, state.t('insights.billed'))),
      h('div', { class: 'zc-kpi' }, h('b', null, costText(kpi.cost)), h('span', null, state.t('insights.cost'))),
      h('div', { class: 'zc-kpi' }, h('b', null, pct(kpi.cacheHitRate)), h('span', null, state.t('insights.cacheHit'))),
      h('div', { class: 'zc-kpi' }, h('b', null, formatCount(kpi.calls ?? 0)), h('span', null, state.t('insights.calls'))),
      h('div', { class: 'zc-kpi' }, h('b', null, pct(kpi.avgContextPct)), h('span', null, state.t('insights.context'))),
    ),
  )
  const grids = h('div', { class: 'zc-insight-grid' },
    card(state.t('insights.usage7'), { className: 'zc-card-mini', body: renderDailyChart(insights.daily) }),
    card(state.t('insights.heatmap'), { className: 'zc-card-mini', body: renderHeatmap(insights.daily) }),
    card(state.t('insights.tokenMix'), { className: 'zc-card-mini', body: renderTokenMix(insights) }),
    card(state.t('insights.composition'), {
      className: 'zc-card-mini',
      subtitle: insights.composition ? state.t('insights.compositionNote', { n: insights.compositionSessions }) : null,
      body: insights.composition
        ? renderCompositionDonut(insights.composition)
        : h('div', { class: 'zc-note' }, state.insightsCompositionLoading ? state.t('insights.compositionLoading') : state.t('common.none')),
    }),
  )
  wrapper.append(grids)
  const filtered = filterInsightsCards(insights.sessionCards)
  const cardsWrap = h('div', { class: 'zc-session-cards' })
  if (filtered.length === 0) cardsWrap.append(h('div', { class: 'zc-empty' }, insights.sessionCards.length ? state.t('insights.noneMatch') : state.t('insights.empty')))
  let lastGroup = null
  for (const cardData of filtered) {
    if (state.insightsGroup === 'workspace') {
      const group = cardData.directory
      if (group !== lastGroup) {
        cardsWrap.append(h('div', { class: 'zc-group-head' }, icon('folder', 14), group))
        lastGroup = group
      }
    }
    cardsWrap.append(renderSessionCard(cardData))
  }
  wrapper.append(cardsWrap)
  if (insights.sessionsTotal > insights.sessionCards.length) {
    wrapper.append(h('div', { class: 'zc-note' }, state.t('insights.truncated', { shown: insights.sessionCards.length, total: insights.sessionsTotal })))
  }
  wrapper.append(h('div', { class: 'zc-note' }, state.t('insights.coverage')))
  return wrapper
}

function filterInsightsCards(cards) {
  let list = [...cards]
  if (state.insightsDay) list = list.filter((card) => dateKey(card.latestAt ?? card.updatedAt) === state.insightsDay)
  const search = state.insightsSearch.trim().toLowerCase()
  if (search) list = list.filter((card) => [card.title, card.directory, card.model].some((value) => String(value ?? '').toLowerCase().includes(search)))
  if (state.insightsSort === 'tokens') list.sort((a, b) => (b.usage?.billed ?? 0) - (a.usage?.billed ?? 0))
  else if (state.insightsSort === 'context') list.sort((a, b) => (b.contextPct ?? 0) - (a.contextPct ?? 0))
  else list.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  return list
}

function renderDailyChart(daily) {
  if (!daily?.length) return h('div', { class: 'zc-empty' }, state.t('insights.empty'))
  const last = [...daily].slice(-7)
  const max = Math.max(1, ...last.map((day) => day.input + day.output))
  const chart = h('div', { class: 'zc-daily', title: state.t('insights.usage7Tip') })
  for (const day of last) {
    const total = (day.input ?? 0) + (day.output ?? 0)
    chart.append(
      h('div', { class: 'zc-daily-col', title: day.day + ' · ' + formatTokens(total) },
        h('span', { class: 'zc-daily-bar', style: { height: Math.max(2, (total / max) * 100) + '%' } }),
        h('span', { class: 'zc-daily-label' }, day.day.slice(5)),
        h('span', { class: 'zc-daily-cost' }, day.cost != null ? costText(day.cost) : ''),
      ),
    )
  }
  return chart
}

function renderHeatmap(daily) {
  const map = new Map((daily ?? []).map((day) => [day.day, day]))
  const days = []
  const today = new Date()
  for (let i = 55; i >= 0; i--) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
    const key = dateKey(date.getTime())
    days.push({ key, value: map.get(key), date })
  }
  const values = days.map((day) => (day.value?.input ?? 0) + (day.value?.output ?? 0))
  const max = Math.max(1, ...values)
  const grid = h('div', { class: 'zc-heatmap', title: state.t('insights.heatmapTip') })
  for (const day of days) {
    const total = (day.value?.input ?? 0) + (day.value?.output ?? 0)
    const level = total === 0 ? 0 : Math.max(1, Math.ceil((total / max) * 4))
    grid.append(h('button', {
      type: 'button',
      class: 'zc-heatcell' + (state.insightsDay === day.key ? ' is-selected' : ''),
      dataset: { level },
      title: day.key + ' · ' + formatTokens(total) + (day.value?.cost != null ? ' · ' + costText(day.value.cost) : ''),
      onclick: () => { state.insightsDay = state.insightsDay === day.key ? null : day.key; render() },
    }))
  }
  return h('div', { class: 'zc-heat-wrap' }, grid, state.insightsDay ? h('button', { type: 'button', class: 'zc-linkbtn', onclick: () => { state.insightsDay = null; render() } }, state.t('browser.clear')) : null)
}

function renderTokenMix(insights) {
  const kpi = insights.kpi
  const uncached = Math.max(0, (kpi.input ?? 0) - (kpi.cacheRead ?? 0))
  const parts = [
    { key: 'uncached', label: state.t('trend.prompt'), value: uncached, color: CAT_COLOR.user },
    { key: 'cacheRead', label: state.t('trend.cacheRead'), value: kpi.cacheRead ?? 0, color: CAT_COLOR.inject },
    { key: 'output', label: state.t('trend.output'), value: kpi.output ?? 0, color: CAT_COLOR.output },
  ].filter((part) => part.value > 0)
  if (!parts.length) return h('div', { class: 'zc-empty' }, state.t('tokens.empty'))
  return h('div', { class: 'zc-donut-row' }, renderDonut(parts, { size: 100, centerTop: formatTokens(kpi.billed), centerSub: state.t('insights.billed') }), renderSliceList(parts, kpi.billed))
}

function renderCompositionDonut(composition) {
  const parts = CATS.filter((cat) => (composition?.[cat] ?? 0) > 0).map((cat) => ({ key: cat, label: catLabel(cat), value: composition[cat], color: CAT_COLOR[cat] }))
  const total = parts.reduce((sum, part) => sum + part.value, 0)
  return h('div', { class: 'zc-donut-row' }, renderDonut(parts, { size: 100, centerTop: formatTokens(total), centerSub: state.t('current.title') }), renderSliceList(parts, total))
}

function renderSessionCard(cardData) {
  return h(
    'button',
    { type: 'button', class: 'zc-session-card', onclick: () => { state.detail = { kind: 'session', data: cardData }; render() }, title: cardData.title },
    h('span', { class: 'zc-session-top' },
      h('span', { class: 'zc-session-name' }, cardData.title || cardData.id),
      h('span', { class: 'zc-session-time' }, relativeTime(cardData.updatedAt)),
    ),
    h('span', { class: 'zc-session-dir' }, cardData.directory || state.t('common.none')),
    h('span', { class: 'zc-session-metrics' },
      h('b', null, formatTokens(cardData.usage?.billed ?? 0)),
      h('span', { class: 'zc-muted' }, costText(cardData.usage?.cost)),
      h('span', { class: 'zc-muted' }, cardData.cacheHitRate != null ? state.t('stats.cacheHit') + ' ' + pct(cardData.cacheHitRate) : ''),
      cardData.contextPct != null ? h('span', { class: 'zc-context-chip' }, pct(cardData.contextPct)) : null,
    ),
    cardData.contextPct != null
      ? h('span', { class: 'zc-session-bar' }, h('span', { style: { width: Math.min(100, cardData.contextPct) + '%' } }))
      : null,
    cardData.model ? h('span', { class: 'zc-session-model' }, cardData.model) : null,
  )
}

/* ------------------------------------------------------------------------------------------------
 * Drawers
 * ---------------------------------------------------------------------------------------------- */

function drawerShell(title, body, { subtitle = null, onBack = null, actions = null } = {}) {
  return h(
    'div',
    { class: 'zc-overlay', role: 'dialog', 'aria-modal': 'true', onclick: (event) => { if (event.target === event.currentTarget) closeDetail() } },
    h(
      'div',
      { class: 'zc-drawer' },
      h(
        'div',
        { class: 'zc-drawer-head' },
        h('div', { class: 'zc-drawer-titles' },
          onBack ? iconButton('left', state.t('action.back'), onBack, 'zc-iconbtn-soft') : null,
          h('div', null, h('h2', null, title), subtitle ? h('div', { class: 'zc-drawer-sub' }, subtitle) : null),
        ),
        h('div', { class: 'zc-drawer-actions' }, actions, iconButton('close', state.t('action.close'), closeDetail)),
      ),
      h('div', { class: 'zc-drawer-body' }, body),
    ),
  )
}

function renderDrawer() {
  const detail = state.detail
  if (!detail) return null
  if (detail.kind === 'element') return renderElementDrawer()
  if (detail.kind === 'event') return renderEventDrawer()
  if (detail.kind === 'about') return renderAboutDrawer()
  if (detail.kind === 'coverage') return renderCoverageDrawer()
  if (detail.kind === 'session') return renderSessionDrawer()
  return null
}

function renderElementDrawer() {
  const detail = state.detail
  const data = detail.data
  const title = data?.title || state.t('detail.title')
  const actions = data
    ? h('div', { class: 'zc-drawer-actionrow' },
        data.call ? button(state.t('action.raw'), { onClick: () => switchElementFormat(detail.format === 'raw' ? 'readable' : 'raw'), class: 'zc-btn-tiny' }) : null,
        button(state.t('action.copy'), { onClick: () => copyText(data.content ?? ''), class: 'zc-btn-tiny', icon: 'copy' }),
      )
    : null
  if (detail.loading) return drawerShell(title, h('div', { class: 'zc-empty' }, state.t('app.tagline')), { actions })
  if (detail.error) return drawerShell(title, h('div', { class: 'zc-inline-error' }, detail.error), { actions })
  const content = data.content ?? ''
  const body = h('div', { class: 'zc-element' })
  body.append(
    h('div', { class: 'zc-element-meta' },
      data.cat ? h('span', { class: 'zc-chip' }, catLabel(data.cat)) : null,
      data.kind ? h('span', { class: 'zc-chip zc-chip-soft' }, state.t('kind.' + data.kind)) : null,
      data.tool ? h('span', { class: 'zc-chip' }, data.tool) : null,
      data.status ? h('span', { class: 'zc-status-dot', dataset: { status: data.status } }) : null,
      data.totalChars != null ? h('span', { class: 'zc-muted' }, state.t('detail.chars', { n: formatCount(data.totalChars) })) : null,
      data.lines ? h('span', { class: 'zc-muted' }, state.t('detail.lines', { n: formatCount(data.lines) })) : null,
    ),
  )
  if (data.attachment) {
    body.append(
      h('div', { class: 'zc-attachment' },
        h('div', { class: 'zc-attachment-icon' }, '🖼'),
        h('div', null,
          h('b', null, data.attachment.mime ?? state.t('detail.attachment')),
          data.attachment.width && data.attachment.height ? h('span', null, state.t('detail.dimensions', { w: data.attachment.width, h: data.attachment.height })) : null,
          data.attachment.bytes ? h('span', null, formatBytes(data.attachment.bytes)) : null,
          h('span', { class: 'zc-muted' }, state.t('detail.artifact')),
        ),
      ),
    )
  }
  if (data.call) {
    body.append(
      h('div', { class: 'zc-element-section' },
        h('h3', null, state.t('detail.arguments')),
        data.call.fields?.length
          ? h('table', { class: 'zc-argtable' }, h('tbody', null, data.call.fields.map((field) =>
              h('tr', null, h('th', null, field.name), h('td', null, h('pre', { class: 'zc-argvalue' }, field.value + (field.truncated ? '…' : '')))),
            )))
          : h('div', { class: 'zc-note' }, state.t('detail.noArgs')),
      ),
    )
  }
  body.append(
    h('div', { class: 'zc-element-section' },
      h('div', { class: 'zc-element-sectionhead' },
        h('h3', null, data.call ? state.t('detail.result') : data.title || state.t('detail.title')),
        h('label', { class: 'zc-search zc-search-small' }, icon('search', 13), h('input', {
          type: 'search', placeholder: state.t('detail.find'), value: detail.find ?? '',
          oninput: (event) => { state.detail = { ...detail, find: event.target.value }; render() },
        })),
      ),
      data.find && content
        ? h('div', { class: 'zc-note' }, findCountText(content, data.find))
        : null,
      content
        ? detail.format === 'readable' && (data.markdown || data.kind === 'text' || data.kind === 'answer')
          ? h('div', { class: 'zc-markdown' }, renderMarkdown(content, detail.find))
          : h('pre', { class: 'zc-pre' }, renderHighlighted(content, detail.find))
        : h('div', { class: 'zc-note' }, data.call ? state.t('detail.noResult') : state.t('detail.noArgs')),
      data.truncated
        ? h('div', { class: 'zc-loadmore' },
            h('span', null, state.t('detail.truncated', { shown: formatCount(content.length), total: formatCount(data.totalChars) })),
            button(state.t('detail.loadMore'), { onClick: loadMoreElement, class: 'zc-btn-tiny', icon: 'down' }),
          )
        : null,
      h('div', { class: 'zc-note' }, state.t('detail.safe')),
    ),
  )
  return drawerShell(title, body, {
    subtitle: data.totalChars != null ? state.t('detail.chars', { n: formatCount(data.totalChars) }) : null,
    actions,
  })
}

function renderEventDrawer() {
  const detail = state.detail
  const event = detail.event
  const data = detail.data
  const info = data?.event ?? event
  const title = state.t('events.compactionDetail')
  const actions = h('div', { class: 'zc-drawer-actionrow' },
    event.step ? button(state.t('events.openStep'), { onClick: () => { closeDetail(); selectStep(event.step, { pin: false }) }, class: 'zc-btn-tiny', icon: 'arrow' }) : null,
    event.step ? button(state.t('events.beforeAfter'), {
      onClick: () => {
        state.baselineMode = 'step'
        state.browserMode = 'changes'
        closeDetail()
        selectStep(event.step, { pin: false })
      },
      class: 'zc-btn-tiny',
    }) : null,
  )
  if (detail.loading) return drawerShell(title, h('div', { class: 'zc-empty' }, state.t('app.tagline')), { actions })
  if (detail.error) return drawerShell(title, h('div', { class: 'zc-inline-error' }, detail.error), { actions })
  const body = h('div', { class: 'zc-event-detail' })
  body.append(
    h('div', { class: 'zc-event-summary' },
      h('div', { class: 'zc-event-stat' }, h('b', null, formatTokens(event.preTokens)), h('span', null, state.t('events.before'))),
      h('div', { class: 'zc-event-stat' }, h('b', null, formatTokens(event.postTokens)), h('span', null, state.t('events.after'))),
      h('div', { class: 'zc-event-stat' }, h('b', null, event.summarizedCount ?? '—'), h('span', null, state.t('events.messages'))),
      h('div', { class: 'zc-event-stat' }, h('b', null, formatDuration(event.durationMs)), h('span', null, state.t('events.duration'))),
    ),
    h('div', { class: 'zc-note' }, [info.trigger ? state.t('events.trigger.' + (info.trigger === 'auto' ? 'auto' : 'manual')) : null, info.reason, info.phase].filter(Boolean).join(' · ')),
  )
  if (!data?.messages?.length) {
    body.append(h('div', { class: 'zc-empty' }, state.t('events.summarizedEmpty')))
  } else {
    body.append(h('div', { class: 'zc-event-messages' }, data.messages.map((message) => renderSummarizedMessage(message))))
    if (data.nextOffset != null) {
      body.append(h('div', { class: 'zc-loadmore' },
        h('span', null, state.t('events.messages') + ' ' + data.offset + ' / ' + data.total),
        button(state.t('detail.loadMore'), { onClick: loadMoreEvent, class: 'zc-btn-tiny', icon: 'down' }),
      ))
    }
  }
  return drawerShell(title, body, { subtitle: clockTime(event.time), actions })
}

function renderSummarizedMessage(message) {
  const row = h('div', { class: 'zc-summary-message' })
  row.append(
    h('div', { class: 'zc-summary-head' },
      h('span', { class: 'zc-chip' }, message.role),
      message.kind ? h('span', { class: 'zc-chip zc-chip-soft' }, message.kind) : null,
      h('span', { class: 'zc-muted' }, '#' + message.sequence),
      h('span', { class: 'zc-muted' }, clockTime(message.time)),
    ),
  )
  for (const part of message.parts ?? []) {
    const text = part.text || part.outputPreview || part.inputSample || part.summary || ''
    row.append(
      h('button', {
        type: 'button',
        class: 'zc-summary-part',
        onclick: () => openElement(part.id ? 'p:' + part.id + (part.type === 'tool' ? ':result' : '') : null, state.step),
        disabled: !part.id,
        title: text,
      },
        h('span', { class: 'zc-chip zc-chip-soft' }, part.type + (part.tool ? ' · ' + part.tool : '')),
        h('span', { class: 'zc-summary-text' }, text || '—'),
      ),
    )
  }
  if (message.summary) row.append(h('pre', { class: 'zc-pre zc-pre-small' }, message.summary))
  return row
}

function renderAboutDrawer() {
  const snapshot = state.snapshot
  const body = h('div', { class: 'zc-about' })
  body.append(
    h('p', null, state.t('about.body')),
    h('div', { class: 'zc-about-grid' },
      h('span', null, state.t('about.author')), h('b', null, 'bowenliang123'),
      h('span', null, state.t('about.license')), h('b', null, 'Apache-2.0'),
      h('span', null, state.t('about.storage')), h('code', null, state.t('about.storageValue')),
      h('span', null, state.t('about.workspace')), h('code', null, snapshot?.session?.directory ?? state.t('common.none')),
      h('span', null, state.t('settings.version')), h('b', null, VERSION),
    ),
    h('div', { class: 'zc-note' }, state.t('about.credits')),
    h('div', { class: 'zc-note' }, state.t('about.privacy')),
  )
  return drawerShell(state.t('about.title'), body)
}

function renderCoverageDrawer() {
  const coverage = state.snapshot.coverage
  const body = h('div', { class: 'zc-about' },
    h('div', { class: 'zc-about-grid' },
      h('span', null, state.t('coverage.messages')), h('b', null, state.t('common.yes')),
      h('span', null, state.t('coverage.rollout', { value: state.t('coverage.rollout.' + (coverage.rollout ?? 'none')) })),
      h('b', null, coverage.headerExact + ' exact / ' + coverage.headerEstimated + ' approximated / ' + coverage.headerMissing + ' missing'),
      h('span', null, state.t('coverage.retention', { value: coverage.fullRetention == null ? state.t('coverage.unknown') : coverage.fullRetention ? state.t('coverage.on') : state.t('coverage.off') })),
      h('b', null, 'modelIoFullRetentionEnabled'),
    ),
    h('div', { class: 'zc-note' }, state.t('coverage.learn')),
  )
  return drawerShell(state.t('coverage.details'), body)
}

function renderSessionDrawer() {
  const cardData = state.detail?.data
  if (!cardData) return null
  const body = h('div', { class: 'zc-about' },
    h('div', { class: 'zc-about-grid' },
      h('span', null, 'ID'), h('code', null, cardData.id),
      h('span', null, state.t('fleet.cost')), h('b', null, costText(cardData.usage?.cost ?? cardData.cost)),
      h('span', null, state.t('insights.billed')), h('b', null, formatTokens(cardData.usage?.billed ?? cardData.billed)),
      h('span', null, state.t('fleet.context')), h('b', null, pct(cardData.contextPct)),
      h('span', null, state.t('settings.dataRoot')), h('code', null, cardData.directory ?? ''),
    ),
    h('div', { class: 'zc-note' }, state.t('insights.openNote')),
  )
  return drawerShell(cardData.title || cardData.id, body, { subtitle: state.t('insights.card.updated', { time: relativeTime(cardData.updatedAt) }) })
}

function renderMember() {
  const member = state.member
  if (!member) return null
  if (member.loading) return drawerShell(state.t('fleet.open'), h('div', { class: 'zc-empty' }, state.t('app.tagline')), { onBack: () => { state.member = null; render() } })
  if (member.error) return drawerShell(state.t('fleet.open'), h('div', { class: 'zc-inline-error' }, member.error), { onBack: () => { state.member = null; render() } })
  const data = member.data
  const body = h('div', { class: 'zc-member' })
  body.append(
    h('div', { class: 'zc-element-meta' },
      h('span', { class: 'zc-chip' }, data.session.taskType ?? state.t('fleet.child')),
      data.latest?.model ? h('span', { class: 'zc-chip zc-chip-soft' }, data.latest.model) : null,
      data.latest?.status ? h('span', { class: 'zc-status-dot', dataset: { status: data.latest.status } }) : null,
    ),
    h('div', { class: 'zc-about-grid' },
      h('span', null, state.t('fleet.billed')), h('b', null, formatTokens(data.usage?.billed ?? 0)),
      h('span', null, state.t('fleet.cost')), h('b', null, costText(data.usage?.cost)),
      h('span', null, state.t('fleet.context')), h('b', null, pct(data.latest?.contextPct)),
      h('span', null, state.t('fleet.calls', { n: data.usage?.calls ?? 0 })), h('b', null, formatDuration(data.latest?.durationMs)),
      h('span', null, state.t('settings.dataRoot')), h('code', null, data.session.directory ?? ''),
    ),
    data.preview?.initialPrompt
      ? h('div', { class: 'zc-element-section' }, h('h3', null, state.t('fleet.prompt')), h('pre', { class: 'zc-pre zc-pre-small' }, data.preview.initialPrompt))
      : null,
    data.preview?.lastReply?.text
      ? h('div', { class: 'zc-element-section' }, h('h3', null, state.t('fleet.lastReply')), h('pre', { class: 'zc-pre zc-pre-small' }, data.preview.lastReply.text))
      : null,
    data.children?.length
      ? h('div', { class: 'zc-element-section' }, h('h3', null, state.t('fleet.children')), data.children.map((child) => h('div', { class: 'zc-note' }, child.title)))
      : null,
    h('div', { class: 'zc-note' }, state.t('fleet.noSwitch')),
  )
  return drawerShell(data.session.title || data.session.id, body, { subtitle: state.t('fleet.open'), onBack: () => { state.member = null; render() } })
}

/* ------------------------------------------------------------------------------------------------
 * Settings
 * ---------------------------------------------------------------------------------------------- */

function renderSettings() {
  const draft = state.settingsDraft ?? { ...state.prefs }
  const current = () => state.settingsDraft ?? draft
  const field = (label, control) => h('label', { class: 'zc-settings-row' }, h('span', { class: 'zc-settings-label' }, label), control)
  const select = (key, values) => h('select', {
    class: 'zc-select',
    onchange: (event) => { state.settingsDraft = { ...current(), [key]: event.target.value } },
  }, values.map(([value, label]) => h('option', { value, selected: current()[key] === value }, label)))
  const number = (key) => h('input', {
    class: 'zc-input',
    type: 'number',
    min: 0,
    step: 1000,
    value: current()[key] ?? 0,
    oninput: (event) => { state.settingsDraft = { ...current(), [key]: Number(event.target.value) || 0 } },
  })
  const checkbox = (key) => h('input', {
    type: 'checkbox',
    checked: current()[key] === true,
    onchange: (event) => { state.settingsDraft = { ...current(), [key]: event.target.checked } },
  })
  const body = h(
    'div',
    { class: 'zc-settings' },
    field(state.t('settings.defaultView'), h('select', { class: 'zc-select', onchange: (event) => { state.settingsDraft = { ...current(), defaultView: event.target.value } } },
      [['context', state.t('tab.context')], ['fleet', state.t('tab.fleet')], ['insights', state.t('tab.insights')]].map(([value, label]) =>
        h('option', { value, selected: draft.defaultView === value }, label),
      ),
    )),
    field(state.t('settings.granularity'), select('granularity', [['step', state.t('settings.step')], ['turn', state.t('settings.turn')]])),
    field(state.t('settings.trendMode'), select('trendMode', [['total', state.t('settings.total')], ['delta', state.t('settings.delta')]])),
    field(state.t('settings.deltaBase'), select('deltaBase', [['step', state.t('settings.step')], ['turn', state.t('settings.turn')]])),
    field(state.t('settings.durationCurve'), checkbox('durationCurve')),
    field(state.t('settings.fileSort'), select('fileSort', [['count', state.t('settings.count')], ['latest', state.t('settings.latest')], ['path', state.t('settings.path')], ['name', state.t('settings.name')], ['added', state.t('settings.added')]])),
    field(state.t('settings.toolSort'), select('toolSort', [['size', state.t('settings.size')], ['count', state.t('settings.count')], ['name', state.t('settings.name')]])),
    field(state.t('settings.currency'), select('currency', [['auto', state.t('settings.auto')], ['usd', state.t('settings.usd')], ['cny', state.t('settings.cny')]])),
    field(state.t('settings.language'), select('language', [['auto', state.t('settings.auto')], ['en', state.t('settings.en')], ['zh', state.t('settings.zh')]])),
    field(state.t('settings.contextWindow'), h('div', null, number('contextWindow'), h('small', { class: 'zc-hint' }, state.t('settings.contextWindowHint')))),
    field(state.t('settings.compactCards'), checkbox('compactCards')),
    h('div', { class: 'zc-settings-actions' },
      button(state.t('action.save'), { onClick: saveSettings, class: 'zc-btn-primary', icon: 'check' }),
      button(state.t('action.reset'), { onClick: () => { state.settingsDraft = { ...defaultPrefs() }; render() }, class: 'zc-btn-tiny' }),
    ),
    h('div', { class: 'zc-note' }, state.t('settings.openSettingsHint')),
    h('div', { class: 'zc-note' }, state.t('coverage.learn')),
  )
  return drawerShell(state.t('settings.title'), body, { onBack: () => { state.settingsOpen = false; render() } })
}

function defaultPrefs() {
  return {
    defaultView: 'context',
    granularity: 'step',
    trendMode: 'total',
    deltaBase: 'step',
    durationCurve: true,
    fileSort: 'count',
    toolSort: 'size',
    currency: 'auto',
    language: 'auto',
    contextWindow: 0,
    compactCards: false,
  }
}

async function saveSettings() {
  try {
    const prefs = await call('set_context_preferences', { patch: state.settingsDraft ?? {} })
    state.prefs = prefs
    state.settingsOpen = false
    applyPreferences(prefs)
    showToast(state.t('settings.saved'))
    await refresh({ silent: true })
  } catch (error) {
    showToast(error?.message ?? state.t('settings.saveFailed'))
  }
}

/* ------------------------------------------------------------------------------------------------
 * Markdown / find helpers
 * ---------------------------------------------------------------------------------------------- */

function inlineNodes(text) {
  const frag = document.createDocumentFragment()
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let last = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) frag.append(document.createTextNode(text.slice(last, match.index)))
    const token = match[0]
    if (token.startsWith('**')) frag.append(h('strong', null, token.slice(2, -2)))
    else frag.append(h('code', null, token.slice(1, -1)))
    last = match.index + token.length
  }
  if (last < text.length) frag.append(document.createTextNode(text.slice(last)))
  return frag
}

function renderMarkdown(text, find = '') {
  const wrap = document.createDocumentFragment()
  const lines = String(text ?? '').split('\n')
  let code = null
  let list = null
  const flushList = () => {
    if (list) {
      wrap.append(list)
      list = null
    }
  }
  for (const line of lines) {
    if (code !== null) {
      if (line.trim().startsWith('```')) {
        wrap.append(h('pre', { class: 'zc-code' }, code.join('\n')))
        code = null
      } else code.push(line)
      continue
    }
    if (line.trim().startsWith('```')) {
      flushList()
      code = []
      continue
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/)
    if (heading) {
      flushList()
      wrap.append(h('h' + Math.min(5, heading[1].length + 2), null, inlineNodes(heading[2])))
      continue
    }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/)
    if (bullet) {
      if (!list) list = h('ul')
      list.append(h('li', null, inlineNodes(bullet[1])))
      continue
    }
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (numbered) {
      if (!list) list = h('ol')
      list.append(h('li', null, inlineNodes(numbered[1])))
      continue
    }
    flushList()
    if (line.trim() === '') continue
    wrap.append(h('p', null, inlineNodes(line)))
  }
  if (code !== null) wrap.append(h('pre', { class: 'zc-code' }, code.join('\n')))
  flushList()
  if (find) {
    const holder = h('div')
    holder.append(wrap)
    return h('div', null, renderHighlighted(holder.innerText, find))
  }
  return wrap
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function findCountText(text, find) {
  if (!find) return ''
  const matches = String(text).toLowerCase().split(String(find).toLowerCase()).length - 1
  return matches > 0 ? state.t('detail.findCount', { n: matches }) : state.t('detail.findNone')
}

function renderHighlighted(text, find) {
  if (!find) return document.createTextNode(String(text ?? ''))
  const frag = document.createDocumentFragment()
  const pattern = new RegExp(escapeRegExp(find), 'gi')
  let last = 0
  for (const match of String(text).matchAll(pattern)) {
    if (match.index > last) frag.append(document.createTextNode(String(text).slice(last, match.index)))
    frag.append(h('mark', null, match[0]))
    last = match.index + match[0].length
  }
  if (last < String(text).length) frag.append(document.createTextNode(String(text).slice(last)))
  return frag
}

/* ------------------------------------------------------------------------------------------------
 * Keyboard and boot
 * ---------------------------------------------------------------------------------------------- */

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (state.settingsOpen) {
      state.settingsOpen = false
      render()
    } else if (state.detail || state.member) {
      state.detail = null
      state.member = null
      render()
    }
    return
  }
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return
  if (state.tab !== 'context') return
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    const step = selectedStep()
    if (!step) return
    event.preventDefault()
    selectStep(event.key === 'ArrowLeft' ? Math.max(1, step - 1) : Math.min(state.snapshot.requestsTotal ?? step, step + 1))
  }
})

window.addEventListener('visibilitychange', () => {
  if (!document.hidden) refresh({ silent: true })
  schedulePoll()
})

function renderToast(text) {
  return h('div', { class: 'zc-toast' }, text)
}

async function boot() {
  applyHost()
  if (PREVIEW) {
    state.lang = String(PREVIEW.locale ?? navigator.language ?? 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en'
    state.t = makeT(state.lang)
    transport = true
    await refresh()
    return
  }
  try {
    app = new App(
      { name: 'zcode-context-insight', version: VERSION },
      { availableDisplayModes: ['inline', 'fullscreen'] },
    )
    app.onhostcontextchanged = () => {
      // Host context change notifications carry only the changed fields; the SDK has already
      // merged them into its own snapshot, so re-read that instead of replacing ours.
      hostContext = app.getHostContext?.() ?? hostContext
      applyHost()
      render()
    }
    await app.connect()
    hostContext = app.getHostContext?.() ?? null
    applyHost()
    transport = true
    await refresh()
  } catch (error) {
    state.loading = false
    state.error = new UiError('offline', state.t('error.offline') + ' ' + (error?.message ?? ''))
    render()
  }
}

function fatal(error) {
  console.error('[zcode-context-insight] fatal', error)
  state.loading = false
  state.error = new UiError('client_error', String(error?.stack ?? error?.message ?? error))
  try {
    render()
  } catch (renderError) {
    root.textContent = 'Context panel failed to render: ' + String(renderError?.message ?? renderError)
  }
}

boot().catch(fatal)
