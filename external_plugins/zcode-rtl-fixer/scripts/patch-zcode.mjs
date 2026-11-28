// ZCode RTL Fixer — installer/patcher
//
// What it does:
//   1. Extracts the ZCode AppImage once into ~/.local/share/zcode-rtl-fixer/app
//      (only when missing or when the AppImage is newer than the extraction).
//   2. Patches resources/app.asar:
//        - appends  out/renderer/assets/zcode-rtl-bootstrap.js  (engine + baked settings + CSS)
//        - replaces out/renderer/index.html              (adds one <script> tag)
//      A pristine backup (app.asar.orig) is kept on first patch; every re-patch
//      restores from it first, so patching is idempotent.
//   3. Creates the launcher ~/.local/bin/zcode-rtl and a desktop entry.
//
// Usage:
//   node patch-zcode.mjs                # install / re-apply with current settings
//   node patch-zcode.mjs --uninstall    # restore original asar, keep extraction
//   node patch-zcode.mjs --purge        # remove everything this installer created
//   node patch-zcode.mjs --appimage /path/to/ZCode.AppImage
//   node patch-zcode.mjs --status

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildPatchedAsar, readHeader, extractFile } from './lib/asar.mjs';
import { loadSettings } from './settings.mjs';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN_VERSION = JSON.parse(
  fs.readFileSync(path.join(PLUGIN_ROOT, '.zcode-plugin', 'plugin.json'), 'utf8')
).version;
const ENGINE_PATH = path.join(PLUGIN_ROOT, 'scripts', 'engine', 'bootstrap.js');
const INSTALL_DIR = path.join(os.homedir(), '.local', 'share', 'zcode-rtl-fixer');
const APP_DIR = path.join(INSTALL_DIR, 'app');
const STATE_PATH = path.join(INSTALL_DIR, 'installed.json');
const BIN_PATH = path.join(os.homedir(), '.local', 'bin', 'zcode-rtl');
const DESKTOP_PATH = path.join(os.homedir(), '.local', 'share', 'applications', 'zcode-rtl.desktop');
// NOTE: the zcode:// protocol handler only serves "/" (index.html) and "/assets/*",
// so the engine must live inside out/renderer/assets/.
const ENGINE_ENTRY = 'out/renderer/assets/zcode-rtl-bootstrap.js';
const INDEX_HTML = 'out/renderer/index.html';
const ENGINE_MARKER = 'zcode-rtl-bootstrap.js';

const DEFAULT_APPIMAGE_CANDIDATES = [
  path.join(os.homedir(), 'Applications', 'ZCode.AppImage'),
  path.join(os.homedir(), 'Applications', 'zcode.AppImage'),
];

function log(msg) { console.log('[rtl-fixer] ' + msg); }
// throws (instead of process.exit) so the module stays importable/testable;
// main() catches and converts to a CLI exit code.
function fail(msg) { throw new Error(msg); }

