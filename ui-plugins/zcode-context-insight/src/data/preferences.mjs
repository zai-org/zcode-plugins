import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const DEFAULT_PREFERENCES = Object.freeze({
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
  priceFile: '',
  showEstimatedResidual: true,
  compactCards: false,
})

const ENUMS = {
  defaultView: ['context', 'fleet', 'insights'],
  granularity: ['step', 'turn'],
  trendMode: ['total', 'delta'],
  deltaBase: ['step', 'turn'],
  fileSort: ['count', 'latest', 'path', 'name', 'added'],
  toolSort: ['size', 'count', 'name'],
  currency: ['auto', 'usd', 'cny'],
  language: ['auto', 'en', 'zh'],
}

export function preferencesPath(paths) {
  return join(paths.pluginDataDir, 'preferences.json')
}

function normalize(input) {
  const out = { ...DEFAULT_PREFERENCES }
  if (!input || typeof input !== 'object') return out
  for (const [key, allowed] of Object.entries(ENUMS)) {
    if (typeof input[key] === 'string' && allowed.includes(input[key])) out[key] = input[key]
  }
  if (typeof input.durationCurve === 'boolean') out.durationCurve = input.durationCurve
  if (typeof input.showEstimatedResidual === 'boolean') out.showEstimatedResidual = input.showEstimatedResidual
  if (typeof input.compactCards === 'boolean') out.compactCards = input.compactCards
  if (Number.isFinite(Number(input.contextWindow)) && Number(input.contextWindow) >= 0) {
    out.contextWindow = Math.floor(Number(input.contextWindow))
  }
  if (typeof input.priceFile === 'string') out.priceFile = input.priceFile.trim()
  return out
}

export function readPreferences(paths) {
  let stored = null
  try {
    stored = JSON.parse(readFileSync(preferencesPath(paths), 'utf8'))
  } catch {}
  const prefs = normalize(stored)
  if (paths.windowOverride > 0) prefs.contextWindow = paths.windowOverride
  if (paths.priceFile) prefs.priceFile = paths.priceFile
  return prefs
}

export function writePreferences(paths, patch) {
  const current = readPreferences(paths)
  const next = normalize({ ...current, ...(patch && typeof patch === 'object' ? patch : {}) })
  mkdirSync(paths.pluginDataDir, { recursive: true })
  const file = preferencesPath(paths)
  const temp = file + '.' + process.pid + '.tmp'
  writeFileSync(temp, JSON.stringify(next, null, 2) + '\n', 'utf8')
  renameSync(temp, file)
  return next
}
