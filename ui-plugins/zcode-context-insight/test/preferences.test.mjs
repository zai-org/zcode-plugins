import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DEFAULT_PREFERENCES, preferencesPath, readPreferences, writePreferences } from '../src/data/preferences.mjs'

test('preferences merge, validate enums and persist atomically', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zc-prefs-'))
  const paths = { pluginDataDir: dir, windowOverride: 0, priceFile: '' }
  try {
    assert.deepEqual(readPreferences(paths), { ...DEFAULT_PREFERENCES })
    const saved = writePreferences(paths, {
      defaultView: 'insights',
      granularity: 'turn',
      trendMode: 'nonsense',
      contextWindow: 256000,
      durationCurve: false,
    })
    assert.equal(saved.defaultView, 'insights')
    assert.equal(saved.granularity, 'turn')
    assert.equal(saved.trendMode, 'total')
    assert.equal(saved.contextWindow, 256000)
    assert.equal(saved.durationCurve, false)
    const disk = JSON.parse(readFileSync(preferencesPath(paths), 'utf8'))
    assert.equal(disk.defaultView, 'insights')
    assert.equal(readPreferences(paths).contextWindow, 256000)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
