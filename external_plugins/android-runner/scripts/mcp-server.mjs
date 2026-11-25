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
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import os from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const AR = join(HERE, 'ar.js');
const ASSET_ROOT = join(HERE, '..', 'assets');
const MANIFEST = join(HERE, '..', '.zcode-plugin', 'plugin.json');
const PLUGIN_VERSION = (() => {
  try {
    return JSON.parse(readFileSync(MANIFEST, 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
})();
const SURFACE_ID = 'android-runner';
const PANEL_URI = `ui://${SURFACE_ID}/panel.html`;
const ASSET_PREFIX = `ui://${SURFACE_ID}/assets/`;
const STATE_URI = `ui://${SURFACE_ID}/state.json`;
const LOGCAT_URI = `ui://${SURFACE_ID}/logcat.json`;
const JOB_PREFIX = `ui://${SURFACE_ID}/job/`;
const JSON_MIME = 'application/json';
const HTML_MIME = 'text/html;profile=mcp-app';

const STATE_FILE = join(os.homedir(), '.android-runner', 'panel-state.json');

function log(...parts) {
  process.stderr.write(`[android-runner] ${parts.join(' ')}\n`);
}

/* ------------------------------------------------------------------ */
/* 工程定位                                                            */
/* ------------------------------------------------------------------ */

function canonical(p) {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

function isInside(root, target) {
  const base = canonical(root);
  const path = canonical(target);
  return path === base || path.startsWith(base + sep);
}

function workspaceRoot() {
  return canonical(
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
  const root = workspaceRoot();
  const all = readState();
  const entry = all[root];
  if (entry && typeof entry.project === 'string') return entry.project;
  // 兼容旧的全局格式:仅当该工程仍在本工作区内时才采用
  if (typeof all.project === 'string' && isInside(root, all.project)) {
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
    // 多个窗口的 MCP 进程会写同一个文件;写临时文件再改名,避免读到半截 JSON
    const tmp = `${STATE_FILE}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(all, null, 2), 'utf8');
    await rename(tmp, STATE_FILE);
  } catch (error) {
    log('保存工程状态失败:', error.message);
  }
}

/** 解析当前要操作的 Gradle 工程目录 —— 始终限定在当前窗口的工作区内。 */
async function resolveProject(explicit) {
  const root = workspaceRoot();
  if (explicit !== undefined && explicit !== null && explicit !== '') {
    if (typeof explicit !== 'string') throw new Error('工程路径必须是字符串');
    const abs = canonical(resolve(root, explicit));
    if (!isInside(root, abs)) {
      throw new Error(
        `工程不在当前工作区内,已拒绝:${abs}\n当前工作区:${root}\n请打开该工程所在的窗口后再操作。`
      );
    }
    if (!isGradleRoot(abs)) {
      throw new Error(`不是 Gradle 工程根目录(没有 gradlew):${abs}`);
    }
    await rememberProject(abs);
    statusCache.at = 0;
    return abs;
  }

  if (currentProject && isInside(root, currentProject) && isGradleRoot(currentProject)) return currentProject;

  // 1) 本工作区记住的工程(必须仍在工作区内且还有 gradlew)
  const saved = savedProjectForWorkspace();
  if (saved && isInside(root, saved) && isGradleRoot(saved)) {
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

const OUTPUT_CAP = 400000;

function appendCapped(current, chunk) {
  const next = current + chunk;
  return next.length > OUTPUT_CAP ? next.slice(-OUTPUT_CAP) : next;
}

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
    child.stdout.on('data', (b) => { stdout = appendCapped(stdout, b.toString()); });
    child.stderr.on('data', (b) => { stderr = appendCapped(stderr, b.toString()); });
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
      javaCompatible: infoJson.javaCompatible !== false,
      javaNote: infoJson.javaNote || '',
      javaHomePreference: infoJson.javaHomePreference || '',
      javaHomes: Array.isArray(infoJson.javaHomes) ? infoJson.javaHomes : [],
      gradleVersion: infoJson.gradleVersion || '',
      task: infoJson.task || ''
    },
    app: {
      packageName: infoJson.packageName || '',
      module: infoJson.module || 'app',
      variant: infoJson.variant || 'debug',
      flavor: infoJson.flavor || '',
      flavorPreference: infoJson.flavorPreference || '',
      flavors: Array.isArray(infoJson.flavors) ? infoJson.flavors : [],
      variantFull: infoJson.variantFull || '',
      flavorAmbiguous: !!infoJson.flavorAmbiguous,
      flavorUnknown: !!infoJson.flavorUnknown,
      task: infoJson.task || '',
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
const JOB_KEEP = 20;

/** 只回收已结束的作业:运行中的作业被删掉会让面板轮询拿到 unknown job。 */
function trimJobs(keep) {
  if (jobs.size <= JOB_KEEP) return;
  for (const [id, job] of jobs) {
    if (jobs.size <= JOB_KEEP) break;
    if (id !== keep && job.done) jobs.delete(id);
  }
}

function pushJobText(job, chunk) {
  job.text = appendCapped(job.text, chunk.toString());
}

function spawnJob(action, args, project) {
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
  child.stdout.on('data', (buf) => pushJobText(job, buf));
  child.stderr.on('data', (buf) => pushJobText(job, buf));
  child.on('error', (error) => {
    pushJobText(job, `\n[启动失败] ${error.message}\n`);
    // spawn 失败时 close 不一定会来,直接结案,避免面板永远轮询
    if (!job.done) {
      job.done = true;
      job.exitCode = -1;
      trimJobs(id);
    }
  });
  child.on('close', (code) => {
    job.done = true;
    job.exitCode = code ?? -1;
    statusCache.at = 0; // 操作后状态失效
    log(`job ${id} (${action}) 结束,exit=${job.exitCode}`);
    trimJobs(id);
  });
  jobs.set(id, job);
  trimJobs(id);
  log(`job ${id} 启动: ar.js ${args.join(' ')} (cwd=${project})`);
  return job;
}

function startJob(action, { serial, confirm } = {}, project) {
  const base = ACTION_ARGS[action];
  if (!base) throw new Error(`未知操作:${action}`);
  const args = [...base];
  if (serial) args.push('--serial', serial);
  // 面板已用对话框确认过破坏性操作
  if ((action === 'uninstall' || action === 'clear-data') && confirm) args.push('--yes');
  return spawnJob(action, args, project);
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

/** 给客户端(工具或资源)的增量结果;资源读取也要推进 readAt。 */
function pollJobForClient(id) {
  const result = pollJob(id);
  if (!result) return null;
  const { _readAt, ...rest } = result;
  const job = jobs.get(id);
  if (job) job.readAt = _readAt;
  return rest;
}

function pollLogcatForClient() {
  const lines = logcat.lines.splice(0, logcat.lines.length);
  return { running: !!logcat.child, serial: logcat.serial, lines };
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

/** 先 SIGTERM 让 ar.js 自己收掉 adb 子进程,超时再 SIGKILL,避免留下孤儿 logcat。 */
function killProcess(child) {
  if (!child) return;
  try { child.kill('SIGTERM'); } catch { /* ignore */ }
  const timer = setTimeout(() => {
    try { child.kill('SIGKILL'); } catch { /* ignore */ }
  }, 1500);
  if (typeof timer.unref === 'function') timer.unref();
  child.once('close', () => clearTimeout(timer));
}

function stopLogcat() {
  const child = logcat.child;
  logcat.stopping = true;
  // 先摘掉引用,旧进程的 close/data 事件就不会污染新连接
  logcat.child = null;
  killProcess(child);
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
    if (logcat.child !== child) return;
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
  child.on('error', (error) => {
    if (logcat.child !== child) return;
    logcat.lines.push(`[logcat 启动失败] ${error.message}`);
    logcat.child = null;
  });
  child.on('close', () => {
    // 已被新的 logcat 取代:不要动新连接的状态
    if (logcat.child !== child) return;
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
          description: 'Optional Gradle project root: a workspace-relative path or an absolute path inside the current workspace.'
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
          description: 'Confirms destructive actions (uninstall / clear-data). Installs that hit a signature mismatch or version downgrade replace the app automatically.'
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
    name: 'panel_use_flavor',
    description:
      'Choose the productFlavor used for debug builds in this project, or reset to automatic selection (official when present). Runs and builds always stay on debug.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'productFlavor name, e.g. official or baidu.' },
        clear: { type: 'boolean', description: 'Reset to automatic selection.' }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: false },
    _meta: APP_VISIBILITY
  },
  {
    name: 'panel_use_java',
    description:
      'Choose the JDK used for Gradle builds in this project, or reset to automatic selection. The choice is remembered per project.',
    inputSchema: {
      type: 'object',
      properties: {
        home: { type: 'string', description: 'Absolute path to a JDK home (the directory containing bin/java).' },
        clear: { type: 'boolean', description: 'Reset to automatic selection based on the Gradle version and project config.' }
      },
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
      const result = pollJobForClient(args.id);
      if (!result) return jsonResult({ error: 'unknown job' }, true);
      return jsonResult(result);
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
      return jsonResult(pollLogcatForClient());
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
    case 'panel_use_flavor': {
      const project = await resolveProject();
      const commandArgs = args.clear || !args.name
        ? ['flavor', '--clear']
        : ['flavor', String(args.name)];
      const r = await runAr(commandArgs, project, { timeout: 60000 });
      statusCache.at = 0;
      return jsonResult(
        { ok: r.code === 0, output: `${r.stdout}${r.stderr}`.trim() },
        r.code !== 0
      );
    }
    case 'panel_use_java': {
      const project = await resolveProject();
      const commandArgs = args.clear || !args.home
        ? ['java', '--clear']
        : ['java', String(args.home)];
      const r = await runAr(commandArgs, project, { timeout: 60000 });
      statusCache.at = 0;
      return jsonResult(
        { ok: r.code === 0, output: `${r.stdout}${r.stderr}`.trim() },
        r.code !== 0
      );
    }
    default:
      throw new Error(`未知工具:${name}`);
  }
}

function startJobForAvd(name, project) {
  return spawnJob('start-avd', ['use', '--emulator', name], project);
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
  try {
    process.stdout.write(`${JSON.stringify(message)}\n`);
  } catch (error) {
    log('写入 stdout 失败(宿主可能已关闭):', error.message);
  }
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
          },
          {
            uri: STATE_URI,
            name: 'Android Runner state',
            mimeType: JSON_MIME
          },
          {
            uri: LOGCAT_URI,
            name: 'Android Runner logcat',
            mimeType: JSON_MIME
          }
        ]
      });
      return;
    case 'resources/templates/list':
      reply(id, {
        resourceTemplates: [
          { uriTemplate: `${ASSET_PREFIX}{+name}`, name: 'assets', mimeType: 'text/css' },
          { uriTemplate: `${JOB_PREFIX}{id}.json`, name: 'job', mimeType: JSON_MIME }
        ]
      });
      return;
    case 'resources/read': {
      const uri = params?.uri || '';
      const clean = String(uri).split(/[?#]/)[0];
      try {
        if (clean === PANEL_URI) {
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
        // 状态/任务/日志走资源读取:宿主不会把 resources/read 当成工具调用去审批,
        // 这样面板的定时刷新不会反复弹权限;只有动作按钮才走 tools/call。
        if (clean === STATE_URI) {
          const status = await collectStatus({ force: /[?&]refresh=1(?:&|$)/.test(uri) });
          reply(id, { contents: [{ uri, mimeType: JSON_MIME, text: JSON.stringify(status) }] });
          return;
        }
        if (clean === LOGCAT_URI) {
          reply(id, { contents: [{ uri, mimeType: JSON_MIME, text: JSON.stringify(pollLogcatForClient()) }] });
          return;
        }
        if (clean.startsWith(JOB_PREFIX)) {
          const jobId = decodeURIComponent(clean.slice(JOB_PREFIX.length).replace(/\.json$/i, ''));
          const result = pollJobForClient(jobId);
          reply(id, {
            contents: [
              { uri, mimeType: JSON_MIME, text: JSON.stringify(result || { error: 'unknown job' }) }
            ]
          });
          return;
        }
        if (clean.startsWith(ASSET_PREFIX)) {
          const name = decodeURIComponent(clean.slice(ASSET_PREFIX.length));
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

/** 退出前收尾:结束 logcat 与仍在跑的作业,避免留下孤儿 adb/gradle 进程。 */
function stopAllChildren() {
  stopLogcat();
  for (const job of jobs.values()) {
    if (job.done || !job.child) continue;
    killProcess(job.child);
  }
}

export async function main() {
  // 宿主断开管道时 stdout 会抛 EPIPE;不能让它把服务器打挂
  process.stdout.on('error', (error) => log('stdout 错误:', error.message));
  process.on('unhandledRejection', (reason) => log('未处理的 Promise 拒绝:', reason?.stack || String(reason)));
  const shutdown = () => {
    stopAllChildren();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  const rl = createInterface({ input: process.stdin });
  const inflight = new Set();
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
    const task = handle(message)
      .catch((error) => {
        log('处理消息失败:', error?.stack || String(error));
        if (message?.id !== undefined) replyError(message.id, -32603, String(error?.message || error));
      })
      .finally(() => inflight.delete(task));
    inflight.add(task);
  });
  rl.on('close', async () => {
    // stdin 关闭时可能有已收到但还在读资源的请求;给它们一点时间写完再退出
    if (inflight.size) {
      await Promise.race([
        Promise.allSettled([...inflight]),
        new Promise((done) => setTimeout(done, 1000))
      ]);
    }
    shutdown();
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
