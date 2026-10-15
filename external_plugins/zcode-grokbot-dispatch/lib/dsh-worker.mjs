/** Detached: run `dsh --profile headless --json <text>` in cwd, fold the result into the job file. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const [file, cwd, text, timeoutS] = process.argv.slice(2);
const job = JSON.parse(fs.readFileSync(file, 'utf8'));
const env = { ...process.env, DSH_PERMISSION_MODE: 'danger-full-access' }; delete env.DEEPSEEK_BASE_URL;
const child = spawn(process.env.DSH_BIN || 'dsh', ['--profile', process.env.DSH_PROFILE || 'headless', '--json', text], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '', err = '';
child.stdout.on('data', d => { if (out.length < 4e6) out += d; });
child.stderr.on('data', d => { if (err.length < 2e5) err += d; });
const timer = setTimeout(() => { job.timed_out = true; child.kill('SIGTERM'); }, Number(timeoutS) * 1000);
child.on('close', code => {
  clearTimeout(timer);
  let final = null, session = null, turnEnd = null;
  for (const l of out.split('\n')) { let e; try { e = JSON.parse(l); } catch { continue; }
    if (e.type === 'final') final = e.text; if (e.type === 'session') session = e.sessionId ?? e.session?.sessionId; if (e.type === 'status' && e.phase === 'turn_end') turnEnd = e.reason?.kind; }
  const ok = code === 0 && !job.timed_out && (turnEnd == null || turnEnd === 'completed');
  Object.assign(job, { state: ok ? 'completed' : 'failed', exit_code: code, session_id: session, turn_end: turnEnd, result: final?.slice(0, 100000) ?? null,
    error: ok ? null : job.timed_out ? 'timeout' : err.trim().split('\n').slice(-5).join('\n').slice(0, 2000) || `exit ${code}`, finished_at: new Date().toISOString() });
  fs.writeFileSync(file, JSON.stringify(job, null, 2), { mode: 0o600 });
});
