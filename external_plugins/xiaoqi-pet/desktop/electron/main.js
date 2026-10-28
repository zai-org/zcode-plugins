'use strict';

// 小栖桌宠跨平台伴侣（Windows / Linux / macOS）。
// 状态来源：xiaoqi-pet 插件 hooks 落盘的事件文件（feed.js），不再轮询任何 HTTP 桥。

const { app, BrowserWindow, dialog, ipcMain, screen, Tray, Menu, nativeImage, shell, Notification } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const feed = require('./feed');
const usage = require('./usage');

const PET_W = 196;
const PANEL_W = 372;
const POLL_MS = 1000;

const isMac = process.platform === 'darwin';
const isWindows = process.platform === 'win32';
const isLinux = process.platform === 'linux';

if (isLinux) {
  app.commandLine.appendSwitch('enable-transparent-visuals');
}
if (isWindows) {
  app.setAppUserModelId('com.xiaoqi.zcode-deskpet');
}

let petWindow = null;
let panelWindow = null;
let tray = null;
let pollTimer = null;
let polling = false;
let store = new feed.SessionStore();
let state = { connected: false, tasks: [], source: 'hooks', balance: null, emote: null };
let emptyScans = 0;
let panelAuto = false;
let panelManuallyClosed = false;
let dragState = null;
let quitting = false;
let petPosition = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showPet());
  app.whenReady().then(start).catch((error) => {
    console.error('[xiaoqi] startup failed', error);
    app.quit();
  });
}

app.on('window-all-closed', () => {
  // 隐藏宠物时仍驻留托盘。
});

app.on('before-quit', () => {
  quitting = true;
  savePosition();
  if (pollTimer) clearInterval(pollTimer);
});

function zh() {
  return String(app.getLocale() || '').toLowerCase().startsWith('zh');
}

function prefsPath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function loadPosition() {
  const saved = readJson(prefsPath());
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    petPosition = { x: Math.round(saved.x), y: Math.round(saved.y) };
  }
}

function savePosition() {
  if (!petWindow || petWindow.isDestroyed()) return;
  const bounds = petWindow.getBounds();
  petPosition = { x: bounds.x, y: bounds.y };
  try {
    fs.mkdirSync(path.dirname(prefsPath()), { recursive: true });
    fs.writeFileSync(prefsPath(), JSON.stringify(petPosition), { mode: 0o600 });
  } catch {
    // 位置持久化失败可忽略。
  }
}

function clampPosition(x, y, width, height) {
  const display = screen.getDisplayNearestPoint({
    x: Math.round(x + width / 2),
    y: Math.round(y + height / 2),
  });
  const area = display.workArea;
  return {
    x: Math.min(Math.max(Math.round(x), area.x + 4), area.x + area.width - width - 4),
    y: Math.min(Math.max(Math.round(y), area.y + 4), area.y + area.height - height - 4),
  };
}

function petHeight() {
  return state.tasks.length === 1 ? 248 : 188;
}

function defaultPosition() {
  const area = screen.getPrimaryDisplay().workArea;
  return {
    x: area.x + 24,
    y: area.y + area.height - petHeight() - 24,
  };
}

function nativePetRunning() {
  if (!isMac) return false;
  try {
    const result = spawnSync('pgrep', ['-f', 'ZCode Xiaoqi Pet.app/Contents/MacOS/XiaoqiPet'], { encoding: 'utf8' });
    return result.status === 0;
  } catch {
    return false;
  }
}

