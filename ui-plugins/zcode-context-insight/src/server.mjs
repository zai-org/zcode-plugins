/**
 * stdio MCP server for the zcode-context-insight panel.
 *
 * The host binds every call to a session through `_meta["com.zcode/request-context"]`; the panel is
 * generic HTML and obtains the bound session by calling an app-only tool. Reads run in a worker so
 * a large session can never block the MCP protocol channel.
 */

import { readFile } from 'node:fs/promises'
import { Worker } from 'node:worker_threads'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { resolvePaths } from './data/paths.mjs'
import { ContextError } from './domain/errors.mjs'
import { readSessionContext } from './domain/session.mjs'

const RESOURCE_URI = 'ui://zcode-context-insight/context.html'
const VERSION = '0.1.0'
const READ_TIMEOUT_MS = 30_000

class Reader {
  constructor() {
    this.worker = null
    this.pending = new Map()
    this.sequence = 0
  }

  start() {
    if (this.worker) return this.worker
    const worker = new Worker(new URL('./worker.mjs', import.meta.url), {
      workerData: { paths: resolvePaths() },
      resourceLimits: { maxOldGenerationSizeMb: 512 },
    })
    worker.on('message', (message) => {
      if (this.worker !== worker) return
      const job = this.pending.get(message.id)
      if (!job) return
      this.pending.delete(message.id)
      clearTimeout(job.timer)
      job.signal?.removeEventListener('abort', job.abort)
      if (message.error) job.reject(new ContextError(message.error.code ?? 'read_failed', message.error.message ?? 'Read failed.'))
      else job.resolve(message.result)
    })
    const fail = (error) => {
      if (this.worker !== worker) return
      this.worker = null
      for (const job of this.pending.values()) {
        clearTimeout(job.timer)
        job.reject(new ContextError('worker_unavailable', 'The context data worker stopped.'))
      }
      this.pending.clear()
      if (error) console.error('[zcode-context-insight] worker error', error)
    }
    worker.on('error', fail)
    worker.on('exit', () => fail(null))
    this.worker = worker
    return worker
  }

  async run(method, sessionId, args, signal) {
    if (signal?.aborted) throw new ContextError('cancelled', 'Read cancelled.')
    const worker = this.start()
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const abort = () => {
        const job = this.pending.get(id)
        if (!job) return
        this.pending.delete(id)
        clearTimeout(job.timer)
        if (this.worker === worker) worker.postMessage({ cancel: id })
        reject(new ContextError('cancelled', 'Read cancelled.'))
      }
      const timer = setTimeout(() => {
        const job = this.pending.get(id)
        if (!job) return
        this.pending.delete(id)
        if (this.worker === worker) worker.postMessage({ cancel: id })
        reject(new ContextError('read_timeout', 'The context read took too long.'))
      }, READ_TIMEOUT_MS)
      signal?.addEventListener('abort', abort, { once: true })
      this.pending.set(id, { resolve, reject, timer, signal, abort })
      worker.postMessage({ id, method, sessionId, args })
    })
  }

  async close() {
    const worker = this.worker
    this.worker = null
    for (const job of this.pending.values()) {
      clearTimeout(job.timer)
      job.reject(new ContextError('worker_unavailable', 'The context data worker stopped.'))
    }
    this.pending.clear()
    await worker?.terminate()
  }
}

const reader = new Reader()

function wrap(method, { requiresSession = true } = {}) {
  return async (args, extra) => {
    try {
      const sessionId = requiresSession ? readSessionContext(extra?._meta)?.sessionId ?? null : null
      const result = await reader.run(method, sessionId, args ?? {}, extra?.signal)
      return { content: [], structuredContent: result }
    } catch (error) {
      const contextError = error instanceof ContextError ? error : new ContextError('read_failed', 'Context data is unavailable.')
      if (!(error instanceof ContextError)) console.error('[zcode-context-insight]', method, error)
      return {
        isError: true,
        content: [{ type: 'text', text: contextError.message }],
        structuredContent: { error: { code: contextError.code, message: contextError.message } },
      }
    }
  }
}

const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
const appOnly = (description, inputSchema) => ({
  description,
  inputSchema,
  annotations,
  _meta: { ui: { visibility: ['app'] } },
})

