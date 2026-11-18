import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const FILE_EDIT_TOOLS = new Set(['Write', 'Edit', 'ApplyPatch', 'MultiEdit', 'write_file', 'edit_file']);
const COMMAND_TOOLS = new Set(['Bash', 'run_command']);
const AGENT_TOOLS = new Set(['Agent', 'Task', 'invoke_subagent']);

function extractTargetFile(toolInput) {
  return toolInput?.file_path || toolInput?.filePath || toolInput?.path || toolInput?.Path || toolInput?.notebook_path || '';
}

function extractCommand(toolInput) {
  return String(toolInput?.command || toolInput?.CommandLine || '').trim().toLowerCase();
}

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hashFileOnDisk(filePath, fsImpl) {
  try {
    if (filePath && fsImpl?.existsSync(filePath)) return sha256Hex(fsImpl.readFileSync(filePath));
  } catch {}
  return '';
}

function stringifyResponse(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function responseFailureExitCode(toolResponse) {
  if (!toolResponse || typeof toolResponse !== 'object') return 0;
  if (typeof toolResponse.exitCode === 'number') return toolResponse.exitCode;
  if (typeof toolResponse.exit_code === 'number') return toolResponse.exit_code;
  const nested = toolResponse.content ?? toolResponse.result;
  if (Array.isArray(nested)) {
    for (const part of nested) {
      if (part && typeof part === 'object') {
        if (typeof part.exitCode === 'number') return part.exitCode;
        if (typeof part.exit_code === 'number') return part.exit_code;
      }
    }
  }
  return 0;
}

function isCommandFailure(payload) {
  if (payload?.error && String(payload.error).trim()) return true;
  if (typeof payload?.exitCode === 'number' && payload.exitCode !== 0) return true;
  const tr = payload?.tool_response ?? payload?.toolResult ?? payload?.toolResultContent;
  if (tr && typeof tr === 'object') {
    if (tr.error && String(tr.error).trim()) return true;
    if (tr.is_error === true || tr.isError === true) return true;
    if (responseFailureExitCode(tr) !== 0) return true;
    if (tr.status === 'ERROR' || tr.status === 'error') return true;
    const nested = tr.content ?? tr.result;
    if (Array.isArray(nested)) {
      for (const part of nested) {
        if (part && typeof part === 'object' && (part.is_error === true || part.isError === true)) return true;
      }
    }
  }
  return false;
}

function failureErrorText(payload) {
  const tr = payload?.tool_response ?? payload?.toolResult;
  if (tr && typeof tr === 'object') {
    const nestedErr = tr.stderr || tr.error || tr.output || '';
    if (String(nestedErr).trim()) return String(nestedErr);
  }
  if (typeof tr === 'string' && tr.trim()) return tr;
  return String(payload?.error || payload?.error_details?.message || `exit code ${payload?.exitCode ?? 1}`);
}

function normalizeFailureSignature(payload) {
  const toolInput = payload?.tool_input ?? payload?.toolInput ?? {};
  const cmd = extractCommand(toolInput);
  const tr = payload?.tool_response ?? payload?.toolResult;
  const exitCode = isCommandFailure(payload) ? (responseFailureExitCode(tr) || payload?.exitCode || 1) : 0;
  const rawErr = failureErrorText(payload).toLowerCase();
  const normErr = rawErr
    .replace(/\d{4}-\d{2}-\d{2}[t\s]\d{2}:\d{2}:\d{2}[^\s]*/gi, '<timestamp>')
    .replace(/[a-f0-9]{8,}/gi, '<hash>')
    .replace(/\b\d+\b/g, '<num>')
    .replace(/\s+/g, ' ')
    .trim();
  return `${cmd}::${exitCode}::${normErr}`;
}

function loadConfig(pluginDir, fsImpl) {
  try {
    const configPath = path.join(pluginDir, 'advisor-config.json');
    if (!fsImpl.existsSync(configPath)) return null;
    const cfg = JSON.parse(fsImpl.readFileSync(configPath, 'utf8'));
    if (!cfg || cfg.enabled === false) return null;
    return cfg;
  } catch {
    return null;
  }
}

function freshState(role) {
  return {
    role: role || '',
    modifiedFiles: {},
    verifiedFiles: {},
    circuitBreakerTripped: false,
    circuitBreakerReason: '',
    consecutiveFailures: 0,
    sameErrorFailures: 0,
    lastError: '',
    lastErrorSignature: '',
    planValidatedByAdvisor: false,
    needsFinalReview: false,
    reviewStatus: '',
    lastReview: null,
    stopContinuations: 0,
    taskStatus: '',
    sessionStartedAt: ''
  };
}

export function runAdvisorHook({ event, payload = {}, pluginDir, dataDir, fsImpl = fs, env = process.env }) {
  const safePluginDir = pluginDir || process.cwd();
  try {
    const cfg = loadConfig(safePluginDir, fsImpl);
    if (!cfg) return {};

    const safeDataDir = dataDir || env.ZCODE_PLUGIN_DATA || env.CLAUDE_PLUGIN_DATA || path.join(safePluginDir, '.state');
    const sessionId = (typeof payload.session_id === 'string' && payload.session_id) || env.CLAUDE_SESSION_ID || 'default';
    const stateFile = path.join(safeDataDir, `${String(sessionId).replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);

    let state = {};
    if (fsImpl.existsSync(stateFile)) {
      try {
        state = JSON.parse(fsImpl.readFileSync(stateFile, 'utf8'));
      } catch {
        state = {};
      }
    }
    if (sourceResetsSession(event, payload)) state = {};
    state = (state && typeof state === 'object') ? state : {};
    const fresh = freshState();
    for (const key of Object.keys(fresh)) {
      if (state[key] === undefined) state[key] = fresh[key];
    }
    state.modifiedFiles = state.modifiedFiles || {};
    state.verifiedFiles = state.verifiedFiles || {};
    state.circuitBreakerTripped = Boolean(state.circuitBreakerTripped);

    const persistState = () => {
      if (!fsImpl.existsSync(safeDataDir)) fsImpl.mkdirSync(safeDataDir, { recursive: true });
      fsImpl.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
    };

    const advisorLabel = cfg.roles?.advisor?.label || 'Frontier Advisor';
    const advisorAgent = cfg.roles?.advisor?.agentName || 'advisor-reviewer';
    const execLabel = cfg.roles?.executor?.label || 'Fast Executor';
    const execAgent = cfg.roles?.executor?.agentName || 'flash-executor';

    const executorPatterns = (cfg.roles?.executor?.uiModelPatterns || ['flash']).map((p) => String(p).toLowerCase());
    const advisorPatterns = (cfg.roles?.advisor?.uiModelPatterns || ['glm-5.3']).map((p) => String(p).toLowerCase());
    const unknownModelRole = cfg.roles?.unknownModelRole === 'advisor' ? 'advisor' : 'executor';

    const planBeforeComplexTask = cfg.gates?.planBeforeComplexTask !== false;
    const maxFail = cfg.gates?.maxConsecutiveFailures !== undefined ? Number(cfg.gates.maxConsecutiveFailures) : 2;
    const breakerEnabled = maxFail > 0;
    const mandatoryFinalReview = cfg.gates?.mandatoryFinalReview !== false;
    const maxStopContinuations = cfg.gates?.maxStopContinuations !== undefined ? Number(cfg.gates.maxStopContinuations) : 2;

    const breakerWarning = () =>
      `[TWO-STRIKE CIRCUIT BREAKER] A command failed repeatedly (reason: ${state.circuitBreakerReason || 'same_error'}). Stop retrying blindly. When running as the Executor, invoke subagent '${advisorAgent}' (${advisorLabel}) and pass the error output. When running as the Advisor, report Cause and Fix to the user.`;
    const breakerDeny = () =>
      `[TWO-STRIKE CIRCUIT BREAKER] Execution blocked after repeated command failure. Invoke subagent '${advisorAgent}' (${advisorLabel}) with the error output before running further commands or edits.`;
    const planDeny = () =>
      `[PRE-TASK PLAN GATE] Multi-file edit blocked. Invoke subagent '${advisorAgent}' (${advisorLabel}) to validate the architecture and the plan before modifying multiple files.`;
    const finalReviewDeny = (files, status) =>
      `[MANDATORY FINAL REVIEW GATE] Cannot complete the task: modified files (${files.join(', ')}) lack an approved final review from '${advisorAgent}' matching their current file hashes (status: ${status || 'PENDING'}). Invoke subagent '${advisorAgent}' with the change summary before stopping.`;

    if (event === 'SessionStart') {
      const rawModel = typeof payload.model === 'string' ? payload.model.trim().toLowerCase() : '';
      let role = state.role || '';
      if (rawModel) {
        if (executorPatterns.some((p) => rawModel.includes(p))) role = 'executor';
        else if (advisorPatterns.some((p) => rawModel.includes(p))) role = 'advisor';
        else role = unknownModelRole;
      } else if (!role) {
        role = unknownModelRole;
      }
      state.role = role;

      const activeGates = [];
      if (planBeforeComplexTask) activeGates.push('(1) planning and multi-file implementation');
      if (breakerEnabled) activeGates.push(`(2) after ${maxFail} consecutive identical failures`);
      if (mandatoryFinalReview) activeGates.push(`(3) at the end of every coding task for the mandatory final review`);

      const defaultsDesc = `Defaults: simplicity=${cfg.defaults?.simplicityIntensity || 'full'}, actionFirst=${cfg.defaults?.actionFirstOutput !== false}.`;
      let msg = '';
      if (role === 'executor') {
        msg = activeGates.length === 0
          ? `[Advisor Mode: executor session (${rawModel || 'unknown model'})] You are running as the Executor (${execLabel}). All operational gates are disabled. ${defaultsDesc}`
          : `[Advisor Mode: executor session (${rawModel || 'unknown model'})] You are running as the Executor (${execLabel}). Invoke subagent '${advisorAgent}' (${advisorLabel}) at the enabled gates: ${activeGates.join(', ')}. ${defaultsDesc}`;
      } else {
        msg = `[Advisor Mode: advisor session (${rawModel || 'unknown model'})] You are running as the Architect, Advisor, and Final Reviewer (${advisorLabel}). Delegate approved task implementation to subagent '${execAgent}' (${execLabel}) and review its diff and command exit codes before closing any task. ${defaultsDesc}`;
      }

      let craft = '';
      try {
        craft = fsImpl.readFileSync(path.join(safePluginDir, 'rules', 'craft.md'), 'utf8');
      } catch {}

      state.sessionStartedAt = new Date().toISOString();
      persistState();
      return { hookEventName: 'SessionStart', additionalContext: craft ? `${msg}\n\n${craft}` : msg };
    }

    if (event === 'UserPromptSubmit') {
      state.stopContinuations = 0;
      if (breakerEnabled && state.circuitBreakerTripped) {
        persistState();
        return { hookEventName: 'UserPromptSubmit', additionalContext: breakerWarning() };
      }
      persistState();
      return {};
    }

    const toolName = String(payload.tool_name || payload.toolName || payload.name || '');
    const toolInput = payload.tool_input ?? payload.toolInput ?? payload.args ?? {};

    if (event === 'PreToolUse') {
      if (breakerEnabled && state.circuitBreakerTripped && state.role === 'executor') {
        if (COMMAND_TOOLS.has(toolName) || FILE_EDIT_TOOLS.has(toolName)) {
          return { hookEventName: 'PreToolUse', continue: false, reason: breakerDeny() };
        }
      }

      if (planBeforeComplexTask && state.role === 'executor' && FILE_EDIT_TOOLS.has(toolName)) {
        const targetFile = extractTargetFile(toolInput);
        const distinct = new Set(Object.keys(state.modifiedFiles || {}));
        if (targetFile) distinct.add(targetFile);
        if (distinct.size >= 2 && !state.planValidatedByAdvisor) {
          return { hookEventName: 'PreToolUse', continue: false, reason: planDeny() };
        }
      }
      return {};
    }

    if (event === 'PostToolUseFailure') {
      if (COMMAND_TOOLS.has(toolName)) {
        registerFailure(payload, state, { maxFail, breakerEnabled });
        persistState();
      }
      return {};
    }

    if (event === 'PostToolUse') {
      if (COMMAND_TOOLS.has(toolName)) {
        const failed = isCommandFailure(payload);
        if (failed) {
          registerFailure(payload, state, { maxFail, breakerEnabled });
        } else {
          state.consecutiveFailures = 0;
          state.sameErrorFailures = 0;
          state.lastError = '';
          state.lastErrorSignature = '';
          state.circuitBreakerTripped = false;
          state.circuitBreakerReason = '';
        }
        persistState();
        return {};
      }

      if (FILE_EDIT_TOOLS.has(toolName)) {
        const failed = payload?.error ? true : isCommandFailure(payload);
        if (!failed) {
          const targetFile = extractTargetFile(toolInput);
          if (targetFile) {
            const diskHash = hashFileOnDisk(targetFile, fsImpl);
            state.modifiedFiles[targetFile] = {
              hash: diskHash || null,
              editedAt: new Date().toISOString()
            };
            state.needsFinalReview = true;
            state.reviewStatus = state.reviewStatus === 'APPROVED' ? 'STALE' : (state.reviewStatus || 'PENDING');
          }
        }
        persistState();
        return {};
      }

      if (AGENT_TOOLS.has(toolName)) {
        const subagent = toolInput.subagent_type || toolInput.subagentType || toolInput.typeName || '';
        if (subagent === advisorAgent) {
          state.planValidatedByAdvisor = true;
          state.circuitBreakerTripped = false;
          state.circuitBreakerReason = '';
          state.consecutiveFailures = 0;
          state.sameErrorFailures = 0;
          state.lastError = '';
          state.lastErrorSignature = '';

          const outputText = stringifyResponse(payload.tool_response ?? payload.toolResponse ?? payload.result ?? '');
          if (outputText.includes('CHANGES_REQUIRED')) {
            state.reviewStatus = 'CHANGES_REQUIRED';
            state.needsFinalReview = true;
            state.lastReview = { reviewer: advisorAgent, verdict: 'CHANGES_REQUIRED', reviewedAt: new Date().toISOString() };
          } else if (outputText.includes('APPROVED')) {
            state.verifiedFiles = {};
            for (const [filePath, meta] of Object.entries(state.modifiedFiles || {})) {
              const currentHash = hashFileOnDisk(filePath, fsImpl) || meta.hash;
              state.verifiedFiles[filePath] = currentHash;
              if (currentHash) state.modifiedFiles[filePath].hash = currentHash;
            }
            if (Object.keys(state.modifiedFiles || {}).length > 0) {
              state.reviewStatus = 'APPROVED';
              state.needsFinalReview = false;
              state.lastReview = { reviewer: advisorAgent, verdict: 'APPROVED', verifiedFiles: { ...state.verifiedFiles }, reviewedAt: new Date().toISOString() };
            }
          }
          persistState();
        }
        return {};
      }
      return {};
    }

    if (event === 'Stop') {
      if (!mandatoryFinalReview || state.role !== 'executor') return {};

      const modifiedKeys = Object.keys(state.modifiedFiles || {});
      if (modifiedKeys.length === 0) return {};

      let verificationFailed = state.needsFinalReview === true
        || state.reviewStatus !== 'APPROVED'
        || state.lastReview?.reviewer !== advisorAgent
        || !state.verifiedFiles;

      if (!verificationFailed) {
        for (const [filePath, meta] of Object.entries(state.modifiedFiles)) {
          const verifiedHash = state.verifiedFiles[filePath];
          if (!verifiedHash || (meta.hash && verifiedHash !== meta.hash)) {
            verificationFailed = true;
            break;
          }
          const diskHash = hashFileOnDisk(filePath, fsImpl);
          if (diskHash && diskHash !== verifiedHash) {
            verificationFailed = true;
            break;
          }
        }
      }

      if (verificationFailed) {
        if ((state.stopContinuations || 0) >= maxStopContinuations) {
          state.reviewPendingAtStop = true;
          persistState();
          return {
            hookEventName: 'Stop',
            additionalContext: `[MANDATORY FINAL REVIEW GATE] Stopping without an approved review from '${advisorAgent}'. Tell the user explicitly that the final review is still missing and which files changed.`
          };
        }
        state.stopContinuations = (state.stopContinuations || 0) + 1;
        persistState();
        return { hookEventName: 'Stop', continue: true, reason: finalReviewDeny(modifiedKeys, state.reviewStatus) };
      }

      state.taskStatus = 'COMPLETED';
      state.reviewPendingAtStop = false;
      state.modifiedFiles = {};
      state.verifiedFiles = {};
      state.needsFinalReview = false;
      state.reviewStatus = '';
      state.lastReview = null;
      state.planValidatedByAdvisor = false;
      state.stopContinuations = 0;
      persistState();
      return {};
    }

    return {};
  } catch (err) {
    try {
      const logDir = dataDir || path.join(safePluginDir, '.state');
      if (!fsImpl.existsSync(logDir)) fsImpl.mkdirSync(logDir, { recursive: true });
      fsImpl.appendFileSync(path.join(logDir, 'hook-errors.log'), `[${new Date().toISOString()}] [ERROR] event=${event}: ${err?.stack || err?.message || String(err)}\n`, 'utf8');
    } catch {}
    return {};
  }
}

function sourceResetsSession(event, payload) {
  return event === 'SessionStart' && (payload?.source === 'clear' || payload?.source === 'startup');
}

function registerFailure(payload, state, { maxFail, breakerEnabled }) {
  const sig = normalizeFailureSignature(payload);
  state.consecutiveFailures = (Number(state.consecutiveFailures) || 0) + 1;
  state.sameErrorFailures = (state.lastErrorSignature && state.lastErrorSignature === sig) ? ((Number(state.sameErrorFailures) || 0) + 1) : 1;
  state.lastErrorSignature = sig;
  state.lastError = failureErrorText(payload);
  const shouldTrip = state.sameErrorFailures >= maxFail;
  if (breakerEnabled && shouldTrip) {
    state.circuitBreakerTripped = true;
    state.circuitBreakerReason = 'same_error';
  }
}

if (process.argv[1] && process.argv[1].endsWith('advisor-hook.mjs')) {
  const event = process.argv[2] || '';
  const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  let rawInput = '';
  try {
    if (process.stdin.isTTY !== true) {
      rawInput = await new Promise((resolve) => {
        let buf = '';
        const timer = setTimeout(() => resolve(buf), 2000);
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => {
          buf += chunk;
        });
        process.stdin.on('end', () => {
          clearTimeout(timer);
          resolve(buf);
        });
        process.stdin.on('error', () => {
          clearTimeout(timer);
          resolve(buf);
        });
        process.stdin.resume();
      });
    }
  } catch {
    rawInput = '';
  }
  let payload = {};
  if (rawInput && rawInput.trim()) {
    try {
      payload = JSON.parse(rawInput);
    } catch {
      payload = {};
    }
  }
  const result = runAdvisorHook({ event, payload, pluginDir: pluginRoot, fsImpl: fs, env: process.env });
  if (result && Object.keys(result).length > 0) {
    process.stdout.write(JSON.stringify(result));
  }
  process.exit(0);
}
