import { createInterface } from 'node:readline';

// A JSONL stdio adapter for this service's stateless JSON Streamable HTTP.
// No shell, credential files, redirects, model calls, or background collection.
export async function runBridge({ url, tokenName, input = process.stdin, output = process.stdout, error = process.stderr }) {
  const token = process.env[tokenName];
  if (!token || /[\r\n]/.test(token)) {
    error.write(`Set ${tokenName} in the environment before starting the host. Never paste a key in chat.\n`);
    return 1;
  }
  let protocol;
  const active = new Set();
  const send = value => output.write(JSON.stringify(value) + '\n');
  const fail = (id, message, code = -32000) => send({ jsonrpc: '2.0', id, error: { code, message } });
  const lines = createInterface({ input, crlfDelay: Infinity });
  const forward = async line => {
    let message;
    try { message = JSON.parse(line); } catch { fail(null, 'Invalid JSON', -32700); return; }
    if (!message || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      fail(null, 'Invalid JSON-RPC request', -32600); return;
    }
    const request = Object.hasOwn(message, 'id');
    if (Buffer.byteLength(line) > 65536) {
      if (request) fail(message.id, 'Request exceeds the service size limit');
      return;
    }
    try {
      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
      if (protocol) headers['MCP-Protocol-Version'] = protocol;
      const response = await fetch(url, { method: 'POST', headers, body: line, redirect: 'error', signal: AbortSignal.timeout(120000) });
      if (!response.ok) {
        await response.body?.cancel();
        if (request) fail(message.id, response.status === 401 ? 'Authentication required: check the configured service API key.' : `Procurement service returned HTTP ${response.status}.`);
        return;
      }
      if (!request || response.status === 202 || response.status === 204) {
        await response.body?.cancel();
        if (request) fail(message.id, 'Expected a JSON-RPC response from the service.');
        return;
      }
      if (!response.headers.get('content-type')?.includes('application/json')) {
        await response.body?.cancel();
        fail(message.id, 'The service must return stateless JSON; SSE responses are not supported by this adapter.');
        return;
      }
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 16 * 1024 * 1024) { await reader.cancel(); throw new Error('response limit'); }
        chunks.push(value);
      }
      const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (result.jsonrpc !== '2.0' || result.id !== message.id || (!Object.hasOwn(result, 'result') && !Object.hasOwn(result, 'error'))) throw new Error('invalid response');
      if (message.method === 'initialize' && result.result?.protocolVersion) protocol = result.result.protocolVersion;
      send(result);
    } catch {
      // Transport exceptions and response bodies may contain credentials or private data.
      if (request) fail(message.id, 'Procurement connection failed. Check connectivity and service configuration.');
    }
  };
  for await (const line of lines) {
    if (!line.trim()) continue;
    const work = forward(line);
    active.add(work);
    work.finally(() => active.delete(work));
  }
  await Promise.allSettled(active);
  return 0;
}
