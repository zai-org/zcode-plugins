#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const allowed = {
  'scan-hook.mjs': ['PreToolUse', 'PostToolUse'],
  'git-gate-hook.mjs': ['PreToolUse', 'PostToolUse'],
  'prompt-hook.mjs': ['UserPromptSubmit'],
  'session-hook.mjs': ['SessionStart'],
  'stop-hook.mjs': ['Stop'],
};
const [hook, event] = process.argv.slice(2);

function writeOutput(bytes) {
  return new Promise((resolve, reject) => {
    process.stdout.write(bytes, (error) => error ? reject(error) : resolve());
  });
}

async function main() {
  if (!allowed[hook]?.includes(event) || process.argv.length !== 4) {
    throw new Error('Invalid hook adapter arguments');
  }
  // 供应商入口写 stdout 后立即 exit；管道背压时 JSON 会丢失，宿主可能把空输出当放行。
  // 子进程输出到私有普通文件（同步写），退出后由适配器等待管道写完。签名载荷不变。
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mimosa-hook-output-'));
  let output;
  let child;
  let interrupted = false;
  const stop = () => { interrupted = true; child?.kill('SIGTERM'); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  try {
    output = await fs.open(path.join(directory, 'decision.json'), 'wx', 0o600);
    if (interrupted) throw new Error('Hook interrupted');
    child = spawn(process.execPath, [path.join(__dirname, '..', 'payload', 'hooks', hook)], {
      stdio: ['inherit', output.fd, 'inherit'],
    });
    const result = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    await output.close(); output = undefined;
    if (interrupted || result.signal) throw new Error('Hook interrupted');
    const bytes = await fs.readFile(path.join(directory, 'decision.json'));
    // 有输出时必须是完整 JSON；损坏结果不能作为一次成功的 PreToolUse 检查。
    if (bytes.length) JSON.parse(bytes.toString('utf8'));
    if (result.code !== 0 && event === 'PreToolUse') throw new Error('Hook process failed');
    await writeOutput(bytes);
    process.exitCode = result.code ?? 1;
  } finally {
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
    if (output) await output.close().catch(() => {});
    // 清理失败不能在已送达的判定后再拼接第二个 JSON。
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {
      process.stderr.write('Mimosa hook temporary-output cleanup failed.\n');
    });
  }
}

main().catch(async () => {
  if (event === 'PreToolUse') {
    try {
      await writeOutput(JSON.stringify({ hookSpecificOutput: {
        hookEventName: 'PreToolUse', permissionDecision: 'deny',
        permissionDecisionReason: 'Mimosa 未能完整传递安全检查结果，本次操作已阻止，请修复后重试。',
      } }));
      process.exitCode = 0;
      return;
    } catch { /* stdout 不可用时保留失败退出码，不谎报判定已送达。 */ }
  }
  process.stderr.write('Mimosa hook adapter failed to deliver a complete result.\n');
  process.exitCode = 1;
});
