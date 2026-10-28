'use strict';

// 事件文件监听与每会话状态机：与 macOS Swift 版（desktop/Sources/Model.swift）同一套语义。
// hooks 把 stdin JSON 包成 feed/*.json，这里扫描、折叠成看板任务快照，消费后删除。

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MAX_TASKS = 16;
const RUNNING_STALE_MS = 60 * 60 * 1000;
const WAITING_STALE_MS = 12 * 60 * 60 * 1000;
const DONE_STALE_MS = 10 * 60 * 1000;

function stateRoot() {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'XiaoqiPet');
  }
  if (process.platform === 'win32') {
    const appdata = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appdata, 'XiaoqiPet');
  }
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(xdg, 'xiaoqi-pet');
}

function feedDir() {
  return path.join(stateRoot(), 'feed');
}

function emoteDir() {
  return path.join(stateRoot(), 'emote');
}

function shortText(value, max) {
  if (typeof value !== 'string') return '';
  const text = value.replace(/\s+/g, ' ').trim();
  if (text === '') return '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function lastSeparatorIndex(value) {
  const slash = value.lastIndexOf('/');
  const backslash = value.lastIndexOf('\\');
  return Math.max(slash, backslash);
}

function fileBase(value) {
  if (typeof value !== 'string' || value.trim() === '') return '';
  const normalized = value.replace(/[\\/]+$/, '');
  const index = lastSeparatorIndex(normalized);
  const base = index >= 0 ? normalized.slice(index + 1) : normalized;
  return shortText(base, 80);
}

function projectName(cwd) {
  if (typeof cwd !== 'string' || cwd.trim() === '') return '';
  const normalized = cwd.replace(/[\\/]+$/, '');
  const index = lastSeparatorIndex(normalized);
  const base = index >= 0 ? normalized.slice(index + 1) : normalized;
  return base === '' ? normalized : base;
}

function firstQuery(value) {
  if (Array.isArray(value)) return shortText(String(value[0] ?? ''), 80);
  return shortText(String(value ?? ''), 80);
}

function parseToolArguments(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string' && value.length <= 262_144) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function isoToMs(value) {
  if (typeof value !== 'string' || value === '') return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function actionForTool(rawName, args) {
  const name = rawName === '' ? 'tool' : rawName;
  switch (name) {
    case 'Read':
    case 'ReadImage':
      return { kind: 'read', target: fileBase(args.file_path ?? args.path) };
    case 'Write':
    case 'ApplyPatch':
    case 'NotebookEdit':
      return { kind: 'write', target: fileBase(args.file_path ?? args.path) };
    case 'Edit':
    case 'MultiEdit':
      return { kind: 'edit', target: fileBase(args.file_path ?? args.path) };
    case 'Bash':
    case 'PowerShell': {
      const target = shortText(args.description, 100) || shortText(args.command, 100) || 'shell';
      return { kind: 'bash', target };
    }
    case 'Glob':
      return { kind: 'glob', target: shortText(args.pattern, 80) || shortText(args.path, 80) };
    case 'Grep':
      return { kind: 'grep', target: shortText(args.pattern, 80) || shortText(args.path, 80) || 'content' };
    case 'WebSearch':
      return { kind: 'search', target: firstQuery(args.queries ?? args.query) || 'web' };
    case 'WebFetch':
      return { kind: 'fetch', target: shortText(args.url, 100) || 'web' };
    case 'Agent':
    case 'Task':
    case 'AgentFork':
      return { kind: 'subagent', target: shortText(args.description, 80) || 'delegate' };
    case 'Workflow':
      return { kind: 'workflow', target: shortText(args.name, 80) || shortText(args.description, 80) };
    case 'Skill':
      return { kind: 'skill', target: shortText(args.skill ?? args.name, 60) || 'skill' };
    case 'TodoWrite':
      return { kind: 'todo', target: '' };
    case 'CronCreate':
    case 'CronUpdate':
    case 'CronDelete':
    case 'OffPeakCreate':
      return { kind: 'schedule', target: shortText(args.title, 80) || name };
    case 'AskUserQuestion': {
      let target = '';
      if (Array.isArray(args.questions) && typeof args.questions[0] === 'object' && args.questions[0]) {
        target = shortText(args.questions[0].question, 80);
      }
      return { kind: 'question', target };
    }
    case 'EnterPlanMode':
    case 'ExitPlanMode':
      return { kind: 'plan', target: '' };
    default: {
      if (name.startsWith('mcp__')) {
        const parts = name.split('__').filter(Boolean);
        const target = parts.length > 2 ? `${parts[1]} · ${parts[2]}` : parts.slice(1).join(' · ');
        return { kind: 'mcp', target: shortText(target, 80) };
      }
      return { kind: 'tool', target: shortText(name, 60) };
    }
  }
}

function todosForArgs(args) {
  if (!Array.isArray(args.todos)) return null;
  const items = args.todos
    .slice(0, 24)
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const content = shortText(item.content, 160);
      if (content === '') return null;
      const status = item.status === 'completed' || item.status === 'in_progress' ? item.status : 'pending';
      return { content, status };
    })
    .filter(Boolean);
  if (items.length === 0) return null;
  const completed = items.filter((item) => item.status === 'completed').length;
  const current = (items.find((item) => item.status === 'in_progress') || {}).content || '';
  return { total: items.length, completed, current };
}

