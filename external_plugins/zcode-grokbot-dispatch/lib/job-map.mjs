/**
 * Persistent session_id <-> job_id mapping and tag helpers for zcode-dispatch.
 *
 * Why this exists: ZCode.app's automation scheduler spawns desktop sessions inside the Host
 * process, which does not inherit ZCODE_DISPATCH_JOB_ID / ZCODE_DISPATCH_SOURCE from the
 * external runner. We embed `[job: <16-hex>]` into both the task prompt and session/automation
 * title, and persist `session_id <-> job_id` in `session-jobs.json` (under ~/.local/state/zcode-dispatch
 * and ZCODE_PLUGIN_DATA when set) so UserPromptSubmit / Stop hooks can always resolve the job id.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { peerHost, resolveNetConfig } from './netconfig.mjs';
export { runYobiru } from './transport.mjs'; // moved: single place for Yobiru

export const JOB_ID_RE = /^[0-9a-f]{16}$/;
export const PROJECT_TAG_RE = /^\s*\[Project:\s*([^\]\n]+)\]/;
export const SOURCE_TAG_RE = /\[来源:\s*([^\]\n]+)\]/;
export const JOB_TAG_RE = /\[job:\s*([0-9a-f]{16})\]/i;
export const TITLE_JOB_RE = /#([0-9a-f]{16})\b/i;

export function defaultStateDir(env = process.env) {
  return env.ZCODE_DISPATCH_STATE_DIR || path.join(os.homedir(), '.local', 'state', 'zcode-dispatch');
}

export function defaultTasksDb(env = process.env) {
  return env.ZCODE_TASKS_DB || path.join(os.homedir(), '.zcode', 'v2', 'tasks-index.sqlite');
}

const NON_GROK_SOURCES = new Set(['dsh', 'local', 'zcode', 'manual']);

/** A peer is Grok if it targets the `grok` agent or is the configured grokPeer's node (netconfig.mjs). */
export function isGrokPeer(peer, grokPeer = resolveNetConfig().grokPeer) {
  if (typeof peer !== 'string') return false;
  const p = peer.trim().toLowerCase().replace(/\.$/, '');
  if (/(^|\/)grok$/.test(p)) return true;
  const node = String(peerHost(grokPeer) || '').toLowerCase().replace(/\.$/, '');
  return Boolean(node) && (p === node || p.startsWith(`${node}/`));
}

/**
 * Only tasks dispatched by Grok Bot (source 'grok'/'grok-bot', inbound Yobiru from grok,
 * or notify==='grok' recorded by a Grok inbound path) should auto-report to Grok.
 * dsh, zcode, and local/manual sessions never report to Grok; ZCODE_DISPATCH_NOTIFY=none disables all.
 */
export function isGrokDispatched(jobInfo = {}, env = process.env) {
  const envNotify = env?.ZCODE_DISPATCH_NOTIFY;
  if (envNotify === 'none' || envNotify === '0' || envNotify === 'false') return false;
  const jobNotify = jobInfo?.notify;
  if (jobNotify === 'none' || jobNotify === '0' || jobNotify === 'false') return false;
  const source = String(jobInfo?.source || env?.ZCODE_DISPATCH_SOURCE || '').trim().toLowerCase();
  if (NON_GROK_SOURCES.has(source)) return false;
  if (source === 'grok' || source === 'grok-bot') return true;
  const peer = jobInfo?.notify_peer || jobInfo?.notifyPeer || env?.ZCODE_DISPATCH_PEER || '';
  if (source === 'yobiru' && isGrokPeer(peer)) return true;
  if (jobNotify === 'grok' || envNotify === 'grok') return true;
  return false;
}

export function extractTags(text) {
  if (typeof text !== 'string' || !text) return { project: null, source: null, jobId: null };
  const project = PROJECT_TAG_RE.exec(text)?.[1]?.trim() || null;
  const source = SOURCE_TAG_RE.exec(text)?.[1]?.trim() || null;
  const jobId = (JOB_TAG_RE.exec(text)?.[1] || TITLE_JOB_RE.exec(text)?.[1] || '').toLowerCase() || null;
  return { project, source, jobId: JOB_ID_RE.test(jobId || '') ? jobId : null };
}

