import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

function env(name) {
  const value = process.env[name]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : ''
}

export function homeDir() {
  return env('HOME') || homedir()
}

/**
 * Resolve every local path the plugin reads. Everything is read-only; the only writable directory
 * is `pluginDataDir`, used for the user's view preferences.
 */
export function resolvePaths(overrides = {}) {
  const home = homeDir()
  const dataRoot = resolve(overrides.dataRoot || env('ZCODE_CONTEXT_DATA_ROOT') || join(home, '.zcode', 'cli'))
  const dbPath = resolve(overrides.dbPath || env('ZCODE_CONTEXT_DB_PATH') || join(dataRoot, 'db', 'db.sqlite'))
  const parent = resolve(dataRoot, '..')
  const settingCandidates = [
    env('ZCODE_CONTEXT_SETTING_PATH'),
    join(parent, 'v2', 'setting.json'),
    join(dataRoot, 'setting.json'),
    join(home, '.zcode', 'v2', 'setting.json'),
  ].filter(Boolean)
  const providerCandidates = [
    env('ZCODE_CONTEXT_PROVIDER_CONFIG'),
    join(parent, 'v2', 'provider_config.json'),
    join(dataRoot, 'provider_config.json'),
    join(home, '.zcode', 'v2', 'provider_config.json'),
  ].filter(Boolean)
  const pluginDataDir =
    env('ZCODE_PLUGIN_DATA') || env('ZCODE_CONTEXT_PLUGIN_DATA') || join(home, '.zcode', 'zcode-context-insight')
  return {
    home,
    dataRoot,
    dbPath,
    rolloutDirs: [join(dataRoot, 'rollout'), join(dataRoot, 'debug')],
    logDir: join(dataRoot, 'log'),
    settingPath: settingCandidates.find((path) => existsSync(path)) ?? settingCandidates[0],
    providerConfigPath: providerCandidates.find((path) => existsSync(path)) ?? providerCandidates[0],
    pluginDataDir,
    priceFile: overrides.priceFile || env('ZCODE_CONTEXT_PRICE_FILE') || '',
    windowOverride: Number(overrides.contextWindow ?? env('ZCODE_CONTEXT_WINDOW') ?? 0) || 0,
  }
}