function findAppImage(cliValue) {
  if (cliValue) {
    const p = path.resolve(cliValue); // extraction runs with cwd=tmp — must be absolute
    let st;
    try { st = fs.statSync(p); } catch { fail('AppImage not found: ' + p); }
    if (!st.isFile()) fail('not a file (AppImage expected): ' + p);
    return p;
  }
  for (const p of DEFAULT_APPIMAGE_CANDIDATES) {
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  fail('ZCode.AppImage not found; pass --appimage /path/to/ZCode.AppImage');
}

/* ---------- step 1: extract ---------- */

function extractAppImage(appImagePath) {
  const stamp = path.join(INSTALL_DIR, '.extracted-from');
  const stampContent = (() => {
    try { return fs.readFileSync(stamp, 'utf8').trim(); } catch { return ''; }
  })();
  const current = appImagePath + '|' + fs.statSync(appImagePath).mtimeMs;

  if (fs.existsSync(APP_DIR) && stampContent === current) {
    log('extraction up to date -> ' + APP_DIR);
    return;
  }

  log('extracting AppImage (one-time, ~30-60s) ...');
  const tmp = fs.mkdtempSync('/tmp/zcode-rtl-extract-');
  try {
    execFileSync(appImagePath, ['--appimage-extract'], { cwd: tmp, stdio: 'ignore' });
    const src = path.join(tmp, 'squashfs-root');
    if (!fs.existsSync(src)) fail('unexpected: squashfs-root missing after --appimage-extract');
    fs.rmSync(APP_DIR, { recursive: true, force: true });
    fs.mkdirSync(INSTALL_DIR, { recursive: true });
    execFileSync('mv', [src, APP_DIR]);
    fs.writeFileSync(stamp, current + '\n');
    log('extracted -> ' + APP_DIR);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/* ---------- step 2: patch asar ---------- */

function buildBootstrap(settings) {
  const src = fs.readFileSync(ENGINE_PATH, 'utf8');
  if (!src.includes('__RTL_SETTINGS__')) fail('engine bootstrap.js is missing __RTL_SETTINGS__ placeholder');
  const baked = JSON.stringify(settings);
  // replace ALL occurrences (the header comment also mentions the placeholder —
  // a naive replace() would hit the comment first and leave `var SETTINGS`
  // pointing at an undefined identifier, crashing the engine at startup)
  return Buffer.from(src.split('__RTL_SETTINGS__').join(baked), 'utf8');
}

function patchIndexHtml(html) {
  if (html.includes(ENGINE_MARKER)) return html; // already patched
  const tag = `    <script defer src="./assets/${path.basename(ENGINE_ENTRY)}"></script>\n  </head>`;
  if (!html.includes('</head>')) fail('index.html has no </head>');
  return html.replace('</head>', tag);
}

function patchAsar(settings) {
  const asarPath = path.join(APP_DIR, 'resources', 'app.asar');
  const backupPath = asarPath + '.orig';
  if (!fs.existsSync(asarPath)) fail('app.asar missing at ' + asarPath);

  if (!fs.existsSync(backupPath)) {
    log('keeping pristine backup -> ' + backupPath);
    fs.copyFileSync(asarPath, backupPath);
  } else {
    log('restoring pristine archive before re-patch');
    fs.copyFileSync(backupPath, asarPath);
  }

  // sanity-check the injection point exists in the pristine archive
  const { header } = readHeader(asarPath);
  if (!header.files?.out?.files?.renderer?.files?.['index.html']) {
    fail('out/renderer/index.html not found inside app.asar — layout changed?');
  }

  const bootstrap = buildBootstrap(settings);
  const indexHtml = Buffer.from(
    patchIndexHtml(extractFile(asarPath, INDEX_HTML).toString('utf8')),
    'utf8'
  );

  const tmpOut = asarPath + '.patched-tmp';
  const res = buildPatchedAsar(asarPath, tmpOut, {
    replace: { [INDEX_HTML]: indexHtml },
    add: { [ENGINE_ENTRY]: bootstrap },
  });

  // verify the result before swapping in
  const patchedHtml = extractFile(tmpOut, INDEX_HTML).toString('utf8');
  if (!patchedHtml.includes(ENGINE_MARKER)) fail('verification failed: patched index.html lost the script tag');
  const patchedBootstrap = extractFile(tmpOut, ENGINE_ENTRY).toString('utf8');
  if (!patchedBootstrap.includes('ZCODE_RTL_FIXER')) fail('verification failed: bootstrap entry unreadable');

  fs.renameSync(tmpOut, asarPath);
  log(`patched app.asar (dataBase=${res.dataBase}, files=${res.fileCount}, size=${(res.totalSize / 1048576).toFixed(1)} MiB)`);
}

/* ---------- step 3: launcher ---------- */

function writeLauncher() {
  fs.mkdirSync(path.dirname(BIN_PATH), { recursive: true });
  const appRun = path.join(APP_DIR, 'AppRun');
  if (!fs.existsSync(appRun)) fail('AppRun missing in ' + APP_DIR);
  fs.writeFileSync(
    BIN_PATH,
    [
      '#!/bin/sh',
      '# ZCode RTL Fixer launcher (generated by the zcode-rtl-fixer plugin)',
      `exec "${appRun}" "$@"`,
      '',
    ].join('\n')
  );
  fs.chmodSync(BIN_PATH, 0o755);
  log('launcher -> ' + BIN_PATH);

  fs.mkdirSync(path.dirname(DESKTOP_PATH), { recursive: true });
  const icon = ['zcode.png', 'icon.png']
    .map((f) => path.join(APP_DIR, f))
    .find((p) => fs.existsSync(p));
  fs.writeFileSync(
    DESKTOP_PATH,
    [
      '[Desktop Entry]',
      'Type=Application',
      'Name=ZCode RTL',
      'Comment=ZCode Desktop with Persian/English RTL fixer',
      `Exec=${BIN_PATH}`,
      'Terminal=false',
      'Categories=Development;',
      icon ? `Icon=${icon}` : '',
      '',
    ]
      .filter(Boolean)
      .join('\n')
  );
  log('desktop entry -> ' + DESKTOP_PATH);
}

/* ---------- uninstall / purge / status ---------- */

function uninstall({ purge = false } = {}) {
  const asarPath = path.join(APP_DIR, 'resources', 'app.asar');
  const backupPath = asarPath + '.orig';
  if (fs.existsSync(backupPath)) {
    fs.copyFileSync(backupPath, asarPath);
    log('original app.asar restored');
  } else {
    log('no backup found; nothing to restore');
  }
  for (const p of [BIN_PATH, DESKTOP_PATH]) {
    if (fs.existsSync(p)) {
      fs.rmSync(p);
      log('removed ' + p);
    }
  }
  if (purge) {
    fs.rmSync(INSTALL_DIR, { recursive: true, force: true });
    log('purged ' + INSTALL_DIR);
  } else {
    fs.rmSync(STATE_PATH, { force: true });
  }
  log('uninstall complete');
}

function status() {
  const asarPath = path.join(APP_DIR, 'resources', 'app.asar');
  let state = null;
  try { state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { /* not installed yet */ }
  const lines = {
    version: PLUGIN_VERSION,
    installDir: INSTALL_DIR,
    extracted: fs.existsSync(APP_DIR),
    patched: false,
    backup: fs.existsSync(asarPath + '.orig'),
    launcher: fs.existsSync(BIN_PATH),
    desktopEntry: fs.existsSync(DESKTOP_PATH),
    lastInstall: state ? { appImage: state.appImage, patchedAt: state.patchedAt } : null,
    settings: loadSettings().settings,
  };
  if (fs.existsSync(asarPath)) {
    try {
      lines.patched = extractFile(asarPath, ENGINE_ENTRY).includes('ZCODE_RTL_FIXER');
    } catch {
      lines.patched = false;
    }
  }
  return lines;
}

/* ---------- main ---------- */

function main() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : undefined;
  };

  if (args.includes('--status')) {
    console.log(JSON.stringify(status(), null, 2));
    return;
  }
  if (args.includes('--uninstall')) return uninstall();
  if (args.includes('--purge')) return uninstall({ purge: true });

  const appImage = findAppImage(get('--appimage'));
  extractAppImage(appImage);

  const { settings } = loadSettings();
  patchAsar(settings);
  writeLauncher();

  fs.writeFileSync(
    STATE_PATH,
    JSON.stringify(
      {
        version: PLUGIN_VERSION,
        appImage,
        patchedAt: new Date().toISOString(),
        settings,
      },
      null,
      2
    ) + '\n'
  );

  log('DONE — launch ZCode via: ' + BIN_PATH + '  (desktop entry: "ZCode RTL")');
  log('NOTE: apply takes effect on the next launch; the currently running ZCode is not modified.');
}

// Run as CLI only — importing this module must have no side effects (tests import it).
function isEntryModule() {
  try {
    return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
}

export {
  findAppImage,
  extractAppImage,
  buildBootstrap,
  patchIndexHtml,
  patchAsar,
  writeLauncher,
  uninstall,
  status,
  PLUGIN_VERSION,
};

if (isEntryModule()) {
  try {
    main();
  } catch (err) {
    console.error('[rtl-fixer][FAIL] ' + err.message);
    process.exit(1);
  }
}
