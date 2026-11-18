import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { runAdvisorHook } from '../scripts/advisor-hook.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultConfig = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'advisor-config.json'), 'utf8'));

function runCli(scriptPath, args, payloadObj, dataDir) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [scriptPath, ...args], { env: { ...process.env, ZCODE_PLUGIN_DATA: dataDir } });
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stdout += chunk;
    });
    child.on('error', reject);
    child.on('exit', (code) => resolve({ stdout, code }));
    child.stdin.write(JSON.stringify(payloadObj));
    child.stdin.end();
  });
}

function makeTemp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'advisor-zcode-test-'));
}

function makePluginDir(config) {
  const dir = makeTemp();
  fs.writeFileSync(path.join(dir, 'advisor-config.json'), JSON.stringify(config, null, 2), 'utf8');
  fs.mkdirSync(path.join(dir, 'rules'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'rules', 'craft.md'), '# Craft Standards\nTest craft rules content.', 'utf8');
  return dir;
}

function makeEnv(pluginDir) {
  return { pluginDir, dataDir: makeTemp(), fsImpl: fs, env: {} };
}

function writeSessionFile(dataDir, name, content) {
  const file = path.join(dataDir, name);
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

test('1. Role recognition: flash, frontier, unknown, and missing session models', () => {
  const pluginDir = makePluginDir(defaultConfig);
  const sessionId = 'role-test';

  const flash = runAdvisorHook({ event: 'SessionStart', payload: { session_id: sessionId, source: 'startup', model: 'account:zai-start-plan/GLM-5.3-Flash' }, ...makeEnv(pluginDir) });
  assert.equal(flash.hookEventName, 'SessionStart');
  assert.ok(flash.additionalContext.includes('executor session'), 'flash model must map to executor');
  assert.ok(flash.additionalContext.includes('Test craft rules content'), 'craft rules must be injected');

  const frontier = runAdvisorHook({ event: 'SessionStart', payload: { session_id: sessionId, source: 'startup', model: 'account:zai-individual-coding-plan/GLM-5.3' }, ...makeEnv(pluginDir) });
  assert.ok(frontier.additionalContext.includes('advisor session'), 'frontier model must map to advisor');

  const unknown = runAdvisorHook({ event: 'SessionStart', payload: { session_id: sessionId, source: 'startup', model: 'account:other-plan/mystery' }, ...makeEnv(pluginDir) });
  assert.ok(unknown.additionalContext.includes('executor session'), 'unknown model must fail closed to executor');

  const noModel = runAdvisorHook({ event: 'SessionStart', payload: { session_id: sessionId, source: 'startup' }, ...makeEnv(pluginDir) });
  assert.ok(noModel.additionalContext.includes('executor session'), 'missing model must fail closed to executor');
});

test('2. Gates governance: disabled gates relax injection and enforcement', () => {
  const relaxed = JSON.parse(JSON.stringify(defaultConfig));
  relaxed.gates.planBeforeComplexTask = false;
  relaxed.gates.maxConsecutiveFailures = 0;
  relaxed.gates.mandatoryFinalReview = false;
  const pluginDir = makePluginDir(relaxed);
  const sessionId = 'gates-off';
  const ctx = makeEnv(pluginDir);

  const start = runAdvisorHook({ event: 'SessionStart', payload: { session_id: sessionId, source: 'startup', model: 'account:zai-start-plan/GLM-5.3-Flash' }, ...ctx });
  assert.ok(start.additionalContext.includes('All operational gates are disabled'), 'disabled gates must be announced');

  const fileA = writeSessionFile(ctx.dataDir, 'gates-a.txt', 'a');
  const fileB = writeSessionFile(ctx.dataDir, 'gates-b.txt', 'b');
  runAdvisorHook({ event: 'PostToolUse', payload: { session_id: sessionId, tool_name: 'Write', tool_input: { file_path: fileA, content: 'a' } }, ...ctx });
  const secondEdit = runAdvisorHook({ event: 'PreToolUse', payload: { session_id: sessionId, tool_name: 'Edit', tool_input: { file_path: fileB, old_string: 'b', new_string: 'c' } }, ...ctx });
  assert.deepEqual(secondEdit, {}, 'plan gate must stay open when disabled');

  runAdvisorHook({ event: 'PostToolUse', payload: { session_id: sessionId, tool_name: 'Write', tool_input: { file_path: fileB, content: 'c' } }, ...ctx });
  const stop = runAdvisorHook({ event: 'Stop', payload: { session_id: sessionId }, ...ctx });
  assert.deepEqual(stop, {}, 'stop gate must stay open when disabled');
});

test('3. Error detection and failure signature tracking', () => {
  const pluginDir = makePluginDir(defaultConfig);
  const sessionId = 'failures';
  const ctx = makeEnv(pluginDir);

  const failPayload = (stderr, command = 'npm test') => ({
    session_id: sessionId,
    tool_name: 'Bash',
    tool_input: { command },
    tool_response: { exitCode: 1, stderr }
  });

  runAdvisorHook({ event: 'PostToolUseFailure', payload: failPayload('Error ECONNREFUSED 127.0.0.1:5432 at 2026-10-23T10:00:00Z'), ...ctx });
  const state1 = JSON.parse(fs.readFileSync(path.join(ctx.dataDir, `${sessionId}.json`), 'utf8'));
  assert.equal(state1.sameErrorFailures, 1);

  runAdvisorHook({ event: 'PostToolUse', payload: failPayload('Error ECONNREFUSED 127.0.0.1:5433 at 2026-10-23T11:00:00Z'), ...ctx });
  const state2 = JSON.parse(fs.readFileSync(path.join(ctx.dataDir, `${sessionId}.json`), 'utf8'));
  assert.equal(state2.circuitBreakerTripped, true, 'normalized identical signatures must trip the breaker on the second strike');
  assert.equal(state2.sameErrorFailures, 2);

  runAdvisorHook({ event: 'PostToolUse', payload: failPayload('a completely different failure'), ...ctx });
  const state3 = JSON.parse(fs.readFileSync(path.join(ctx.dataDir, `${sessionId}.json`), 'utf8'));
  assert.equal(state3.sameErrorFailures, 1, 'a different signature must restart the same-error count');

  runAdvisorHook({ event: 'PostToolUse', payload: { session_id: sessionId, tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: { exitCode: 0 } }, ...ctx });
  const state4 = JSON.parse(fs.readFileSync(path.join(ctx.dataDir, `${sessionId}.json`), 'utf8'));
  assert.equal(state4.circuitBreakerTripped, false, 'a successful command must reset the breaker');
});

test('4. Circuit breaker persistence and advisor consultation release', () => {
  const pluginDir = makePluginDir(defaultConfig);
  const sessionId = 'breaker';
  const ctx = makeEnv(pluginDir);

  runAdvisorHook({ event: 'SessionStart', payload: { session_id: sessionId, source: 'startup', model: 'account:zai-start-plan/GLM-5.3-Flash' }, ...ctx });
  for (let i = 0; i < 2; i++) {
    runAdvisorHook({ event: 'PostToolUseFailure', payload: { session_id: sessionId, tool_name: 'Bash', tool_input: { command: 'git push' }, tool_response: { exitCode: 128, stderr: 'rejected' } }, ...ctx });
  }

  const prompt = runAdvisorHook({ event: 'UserPromptSubmit', payload: { session_id: sessionId }, ...ctx });
  assert.equal(prompt.hookEventName, 'UserPromptSubmit');
  assert.ok(prompt.additionalContext.includes('TWO-STRIKE CIRCUIT BREAKER'), 'an active breaker must warn on new prompts');

  const blocked = runAdvisorHook({ event: 'PreToolUse', payload: { session_id: sessionId, tool_name: 'Bash', tool_input: { command: 'git push' } }, ...ctx });
  assert.equal(blocked.continue, false, 'an active breaker must deny commands');
  assert.ok(blocked.reason.includes('advisor-reviewer'));

  const consultation = runAdvisorHook({
    event: 'PostToolUse',
    payload: {
      session_id: sessionId,
      tool_name: 'Agent',
      tool_input: { subagent_type: 'advisor-reviewer', prompt: 'diagnose the push failure' },
      tool_response: { content: [{ type: 'text', text: 'Cause: remote hook rejected the branch.\nFix: pull and rebase first.' }] }
    },
    ...ctx
  });
  assert.deepEqual(consultation, {});

  const allowed = runAdvisorHook({ event: 'PreToolUse', payload: { session_id: sessionId, tool_name: 'Bash', tool_input: { command: 'git push' } }, ...ctx });
  assert.deepEqual(allowed, {}, 'an advisor consultation must release the breaker');
});

test('5. Pre-task plan gate on multi-file edits', () => {
  const pluginDir = makePluginDir(defaultConfig);
  const sessionId = 'plan-gate';
  const ctx = makeEnv(pluginDir);

  runAdvisorHook({ event: 'SessionStart', payload: { session_id: sessionId, source: 'startup', model: 'account:zai-start-plan/GLM-5.3-Flash' }, ...ctx });

  const fileA = writeSessionFile(ctx.dataDir, 'a.txt', 'a');
  const fileB = writeSessionFile(ctx.dataDir, 'b.txt', 'b');
  const firstEdit = runAdvisorHook({ event: 'PreToolUse', payload: { session_id: sessionId, tool_name: 'Edit', tool_input: { file_path: fileA } }, ...ctx });
  assert.deepEqual(firstEdit, {}, 'a single-file edit must pass');

  runAdvisorHook({ event: 'PostToolUse', payload: { session_id: sessionId, tool_name: 'Edit', tool_input: { file_path: fileA } }, ...ctx });
  const secondEdit = runAdvisorHook({ event: 'PreToolUse', payload: { session_id: sessionId, tool_name: 'Edit', tool_input: { file_path: fileB } }, ...ctx });
  assert.equal(secondEdit.continue, false, 'a second distinct file must be denied before plan validation');
  assert.ok(secondEdit.reason.includes('PRE-TASK PLAN GATE'));

  runAdvisorHook({
    event: 'PostToolUse',
    payload: {
      session_id: sessionId,
      tool_name: 'Agent',
      tool_input: { subagent_type: 'advisor-reviewer', prompt: 'validate the plan' },
      tool_response: { content: [{ type: 'text', text: 'Plan validated. Proceed.' }] }
    },
    ...ctx
  });
  const thirdEdit = runAdvisorHook({ event: 'PreToolUse', payload: { session_id: sessionId, tool_name: 'Edit', tool_input: { file_path: fileB } }, ...ctx });
  assert.deepEqual(thirdEdit, {}, 'an advisor-validated plan must open the gate');
});

test('6. Final review gate: verdict capture, hash verification, and stop continuation cap', () => {
  const pluginDir = makePluginDir(defaultConfig);
  const sessionId = 'final-review';
  const ctx = makeEnv(pluginDir);

  runAdvisorHook({ event: 'SessionStart', payload: { session_id: sessionId, source: 'startup', model: 'account:zai-start-plan/GLM-5.3-Flash' }, ...ctx });

  const fileA = writeSessionFile(ctx.dataDir, 'work.txt', 'version 1');
  runAdvisorHook({ event: 'PostToolUse', payload: { session_id: sessionId, tool_name: 'Write', tool_input: { file_path: fileA, content: 'version 1' } }, ...ctx });

  runAdvisorHook({
    event: 'PostToolUse',
    payload: {
      session_id: sessionId,
      tool_name: 'Agent',
      tool_input: { subagent_type: 'advisor-reviewer', prompt: 'final review' },
      tool_response: { content: [{ type: 'text', text: 'Scope clean.\nnet: -0 lines possible.\nLean already. Ship.\nVERDICT: APPROVED' }] }
    },
    ...ctx
  });

  const stopApproved = runAdvisorHook({ event: 'Stop', payload: { session_id: sessionId }, ...ctx });
  assert.deepEqual(stopApproved, {}, 'an approved review matching disk hashes must let the task stop');

  const stateAfter = JSON.parse(fs.readFileSync(path.join(ctx.dataDir, `${sessionId}.json`), 'utf8'));
  assert.equal(stateAfter.taskStatus, 'COMPLETED');
  assert.equal(Object.keys(stateAfter.modifiedFiles).length, 0, 'task state must reset after a completed stop');

  runAdvisorHook({ event: 'PostToolUse', payload: { session_id: sessionId, tool_name: 'Write', tool_input: { file_path: fileA, content: 'version 2' } }, ...ctx });
  fs.writeFileSync(fileA, 'version 2', 'utf8');

  const stopStale = runAdvisorHook({ event: 'Stop', payload: { session_id: sessionId }, ...ctx });
  assert.equal(stopStale.continue, true, 'a stale review must force continuation');
  assert.ok(stopStale.reason.includes('MANDATORY FINAL REVIEW GATE'));

  const stopSecond = runAdvisorHook({ event: 'Stop', payload: { session_id: sessionId, stop_hook_active: true }, ...ctx });
  assert.equal(stopSecond.continue, true, 'the second continuation must still force work');
  assert.equal(stopSecond.reason.includes('MANDATORY FINAL REVIEW GATE'), true);

  const stopCapped = runAdvisorHook({ event: 'Stop', payload: { session_id: sessionId, stop_hook_active: true }, ...ctx });
  assert.equal(stopCapped.continue, undefined, 'past the cap the gate must warn instead of forcing');
  assert.ok(stopCapped.additionalContext.includes('final review is still missing'));

  fs.writeFileSync(fileA, 'tampered without review', 'utf8');
  runAdvisorHook({
    event: 'PostToolUse',
    payload: {
      session_id: sessionId,
      tool_name: 'Agent',
      tool_input: { subagent_type: 'advisor-reviewer', prompt: 'final review' },
      tool_response: { content: [{ type: 'text', text: 'VERDICT: CHANGES_REQUIRED' }] }
    },
    ...ctx
  });
  const stopChanges = runAdvisorHook({ event: 'Stop', payload: { session_id: sessionId }, ...ctx });
  assert.ok(
    (stopChanges.reason && stopChanges.reason.includes('MANDATORY FINAL REVIEW GATE')) || stopChanges.additionalContext,
    'a changes-required verdict must keep the gate active'
  );
});

test('7. CLI execution: standalone stdin and stdout contract', async () => {
  const dataDir = makeTemp();
  const script = path.join(pluginRoot, 'scripts', 'advisor-hook.mjs');
  const first = await runCli(script, ['SessionStart'], { session_id: 'cli-test', source: 'startup', model: 'account:zai-start-plan/GLM-5.3-Flash' }, dataDir);
  assert.equal(first.code, 0);
  const parsed = JSON.parse(first.stdout);
  assert.equal(parsed.hookEventName, 'SessionStart');
  assert.ok(parsed.additionalContext.includes('Advisor Mode'));
  assert.ok(parsed.additionalContext.includes('executor session'), 'the CLI must read the session model from stdin');

  const quiet = await runCli(script, ['UserPromptSubmit'], { session_id: 'cli-test' }, dataDir);
  assert.equal(quiet.stdout, '', 'an action-free event must print nothing');
  assert.ok(fs.existsSync(path.join(dataDir, 'cli-test.json')), 'state must persist under the plugin data directory');
});
