import assert from 'node:assert/strict'
import test from 'node:test'
import { buildFileOps, fileActivity } from '../src/domain/files.mjs'
import { buildDnaSeries, buildSessionView, buildStepDetail } from '../src/domain/compose.mjs'

function message(id, sequence, role, kind, extra = {}) {
  return {
    id,
    sequence,
    time_created: 1000 + sequence * 100,
    time_updated: 1050 + sequence * 100,
    role,
    kind,
    origin: role === 'user' ? 'real_user' : 'agent_runtime',
    source: null,
    visibility: 'visible',
    synthetic: 0,
    summary_title: null,
    summary_chars: 0,
    summary_preview: null,
    metadata_source: null,
    ...extra,
  }
}

function part(id, messageId, sequence, fields) {
  return {
    id,
    message_id: messageId,
    sequence,
    time_created: 1000 + sequence * 100,
    time_updated: 1020 + sequence * 100,
    type: 'text',
    tool: null,
    call_id: null,
    status: null,
    tool_start: null,
    tool_end: null,
    text_chars: 0,
    text_preview: null,
    input_chars: 0,
    input_sample: null,
    output_chars: 0,
    output_preview: null,
    ...fields,
  }
}

function fixture() {
  const messages = [
    message('m1', 1, 'user', 'user_prompt'),
    message('m2', 2, 'user', 'system_reminder', { synthetic: 1, origin: 'agent_runtime', source: 'todo_reminder' }),
    message('m3', 3, 'assistant', 'assistant_response'),
    message('m4', 4, 'assistant', 'assistant_response'),
  ]
  const parts = [
    part('p1', 'm1', 1, { type: 'text', text_chars: 60, text_preview: 'Please inspect the context panel.' }),
    part('p2', 'm2', 2, { type: 'text', text_chars: 40, text_preview: 'The TodoWrite tool has not been used recently.' }),
    part('p3', 'm3', 3, { type: 'text', text_chars: 20, text_preview: 'I will read the file.' }),
    part('p4', 'm3', 4, {
      type: 'tool', tool: 'Read', call_id: 'call_read', status: 'completed', tool_start: 1200, tool_end: 1250,
      input_chars: 30, input_sample: '{"file_path":"src/a.ts"}', output_chars: 120, output_preview: '1\tconst a = 1',
      output_lines: 12, file_path: 'src/a.ts', read_path: 'src/a.ts', read_offset: 1,
    }),
    part('p5', 'm4', 5, {
      type: 'tool', tool: 'Edit', call_id: 'call_edit', status: 'completed', tool_start: 1300, tool_end: 1350,
      input_chars: 40, input_sample: '{"file_path":"src/a.ts"}', output_chars: 40, output_preview: 'updated',
      file_path: 'src/a.ts', additions: 3, deletions: 1,
    }),
    part('p6', 'm4', 6, {
      type: 'tool', tool: 'Bash', call_id: 'call_bash', status: 'completed', tool_start: 1350, tool_end: 1360,
      input_chars: 30, input_sample: '{"command":"cat src/a.ts"}', output_chars: 50, output_preview: 'const a = 1',
      command: 'cat src/a.ts',
    }),
  ]
  const messageMap = new Map(messages.map((entry) => [entry.id, entry]))
  const byMessage = new Map()
  for (const entry of parts) {
    const list = byMessage.get(entry.message_id) ?? []
    list.push(entry)
    byMessage.set(entry.message_id, list)
  }
  return { messages, parts, messageMap, byMessage, branch: null }
}

const session = {
  id: 'sess_test',
  title: 'Fixture session',
  directory: '/workspace',
  project_id: 'project',
  parent_id: null,
  task_type: 'interactive',
  time_created: 900,
  time_updated: 2000,
}

const usage = [
  {
    logical_request_id: 'logical-1', attempt_index: 0, assistant_message_id: 'm3', parent_user_message_id: 'm1',
    turn_id: 'turn_1', query_source: 'main_turn', provider_id: 'deepseek', model_id: 'deepseek-flash',
    status: 'completed', started_at: 1000, first_token_at: 1050, completed_at: 1800, duration_ms: 800,
    time_to_first_token_ms: 50, tool_call_count: 1, input_tokens: 400, output_tokens: 30, reasoning_tokens: 0,
    cache_creation_input_tokens: 0, cache_read_input_tokens: 100, computed_total_tokens: 430,
  },
  {
    logical_request_id: 'logical-2', attempt_index: 0, assistant_message_id: 'm4', parent_user_message_id: 'm1',
    turn_id: 'turn_1', query_source: 'main_turn', provider_id: 'deepseek', model_id: 'deepseek-flash',
    status: 'completed', started_at: 2000, first_token_at: 2050, completed_at: 2600, duration_ms: 600,
    time_to_first_token_ms: 50, tool_call_count: 2, input_tokens: 800, output_tokens: 40, reasoning_tokens: 0,
    cache_creation_input_tokens: 0, cache_read_input_tokens: 400, computed_total_tokens: 840,
  },
]

