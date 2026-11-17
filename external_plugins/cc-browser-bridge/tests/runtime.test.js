// Apache-2.0. Isolated package checks: node --test tests/runtime.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const WebSocket = require('../server/vendor/ws');
const launcher = require('../server/launcher');
const onboard = require('../server/onboard');
const root = path.resolve(__dirname, '..');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-bridge-package-'));
let port;

function env(extra = {}) {
  const result = { ...process.env, BROWSER_BRIDGE_HOME: home, ONBOARD_SHELL_DISABLED: '1', ...extra };
  delete result.BRIDGE_URL;
  return result;
}
function run(entry, extra, messages = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, entry)], {
      env: env(extra), stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => { child.kill(); reject(new Error('package process exceeded deadline')); }, 20000);
    child.on('error', reject);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    for (const message of messages) child.stdin.write(JSON.stringify(message) + '\n');
    child.stdin.end();
  });
}
function request(method, route, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: route,
      headers: { 'Content-Type': 'application/json' } }, (response) => {
      let data = '';
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

test.before(async () => {
  const reservation = http.createServer();
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
});
test.after(() => {
  try {
    const state = JSON.parse(fs.readFileSync(path.join(home, 'state', `bridge-${port}.pid`), 'utf8'));
    process.kill(state.pid, 'SIGTERM');
  } catch (_) {}
});

test('published package resolves its vendored dependency and plugin layout', () => {
  assert.equal(require('../server/vendor/ws/package.json').version, '8.22.0');
  assert.equal(onboard.resolveLayout(path.join(root, 'server')).mode, 'plugin');
  assert.equal(onboard.VERSION, require('../.zcode-plugin/plugin.json').version);
});

test('stdio initialize and tool discovery use pure JSON-RPC without launching a browser', async () => {
  const result = await run('server/mcp-stdio.js', { BB_AUTO_ENSURE: '0', BRIDGE_PORT: String(port) }, [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  ]);
  assert.equal(result.code, 0);
  const messages = result.stdout.trim().split('\n').map(JSON.parse);
  assert.equal(messages.find((m) => m.id === 1).result.serverInfo.name, 'cc-browser-bridge');
  assert.equal(messages.find((m) => m.id === 2).result.tools.length, 15);
});

test('launcher starts the packaged bridge and copies complete extension assets into an isolated home', async () => {
  const result = await launcher.ensureReady({ home, port, layoutRoot: root, noOnboarding: true, env: env() });
  assert.equal(result.ok, true, result.reason);
  assert.equal((await request('GET', '/status')).ok, true);
  for (const file of ['manifest.json', 'background.js', 'popup.js', 'icons/icon128.png']) {
    assert.ok(fs.statSync(path.join(home, 'extension', file)).isFile());
  }
});

test('packaged MCP tool calls reach an isolated extension through the vendored WebSocket server', async () => {
  const extension = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
    origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  });
  extension.on('message', (data) => {
    const message = JSON.parse(String(data));
    if (message.id && message.tool === 'tabs') extension.send(JSON.stringify({
      type: 'result', id: message.id, ok: true,
      result: { tabs: [{ tab_id: 7, title: 'Fixture', url: 'https://example.com/', active: true }] },
    }));
  });
  await new Promise((resolve, reject) => { extension.once('open', resolve); extension.once('error', reject); });
  try {
    const result = await run('server/mcp-stdio.js', { BB_AUTO_ENSURE: '0', BRIDGE_PORT: String(port) }, [
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'browser_tabs', arguments: { action: 'list' } } },
    ]);
    assert.equal(result.code, 0);
    const reply = JSON.parse(result.stdout.trim());
    assert.notEqual(reply.result.isError, true);
    assert.match(reply.result.content[0].text, /Fixture/);
    assert.equal((await request('GET', '/status')).ok, true, 'bridge survives the stdio client');
  } finally { extension.close(); }
});

test('ZCODE_PLUGIN_ROOT SessionStart reuses the bridge and suppresses an already shown guide', async () => {
  const stateFile = path.join(home, 'state', 'onboard-complete.json');
  const shown = { autoOpenedAt: '2026-10-25T00:00:00.000Z', version: '0.0.1' };
  fs.writeFileSync(stateFile, JSON.stringify(shown));
  const result = await run('hooks/session-start.js', { ZCODE_PLUGIN_ROOT: root, BRIDGE_PORT: String(port) });
  assert.equal(result.code, 0);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /rootVia=ZCODE_PLUGIN_ROOT/);
  assert.match(result.stderr, /onboarding=skipped:complete/);
  assert.deepEqual(JSON.parse(fs.readFileSync(stateFile, 'utf8')), shown);
  assert.equal(fs.readdirSync(path.join(home, 'state')).some((name) => name.startsWith('onboard-session-')), false);
});
