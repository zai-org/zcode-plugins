/**
 * mcp-server.mjs —— Android Runner 的 MCP 服务器(ZCode 插件面板后端)
 *
 * 职责:
 *  1. 提供 ui://android-runner/panel.html 面板资源
 *  2. 暴露 open_panel(模型可调用,打开面板)
 *  3. 暴露 app-only 工具给面板调用:状态查询、执行操作、作业轮询、logcat
 *
 * 所有真实操作都委托给同目录的 ar.js(移植自 menggod/android-runner)。
 * stdout 只允许输出 JSON-RPC 帧,日志一律写 stderr。
 */

import { spawn } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import os from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const AR = join(HERE, 'ar.js');
const ASSET_ROOT = join(HERE, '..', 'assets');
const PLUGIN_VERSION = '0.4.0';
const SURFACE_ID = 'android-runner';
const PANEL_URI = `ui://${SURFACE_ID}/panel.html`;
const ASSET_PREFIX = `ui://${SURFACE_ID}/assets/`;
const HTML_MIME = 'text/html;profile=mcp-app';

const STATE_FILE = join(os.homedir(), '.android-runner', 'panel-state.json');

function log(...parts) {
  process.stderr.write(`[android-runner] ${parts.join(' ')}\n`);
}

/* ------------------------------------------------------------------ */
/* 工程定位                                                            */
/* ------------------------------------------------------------------ */

function workspaceRoot() {
  return (
    process.env.ZCODE_WORKSPACE_ROOT ||
    process.env.ZCODE_PROJECT_DIR ||
    process.cwd()
  );
}

function isGradleRoot(dir) {
  return (
    existsSync(join(dir, 'gradlew')) || existsSync(join(dir, 'gradlew.bat'))
  );
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.idea', '.gradle', 'build', 'dist', 'out',
  'Pods', 'target', 'vendor', '.venv', 'venv', '__pycache__', 'Library'
]);

/** 在 workspace 内浅层扫描 Gradle 工程(给面板做工程选择器)。 */
function scanProjects(root, maxDepth = 4, limit = 40) {
  const found = [];
  const seen = new Set();
  function walk(dir, depth) {
    if (found.length >= limit || seen.size > 4000) return;
    if (seen.has(dir)) return;
    seen.add(dir);
    if (isGradleRoot(dir)) {
      found.push(dir);
      return; // 不再深入子工程
    }
    if (depth >= maxDepth) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), depth + 1);
    }
  }
  walk(root, 0);
  return found;
}

let currentProject = null;

function readState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8')) || {};
  } catch {
    return {};
  }
}

/** 读取当前工作区记住的工程(按 workspace 隔离,换窗口不会串)。 */
function savedProjectForWorkspace() {
  const all = readState();
  const entry = all[workspaceRoot()];
  if (entry && typeof entry.project === 'string') return entry.project;
  // 兼容旧的全局格式:仅当该工程仍在本工作区内时才采用
  if (typeof all.project === 'string' && all.project.startsWith(workspaceRoot())) {
    return all.project;
  }
  return null;
}

async function rememberProject(project) {
  currentProject = project;
  try {
    const all = readState();
    delete all.project;
    delete all.at;
    all[workspaceRoot()] = { project, at: Date.now() };
    await mkdir(dirname(STATE_FILE), { recursive: true });
    await writeFile(STATE_FILE, JSON.stringify(all, null, 2), 'utf8');
  } catch (error) {
    log('保存工程状态失败:', error.message);
  }
}

