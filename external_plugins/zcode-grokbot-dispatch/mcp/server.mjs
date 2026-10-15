#!/usr/bin/env node
/** Minimal stdio MCP server (JSON-RPC 2.0, newline-delimited): dispatch_to_grokbot, dispatch_to_dsh, dispatch_status. */
import readline from 'node:readline';
import { toGrokBot, toDsh, status } from '../lib/dispatch.mjs';

const proj = { project: { type: 'string', description: 'Folder name under the projects root (default ~/Projects); the text is tagged [Project: <project>] for routing' },
  text: { type: 'string', description: 'Task text. May already start with [Project: <project>]' },
  timeout_seconds: { type: 'integer', minimum: 10, maximum: 7200 } };
const TOOLS = [
  { name: 'dispatch_to_grokbot', description: 'Send a task to Grok Bot (peer "grok-bot": direct HTTP, or Yobiru grokPeer when transport is yobiru); returns the request/job id.', inputSchema: { type: 'object', properties: proj, required: ['text'] }, run: toGrokBot },
  { name: 'dispatch_to_dsh', description: 'Hand a task to DeepSeek Harness: over HTTP to peers.dsh (any machine) or a local headless dsh; returns a job id.', inputSchema: { type: 'object', properties: proj, required: ['text'] }, run: toDsh },
  { name: 'dispatch_status', description: 'Status/result of a DSH job id, remote request/job id, or ZCode session_id (sess_...) mapped to a dispatched job.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, run: status },
];
const write = (m) => process.stdout.write(JSON.stringify(m) + '\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  if (id === undefined) return; // notification
  const ok = (result) => write({ jsonrpc: '2.0', id, result });
  if (method === 'initialize') return ok({ protocolVersion: params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'zcode-dispatch', version: '0.3.0' } });
  if (method === 'ping') return ok({});
  if (method === 'tools/list') return ok({ tools: TOOLS.map(({ run, ...t }) => t) });
  if (method === 'tools/call') {
    const tool = TOOLS.find(t => t.name === params?.name);
    if (!tool) return write({ jsonrpc: '2.0', id, error: { code: -32602, message: 'unknown tool' } });
    return Promise.resolve().then(() => tool.run(params.arguments || {}))
      .then((r) => ok({ content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] }))
      .catch((e) => ok({ isError: true, content: [{ type: 'text', text: String(e.message || e) }] }));
  }
  write({ jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found' } });
});