/**
 * "[Project: X] body" -> "[Project: X] [来源: src] [job: id] body" (session title = prompt head).
 * Preserves backwards compatibility when jobId is omitted.
 */
export function withSource(text, source, jobId) {
  if (typeof text !== 'string') return '';
  let out = text;
  if (source && !/^\s*\[Project: [^\]]+\]\s*\[来源:/.test(out)) {
    out = out.replace(/^(\s*\[Project: [^\]\n]+\])\s*/, `$1 [来源: ${source}] `);
  }
  const cleanJob = typeof jobId === 'string' && JOB_ID_RE.test(jobId) ? jobId : null;
  if (cleanJob && !JOB_TAG_RE.test(out)) {
    if (/^\s*\[Project: [^\]]+\]\s*\[来源:[^\]]+\]/.test(out)) {
      out = out.replace(/^(\s*\[Project: [^\]\n]+\]\s*\[来源:[^\]\n]+\])\s*/, `$1 [job: ${cleanJob}] `);
    } else if (/^\s*\[Project: [^\]]+\]/.test(out)) {
      out = out.replace(/^(\s*\[Project: [^\]\n]+\])\s*/, `$1 [job: ${cleanJob}] `);
    } else {
      out = `[job: ${cleanJob}] ${out}`;
    }
  }
  return out;
}

export function summaryTitle(text, source, jobId) {
  const body = String(text || '')
    .replace(/^\s*\[Project: [^\]\n]+\]\s*(\[来源[^\]]*\]\s*)?(\[job:\s*[0-9a-f]{16}\]\s*)?/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  const cleanJob = typeof jobId === 'string' && JOB_ID_RE.test(jobId) ? jobId : extractTags(text).jobId;
  const tag = cleanJob ? `${source || 'dispatch'} #${cleanJob}` : `${source || 'dispatch'}`;
  return `[${tag}] ${body.slice(0, 40)}${body.length > 40 ? '…' : ''}`;
}

function mapFiles(opts = {}) {
  const env = opts.env || process.env;
  const stateDir = opts.stateDir || defaultStateDir(env);
  const files = [path.join(stateDir, 'session-jobs.json')];
  const pluginData = opts.pluginDataDir ?? env.ZCODE_PLUGIN_DATA;
  if (pluginData && path.resolve(pluginData) !== path.resolve(stateDir)) {
    files.push(path.join(pluginData, 'session-jobs.json'));
  }
  return files;
}

function readOneMap(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      jobs: raw && typeof raw.jobs === 'object' ? raw.jobs : {},
      sessions: raw && typeof raw.sessions === 'object' ? raw.sessions : {},
    };
  } catch {
    return { jobs: {}, sessions: {} };
  }
}

export function loadMap(opts = {}) {
  const merged = { jobs: {}, sessions: {} };
  for (const file of mapFiles(opts)) {
    const m = readOneMap(file);
    for (const [k, v] of Object.entries(m.jobs)) {
      if (!JOB_ID_RE.test(k) || !v || typeof v !== 'object') continue;
      merged.jobs[k] = { ...merged.jobs[k], ...v };
    }
    for (const [sid, jid] of Object.entries(m.sessions)) {
      if (sid && JOB_ID_RE.test(jid || '')) merged.sessions[sid] = jid;
    }
  }
  return merged;
}

const SLEEP_BUF = new Int32Array(new SharedArrayBuffer(4));
function sleepSync(ms) {
  try { Atomics.wait(SLEEP_BUF, 0, 0, ms); } catch {}
}

function mapLockPath(opts = {}) {
  const env = opts.env || process.env;
  const stateDir = opts.stateDir || defaultStateDir(env);
  return path.join(stateDir, 'session-jobs.lock');
}