class SessionState {
  constructor(id, project, atMs) {
    this.id = id;
    this.project = project;
    this.kind = 'running';
    this.phase = 'starting';
    this.turn = 0;
    this.step = 0;
    this.tool = '';
    this.toolCount = 0;
    this.turnStartedAt = atMs;
    this.lastAt = atMs;
    this.action = null;
    this.todos = null;
    this.trail = [];
    this.pendingKind = '';
    this.pendingTool = '';
  }

  pushTrail(item) {
    this.trail.push(item);
    if (this.trail.length > 6) this.trail = this.trail.slice(-6);
  }

  markCurrentActionDone(failed) {
    if (this.action) {
      this.action = { ...this.action, done: true, failed: failed || false };
      const last = this.trail[this.trail.length - 1];
      if (last && last.kind === 'action' && last.actionKind === this.action.kind) {
        this.trail[this.trail.length - 1] = { ...last, done: true, failed: failed || false };
      }
    }
  }

  apply(event, atMs, payload, cwd) {
    const project = projectName(cwd);
    if (project !== '') this.project = project;
    this.lastAt = atMs;

    switch (event) {
      case 'SessionStart':
        this.kind = 'running';
        this.phase = 'starting';
        this.pendingKind = '';
        this.pendingTool = '';
        if (this.turnStartedAt === 0) this.turnStartedAt = atMs;
        break;
      case 'UserPromptSubmit':
        this.turn += 1;
        this.step = 0;
        this.tool = '';
        this.toolCount = 0;
        this.phase = 'thinking';
        this.action = null;
        this.trail = [];
        this.turnStartedAt = atMs;
        this.kind = 'running';
        this.pendingKind = '';
        this.pendingTool = '';
        break;
      case 'PreToolUse': {
        const name = typeof payload.tool_name === 'string' ? payload.tool_name : (payload.toolName ?? '');
        const args = parseToolArguments(payload.tool_input ?? payload.toolInput);
        const action = actionForTool(String(name), args);
        this.step += 1;
        this.tool = String(name);
        this.toolCount += 1;
        this.phase = 'tool';
        this.kind = 'running';
        this.pendingKind = '';
        this.pendingTool = '';
        this.action = { ...action, done: false, failed: false };
        if (String(name) === 'TodoWrite') {
          const todos = todosForArgs(args);
          if (todos) this.todos = todos;
        }
        this.pushTrail({ kind: 'action', label: action.target, at: atMs, actionKind: action.kind, done: false, failed: false });
        break;
      }
      case 'PermissionRequest': {
        this.kind = 'waiting';
        this.pendingKind = 'approval';
        const name = typeof payload.tool_name === 'string' ? payload.tool_name : (payload.toolName ?? '');
        this.pendingTool = String(name) !== ''
          ? String(name)
          : shortText(typeof payload.reason === 'string' ? payload.reason : '', 60);
        break;
      }
      case 'PostToolUse':
        this.markCurrentActionDone(false);
        this.phase = 'thinking';
        this.tool = '';
        break;
      case 'PostToolUseFailure':
        this.markCurrentActionDone(true);
        this.phase = 'thinking';
        this.tool = '';
        this.kind = 'running';
        break;
      case 'Stop':
        this.phase = 'done';
        this.kind = 'done';
        this.tool = '';
        this.pendingKind = '';
        this.pendingTool = '';
        break;
      default:
        break;
    }
  }