function start() {
  if (nativePetRunning()) {
    dialog.showMessageBoxSync({
      type: 'info',
      title: 'Xiaoqi',
      message: zh() ? '请使用 macOS 原生小栖' : 'Please use the native macOS Xiaoqi',
      detail: zh()
        ? 'macOS 原生小栖正在运行；跨平台版已退出，避免桌面上同时出现两只小栖。'
        : 'A native Xiaoqi pet is already running. The cross-platform Electron version will exit so two pets do not appear on the desktop.',
    });
    app.quit();
    return;
  }
  if (isMac && app.dock) app.dock.hide();
  try {
    fs.mkdirSync(feed.feedDir(), { recursive: true, mode: 0o700 });
    fs.mkdirSync(feed.emoteDir(), { recursive: true, mode: 0o700 });
  } catch {
    // 目录可能已存在。
  }
  loadPosition();
  const initial = petPosition || defaultPosition();
  const safe = clampPosition(initial.x, initial.y, PET_W, petHeight());
  petPosition = safe;

  createPetWindow(safe);
  createPanelWindow();
  createTray();
  startPolling();
}

function createPetWindow(position) {
  petWindow = new BrowserWindow({
    x: position.x,
    y: position.y,
    width: PET_W,
    height: petHeight(),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    title: 'Xiaoqi Pet',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  try {
    petWindow.setAlwaysOnTop(true, 'floating');
    petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch {
    // 平台窗口细节；基础窗口不受影响。
  }
  petWindow.loadFile(path.join(__dirname, 'renderer', 'pet.html'));
  petWindow.webContents.on('did-finish-load', () => {
    sendState();
    if (petWindow && !petWindow.isVisible()) petWindow.showInactive();
  });
  petWindow.once('ready-to-show', () => {
    if (petWindow && !petWindow.isVisible()) petWindow.showInactive();
  });
  petWindow.on('closed', () => {
    petWindow = null;
  });
}

function createPanelWindow() {
  panelWindow = new BrowserWindow({
    width: PANEL_W,
    height: 420,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    title: 'Xiaoqi Tasks',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  try {
    panelWindow.setAlwaysOnTop(true, 'floating');
    panelWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch {
    // 可选的平台润色。
  }
  panelWindow.loadFile(path.join(__dirname, 'renderer', 'panel.html'));
  panelWindow.webContents.on('did-finish-load', sendState);
  panelWindow.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    hidePanel(true);
  });
  panelWindow.on('closed', () => {
    panelWindow = null;
  });
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  let image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) image = nativeImage.createEmpty();
  image = image.resize({ width: 18, height: 18 });
  tray = new Tray(image);
  tray.setToolTip(zh() ? '小栖桌宠' : 'Xiaoqi');
  updateTrayMenu();
  tray.on('click', () => {
    if (!petWindow) return;
    if (petWindow.isVisible()) hidePet();
    else showPet();
  });
}

function updateTrayMenu() {
  if (!tray) return;
  const labels = zh()
    ? { show: '显示小栖', hide: '隐藏小栖', panel: '任务面板', refresh: '刷新用量 / 余量', quit: '退出小栖' }
    : { show: 'Show Xiaoqi', hide: 'Hide Xiaoqi', panel: 'Task board', refresh: 'Refresh usage / balance', quit: 'Quit Xiaoqi' };
  const menu = Menu.buildFromTemplate([
    {
      label: petWindow && petWindow.isVisible() ? labels.hide : labels.show,
      click: () => (petWindow && petWindow.isVisible() ? hidePet() : showPet()),
    },
    { label: labels.panel, click: () => togglePanel(true) },
    { label: labels.refresh, click: () => { void refreshBalance(true); } },
    { type: 'separator' },
    { label: labels.quit, click: () => quitApp() },
  ]);
  tray.setContextMenu(menu);
}

function showPet() {
  if (!petWindow) return;
  petWindow.showInactive();
  updateTrayMenu();
  if (state.tasks.length >= 2 && !panelManuallyClosed) showPanel(false);
}

function hidePet() {
  if (petWindow) petWindow.hide();
  hidePanel(false);
  updateTrayMenu();
}

function quitApp() {
  quitting = true;
  savePosition();
  app.quit();
}

function taskPanelHeight() {
  const n = Math.min(Math.max(state.tasks.length, 1), 4);
  return Math.min(620, Math.max(430, 84 + n * 150));
}

function panelPosition() {
  if (!petWindow || !panelWindow) return { x: 0, y: 0 };
  const pet = petWindow.getBounds();
  const height = taskPanelHeight();
  const area = screen.getDisplayMatching(pet).workArea;
  let x = pet.x + pet.width + 12;
  if (x + PANEL_W > area.x + area.width - 8) x = pet.x - PANEL_W - 12;
  x = Math.min(Math.max(x, area.x + 8), area.x + area.width - PANEL_W - 8);
  let y = pet.y + pet.height / 2 - height / 2;
  y = Math.min(Math.max(y, area.y + 8), area.y + area.height - height - 8);
  return { x: Math.round(x), y: Math.round(y) };
}

function updatePanelSize() {
  if (!panelWindow) return;
  const height = taskPanelHeight();
  panelWindow.setContentSize(PANEL_W, height);
  const pos = panelPosition();
  panelWindow.setPosition(pos.x, pos.y);
}

function showPanel(force) {
  if (!panelWindow) return;
  if (force === false && panelManuallyClosed) return;
  if (force !== false) panelManuallyClosed = false;
  updatePanelSize();
  if (!panelWindow.isVisible()) panelWindow.showInactive();
  sendState();
}

function hidePanel(manual) {
  if (!panelWindow) return;
  panelWindow.hide();
  if (manual) {
    panelManuallyClosed = true;
    panelAuto = false;
  }
  updateTrayMenu();
}

function togglePanel(user) {
  if (!panelWindow) return;
  if (panelWindow.isVisible()) {
    hidePanel(Boolean(user));
  } else {
    panelManuallyClosed = false;
    panelAuto = false;
    showPanel(true);
  }
}

function startPolling() {
  void poll();
  pollTimer = setInterval(() => { void poll(); }, POLL_MS);
}

async function poll() {
  if (polling || quitting) return;
  polling = true;
  try {
    const { events, emotes } = feed.collectEvents(true);
    const nowMs = Date.now();
    let sawEvents = false;
    for (const item of events) {
      store.apply(item.event, item.atMs, item.payload, item.cwd);
      sawEvents = true;
    }
    if (sawEvents) emptyScans = 0;
    else emptyScans += 1;

    const tasks = store.snapshot(nowMs);
    const lastEventAt = store.lastEventAt ?? 0;
    const connected = tasks.length > 0 || (lastEventAt > 0 && nowMs - lastEventAt < 10 * 60 * 1000);

    let emote = state.emote;
    if (emotes.length > 0) {
      const envelope = emotes[emotes.length - 1];
      const speech = typeof envelope.speech === 'string' ? envelope.speech.trim().slice(0, 200) : '';
      if (speech !== '') {
        let seconds = Number(envelope.seconds);
        if (!Number.isFinite(seconds) || seconds <= 0) seconds = 6;
        emote = { speech, until: nowMs + Math.min(30, Math.max(3, seconds)) * 1000 };
      }
    }
    if (emote && emote.until < nowMs) emote = null;

    const balance = await usage.getBalance(false);
    applyState({ connected, tasks, source: 'hooks', balance, emote });
  } catch (error) {
    console.error('[xiaoqi] poll failed', error);
  } finally {
    polling = false;
  }
}

function applyState(next) {
  const previous = state;
  const wasMulti = previous.tasks.length >= 2;
  state = next;
  const isMulti = state.tasks.length >= 2;
  if (isMulti && !wasMulti) {
    panelManuallyClosed = false;
    panelAuto = true;
  }
  notifyTransitions(previous, state);
  updateTaskWindows();
}

function updateTaskWindows() {
  resizePetWindow();
  sendState();
  if (!panelWindow) return;
  if (state.tasks.length >= 2 && !panelManuallyClosed && !panelWindow.isVisible()) {
    panelAuto = true;
    showPanel(true);
  } else if (state.tasks.length < 2) {
    if (state.tasks.length === 0) {
      hidePanel(false);
      panelAuto = false;
    } else if (panelAuto && panelWindow.isVisible()) {
      hidePanel(false);
      panelAuto = false;
    }
  }
  if (panelWindow.isVisible()) updatePanelSize();
  updateTrayMenu();
}

function resizePetWindow() {
  if (!petWindow) return;
  const target = petHeight();
  const bounds = petWindow.getBounds();
  if (bounds.height === target) return;
  const pos = clampPosition(bounds.x, bounds.y, PET_W, target);
  petWindow.setBounds({ x: pos.x, y: pos.y, width: PET_W, height: target });
  if (panelWindow && panelWindow.isVisible()) {
    const panelPos = panelPosition();
    panelWindow.setPosition(panelPos.x, panelPos.y);
  }
}

async function refreshBalance(force) {
  try {
    const balance = await usage.getBalance(force);
    state = { ...state, balance };
    sendState();
  } catch (error) {
    console.error('[xiaoqi] balance refresh failed', error);
  }
}

function sendState() {
  const payload = {
    connected: state.connected,
    tasks: state.tasks,
    source: state.source,
    balance: state.balance,
    emote: state.emote,
  };
  for (const win of [petWindow, panelWindow]) {
    if (win && !win.isDestroyed() && !win.webContents.isLoading()) {
      win.webContents.send('state', payload);
    }
  }
}

function notifyTransitions(previous, next) {
  if (!previous || !Array.isArray(previous.tasks)) return;
  const old = new Map(previous.tasks.map((task) => [task.id, task]));
  const waiting = next.tasks.filter((task) => task.kind === 'waiting' && old.get(task.id)?.kind !== 'waiting');
  const done = next.tasks.filter((task) => (
    task.kind === 'done'
    && old.get(task.id)?.kind === 'running'
  ));
  if (!Notification.isSupported() || (waiting.length === 0 && done.length === 0)) return;
  const icon = path.join(__dirname, 'assets', 'icon.png');
  for (const task of waiting) {
    try {
      new Notification({
        title: zh() ? '小栖 · 需要你处理' : 'Xiaoqi · Needs you',
        body: task.pendingTool ? `${task.title} · ${task.pendingTool}` : task.title,
        icon,
      }).show();
    } catch {
      // 通知是可选能力。
    }
  }
  for (const task of done) {
    try {
      new Notification({
        title: zh() ? '小栖 · 任务完成' : 'Xiaoqi · Task complete',
        body: task.title,
        icon,
      }).show();
    } catch {
      // 通知是可选能力。
    }
  }
}

function focusZCode() {
  shell.openExternal('zcode://workspace').catch(() => {
    if (isMac) {
      try {
        spawnSync('open', ['-a', 'ZCode'], { stdio: 'ignore' });
      } catch {
        // 没有别的拉起手段了。
      }
    }
  });
}

ipcMain.on('pet:drag-start', () => {
  if (!petWindow) return;
  dragState = {
    origin: petWindow.getPosition(),
    cursor: screen.getCursorScreenPoint(),
  };
});

ipcMain.on('pet:drag-move', () => {
  if (!petWindow || !dragState) return;
  const cursor = screen.getCursorScreenPoint();
  const dx = cursor.x - dragState.cursor.x;
  const dy = cursor.y - dragState.cursor.y;
  const height = petWindow.getBounds().height;
  const pos = clampPosition(dragState.origin[0] + dx, dragState.origin[1] + dy, PET_W, height);
  petWindow.setPosition(pos.x, pos.y);
  if (panelWindow && panelWindow.isVisible()) {
    const panelPos = panelPosition();
    panelWindow.setPosition(panelPos.x, panelPos.y);
  }
});

ipcMain.on('pet:drag-end', () => {
  dragState = null;
  savePosition();
});

ipcMain.on('pet:toggle-panel', () => togglePanel(true));
ipcMain.on('panel:close', () => hidePanel(true));
ipcMain.on('task:open', () => {
  focusZCode();
});