export function withMapLock(opts = {}, fn) {
  const lockPath = mapLockPath(opts);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  const staleMs = opts.lockStaleMs ?? 10000;
  const timeoutMs = opts.lockTimeoutMs ?? 5000;
  const deadline = Date.now() + timeoutMs;
  let fd = null;
  while (fd === null) {
    try {
      fd = fs.openSync(lockPath, 'wx', 0o600);
      try { fs.writeFileSync(fd, `${process.pid} ${Date.now()}\n`); } catch {}
      break;
    } catch (err) {
      if (err && err.code === 'EEXIST') {
        try {
          const st = fs.statSync(lockPath);
          if (Date.now() - st.mtimeMs > staleMs) {
            sleepSync(2 + Math.floor(Math.random() * 15));
            const st2 = fs.statSync(lockPath);
            if (st2.ino === st.ino && Date.now() - st2.mtimeMs > staleMs) {
              fs.unlinkSync(lockPath);
            }
            continue;
          }
        } catch {}
        if (Date.now() < deadline) {
          sleepSync(5 + Math.floor(Math.random() * 10));
          continue;
        }
        // Timed out behind a live holder: never delete another process's fresh lock (that would let
        // two writers in at once). Degrade to an unlocked update so hooks never block the stop.
        break;
      }
      break;
    }
  }
  try {
    return fn();
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch {}
      try { fs.unlinkSync(lockPath); } catch {}
    }
  }
}