/** 解析当前要操作的 Gradle 工程目录 —— 始终限定在当前窗口的工作区内。 */
async function resolveProject(explicit) {
  if (explicit) {
    const abs = resolve(explicit);
    if (!isGradleRoot(abs)) {
      throw new Error(`不是 Gradle 工程根目录(没有 gradlew):${abs}`);
    }
    await rememberProject(abs);
    statusCache.at = 0;
    return abs;
  }

  if (currentProject && isGradleRoot(currentProject)) return currentProject;

  const root = workspaceRoot();

  // 1) 本工作区记住的工程(必须仍然存在)
  const saved = savedProjectForWorkspace();
  if (saved && isGradleRoot(saved)) {
    currentProject = saved;
    return saved;
  }

  // 2) 工作区根目录自身或其上层就是 Gradle 工程
  if (isGradleRoot(root)) {
    currentProject = root;
    return root;
  }
  let dir = root;
  for (let i = 0; i < 6; i++) {
    if (isGradleRoot(dir)) {
      currentProject = dir;
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // 3) 只在当前工作区内向下扫描
  const candidates = scanProjects(root);
  if (candidates.length === 1) {
    currentProject = candidates[0];
    await rememberProject(candidates[0]);
    return candidates[0];
  }
  if (candidates.length === 0) {
    throw new Error(
      `当前工作区(${root})里没有找到 Gradle 工程(含 gradlew 的目录)。` +
        '请切换到 Android 工程所在的窗口,或在面板里指定工程路径。'
    );
  }
  const error = new Error(
    `当前工作区里有 ${candidates.length} 个 Gradle 工程,请选择:${candidates
      .map((c) => '\n  · ' + c.replace(root + '/', ''))
      .join('')}`
  );
  error.candidates = candidates;
  throw error;
}

/* ------------------------------------------------------------------ */
/* 调用 ar.js                                                          */
/* ------------------------------------------------------------------ */

function runAr(args, project, { timeout = 120000 } = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [AR, ...args], {
      cwd: project,
      env: { ...process.env, ANDROID_RUNNER_MCP: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
      }
    }, timeout);
    child.stdout.on('data', (b) => { stdout += b.toString(); });
    child.stderr.on('data', (b) => { stderr += b.toString(); });
    child.on('error', (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolvePromise({ code: -1, stdout, stderr: stderr + `\n${error.message}` });
    });
    child.on('close', (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolvePromise({ code: code ?? -1, stdout, stderr });
    });
  });
}

