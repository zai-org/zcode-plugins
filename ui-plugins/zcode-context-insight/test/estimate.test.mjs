import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canonical,
  contentKey,
  estimateImageTokens,
  estimateSystemContent,
  estimateTokens,
  formatCost,
  formatDuration,
  formatTokens,
} from '../src/shared/estimate.mjs'

test('token estimator separates ASCII, CJK and other scripts', () => {
  assert.equal(estimateTokens('abcd'), 1)
  assert.equal(estimateTokens('你好你好'), 3)
  assert.ok(estimateTokens('你好你好') > estimateTokens('abcdefgh'))
  assert.equal(estimateTokens(''), 0)
})

test('canonical JSON is stable and cache keys are not content', () => {
  assert.equal(canonical({ b: 1, a: [2, undefined] }), '{"a":[2,null],"b":1}')
  assert.equal(
    contentKey({ role: 'user', content: 'x', cache_control: { type: 'ephemeral' } }),
    contentKey({ content: 'x', role: 'user' }),
  )
})

test('image calculator is bounded and deterministic', () => {
  const a = estimateImageTokens(900, 482)
  assert.ok(a > 0 && a <= 384)
  assert.equal(a, estimateImageTokens(900, 482))
  assert.equal(estimateImageTokens(0, 100), null)
})

test('system content prices text blocks', () => {
  assert.ok(estimateSystemContent([{ type: 'text', text: 'hello world' }]) >= 4)
  assert.equal(estimateSystemContent(null), 0)
})

test('display formatters stay compact', () => {
  assert.equal(formatTokens(1500), '1.5k')
  assert.equal(formatTokens(2_000_000), '2M')
  assert.equal(formatDuration(2500), '2.5s')
  assert.equal(formatDuration(65_000), '1m5s')
  assert.match(formatCost(0.0002, 'usd'), /^\$/)
  assert.match(formatCost(0.2, 'cny'), /^¥/)
})