export function saveMap(map, opts = {}) {
  const keys = Object.keys(map.jobs);
  if (keys.length > 500) {
    keys.sort((a, b) => String(map.jobs[a]?.updated_at || '').localeCompare(String(map.jobs[b]?.updated_at || '')));
    for (const k of keys.slice(0, keys.length - 500)) delete map.jobs[k];
    for (const [sid, jid] of Object.entries(map.sessions)) {
      if (!map.jobs[jid]) delete map.sessions[sid];
    }
  }
  const payload = JSON.stringify(map, null, 2);
  for (const file of mapFiles(opts)) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2, 8)}.tmp`;
      fs.writeFileSync(tmp, payload, { mode: 0o600 });
      fs.renameSync(tmp, file);
    } catch {}
  }
}

function applyUpsert(map, entry) {
  const prev = map.jobs[entry.job_id] || { job_id: entry.job_id, created_at: new Date().toISOString() };
  const next = { ...prev };
  for (const [k, v] of Object.entries(entry)) {
    if (v !== undefined && v !== null) next[k] = v;
  }
  next.updated_at = new Date().toISOString();
  map.jobs[entry.job_id] = next;
  if (next.session_id) map.sessions[next.session_id] = entry.job_id;
  return next;
}

export function upsertJob(entry, opts = {}) {
  if (!entry || !JOB_ID_RE.test(entry.job_id || '')) return null;
  return withMapLock(opts, () => {
    const map = loadMap(opts);
    const next = applyUpsert(map, entry);
    saveMap(map, opts);
    return next;
  });
}

export function bindSession(info, opts = {}) {
  const { sessionId, jobId, automationId, source, project, cwd, notify, notifyPeer } = info || {};
  return withMapLock(opts, () => {
    const map = loadMap(opts);
    let targetJobId = JOB_ID_RE.test(jobId || '') ? jobId : (sessionId ? map.sessions[sessionId] : null);
    if (!targetJobId && automationId) {
      const found = Object.values(map.jobs).find(j => j.automation_id === automationId);
      if (found) targetJobId = found.job_id;
    }
    if (!targetJobId || !JOB_ID_RE.test(targetJobId)) return null;
    const next = applyUpsert(map, {
      job_id: targetJobId,
      session_id: sessionId || undefined,
      automation_id: automationId || undefined,
      source: source || undefined,
      project: project || undefined,
      cwd: cwd || undefined,
      notify: notify || undefined,
      notify_peer: notifyPeer || undefined,
    });
    saveMap(map, opts);
    return next;
  });
}

function lookupDbForSession(sessionId, map, dbPath) {
  if (!sessionId || !dbPath || !fs.existsSync(dbPath)) return null;
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    db.exec('PRAGMA busy_timeout = 2000');
    const run = db.prepare('SELECT automation_id FROM automation_runs WHERE session_id=? ORDER BY created_at DESC LIMIT 1').get(sessionId);
    if (run?.automation_id) {
      const byAuto = Object.values(map.jobs).find(j => j.automation_id === run.automation_id);
      if (byAuto) return { jobId: byAuto.job_id, automationId: run.automation_id, source: byAuto.source, project: byAuto.project };
      const autoRow = db.prepare('SELECT title, prompt FROM automations WHERE automation_id=?').get(run.automation_id);
      const tags = extractTags(autoRow?.prompt || autoRow?.title || '');
      if (tags.jobId) return { ...tags, automationId: run.automation_id };
    }
    const task = db.prepare('SELECT title, searchable_text FROM tasks WHERE task_id=?').get(sessionId);
    if (task) {
      const tags = extractTags(task.title || '') || {};
      if (tags.jobId) return tags;
      const bodyTags = extractTags(task.searchable_text || '');
      if (bodyTags.jobId) return bodyTags;
    }
  } catch {} finally {
    try { db?.close(); } catch {}
  }
  return null;
}

/**
 * Resolve job metadata for a session or hook invocation.
 * Order: 1) env ZCODE_DISPATCH_JOB_ID -> 2) session-jobs.json by session_id ->
 *        3) prompt / transcript tags -> 4) tasks-index.sqlite automation_runs/tasks.
 */
export function resolveJob(params = {}) {
  const env = params.env || process.env;
  const opts = { env, stateDir: params.stateDir, pluginDataDir: params.pluginDataDir };
  const sessionId = params.sessionId || env.ZCODE_SESSION_ID || env.CLAUDE_SESSION_ID || null;
  const map = loadMap(opts);

  // 1. Direct env var (headless runs or explicit env)
  const envJob = env.ZCODE_DISPATCH_JOB_ID;
  if (JOB_ID_RE.test(envJob || '')) {
    return upsertJob({
      job_id: envJob,
      session_id: sessionId || undefined,
      source: params.source || env.ZCODE_DISPATCH_SOURCE || undefined,
      cwd: params.cwd || undefined,
      notify: env.ZCODE_DISPATCH_NOTIFY || undefined,
      notify_peer: env.ZCODE_DISPATCH_PEER || undefined,
    }, opts);
  }

  // 2. Persistent mapping by sessionId
  if (sessionId && map.sessions[sessionId] && map.jobs[map.sessions[sessionId]]) {
    const existing = map.jobs[map.sessions[sessionId]];
    if (params.cwd && !existing.cwd) return upsertJob({ job_id: existing.job_id, session_id: sessionId, cwd: params.cwd }, opts);
    return existing;
  }

  // 3. Prompt / text / transcript file tags
  let candidateText = params.prompt || params.text || '';
  if (!candidateText && params.transcriptPath && fs.existsSync(params.transcriptPath)) {
    try { candidateText = fs.readFileSync(params.transcriptPath, 'utf8').slice(0, 32768); } catch {}
  }
  const tags = extractTags(candidateText);
  if (tags.jobId) {
    return upsertJob({
      job_id: tags.jobId,
      session_id: sessionId || undefined,
      source: tags.source || params.source || undefined,
      project: tags.project || undefined,
      cwd: params.cwd || undefined,
    }, opts);
  }

  // 4. Fallback: read-only tasks-index.sqlite lookup by sessionId
  const dbPath = params.dbPath ?? defaultTasksDb(env);
  const fromDb = lookupDbForSession(sessionId, map, dbPath);
  if (fromDb?.jobId) {
    return upsertJob({
      job_id: fromDb.jobId,
      session_id: sessionId || undefined,
      automation_id: fromDb.automationId || undefined,
      source: fromDb.source || undefined,
      project: fromDb.project || undefined,
      cwd: params.cwd || undefined,
    }, opts);
  }

  return null;
}
