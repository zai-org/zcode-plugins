'use strict';

/**
 * 投屏（scrcpy）集成 —— 移植自 menggod/android-runner（MIT）。
 *
 * 只做三件事：找到 scrcpy、拼参数、拉起进程。
 * 不自带二进制、不解析视频流、不注入输入事件——画面与控制交给 scrcpy 自己的窗口。
 */

const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const IS_WIN = process.platform === 'win32';

const CANDIDATES = {
  darwin: ['/opt/homebrew/bin/scrcpy', '/usr/local/bin/scrcpy', '/opt/local/bin/scrcpy'],
  linux: ['/usr/bin/scrcpy', '/usr/local/bin/scrcpy', '/snap/bin/scrcpy', path.join(os.homedir(), '.local/bin/scrcpy')],
  win32: []
};

/** PATH 里的 scrcpy。 */
function fromPath() {
  try {
    const out = cp
      .execFileSync(IS_WIN ? 'where' : 'which', ['scrcpy'], {
        encoding: 'utf8',
        timeout: 3000,
        windowsHide: true
      })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    return out[0] || '';
  } catch (_) {
    return '';
  }
}

function isFile(target) {
  try {
    return fs.statSync(target).isFile();
  } catch (_) {
    return false;
  }
}

function installHint() {
  if (process.platform === 'darwin') return 'brew install scrcpy';
  if (IS_WIN) return 'winget install --id Genymobile.scrcpy -e';
  return 'sudo apt install scrcpy';
}

/** 显式设置优先；其次 PATH；最后常见安装目录。 */
function findScrcpy(configured) {
  const explicit = String(configured || '').trim();
  if (explicit) return isFile(explicit) ? explicit : '';
  const resolved = fromPath();
  if (resolved && isFile(resolved)) return resolved;
  for (const candidate of CANDIDATES[process.platform] || []) {
    if (isFile(candidate)) return candidate;
  }
  return '';
}

/** scrcpy 1.19+ 通用参数；其余交给用户。 */
function buildArgs(options) {
  const opts = options || {};
  const args = [];
  if (opts.serial) args.push('-s', opts.serial);
  if (opts.title) args.push('--window-title', opts.title);
  return args.concat(opts.extraArgs || []);
}

/** scrcpy 不认 PATH 里的 adb 时靠环境变量 ADB 指定。 */
function launch(options) {
  const env = Object.assign({}, process.env);
  if (options.adb) env.ADB = options.adb;
  return cp.spawn(options.scrcpy, options.args || [], {
    env,
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  });
}

module.exports = { findScrcpy, buildArgs, launch, installHint };
