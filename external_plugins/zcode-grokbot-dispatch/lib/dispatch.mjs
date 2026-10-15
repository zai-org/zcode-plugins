/**
 * Outbound dispatch from ZCode, through transport.mjs:
 *   toGrokBot -> peer "grok-bot" (direct HTTP by default; yobiru: request send to grokPeer).
 *   toDsh     -> "http" (POST to peers.dsh /v1/jobs, any machine) when peers.dsh is configured,
 *                else "local" (detached `dsh --profile headless` on this machine). Override: config "dshVia".
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JOB_ID_RE, defaultStateDir, loadMap } from './job-map.mjs';
import { denyProjectsRe, projectsRoot, readConfigFile, resolveNetConfig } from './netconfig.mjs';
import { directPeers, directSend, directStatus, expandHome, send, status as transportStatus, transportName, which } from './transport.mjs';

const HOME = os.homedir();
export const CFG = {
  get projectsRoot() { return projectsRoot(); },
  stateDir: path.join(HOME, '.local', 'state', 'zcode-dispatch', 'outgoing'),
  // env ZCODE_DISPATCH_GROK_PEER > ~/.config/zcode-dispatch/config.json "grokPeer" (netconfig.mjs); null = unset
  get grokPeer() { return resolveNetConfig().grokPeer; },
  // env DSH_BIN > config "dshBin" > `dsh` on PATH (null = not found)
  get dsh() { return which(expandHome(process.env.DSH_BIN || readConfigFile().dshBin || 'dsh')); },
  get dshVia() { const v = readConfigFile().dshVia; return v === 'http' || v === 'local' ? v : (directPeers().dsh ? 'http' : 'local'); },
  dshProfile: process.env.DSH_PROFILE || 'headless',
};
const TAG = /^\s*\[Project: ([^\]\n]+)\]/;
const PROJECT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Ensure text carries "[Project: X]" for project; returns {project, cwd, text}. */
export function route(project, text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('text required');
  const tag = TAG.exec(text)?.[1];
  project = project || tag;
  if (!project || !PROJECT.test(project) || denyProjectsRe().test(project)) throw new Error(`project "${project ?? ''}" refused: must be a plain folder name under the projects root, not matching denyProjects (default finance)`);
  if (tag && tag !== project) throw new Error(`text is tagged [Project: ${tag}] but project=${project}`);
  const cwd = path.join(CFG.projectsRoot, project);
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error(`no such project folder ${cwd}`);
  return { project, cwd, text: tag ? text : `[Project: ${project}] ${text}` };
}

export async function toGrokBot({ project, text, timeout_seconds = 1800 }) {
  const r = route(project, text);
  const out = await send('grok-bot', { project: r.project, text: r.text, timeoutSeconds: timeout_seconds });
  return { target: 'grok-bot', via: transportName(), project: r.project, request_id: out.id, output: out.output };
}

export async function toDsh({ project, text, timeout_seconds = 1800 }) {
  const r = route(project, text);
  fs.mkdirSync(CFG.stateDir, { recursive: true, mode: 0o700 });
  const id = randomBytes(8).toString('hex');
  const file = path.join(CFG.stateDir, `${id}.json`);
  const job = { id, target: 'dsh', via: CFG.dshVia, project: r.project, state: 'running', created_at: new Date().toISOString(), text_preview: r.text.slice(0, 200) };
  if (job.via === 'http') {
    // Cross-machine: DSH's own POST /v1/jobs; result comes back by callback (POST /v1/callbacks) or dispatch_status polling.
    await directSend('dsh', { project: r.project, text: r.text, timeoutSeconds: timeout_seconds, jobId: id });
    fs.writeFileSync(file, JSON.stringify(job, null, 2), { mode: 0o600 });
    return { target: 'dsh', via: 'http', project: r.project, job_id: id, state: 'running' };
  }
  if (!CFG.dsh) throw new Error('dsh not found: put dsh on PATH, set "dshBin" (or DSH_BIN), or configure peers.dsh for HTTP dispatch');
  fs.writeFileSync(file, JSON.stringify(job, null, 2), { mode: 0o600 });
  // Detached worker so the job outlives the MCP server / ZCode session.
  const child = spawn(process.execPath, [new URL('./dsh-worker.mjs', import.meta.url).pathname, file, r.cwd, r.text, String(timeout_seconds)],
    { detached: true, stdio: 'ignore', env: { ...process.env, DSH_BIN: CFG.dsh, DSH_PROFILE: CFG.dshProfile } });
  child.unref();
  return { target: 'dsh', via: 'local', project: r.project, job_id: id, state: 'running' };
}

export async function status({ id }) {
  const rootState = defaultStateDir();
  if (typeof id === 'string' && id.startsWith('sess_')) {
    const map = loadMap({ stateDir: rootState });
    const jid = map.sessions[id];
    const entry = jid ? map.jobs[jid] : null;
    let report = null;
    if (jid) {
      try { report = JSON.parse(fs.readFileSync(path.join(rootState, 'reports', `${jid}.json`), 'utf8')); } catch {}
    }
    return { session_id: id, job_id: jid || null, mapping: entry, report };
  }
  if (JOB_ID_RE.test(id || '')) {
    const f = path.join(CFG.stateDir, `${id}.json`);
    if (fs.existsSync(f)) {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      // HTTP-dispatched DSH job still running locally: ask DSH (pull), unless a callback already landed.
      if (j.via === 'http' && j.state === 'running') {
        try { const remote = await directStatus('dsh', id); return { ...j, state: remote?.state ?? j.state, result: remote?.result ?? null, error: remote?.error ?? null, remote }; }
        catch (e) { return { ...j, remote_error: e.message }; }
      }
      return j;
    }
    const map = loadMap({ stateDir: rootState });
    const repFile = path.join(rootState, 'reports', `${id}.json`);
    if (fs.existsSync(repFile)) {
      return { ...JSON.parse(fs.readFileSync(repFile, 'utf8')), mapping: map.jobs[id] || null };
    }
    if (map.jobs[id]) {
      return { state: 'running', ...map.jobs[id], job_id: id, mapping: map.jobs[id], report: null };
    }
    return transportStatus('grok-bot', id);
  }
  throw new Error('id must be a 16-hex job/Yobiru request id or a sess_... session id');
}
