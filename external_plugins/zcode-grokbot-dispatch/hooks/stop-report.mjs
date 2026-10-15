/**
 * Hook handler for UserPromptSubmit and Stop.
 *
 * - On UserPromptSubmit: extracts `[job: <16-hex>]` from prompt and records `session_id <-> job_id`
 *   in the persistent mapping (`session-jobs.json` in ~/.local/state/zcode-dispatch and ZCODE_PLUGIN_DATA).
 * - On Stop: resolves `job_id` for `session_id` (via persistent mapping, env, transcript, or tasks-index.sqlite),
 *   writes `~/.local/state/zcode-dispatch/reports/<job>.json` + `reports.jsonl`, and automatically reports the
 *   result back to the dispatcher peer via Yobiru (`[ZCode report <job>] ...`) when transport is "yobiru".
 *   With the default direct transport the receiver pushes results itself (HTTP callback), so this hook only records.
 * - Never blocks ZCode: stdout stays empty, exit 0.
 */
import fs from 'node:fs';
import path from 'node:path';
import { resolveNetConfig } from '../lib/netconfig.mjs';
import { JOB_ID_RE, defaultStateDir, isGrokDispatched, resolveJob, upsertJob } from '../lib/job-map.mjs';
import { runYobiru, transportName } from '../lib/transport.mjs';

let raw = '';
process.stdin.setEncoding('utf8');
for await (const c of process.stdin) raw += c;

let input = {};
try { input = JSON.parse(raw); } catch {}

const event = input.hook_event_name || input.hookEventName || 'Stop';
const sessionId = input.session_id ?? input.sessionId ?? process.env.ZCODE_SESSION_ID ?? null;
const jobInfo = resolveJob({
  sessionId,
  prompt: input.prompt,
  transcriptPath: input.transcript_path ?? input.transcriptPath,
  cwd: input.cwd,
  env: process.env,
});

if (!jobInfo || !JOB_ID_RE.test(jobInfo.job_id || '')) process.exit(0);

if (event === 'UserPromptSubmit' || event === 'SessionStart') {
  process.stderr.write(`[zcode-dispatch] mapped session ${sessionId} <-> job ${jobInfo.job_id}\n`);
  process.exit(0);
}

const job = jobInfo.job_id;
const text = String(input.last_assistant_message ?? input.responseText ?? '').slice(0, 20000);
const notify = process.env.ZCODE_DISPATCH_NOTIFY ?? jobInfo.notify ?? null;
// Yobiru-sourced jobs are answered by the adapter via `request respond`; a Stop-hook `send` would
// duplicate the result even when the request came from Grok.
const viaAdapter = (jobInfo.source || process.env.ZCODE_DISPATCH_SOURCE) === 'yobiru';
let viaYobiru = false; try { viaYobiru = transportName() === 'yobiru'; } catch {}
const shouldNotifyGrok = viaYobiru && !viaAdapter && isGrokDispatched(jobInfo, process.env);
const peer = process.env.ZCODE_DISPATCH_PEER || process.env.ZCODE_DISPATCH_GROK_PEER || jobInfo.notify_peer || resolveNetConfig().grokPeer;

const rep = {
  agent: 'zcode',
  job_id: job,
  source: jobInfo.source || process.env.ZCODE_DISPATCH_SOURCE || null,
  project: jobInfo.project || null,
  session_id: sessionId || jobInfo.session_id || null,
  automation_id: jobInfo.automation_id || null,
  cwd: input.cwd ?? jobInfo.cwd ?? null,
  at: new Date().toISOString(),
  text,
  yobiru_reported: false,
  yobiru_peer: null,
  yobiru_receipt: null,
};

// Report once per dispatched job, and only when the job mapping indicates Grok dispatched it
// (inbound Yobiru from grok, or source==='grok'/'grok-bot' / notify==='grok' from Grok inbound).
// dsh, zcode, and local/manual sessions never notify Grok; ZCODE_DISPATCH_NOTIFY=none disables all.
const alreadyReported = Boolean(jobInfo.yobiru_reported);
if (!viaYobiru) {
  rep.yobiru_skipped = 'transport-direct';
} else if (viaAdapter) {
  rep.yobiru_skipped = 'adapter-responds';
} else if (!shouldNotifyGrok) {
  rep.yobiru_skipped = notify === 'none' || notify === '0' || notify === 'false' ? 'notify-disabled' : 'non-grok-source';
}
if (shouldNotifyGrok && !peer) rep.yobiru_skipped = 'grok-peer-not-configured';
if (shouldNotifyGrok && peer && !alreadyReported) {
  try {
    const out = runYobiru(['send', peer, `[ZCode report ${job}] ${text.slice(0, 3000)}`, '--as', 'zcode', '--wake', 'none'], process.env);
    rep.yobiru_reported = true;
    rep.yobiru_peer = peer;
    rep.yobiru_receipt = String(out || '').trim().slice(0, 500) || 'sent';
  } catch (e) {
    rep.yobiru_error = String(e.message || e).slice(0, 500);
    process.stderr.write(`[zcode-dispatch] yobiru notify failed for job ${job}: ${e.message}\n`);
  }
}

upsertJob({
  job_id: job,
  session_id: rep.session_id || undefined,
  cwd: rep.cwd || undefined,
  reported_at: rep.at,
  last_reported_text: text,
  yobiru_reported: rep.yobiru_reported || Boolean(jobInfo.yobiru_reported),
  yobiru_peer: rep.yobiru_peer || jobInfo.yobiru_peer || undefined,
  yobiru_receipt: rep.yobiru_receipt || jobInfo.yobiru_receipt || undefined,
  report_count: (jobInfo.report_count || 0) + 1,
});

const writeReportDir = (baseDir) => {
  const dir = path.join(baseDir, 'reports');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, `${job}.json`), JSON.stringify(rep, null, 2), { mode: 0o600 });
  fs.appendFileSync(path.join(dir, 'reports.jsonl'), JSON.stringify(rep) + '\n', { mode: 0o600 });
};

const stateDir = defaultStateDir(process.env);
writeReportDir(stateDir);
if (process.env.ZCODE_PLUGIN_DATA && path.resolve(process.env.ZCODE_PLUGIN_DATA) !== path.resolve(stateDir)) {
  try { writeReportDir(process.env.ZCODE_PLUGIN_DATA); } catch {}
}

process.stderr.write(`[zcode-dispatch] report written for job ${job} (session=${rep.session_id || 'none'}, yobiru=${rep.yobiru_reported})\n`);