/** ar.js --json 输出可能带上 ❌ 提示行,这里只取 JSON 主体。 */
function parseJsonLoose(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* 状态汇总                                                            */
/* ------------------------------------------------------------------ */

let statusCache = { at: 0, data: null };

async function collectStatus({ force = false } = {}) {
  if (!force && statusCache.data && Date.now() - statusCache.at < 2000) {
    return statusCache.data;
  }
  const root = workspaceRoot();
  let project = null;
  let projectError = null;
  try {
    project = await resolveProject();
  } catch (error) {
    projectError = { message: error.message, candidates: error.candidates || [] };
  }

  const candidates = projectError?.candidates?.length ? projectError.candidates : scanProjects(root);

  if (!project) {
    const data = {
      project: null,
      workspace: root,
      projectError,
      candidates,
      devices: [],
      avds: [],
      preference: null,
      env: null,
      app: null
    };
    statusCache = { at: Date.now(), data };
    return data;
  }

  const [devicesRun, infoRun] = await Promise.all([
    runAr(['devices', '--json'], project, { timeout: 30000 }),
    runAr(['info', '--json'], project, { timeout: 30000 })
  ]);
  const devicesJson = parseJsonLoose(devicesRun.stdout) || {};
  const infoJson = parseJsonLoose(infoRun.stdout) || {};

  const data = {
    project,
    workspace: root,
    projectError: null,
    candidates,
    devices: devicesJson.devices || [],
    avds: devicesJson.avds || [],
    preference: devicesJson.preference || null,
    deviceError: devicesJson.error || (devicesRun.code === 2 && !devicesJson.devices ? (devicesRun.stderr || '').split('\n')[0] : null),
    env: {
      sdk: infoJson.sdk || '',
      adb: infoJson.adb || '',
      adbUsable: !!infoJson.adbUsable,
      javaHome: infoJson.javaHome || '',
      javaSource: infoJson.javaSource || '',
      javaVersion: infoJson.javaVersion || '',
      gradleVersion: infoJson.gradleVersion || '',
      task: infoJson.task || ''
    },
    app: {
      packageName: infoJson.packageName || '',
      module: infoJson.module || 'app',
      variant: infoJson.variant || 'debug',
      apk: infoJson.apk || null
    }
  };
  statusCache = { at: Date.now(), data };
  return data;
}

/* ------------------------------------------------------------------ */
/* 作业(长任务后台执行 + 增量输出)                                     */
/* ------------------------------------------------------------------ */

/** action → ar.js 参数 */
const ACTION_ARGS = {
  build: ['build'],
  install: ['install'],
  run: ['run'],
  launch: ['launch'],
  stop: ['stop'],
  restart: ['restart'],
  doctor: ['doctor'],
  uninstall: ['uninstall'],
  'clear-data': ['clear-data'],
  refresh: null
};

const jobs = new Map();
let jobSeq = 0;

function startJob(action, { serial, confirm } = {}, project) {
  const base = ACTION_ARGS[action];
  if (!base) throw new Error(`未知操作:${action}`);
  const args = [...base];
  if (serial) args.push('--serial', serial);
  // 面板已用对话框确认过破坏性操作
  if ((action === 'uninstall' || action === 'clear-data') && confirm) args.push('--yes');
  if (action === 'install' && confirm) args.push('--reinstall');

  const id = `job-${++jobSeq}`;
  const child = spawn(process.execPath, [AR, ...args], {
    cwd: project,
    env: { ...process.env, ANDROID_RUNNER_MCP: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const job = {
    id,
    action,
    args,
    startedAt: Date.now(),
    text: '',
    readAt: 0,
    done: false,
    exitCode: null,
    child
  };
  const push = (buf) => {
    job.text += buf.toString();
    if (job.text.length > 400000) job.text = job.text.slice(-300000);
  };
  child.stdout.on('data', push);
  child.stderr.on('data', push);
  child.on('error', (error) => {
    push(Buffer.from(`\n[启动失败] ${error.message}\n`));
  });
  const finish = (code) => {
    job.done = true;
    job.exitCode = code ?? -1;
    statusCache.at = 0; // 操作后状态失效
    log(`job ${id} (${action}) 结束,exit=${job.exitCode}`);
  };
  child.on('close', finish);
  jobs.set(id, job);
  // 保留最近 20 个作业
  if (jobs.size > 20) {
    const oldest = jobs.keys().next().value;
    if (oldest !== id) jobs.delete(oldest);
  }
  log(`job ${id} 启动: ar.js ${args.join(' ')} (cwd=${project})`);
  return job;
}

function pollJob(id) {
  const job = jobs.get(id);
  if (!job) return null;
  const chunk = job.text.slice(job.readAt);
  const readAt = job.text.length;
  return {
    id: job.id,
    action: job.action,
    running: !job.done,
    exitCode: job.exitCode,
    output: chunk,
    elapsedMs: Date.now() - job.startedAt,
    _readAt: readAt
  };
}

/* ------------------------------------------------------------------ */
/* logcat                                                             */
/* ------------------------------------------------------------------ */

const logcat = {
  child: null,
  serial: null,
  lines: [],
  carry: '',
  stopping: false
};

function stopLogcat() {
  if (logcat.child) {
    logcat.stopping = true;
    try { logcat.child.kill('SIGKILL'); } catch { /* ignore */ }
    logcat.child = null;
  }
  logcat.serial = null;
  return true;
}

function startLogcat(serial, project) {
  stopLogcat();
  logcat.lines = [];
  logcat.carry = '';
  logcat.stopping = false;
  const args = ['logcat'];
  if (serial) args.push('--serial', serial);
  const child = spawn(process.execPath, [AR, ...args], {
    cwd: project,
    env: { ...process.env, ANDROID_RUNNER_MCP: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  logcat.child = child;
  logcat.serial = serial || 'auto';
  const onData = (buf) => {
    logcat.carry += buf.toString();
    const parts = logcat.carry.split('\n');
    logcat.carry = parts.pop() ?? '';
    for (const line of parts) {
      logcat.lines.push(line);
    }
    if (logcat.lines.length > 4000) logcat.lines.splice(0, logcat.lines.length - 4000);
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('close', () => {
    if (!logcat.stopping) {
      logcat.lines.push('[logcat 已结束]');
    }
    logcat.child = null;
  });
  return { started: true, serial: logcat.serial };
}

/* ------------------------------------------------------------------ */
/* 工具定义                                                            */
/* ------------------------------------------------------------------ */

const APP_VISIBILITY = { ui: { visibility: ['app'] } };

const TOOLS = [
  {
    name: 'open_panel',
    description:
      'Open the Android Runner panel in ZCode. It shows connected devices, emulators, build environment, APK info and action buttons (run/build/install/launch/stop/logcat/doctor). Use it when the user wants a visual console for Android device work.',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'Optional absolute or workspace-relative path to the Gradle project root.'
        }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
    _meta: {
      ui: { resourceUri: PANEL_URI, surface: SURFACE_ID, visibility: ['model', 'app'] },
      'openai/ui': { preferredModelDisplayMode: 'fullscreen' }
    }
  },
  {
    name: 'panel_status',
    description: 'Read the Android Runner panel state: project, devices, emulators, environment, app.',
    inputSchema: {
      type: 'object',
      properties: {
        refresh: { type: 'boolean', description: 'Force a fresh device scan.' },
        project: { type: 'string', description: 'Switch to this Gradle project root first.' }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true },
    _meta: APP_VISIBILITY
  },
  {
    name: 'panel_action',
    description:
      'Start a device action in the background and return a job id. Poll it with panel_job. Actions: build, install, run, launch, stop, restart, doctor, uninstall, clear-data.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['build', 'install', 'run', 'launch', 'stop', 'restart', 'doctor', 'uninstall', 'clear-data']
        },
        serial: { type: 'string', description: 'Target device serial; defaults to the remembered device.' },
        confirm: {
          type: 'boolean',
          description: 'Confirms destructive actions (uninstall / clear-data) or reinstall on signature mismatch.'
        }
      },
      required: ['action'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false },
    _meta: APP_VISIBILITY
  },
  {
    name: 'panel_job',
    description: 'Poll a job started by panel_action; returns new output since the last poll.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true },
    _meta: APP_VISIBILITY
  },
  {
    name: 'panel_logcat',
    description: 'Start, poll or stop logcat streaming for the current app.',
    inputSchema: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['start', 'poll', 'stop'] },
        serial: { type: 'string' }
      },
      required: ['op'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false },
    _meta: APP_VISIBILITY
  },
  {
    name: 'panel_select_project',
    description: 'Switch the panel to another Gradle project and persist the choice.',
    inputSchema: {
      type: 'object',
      properties: { project: { type: 'string' } },
      required: ['project'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false },
    _meta: APP_VISIBILITY
  },
  {
    name: 'panel_use_device',
    description: 'Remember a device as the target for this project (ar.js use <serial>).',
    inputSchema: {
      type: 'object',
      properties: { serial: { type: 'string' } },
      required: ['serial'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false },
    _meta: APP_VISIBILITY
  },
  {
    name: 'panel_start_avd',
    description: 'Boot an Android emulator by AVD name and select it.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false },
    _meta: APP_VISIBILITY
  }
];

const TOOL_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

async function callTool(name, args = {}) {
  switch (name) {
    case 'open_panel': {
      if (args.project) await resolveProject(args.project);
      const status = await collectStatus();
      return textResult(
        status.project
          ? `Android Runner panel opened for ${status.project}.`
          : 'Android Runner panel opened. No Gradle project selected yet; choose one in the panel.'
      );
    }
    case 'panel_status': {
      if (args.project) await resolveProject(args.project);
      const status = await collectStatus({ force: !!args.refresh });
      return jsonResult(status);
    }
    case 'panel_action': {
      const project = await resolveProject();
      const job = startJob(args.action, args, project);
      return jsonResult({ jobId: job.id, action: job.action, command: `ar.js ${job.args.join(' ')}` });
    }
    case 'panel_job': {
      const result = pollJob(args.id);
      if (!result) return jsonResult({ error: 'unknown job' }, true);
      const { _readAt, ...rest } = result;
      const job = jobs.get(args.id);
      if (job) job.readAt = _readAt;
      return jsonResult(rest);
    }
    case 'panel_logcat': {
      if (args.op === 'start') {
        const project = await resolveProject();
        return jsonResult(startLogcat(args.serial, project));
      }
      if (args.op === 'stop') {
        stopLogcat();
        return jsonResult({ stopped: true });
      }
      const lines = logcat.lines.splice(0, logcat.lines.length);
      return jsonResult({ running: !!logcat.child, serial: logcat.serial, lines });
    }
    case 'panel_select_project': {
      const project = await resolveProject(args.project);
      await rememberProject(project);
      statusCache.at = 0;
      return jsonResult({ project });
    }
    case 'panel_use_device': {
      const project = await resolveProject();
      const r = await runAr(['use', args.serial], project, { timeout: 30000 });
      statusCache.at = 0;
      return jsonResult(
        { ok: r.code === 0, output: `${r.stdout}${r.stderr}`.trim() },
        r.code !== 0
      );
    }
    case 'panel_start_avd': {
      const project = await resolveProject();
      const job = startJobForAvd(args.name, project);
      return jsonResult({ jobId: job.id, action: 'start-avd' });
    }
    default:
      throw new Error(`未知工具:${name}`);
  }
}

function startJobForAvd(name, project) {
  const id = `job-${++jobSeq}`;
  const child = spawn(process.execPath, [AR, 'use', '--emulator', name], {
    cwd: project,
    env: { ...process.env, ANDROID_RUNNER_MCP: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const job = { id, action: 'start-avd', args: ['use', '--emulator', name], startedAt: Date.now(), text: '', readAt: 0, done: false, exitCode: null, child };
  const push = (buf) => { job.text += buf.toString(); };
  child.stdout.on('data', push);
  child.stderr.on('data', push);
  child.on('close', (code) => {
    job.done = true;
    job.exitCode = code ?? -1;
    statusCache.at = 0;
  });
  jobs.set(id, job);
  return job;
}

function textResult(text, isError = false) {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}

function jsonResult(value, isError = false) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
    ...(isError ? { isError: true } : {})
  };
}

/* ------------------------------------------------------------------ */
/* 资源                                                                */
/* ------------------------------------------------------------------ */

async function readPanelHtml() {
  return readFile(join(ASSET_ROOT, 'panel.html'), 'utf8');
}

async function readAsset(name) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) throw new Error(`非法资源名:${name}`);
  const file = join(ASSET_ROOT, name);
  if (!file.startsWith(ASSET_ROOT)) throw new Error(`非法资源路径:${name}`);
  if (!existsSync(file)) throw new Error(`资源不存在:${name}`);
  if (/\.(css)$/.test(name)) return { mimeType: 'text/css', text: await readFile(file, 'utf8') };
  if (/\.(js|mjs)$/.test(name)) return { mimeType: 'text/javascript', text: await readFile(file, 'utf8') };
  if (/\.(json)$/.test(name)) return { mimeType: 'application/json', text: await readFile(file, 'utf8') };
  const bytes = await readFile(file);
  return { mimeType: 'application/octet-stream', blob: bytes.toString('base64') };
}

/* ------------------------------------------------------------------ */
/* MCP 服务器                                                          */
/* ------------------------------------------------------------------ */

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function replyError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handle(message) {
  const { id, method, params } = message;
  // 通知(无 id)只做副作用
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') return;

  switch (method) {
    case 'initialize': {
      reply(id, {
        protocolVersion: params?.protocolVersion || '2025-06-18',
        capabilities: {
          tools: { listChanged: false },
          resources: { listChanged: false }
        },
        serverInfo: { name: SURFACE_ID, version: PLUGIN_VERSION }
      });
      return;
    }
    case 'ping':
      reply(id, {});
      return;
    case 'tools/list':
      reply(id, { tools: TOOLS.map(({ name, description, inputSchema, annotations, _meta }) => ({ name, description, inputSchema, annotations, _meta })) });
      return;
    case 'tools/call': {
      const name = params?.name;
      if (!TOOL_BY_NAME.has(name)) {
        replyError(id, -32602, `未知工具:${name}`);
        return;
      }
      try {
        const result = await callTool(name, params?.arguments || {});
        reply(id, result);
      } catch (error) {
        log(`tools/call ${name} 失败:`, error?.stack || error?.message || String(error));
        reply(id, textResult(`[error] ${error?.message || String(error)}`, true));
      }
      return;
    }
    case 'resources/list':
      reply(id, {
        resources: [
          {
            uri: PANEL_URI,
            name: 'Android Runner panel',
            mimeType: HTML_MIME
          }
        ]
      });
      return;
    case 'resources/templates/list':
      reply(id, {
        resourceTemplates: [
          { uriTemplate: `${ASSET_PREFIX}{+name}`, name: 'assets', mimeType: 'text/css' }
        ]
      });
      return;
    case 'resources/read': {
      const uri = params?.uri || '';
      try {
        if (uri === PANEL_URI) {
          reply(id, {
            contents: [
              {
                uri,
                mimeType: HTML_MIME,
                text: await readPanelHtml(),
                _meta: { 'zcode/csp': {} }
              }
            ]
          });
          return;
        }
        if (uri.startsWith(ASSET_PREFIX)) {
          const name = decodeURIComponent(uri.slice(ASSET_PREFIX.length));
          const asset = await readAsset(name);
          reply(id, { contents: [{ uri, ...asset }] });
          return;
        }
        replyError(id, -32602, `未知资源:${uri}`);
      } catch (error) {
        replyError(id, -32603, error.message);
      }
      return;
    }
    case 'prompts/list':
      reply(id, { prompts: [] });
      return;
    default:
      if (id !== undefined) replyError(id, -32601, `Method not found: ${method}`);
  }
}

export async function main() {
  const rl = createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      log('收到非 JSON 行,已忽略');
      return;
    }
    handle(message).catch((error) => {
      log('处理消息失败:', error?.stack || String(error));
      if (message?.id !== undefined) replyError(message.id, -32603, String(error?.message || error));
    });
  });
  rl.on('close', () => {
    stopLogcat();
    process.exit(0);
  });
  log(`已启动 (workspace=${workspaceRoot()})`);
}

if (
  process.env.ANDROID_RUNNER_MCP_NO_AUTOSTART !== '1' &&
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    log('启动失败:', error?.stack || String(error));
    process.exit(1);
  });
}