  task(nowMs) {
    let elapsed = 0;
    if (this.turnStartedAt > 0) {
      elapsed = this.phase === 'done'
        ? Math.max(0, this.lastAt - this.turnStartedAt)
        : Math.max(0, nowMs - this.turnStartedAt);
    }
    return {
      id: this.id,
      title: this.project === '' ? 'ZCode' : this.project,
      project: this.project,
      kind: this.kind,
      pendingKind: this.pendingKind === '' ? null : this.pendingKind,
      pendingTool: this.pendingTool === '' ? null : this.pendingTool,
      current: false,
      updatedAt: this.lastAt,
      progress: {
        phase: this.phase,
        turn: this.turn,
        step: this.step,
        tool: this.tool,
        toolCount: this.toolCount,
        elapsedMs: elapsed,
        updatedAt: this.lastAt,
        action: this.action,
        todos: this.todos,
        trail: this.trail.slice(-4),
      },
    };
  }
}

class SessionStore {
  constructor() {
    this.sessions = new Map();
    this.lastEventAt = 0;
  }

  apply(event, atMs, payload, cwd) {
    const id = typeof payload.session_id === 'string' && payload.session_id !== ''
      ? payload.session_id
      : (typeof payload.sessionId === 'string' && payload.sessionId !== '' ? payload.sessionId : '(unknown)');
    let state = this.sessions.get(id);
    if (!state) {
      state = new SessionState(id, projectName(cwd), atMs);
      this.sessions.set(id, state);
    }
    state.apply(event, atMs, payload, cwd);
    this.lastEventAt = Math.max(this.lastEventAt, atMs);
  }

  prune(nowMs) {
    for (const [id, state] of this.sessions) {
      const age = nowMs - state.lastAt;
      const stale = state.kind === 'waiting'
        ? age >= WAITING_STALE_MS
        : (state.kind === 'done' ? age >= DONE_STALE_MS : age >= RUNNING_STALE_MS);
      if (stale) this.sessions.delete(id);
    }
  }

  snapshot(nowMs) {
    this.prune(nowMs);
    const tasks = [...this.sessions.values()]
      .map((state) => state.task(nowMs))
      .sort((left, right) => (right.updatedAt - left.updatedAt) || left.id.localeCompare(right.id));
    return tasks.slice(0, MAX_TASKS);
  }
}

function scanDirectory(directory, onEnvelope, remove) {
  let entries;
  try {
    entries = fs.readdirSync(directory);
  } catch {
    return;
  }
  for (const name of entries.sort()) {
    if (!name.endsWith('.json') || name.startsWith('.')) continue;
    const file = path.join(directory, name);
    let envelope;
    try {
      envelope = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      if (remove) {
        try { fs.unlinkSync(file); } catch { /* leave it; a later sweep can retry */ }
      }
      continue;
    }
    if (envelope && typeof envelope === 'object') onEnvelope(envelope);
    if (remove) {
      try { fs.unlinkSync(file); } catch { /* ignore */ }
    }
  }
}

function collectEvents(remove) {
  const events = [];
  const emotes = [];
  scanDirectory(feedDir(), (envelope) => {
    if (typeof envelope.event !== 'string') return;
    const payload = envelope.payload && typeof envelope.payload === 'object' ? envelope.payload : {};
    const atSeconds = Number(envelope.at) || 0;
    // 事件自身的 ISO 时间戳最精确；缺失时才退回 hook 落盘时刻（秒级）。
    const payloadMs = isoToMs(payload.timestamp ?? payload.time);
    const atMs = payloadMs > 0 ? payloadMs : atSeconds * 1000;
    events.push({
      event: envelope.event,
      atMs,
      cwd: typeof envelope.cwd === 'string' ? envelope.cwd : '',
      payload,
    });
  }, remove);
  scanDirectory(emoteDir(), (envelope) => emotes.push(envelope), remove);
  events.sort((left, right) => left.atMs - right.atMs);
  return { events, emotes };
}

module.exports = {
  MAX_TASKS,
  stateRoot,
  feedDir,
  emoteDir,
  collectEvents,
  SessionStore,
  actionForTool,
  projectName,
  shortText,
  isoToMs,
};
