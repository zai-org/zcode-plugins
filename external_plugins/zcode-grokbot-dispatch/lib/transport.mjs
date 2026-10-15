/**
 * The only place zcode-dispatch talks to other agents. Three operations:
 *   send(target, {project, text, timeoutSeconds, jobId?})  -> {id, peer, output}
 *   respond(job, payload)                                   -> {method}   (push a finished job's result)
 *   status(target, id)                                      -> remote job / request status
 *
 * Two implementations, picked by `transport` (env ZCODE_DISPATCH_TRANSPORT > config.json > "direct"):
 *   direct (default): plain HTTP + shared Bearer key; config.json
 *       "peers": { "dsh": { "url": "http://host:7790", "keyFile": "~/.config/zcode-dispatch/dsh.key" } }
 *     send -> POST <url>/v1/jobs, status -> GET <url>/v1/jobs/<id>,
 *     respond -> POST JSON to callback_url or <peers[callback_peer].url>/v1/callbacks.
 *   yobiru (opt-in, "transport": "yobiru"): the Yobiru / tailmsg CLI, argv identical to v0.2.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readConfigFile, resolveNetConfig } from './netconfig.mjs';

export const expandHome = (p) => (typeof p === 'string' && p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p);

export function transportName(env = process.env, file = readConfigFile()) {
  const t = env.ZCODE_DISPATCH_TRANSPORT || file.transport || 'direct';
  if (t !== 'direct' && t !== 'yobiru') throw new Error(`transport must be "direct" or "yobiru" (got ${JSON.stringify(t)})`);
  return t;
}

/** Find an executable on PATH (absolute/relative paths are checked directly). */
export function which(name, pathStr = process.env.PATH) {
  if (!name) return null;
  const ok = (f) => { try { fs.accessSync(f, fs.constants.X_OK); return fs.statSync(f).isFile(); } catch { return false; } };
  if (name.includes('/')) return ok(name) ? name : null;
  for (const d of String(pathStr || '').split(path.delimiter).filter(Boolean)) { const f = path.join(d, name); if (ok(f)) return f; }
  return null;
}

// ---------------------------------------------------------------- yobiru (tailmsg CLI)

