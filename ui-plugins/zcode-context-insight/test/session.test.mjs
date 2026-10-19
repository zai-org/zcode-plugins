import assert from 'node:assert/strict'
import test from 'node:test'
import { readSessionContext } from '../src/domain/session.mjs'
import { ContextError } from '../src/domain/errors.mjs'

test('session identity comes only from the host namespace', () => {
  assert.deepEqual(readSessionContext({ 'com.zcode/request-context': { session_id: 'sess_abc-1' } }), {
    sessionId: 'sess_abc-1',
  })
  for (const meta of [undefined, null, {}, { 'com.zcode/request-context': {} }, { 'com.zcode/request-context': { session_id: '../x' } }]) {
    assert.throws(() => readSessionContext(meta), (error) => error instanceof ContextError && error.code === 'binding_unavailable')
  }
})