export function createServer() {
  const server = new McpServer(
    { name: 'zcode-context-insight', version: VERSION },
    {
      instructions:
        'Read-only local context insights for a ZCode session. Prefer the Context panel in the session side pane; get_context_report returns a compact text report for the current session.',
    },
  )

  server.registerResource(
    'context_panel',
    RESOURCE_URI,
    {
      mimeType: 'text/html;profile=mcp-app',
      _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } },
    },
    async () => ({
      contents: [
        {
          uri: RESOURCE_URI,
          mimeType: 'text/html;profile=mcp-app',
          text: await readFile(new URL('./context.html', import.meta.url), 'utf8'),
        },
      ],
    }),
  )

  const locale = z.string().max(24).optional()

  server.registerTool(
    'get_context_snapshot',
    appOnly('App-only: the bound session summary, compact request trend, current composition, events and file activity.', {
      locale,
    }),
    wrap('snapshot'),
  )

  server.registerTool(
    'get_context_history',
    appOnly('App-only: earlier compact request rows for the bound session.', {
      beforeStep: z.number().int().min(0).max(1_000_000).optional(),
      limit: z.number().int().min(1).max(260).optional(),
      locale,
    }),
    wrap('history'),
  )

  server.registerTool(
    'get_context_step',
    appOnly('App-only: category groups, diff, step brief, DNA order and files for one recorded request.', {
      step: z.number().int().min(1).max(1_000_000),
      baselineMode: z.enum(['step', 'turn']).optional(),
      search: z.string().max(200).optional(),
      sort: z.enum(['size', 'order', 'name', 'calls']).optional(),
      locale,
    }),
    wrap('step'),
  )

  server.registerTool(
    'get_context_group',
    appOnly('App-only: one category page for a request, with search and sorting.', {
      step: z.number().int().min(1).max(1_000_000),
      cat: z.enum(['system', 'tools', 'user', 'inject', 'skill', 'assistant', 'tool', 'unknown']),
      offset: z.number().int().min(0).max(1_000_000).optional(),
      limit: z.number().int().min(1).max(60).optional(),
      search: z.string().max(200).optional(),
      sort: z.enum(['size', 'order', 'name', 'calls']).optional(),
      locale,
    }),
    wrap('group'),
  )

  server.registerTool(
    'get_context_dna',
    appOnly('App-only: the flattened prompt-order element list for one request.', {
      step: z.number().int().min(1).max(1_000_000),
      offset: z.number().int().min(0).max(1_000_000).optional(),
      limit: z.number().int().min(1).max(200).optional(),
      locale,
    }),
    wrap('dna'),
  )

  server.registerTool(
    'get_context_dna_series',
    appOnly('App-only: compact per-request DNA band series for the trend bars.', {
      fromStep: z.number().int().min(1).max(1_000_000).optional(),
      toStep: z.number().int().min(1).max(1_000_000).optional(),
      maxBands: z.number().int().min(8).max(80).optional(),
      locale,
    }),
    wrap('dnaSeries'),
  )

  server.registerTool(
    'get_context_element',
    appOnly('App-only: full content of one context element, chunked.', {
      step: z.number().int().min(1).max(1_000_000),
      key: z.string().min(1).max(300),
      format: z.enum(['readable', 'raw']).optional(),
      offset: z.number().int().min(0).max(100_000_000).optional(),
      limit: z.number().int().min(1).max(24_000).optional(),
      locale,
    }),
    wrap('element'),
  )

  server.registerTool(
    'get_context_event',
    appOnly('App-only: the summarized messages behind a compaction event.', {
      eventId: z.string().min(1).max(300),
      offset: z.number().int().min(0).max(100_000).optional(),
      limit: z.number().int().min(1).max(20).optional(),
      locale,
    }),
    wrap('eventDetail'),
  )

  server.registerTool(
    'get_context_fleet',
    appOnly('App-only: the current agent family tree, usage and status.', { locale }),
    wrap('fleet'),
  )

  server.registerTool(
    'get_context_fleet_member',
    appOnly('App-only: detail for one agent in the current family.', {
      targetId: z.string().min(1).max(300),
      locale,
    }),
    wrap('fleetMember'),
  )

  server.registerTool(
    'get_context_insights',
    appOnly('App-only: cross-session usage, daily activity, session cards and aggregate composition.', {
      range: z.enum(['7d', '30d', 'all']).optional(),
      includeComposition: z.boolean().optional(),
      locale,
    }),
    wrap('insights'),
  )

  server.registerTool(
    'get_context_preferences',
    appOnly('App-only: this plugin\'s persisted display preferences.', {}),
    wrap('preferencesGet'),
  )

  server.registerTool(
    'set_context_preferences',
    {
      description: 'App-only: persist this plugin\'s display preferences.',
      inputSchema: { patch: z.record(z.string(), z.unknown()) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: { ui: { visibility: ['app'] } },
    },
    wrap('preferencesSet'),
  )

  server.registerTool(
    'get_context_report',
    {
      description:
        'Read-only: a compact context report for the current ZCode session (current prompt composition, session counts, recent injections/compactions, coverage). Use when the user asks what is in the context window or types /context.',
      inputSchema: {},
      annotations,
      _meta: { ui: { visibility: ['model', 'app'] } },
    },
    async (args, extra) => {
      try {
        const { sessionId } = readSessionContext(extra?._meta)
        const result = await reader.run('report', sessionId, {}, extra?.signal)
        return {
          content: [{ type: 'text', text: result.text }],
          structuredContent: result,
        }
      } catch (error) {
        const contextError = error instanceof ContextError ? error : new ContextError('read_failed', 'Context data is unavailable.')
        if (!(error instanceof ContextError)) console.error('[zcode-context-insight] report', error)
        return { isError: true, content: [{ type: 'text', text: contextError.message }] }
      }
    },
  )

  return server
}

const server = createServer()
await server.connect(new StdioServerTransport())

let closing = false
async function shutdown() {
  if (closing) return
  closing = true
  setTimeout(() => process.exit(0), 2000).unref()
  await server.close().catch(() => {})
  await reader.close().catch(() => {})
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.stdin.once('end', shutdown)
process.stdin.once('close', shutdown)