const rollout = {
  available: true,
  coverage: 'full',
  records: [
    {
      startedAt: 1000,
      turnId: 'turn_1',
      messagesKind: 'full',
      header: {
        system: [{ type: 'text', text: 'You are a fixture agent.' }],
        tools: [
          { type: 'function', function: { name: 'Read', description: 'Read a file', parameters: { type: 'object' } } },
          { type: 'function', function: { name: 'mcp__fixture__search', description: 'Search', parameters: { type: 'object' } } },
        ],
        maxOutputTokens: 8000,
      },
      usage: null,
    },
  ],
}

test('file operations derive from Read/Edit and conservative shell paths', () => {
  const conversation = fixture()
  const ops = buildFileOps(conversation)
  assert.deepEqual(ops.map((op) => [op.tool, op.path, op.kind]).sort(), [
    ['Bash', 'src/a.ts', 'read'],
    ['Edit', 'src/a.ts', 'write'],
    ['Read', 'src/a.ts', 'read'],
  ])
  const activity = fileActivity(conversation, null)
  assert.equal(activity.entries.length, 1)
  assert.equal(activity.totals.read.ops, 2)
  assert.equal(activity.totals.write.ops, 1)
  assert.equal(activity.totals.added, 3)
  assert.equal(activity.totals.removed, 1)
})

test('session view anchors composition to provider prompt tokens and builds a step brief', () => {
  const view = buildSessionView({
    session,
    usageRows: usage,
    toolRows: [
      { tool_name: 'Read', started_at: 1200, completed_at: 1250, duration_ms: 50, tool_call_id: 'call_read' },
      { tool_name: 'Edit', started_at: 1300, completed_at: 1350, duration_ms: 50, tool_call_id: 'call_edit' },
      { tool_name: 'Bash', started_at: 1350, completed_at: 1360, duration_ms: 10, tool_call_id: 'call_bash' },
    ],
    conversation: fixture(),
    rollout,
    preferences: { language: 'en', currency: 'usd', contextWindow: 0 },
    providerWindows: new Map([['deepseek/deepseek-flash', 100000]]),
    fullRetention: true,
    subagentStats: { count: 1, usage: { billed: 100 } },
  })
  assert.equal(view.stats.steps, 2)
  assert.equal(view.stats.turns, 1)
  assert.equal(view.stats.humanInputs, 1)
  assert.equal(view.stats.toolCalls, 3)
  assert.equal(view.current.prompt, 800)
  assert.equal(view.current.window, 100000)
  assert.ok(view.current.parts.system > 0)
  assert.ok(view.current.parts.tools > 0)
  assert.equal(
    Object.values(view.current.parts).reduce((sum, value) => sum + value, 0),
    view.current.prompt,
  )
  // The selected (latest) request's own tool calls are not yet part of its prompt.
  assert.equal(view.files.totals.read.ops, 1)
  assert.equal(view.files.totals.write.ops, 0)
  assert.equal(view.events.filter((event) => event.kind === 'inject').length, 1)
  assert.equal(view.stats.subagents.count, 1)

  const detail = buildStepDetail(view, 2, { baselineMode: 'step' })
  assert.equal(detail.step, 2)
  assert.ok(detail.groups.some((group) => group.cat === 'tool'))
  assert.ok(detail.groups.some((group) => group.cat === 'inject'))
  assert.ok(detail.diff.available)
  assert.ok(detail.brief.incoming.length >= 1)
  assert.ok(detail.dna.length > 0)
  assert.equal(detail.files.entries[0].path, 'src/a.ts')
})

test('payloads stay under the host budget for a modest session', () => {
  const view = buildSessionView({
    session,
    usageRows: usage,
    toolRows: [],
    conversation: fixture(),
    rollout,
    preferences: {},
    providerWindows: new Map(),
    fullRetention: false,
  })
  assert.ok(Buffer.byteLength(JSON.stringify(view.requests)) < 64 * 1024)
  assert.ok(Buffer.byteLength(JSON.stringify(view.current)) < 16 * 1024)
})


test('DNA series keeps one entry per request and compresses item bands', () => {
  const view = buildSessionView({
    session,
    usageRows: usage,
    toolRows: [],
    conversation: fixture(),
    rollout,
    preferences: {},
    providerWindows: new Map(),
    fullRetention: true,
  })
  const series = buildDnaSeries(view, { fromStep: 1, toStep: 2, maxBands: 8 })
  assert.equal(series.steps.length, 2)
  assert.ok(series.steps.every((entry) => entry.bands.length <= 8))
  assert.ok(series.steps[0].bands.length > 0)
  assert.equal(series.categories[0], 'system')
})