/** Newest installed Yobiru plugin CLI (a pinned version path broke on the 0.5.0 -> 0.5.1 upgrade). */
export function yobiruBin(env = process.env, home = os.homedir()) {
  if (env.YOBIRU_BIN) return env.YOBIRU_BIN;
  const base = path.join(home, '.codex', 'plugins', 'cache', 'yobiru', 'yobiru');
  let vers = [];
  try { vers = fs.readdirSync(base).filter(v => fs.existsSync(path.join(base, v, 'scripts', 'yobiru'))); } catch {}
  const key = v => v.split('.').map(n => Number.parseInt(n, 10) || 0);
  vers.sort((a, b) => { const x = key(a), y = key(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; });
  return vers.length ? path.join(base, vers.at(-1), 'scripts', 'yobiru') : path.join(base, 'MISSING', 'scripts', 'yobiru');
}

/** Run Yobiru / tailmsg CLI with automatic binary resolution (unchanged from v0.2). */
export function runYobiru(args, env = process.env) {
  const home = env.TAILMSG_HOME || path.join(os.homedir(), '.tailmsg');
  const bin = env.YOBIRU_BIN;
  if (bin && fs.existsSync(bin)) return execFileSync('/bin/sh', [bin, '--home', home, ...args], { encoding: 'utf8', timeout: 15000, env });
  const tailmsgPy = path.join(home, 'tailmsg.py');
  if (fs.existsSync(tailmsgPy)) return execFileSync('python3', [tailmsgPy, '--home', home, ...args], { encoding: 'utf8', timeout: 15000, env });
  return execFileSync('/bin/sh', [yobiruBin({}, os.homedir()), '--home', home, ...args], { encoding: 'utf8', timeout: 15000, env });
}

const yobiru = {
  async send(target, { text, timeoutSeconds = 1800, run = runYobiru }) {
    if (target !== 'grok-bot') throw new Error(`yobiru transport only sends to grok-bot (got ${target})`);
    const peer = resolveNetConfig().grokPeer;
    if (!peer) throw new Error('Grok peer is not configured: set ZCODE_DISPATCH_GROK_PEER or "grokPeer" in ~/.config/zcode-dispatch/config.json');
    const out = run(['request', 'send', peer, text, '--as', 'zcode', '--wake', 'now', '--timeout-seconds', String(timeoutSeconds)]);
    return { id: /\b[0-9a-f]{16}\b/.exec(out)?.[0] ?? null, peer, output: out.trim().slice(0, 2000) };
  },
  // Yobiru results are pushed by hooks/stop-report.mjs (Grok) and the yobiru adapter (request respond).
  async respond() { return { method: null, error: 'yobiru: results are reported by the Stop hook / adapter' }; },
  async status(_t, id, { run = runYobiru } = {}) {
    const out = run(['request', 'status', id, '--refresh', '--json']);
    try { return JSON.parse(out); } catch { return { output: out.trim().slice(0, 4000) }; }
  },
};

// ---------------------------------------------------------------- direct (HTTP)

export function directPeers(file = readConfigFile()) {
  const peers = file.peers && typeof file.peers === 'object' ? file.peers : {};
  return Object.fromEntries(Object.entries(peers).filter(([, p]) => p && typeof p.url === 'string')
    .map(([n, p]) => [n, { url: p.url.replace(/\/+$/, ''), keyFile: expandHome(p.keyFile) }]));
}

/** A callback_url is accepted only if it points at a configured peer (whose key is then used). */
export function peerForUrl(url, peers = directPeers()) {
  if (typeof url !== 'string') return null;
  return Object.entries(peers).find(([, p]) => url === p.url || url.startsWith(`${p.url}/`))?.[0] ?? null;
}

async function httpJson(method, url, keyFile, body) {
  const key = fs.readFileSync(keyFile, 'utf8').trim();
  const res = await fetch(url, { method, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000),
    headers: { authorization: `Bearer ${key}`, ...(body ? { 'content-type': 'application/json' } : {}) } });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}: ${text.slice(0, 300)}`);
  return json;
}

const direct = {
  async send(target, { project, text, timeoutSeconds = 1800, jobId }) {
    const peer = directPeers()[target];
    if (!peer) throw new Error(`peer "${target}" is not configured: add peers.${target} {url, keyFile} to ~/.config/zcode-dispatch/config.json`);
    const f = readConfigFile();
    const body = { project, text, timeout_seconds: Number(timeoutSeconds), source: 'zcode', ...(jobId ? { job_id: jobId } : {}),
      ...(f.callbackUrl ? { callback_url: f.callbackUrl } : { callback_peer: f.selfName || 'zcode' }) };
    const j = await httpJson('POST', `${peer.url}/v1/jobs`, peer.keyFile, body);
    return { id: j?.id ?? jobId ?? null, peer: target, output: JSON.stringify(j).slice(0, 2000) };
  },
  async respond(job, payload) {
    const peers = directPeers();
    let name = job.callback_peer && peers[job.callback_peer] ? job.callback_peer : null;
    let url = name ? `${peers[name].url}/v1/callbacks` : null;
    if (job.callback_url) { name = peerForUrl(job.callback_url, peers); url = name ? job.callback_url : null; }
    if (!url) return { method: null, error: `no direct callback route (callback_peer=${job.callback_peer ?? ''} callback_url=${job.callback_url ?? ''})` };
    try { await httpJson('POST', url, peers[name].keyFile, payload); return { method: 'http-callback', peer: name }; }
    catch (e) { return { method: null, error: e.message }; }
  },
  async status(target, id) {
    const peer = directPeers()[target];
    if (!peer) throw new Error(`peer "${target}" is not configured`);
    return httpJson('GET', `${peer.url}/v1/jobs/${id}`, peer.keyFile);
  },
};

export const getTransport = () => (transportName() === 'yobiru' ? yobiru : direct);
export const send = (target, opts) => getTransport().send(target, opts);
export const respond = (job, payload) => direct.respond(job, payload); // HTTP callbacks are only ever direct
export const status = (target, id, opts) => getTransport().status(target, id, opts);
export const directSend = (target, opts) => direct.send(target, opts);
export const directStatus = (target, id) => direct.status(target, id);

/** Startup check for the selected transport: {transport, errors[], warnings[]}. */
export function checkTransport({ exists = fs.existsSync } = {}) {
  const errors = []; const warnings = [];
  let t; try { t = transportName(); } catch (e) { return { transport: null, errors: [e.message], warnings }; }
  if (t === 'yobiru') {
    const home = process.env.TAILMSG_HOME || path.join(os.homedir(), '.tailmsg');
    const bin = process.env.YOBIRU_BIN;
    if (!(bin && exists(bin)) && !exists(path.join(home, 'tailmsg.py')) && !exists(yobiruBin({}, os.homedir()))) errors.push(`yobiru: no Yobiru CLI (YOBIRU_BIN, ${home}/tailmsg.py, ~/.codex/plugins/cache/yobiru)`);
    if (!resolveNetConfig().grokPeer) warnings.push('yobiru: grokPeer not set; dispatch_to_grokbot / Grok reporting disabled');
  } else {
    const peers = directPeers();
    if (!Object.keys(peers).length) warnings.push('direct: no peers configured; outbound dispatch and callbacks disabled (inbound + polling still work)');
    for (const [n, p] of Object.entries(peers)) if (!p.keyFile || !exists(p.keyFile)) errors.push(`direct: peers.${n}.keyFile missing (${p.keyFile ?? 'unset'})`);
  }
  return { transport: t, errors, warnings };
}
