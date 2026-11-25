#!/usr/bin/env node
'use strict';

/**
 * ar.js —— Android Runner CLI(ZCode 插件版)
 *
 * 移植自 menggod/android-runner(VSCode 扩展 Android Device Runner,MIT License)
 * https://github.com/menggod/android-runner
 *
 * 设计原则(与上游一致):
 *  1. 零配置优先:adb / SDK / JDK / 模块 / 包名 / APK 全部自动探测,探测失败才回落到参数。
 *  2. 不重复造轮子:编译走项目自己的 gradlew,安装/启动走 adb。
 *  3. 任何一步失败都把原因写进输出,并给出可执行的修复建议。
 *
 * 退出码:
 *  0  成功
 *  1  操作失败(编译/安装/启动等)
 *  2  环境问题(无 gradlew / 无 adb / 无设备等),附修复建议
 *  3  需要用户确认后重试(签名不一致 → --reinstall;破坏性操作缺 --yes)
 *  130 被中断(Ctrl-C)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { discoverModules, moduleDirectory, findApk, apkInfo } = require('./project-info.js');

const VERSION = '0.1.0';
const EXIT = { OK: 0, FAIL: 1, ENV: 2, CONFIRM: 3, CANCELLED: 130 };

class CliError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* 参数解析                                                            */
/* ------------------------------------------------------------------ */

function printHelp() {
  console.log(`ar.js ${VERSION} —— Android Runner CLI(移植自 VSCode 扩展 Android Device Runner)

用法: node ar.js <命令> [参数] [-- 透传给 Gradle 的参数]

命令:
  doctor                 环境自检:工程/SDK/JDK/adb/设备/模拟器/APK/包名
  devices                列出已连接设备与可用 AVD(--json 输出结构化结果)
  use [serial]           记住目标设备(--emulator <名字> 启动模拟器并选中;--clear 清除)
  info                   输出当前工程探测结果(--json)
  build                  编译(:<module>:assemble<Variant>)
  install                安装 APK(Android 11+ 先试增量安装,失败回退全量)
  run                    编译 → 安装 → 启动 一条龙
  launch                 仅启动 App
  stop                   强制停止 App
  restart                停止后重新启动
  uninstall              卸载 App(破坏性,需 --yes)
  clear-data             清除应用数据(破坏性,需 --yes)
  logcat                 查看设备日志(优先只看本应用进程,前台持续输出)
  dashboard              生成图形化状态面板(HTML,--open 自动在浏览器打开)

通用参数:
  --module <名>          Gradle 模块,默认 app
  --variant <名>         构建变体,默认 debug
  --task <名>            自定义 Gradle 任务,默认自动 :<module>:assemble<Variant>
  --apk <路径>           指定 APK 路径(默认自动在 build/outputs/apk 下查找最新)
  --package <包名>       指定 applicationId(默认从 build.gradle 自动识别)
  --serial <序列号>      本次操作的目标设备
  --adb <路径>           指定 adb 路径(默认自动探测)
  --java-home <路径>     指定 JAVA_HOME(默认自动探测)
  --reinstall            兼容旧参数(签名不一致时默认就会自动卸载重装)
  --no-reinstall         关闭自动替换:签名不一致/版本回退时直接报错退出(exit 3)
  --yes / -y             确认破坏性操作(uninstall / clear-data)
  --no-local-properties  不自动生成 local.properties
  --json                 结构化输出(devices / info)

示例:
  node ar.js devices --json
  node ar.js use emulator-5554
  node ar.js use --emulator Pixel_7_API_34
  node ar.js run
  node ar.js build -- --info -Papi_env=prod
  node ar.js logcat --serial emulator-5554`);
}

const opts = {
  module: '', variant: '', task: '', apk: '', applicationId: '',
  adb: process.env.AR_ADB || '', javaHome: process.env.AR_JAVA_HOME || '',
  serial: '', emulator: '', clear: false, json: false, yes: false, reinstall: false,
  noReinstall: false,
  localProperties: true, open: false
};
let command = '';
let gradleArgs = [];
let positionals = [];

try {
(function parseArgs() {
  const flagMap = {
    '--module': 'module', '--variant': 'variant', '--task': 'task', '--apk': 'apk',
    '--application-id': 'applicationId', '--package': 'applicationId',
    '--adb': 'adb', '--java-home': 'javaHome', '--serial': 'serial', '--emulator': 'emulator'
  };
  const rest = process.argv.slice(2);
  let afterDoubleDash = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (afterDoubleDash) { gradleArgs.push(a); continue; }
    if (a === '--') { afterDoubleDash = true; continue; }
    if (a === '--json') { opts.json = true; continue; }
    if (a === '--yes' || a === '-y') { opts.yes = true; continue; }
    if (a === '--reinstall') { opts.reinstall = true; continue; }
    if (a === '--no-reinstall') { opts.noReinstall = true; continue; }
    if (a === '--no-local-properties') { opts.localProperties = false; continue; }
    if (a === '--clear') { opts.clear = true; continue; }
    if (a === '--open') { opts.open = true; continue; }
    if (a === '--help' || a === '-h') { printHelp(); process.exit(EXIT.OK); }
    if (a === '--version' || a === '-V') { console.log(VERSION); process.exit(EXIT.OK); }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const name = eq === -1 ? a : a.slice(0, eq);
      if (flagMap[name]) {
        const value = eq === -1 ? rest[++i] : a.slice(eq + 1);
        if (value === undefined) throw new CliError(EXIT.ENV, `参数 ${name} 缺少取值`);
        opts[flagMap[name]] = value;
        continue;
      }
      throw new CliError(EXIT.ENV, `未知参数:${a}\n运行 node ar.js --help 查看用法`);
    }
    if (!command) command = a;
    else positionals.push(a);
  }
  if (!command) { printHelp(); process.exit(EXIT.OK); }
  if (command === 'use' && !opts.serial && positionals.length) {
    opts.serial = positionals.shift();
  }
  if (positionals.length) {
    throw new CliError(EXIT.ENV, `多余的参数:${positionals.join(' ')}\n运行 node ar.js --help 查看用法`);
  }
})();
} catch (e) {
  if (e instanceof CliError) {
    console.error(`❌ ${e.message}`);
    process.exit(e.code);
  }
  throw e;
}

const COMMANDS = ['doctor', 'devices', 'use', 'info', 'build', 'install', 'run', 'launch', 'stop', 'restart', 'uninstall', 'clear-data', 'logcat', 'dashboard'];
if (!COMMANDS.includes(command)) {
  console.error(`未知命令:${command || '(缺省)'}\n可用命令:${COMMANDS.join(' ')}\n运行 node ar.js --help 查看用法`);
  process.exit(EXIT.ENV);
}

/* ------------------------------------------------------------------ */
/* 基础工具                                                            */
/* ------------------------------------------------------------------ */

function isWin() {
  return process.platform === 'win32';
}

function execFileP(file, args, options) {
  return new Promise((resolve) => {
    const o = Object.assign(
      { encoding: 'utf8', timeout: 20000, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
      options || {}
    );
    cp.execFile(file, args, o, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        code: err ? (typeof err.code === 'number' ? err.code : -1) : 0,
        stdout: stdout || '',
        stderr: stderr || '',
        message: err ? err.message : ''
      });
    });
  });
}

function execFileSyncSafe(file, args, options) {
  try {
    return cp
      .execFileSync(file, args, Object.assign({ encoding: 'utf8', timeout: 5000, windowsHide: true }, options || {}))
      .toString()
      .trim();
  } catch (e) {
    return '';
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function existsFile(p) {
  try {
    return !!p && fs.existsSync(p) && fs.statSync(p).isFile();
  } catch (e) {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* 工程根目录                                                          */
/* ------------------------------------------------------------------ */

const cache = { root: undefined, adb: null, javaHome: undefined, pkg: undefined };

/** 从当前目录向上最多 6 层寻找带 gradle wrapper 的工程根目录。 */
function findProjectRoot() {
  let dir = process.cwd();
  for (let i = 0; i < 6 && dir; i++) {
    if (fs.existsSync(path.join(dir, 'gradlew')) || fs.existsSync(path.join(dir, 'gradlew.bat'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function projectRoot(force) {
  if (force) cache.root = undefined;
  if (cache.root === undefined) cache.root = findProjectRoot();
  return cache.root;
}

function requireProjectRoot() {
  const root = projectRoot();
  if (!root) {
    throw new CliError(EXIT.ENV, '当前目录不是 Gradle 工程(未找到 gradlew)\n请在 Gradle 工程根目录(或其子目录)运行,或先 cd 到工程目录');
  }
  return root;
}

function gradlewPath() {
  const root = projectRoot();
  if (!root) return null;
  const file = path.join(root, isWin() ? 'gradlew.bat' : 'gradlew');
  return fs.existsSync(file) ? file : null;
}

function module() {
  return (opts.module || 'app').trim().replace(/^:/, '');
}

function variant() {
  return (opts.variant || 'debug').trim();
}

/* ------------------------------------------------------------------ */
/* 环境探测:adb / SDK / JDK / Gradle                                   */
/* ------------------------------------------------------------------ */

/** 读取 local.properties 中的 sdk.dir。 */
function readSdkDirFromLocalProperties() {
  const root = projectRoot();
  if (!root) return null;
  const lp = path.join(root, 'local.properties');
  if (!fs.existsSync(lp)) return null;
  try {
    const m = /^\s*sdk\.dir\s*=\s*(.+?)\s*$/m.exec(fs.readFileSync(lp, 'utf8'));
    return m ? m[1].replace(/\\:/g, ':').replace(/\\\\/g, '\\') : null;
  } catch (e) {
    return null;
  }
}

/** 探测 Android SDK 根目录。 */
function detectSdkDir() {
  const candidates = [];
  const fromProps = readSdkDirFromLocalProperties();
  if (fromProps) candidates.push(fromProps);
  if (process.env.ANDROID_HOME) candidates.push(process.env.ANDROID_HOME);
  if (process.env.ANDROID_SDK_ROOT) candidates.push(process.env.ANDROID_SDK_ROOT);
  candidates.push(path.join(os.homedir(), 'Library', 'Android', 'sdk'));
  candidates.push(path.join(os.homedir(), 'Android', 'Sdk'));
  candidates.push(path.join(os.homedir(), 'Android', 'sdk'));

  for (const c of candidates) {
    if (c && fs.existsSync(c)) return path.resolve(c);
  }
  return null;
}

function detectAdbUsable() {
  const adb = detectAdb();
  if (existsFile(adb)) return true;
  return !!execFileSyncSafe(adb, ['version']);
}

/** 探测 adb。 */
function detectAdb() {
  if (cache.adb) return cache.adb;
  const configured = (opts.adb || '').trim();
  const candidates = [];
  if (configured) candidates.push(configured);
  const sdk = detectSdkDir();
  if (sdk) candidates.push(path.join(sdk, 'platform-tools', isWin() ? 'adb.exe' : 'adb'));
  for (const key of ['ANDROID_HOME', 'ANDROID_SDK_ROOT']) {
    if (process.env[key]) {
      candidates.push(path.join(process.env[key], 'platform-tools', isWin() ? 'adb.exe' : 'adb'));
    }
  }
  candidates.push(path.join(os.homedir(), 'Library', 'Android', 'sdk', 'platform-tools', 'adb'));
  candidates.push(path.join(os.homedir(), 'Android', 'Sdk', 'platform-tools', 'adb'));

  for (const c of candidates) {
    if (existsFile(c)) {
      cache.adb = c;
      return cache.adb;
    }
  }
  // 回落到 PATH,最后才承认失败
  cache.adb = isWin() ? 'adb.exe' : 'adb';
  return cache.adb;
}

function javaHomeForVersion(version) {
  if (process.platform === 'darwin') {
    const out = execFileSyncSafe('/usr/libexec/java_home', ['-v', version]);
    if (out && fs.existsSync(out)) return out;
  }
  const roots = [
    '/Library/Java/JavaVirtualMachines',
    path.join(os.homedir(), 'Library', 'Java', 'JavaVirtualMachines')
  ];
  for (const dir of roots) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const home = path.join(dir, name, 'Contents', 'Home');
      if (name.indexOf(version) !== -1 && fs.existsSync(home)) return home;
    }
  }
  return null;
}

/** 读取 .idea/gradle.xml 中 Android Studio 实际使用的 Gradle JDK。 */
function readGradleJvmFromIdea() {
  const root = projectRoot();
  if (!root) return null;
  const gxml = path.join(root, '.idea', 'gradle.xml');
  if (!fs.existsSync(gxml)) return null;
  try {
    const m = /name="gradleJvm"[^>]*value="([^"]+)"/.exec(fs.readFileSync(gxml, 'utf8'));
    return m ? m[1].trim() : null;
  } catch (e) {
    return null;
  }
}

/** 把 .idea 的 gradleJvm 取值解析成 JAVA_HOME。 */
function resolveGradleJvmValue(value) {
  if (!value) return null;
  const v = value.trim();
  if (path.isAbsolute(v) && fs.existsSync(v)) return v;
  const jbr = /^jbr-(\d+)/.exec(v);
  if (jbr) {
    const asJbr = '/Applications/Android Studio.app/Contents/jbr/Contents/Home';
    if (fs.existsSync(asJbr)) return asJbr;
    return javaHomeForVersion(jbr[1]);
  }
  const numeric = /^(\d+(?:\.\d+)?)$/.exec(v);
  if (numeric) return javaHomeForVersion(numeric[1]);
  return null;
}

function detectJavaHomeDetail() {
  const configured = (opts.javaHome || '').trim();
  if (configured && fs.existsSync(configured)) {
    return { home: configured, source: '参数 --java-home' };
  }
  const jvmValue = readGradleJvmFromIdea();
  const fromIdea = resolveGradleJvmValue(jvmValue);
  if (fromIdea) {
    return { home: fromIdea, source: `.idea/gradle.xml 中的 gradleJvm="${jvmValue}"` };
  }
  const envHome = process.env.JAVA_HOME;
  if (envHome && fs.existsSync(envHome)) {
    return { home: envHome, source: '环境变量 JAVA_HOME' };
  }
  if (process.platform === 'darwin') {
    const out = execFileSyncSafe('/usr/libexec/java_home', []);
    if (out && fs.existsSync(out)) {
      return { home: out, source: '系统默认 JDK(/usr/libexec/java_home)' };
    }
  }
  return { home: null, source: '未找到' };
}

function detectJavaHome() {
  if (cache.javaHome !== undefined) return cache.javaHome;
  cache.javaHome = detectJavaHomeDetail().home;
  return cache.javaHome;
}

function javaVersionOf(home) {
  if (!home) return '';
  const javaBin = path.join(home, 'bin', 'java');
  if (!existsFile(javaBin)) return '';
  try {
    // java -version 输出到 stderr,必须两个流都读
    const r = cp.spawnSync(javaBin, ['-version'], { encoding: 'utf8', timeout: 5000 });
    const text = `${r.stdout || ''}${r.stderr || ''}`;
    const m = /version "([^"]+)"/.exec(text);
    return m ? m[1] : '';
  } catch (e) {
    return '';
  }
}

function gradleVersionFromWrapper() {
  const root = projectRoot();
  if (!root) return '';
  const props = path.join(root, 'gradle', 'wrapper', 'gradle-wrapper.properties');
  if (!fs.existsSync(props)) return '';
  try {
    const m = /gradle-([\d.]+)-(all|bin)\.zip/.exec(fs.readFileSync(props, 'utf8'));
    return m ? m[1] : '';
  } catch (e) {
    return '';
  }
}

function ensureGradlewExecutable() {
  if (isWin()) return;
  const file = gradlewPath();
  if (!file) return;
  try {
    fs.accessSync(file, fs.constants.X_OK);
  } catch (e) {
    try {
      fs.chmodSync(file, 0o755);
      console.log(`已补上执行权限:${file}`);
    } catch (e2) {
      console.error(`无法为 gradlew 添加执行权限:${e2.message}`);
    }
  }
}

/** 缺少 local.properties 时自动生成(该文件通常在 .gitignore 中)。 */
function ensureLocalProperties() {
  if (!opts.localProperties) return;
  const root = projectRoot();
  if (!root) return;
  const lp = path.join(root, 'local.properties');
  if (fs.existsSync(lp)) return;
  const sdk = detectSdkDir();
  if (!sdk) return;
  try {
    const content = `## 由 Android Runner 自动生成,用于本机构建\nsdk.dir=${sdk.replace(/\\/g, '\\\\')}\n`;
    fs.writeFileSync(lp, content, 'utf8');
    console.log(`已自动生成 local.properties(sdk.dir=${sdk})`);
  } catch (e) {
    console.error(`自动生成 local.properties 失败:${e.message}`);
  }
}

/* ------------------------------------------------------------------ */
/* 设备                                                                */
/* ------------------------------------------------------------------ */

const modelCache = new Map();
const androidCache = new Map();
const apiLevelCache = new Map();

async function listDevices() {
  const adb = detectAdb();
  const r = await execFileP(adb, ['devices', '-l'], { timeout: 10000 });
  if (!r.ok) {
    return { error: r.message || r.stderr || 'adb 执行失败', devices: [] };
  }
  const devices = [];
  const lines = r.stdout.split(/\r?\n/).slice(1);
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('*')) continue;
    const parts = t.split(/\s+/);
    if (parts.length < 2) continue;
    const modelPart = parts.find((p) => p.startsWith('model:'));
    devices.push({
      serial: parts[0],
      state: parts[1],
      model: modelPart ? modelPart.slice(6).replace(/_/g, ' ') : ''
    });
  }
  return { devices };
}

async function resolveModel(dev) {
  if (modelCache.has(dev.serial)) return modelCache.get(dev.serial);
  const r = await execFileP(detectAdb(), ['-s', dev.serial, 'shell', 'getprop', 'ro.product.model'], { timeout: 5000 });
  const model = (r.ok ? r.stdout.trim() : '') || dev.model || '';
  if (model) modelCache.set(dev.serial, model);
  return model;
}

async function resolveAndroidVersion(serial) {
  if (androidCache.has(serial)) return androidCache.get(serial);
  const r = await execFileP(detectAdb(), ['-s', serial, 'shell', 'getprop', 'ro.build.version.release'], { timeout: 5000 });
  const version = r.ok ? r.stdout.trim() : '';
  if (version) androidCache.set(serial, version);
  return version;
}

function emulatorPath() {
  const sdk = detectSdkDir();
  if (!sdk) return null;
  const file = path.join(sdk, 'emulator', isWin() ? 'emulator.exe' : 'emulator');
  return existsFile(file) ? file : null;
}

async function listAvds() {
  const emu = emulatorPath();
  if (!emu) return [];
  const r = await execFileP(emu, ['-list-avds'], { timeout: 8000 });
  if (!r.ok) return [];
  return r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

/** 设备 SDK 级别;取不到时返回 0,按不支持增量安装处理。 */
async function deviceApiLevel(serial) {
  if (apiLevelCache.has(serial)) return apiLevelCache.get(serial);
  const r = await execFileP(detectAdb(), ['-s', serial, 'shell', 'getprop', 'ro.build.version.sdk'], { timeout: 5000 });
  const level = parseInt((r.stdout || '').trim(), 10);
  if (Number.isFinite(level) && level > 0) {
    apiLevelCache.set(serial, level);
    return level;
  }
  return 0;
}

/* ------------------------------------------------------------------ */
/* 设备偏好(按工程根目录记忆,存 ~/.android-runner/projects.json)        */
/* ------------------------------------------------------------------ */

const storeFile = () => path.join(os.homedir(), '.android-runner', 'projects.json');

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(storeFile(), 'utf8')) || {};
  } catch (e) {
    return {};
  }
}

function writeStore(data) {
  fs.mkdirSync(path.dirname(storeFile()), { recursive: true });
  fs.writeFileSync(storeFile(), JSON.stringify(data, null, 2), 'utf8');
}

function devicePreference() {
  const root = projectRoot();
  if (!root) return null;
  return readStore()[root] || null;
}

function rememberDevice(device) {
  const root = projectRoot();
  if (!root) return;
  const all = readStore();
  all[root] = { serial: device.serial, model: device.model || device.serial, at: Date.now() };
  writeStore(all);
}

function clearDevicePreference() {
  const root = projectRoot();
  if (!root) return;
  const all = readStore();
  if (all[root]) {
    delete all[root];
    writeStore(all);
  }
}

function noDeviceMessage(unavailable, ready) {
  const unauthorized = unavailable.filter((d) => d.state === 'unauthorized');
  const offline = unavailable.filter((d) => d.state === 'offline');
  if (unauthorized.length) {
    return '设备已连接但未授权:请在手机上点「允许 USB 调试」后重试';
  }
  if (offline.length) {
    return '设备处于 offline 状态:请拔插 USB 或执行 adb kill-server 后重试';
  }
  if (unavailable.length) {
    return `设备状态异常(${unavailable.map((d) => `${d.serial}=${d.state}`).join(', ')}),请检查后重试`;
  }
  return '没有检测到设备:请检查 USB 线、开发者选项与 USB 调试开关,或用无线调试连接';
}

/**
 * 选定本次操作的目标设备:
 *  1. --serial 显式指定(要求在线)
 *  2. 工程记住的偏好设备(在线时)
 *  3. 恰好一台在线设备时自动选用
 *  其余情况报环境错并列出设备/AVD,给出下一步建议。
 */
async function pickDevice({ interactiveHint } = {}) {
  const { devices, error } = await listDevices();
  if (error) {
    throw new CliError(EXIT.ENV, `adb 执行失败:${error}\n检查 --adb 参数或 PATH 中的 adb`);
  }
  const ready = devices.filter((d) => d.state === 'device');
  const unavailable = devices.filter((d) => d.state !== 'device');

  if (opts.serial) {
    const found = ready.find((d) => d.serial === opts.serial);
    if (!found) {
      const raw = devices.find((d) => d.serial === opts.serial);
      if (raw) throw new CliError(EXIT.ENV, `设备 ${opts.serial} 当前状态为 ${raw.state},不可用`);
      throw new CliError(EXIT.ENV, `设备 ${opts.serial} 未连接\n当前设备:${devices.map((d) => d.serial).join(', ') || '(无)'}`);
    }
    return found;
  }

  const pref = devicePreference();
  if (pref) {
    const found = ready.find((d) => d.serial === pref.serial);
    if (found) return found;
    if (ready.length === 1) {
      console.log(`⚠ 记住的设备 ${pref.model || pref.serial} 已断开,临时改用唯一在线设备 ${ready[0].serial}`);
      return ready[0];
    }
    throw new CliError(
      EXIT.ENV,
      `记住的目标设备 ${pref.model || pref.serial}(${pref.serial})已断开\n` +
        (ready.length ? `在线设备:${ready.map((d) => d.serial).join(', ')}\n执行 node ar.js use <序列号> 重新选择` : noDeviceMessage(unavailable))
    );
  }

  if (!ready.length) {
    const avds = await listAvds();
    let msg = noDeviceMessage(unavailable);
    if (avds.length) {
      msg += `\n可用模拟器:${avds.join(', ')}\n启动并选中:node ar.js use --emulator <名字>`;
    }
    throw new CliError(EXIT.ENV, msg);
  }
  if (ready.length === 1) return ready[0];
  throw new CliError(
    EXIT.ENV,
    `检测到 ${ready.length} 台在线设备,请先选择目标:\n` +
      ready.map((d) => `  ${d.serial}  ${d.model || ''}`).join('\n') +
      `\n执行 node ar.js use <序列号> 记住选择,或用 --serial <序列号> 临时指定` +
      (interactiveHint ? `\n${interactiveHint}` : '')
  );
}

/* ------------------------------------------------------------------ */
/* 工程信息探测:任务 / APK / 包名                                       */
/* ------------------------------------------------------------------ */

function gradleTaskFor() {
  const explicit = (opts.task || '').trim();
  if (explicit) return explicit;
  const mod = module();
  const varnt = variant();
  return `:${mod}:assemble${varnt.charAt(0).toUpperCase() + varnt.slice(1)}`;
}

function findApkForConfiguration() {
  return findApk(projectRoot(), module(), variant(), (opts.apk || '').trim());
}

function resolveApk() {
  const candidate = findApkForConfiguration();
  return candidate && candidate.path;
}

function resolvePackage() {
  const explicitId = (opts.applicationId || '').trim();
  if (explicitId) return explicitId;
  const artifact = findApkForConfiguration();
  if (artifact && artifact.applicationId) return artifact.applicationId;
  if (cache.pkg !== undefined) return cache.pkg;
  const root = projectRoot();
  if (!root) {
    cache.pkg = null;
    return null;
  }
  const mod = module();
  const candidates = [
    path.join(moduleDirectory(root, mod), 'build.gradle'),
    path.join(moduleDirectory(root, mod), 'build.gradle.kts')
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const text = fs.readFileSync(file, 'utf8');
      const m = /applicationId\s*[=]?\s*['"]([^'"]+)['"]/.exec(text);
      if (m) {
        cache.pkg = m[1];
        return cache.pkg;
      }
    } catch (e) {
      /* 忽略,继续 */
    }
  }
  cache.pkg = null;
  return null;
}

/* ------------------------------------------------------------------ */
/* 编译                                                                */
/* ------------------------------------------------------------------ */

function runGradle(args, device) {
  return new Promise((resolve) => {
    const root = projectRoot();
    const gradlew = gradlewPath();
    if (!root || !gradlew) {
      resolve({ ok: false, reason: 'no-wrapper' });
      return;
    }
    const env = Object.assign({}, process.env);
    const javaHome = detectJavaHome();
    if (javaHome) env.JAVA_HOME = javaHome;
    const sdk = detectSdkDir();
    if (sdk && fs.existsSync(sdk)) {
      env.ANDROID_HOME = sdk;
      env.ANDROID_SDK_ROOT = sdk;
    }
    if (device) env.ANDROID_SERIAL = device.serial;

    console.log('');
    console.log(`▶ ${path.basename(gradlew)} ${args.join(' ')}`);
    console.log(`  cwd=${root}`);
    if (javaHome) console.log(`  JAVA_HOME=${javaHome}`);
    if (env.ANDROID_SERIAL) console.log(`  ANDROID_SERIAL=${env.ANDROID_SERIAL}`);

    const proc = cp.spawn(
      isWin() ? 'cmd.exe' : gradlew,
      isWin() ? ['/c', gradlew].concat(args) : args,
      {
        cwd: root,
        env,
        stdio: 'inherit',
        windowsHide: true
      }
    );
    // Ctrl-C 会同时到达本进程与同一进程组的 Gradle,这里只负责收尾
    const onSignal = () => {
      try { proc.kill('SIGKILL'); } catch (e) { /* 可能已结束 */ }
      resolve({ ok: false, reason: 'cancelled' });
      process.exit(EXIT.CANCELLED);
    };
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);

    proc.on('error', (e) => {
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
      console.error(`启动 Gradle 失败:${e.message}`);
      resolve({ ok: false, reason: 'spawn-error' });
    });

    proc.on('close', (code, signal) => {
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
      console.log(`◀ Gradle 退出:code=${code} signal=${signal || '-'}`);
      resolve({ ok: code === 0, cancelled: signal === 'SIGINT' || signal === 'SIGTERM' });
    });
  });
}

async function build(device) {
  const task = gradleTaskFor();
  const args = [task].concat(gradleArgs);

  ensureGradlewExecutable();
  ensureLocalProperties();

  const r = await runGradle(args, device);
  if (r.reason === 'no-wrapper') {
    throw new CliError(EXIT.ENV, '当前目录没有找到 gradlew,请在 Gradle 工程根目录运行');
  }
  if (r.cancelled) {
    throw new CliError(EXIT.CANCELLED, '已取消编译');
  }
  if (!r.ok) {
    throw new CliError(EXIT.FAIL, `编译失败:${task}\n查看上方 Gradle 输出定位错误`);
  }
  console.log(`✅ 编译成功:${task}`);
  return r;
}

/* ------------------------------------------------------------------ */
/* 安装 / 启动 / 日志                                                   */
/* ------------------------------------------------------------------ */

/** 执行一次 adb install,附带耗时,便于对比增量安装效果。 */
async function runInstall(adb, serial, apk, extraArgs) {
  const args = ['-s', serial, 'install', '-r', '-t'].concat(extraArgs || []).concat([apk]);
  console.log(`▶ adb ${args.join(' ')}`);
  const started = Date.now();
  const r = await execFileP(adb, args, { timeout: 300000 });
  const text = `${r.stdout || ''}${r.stderr || ''}`;
  console.log(text.trimEnd());
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`  安装用时 ${seconds}s`);
  return { ok: r.ok && /Success/i.test(text), text, seconds };
}

async function installApk(device, { quiet = false } = {}) {
  const adb = detectAdb();
  const apk = resolveApk();
  if (!apk || !fs.existsSync(apk)) {
    throw new CliError(EXIT.ENV, `找不到 APK:${apk || '(未定位到输出目录)'}\n先执行编译,或用 --apk 指定路径`);
  }
  const stat = fs.statSync(apk);
  const ageMin = Math.round((Date.now() - stat.mtimeMs) / 60000);
  if (!quiet) {
    console.log('');
    console.log(`导出 APK:${(stat.size / 1024 / 1024).toFixed(1)} MB,构建于 ${new Date(stat.mtimeMs).toLocaleString()}(${ageMin} 分钟前)`);
  }

  const api = await deviceApiLevel(device.serial);
  let result;

  if (api >= 30) {
    // Android 11+ 支持增量安装:只传输 APK 中变化的块
    result = await runInstall(adb, device.serial, apk, ['--fastdeploy']);
    if (!result.ok) {
      console.log('  --fastdeploy 未成功(常见于签名变化或首次安装),回退到全量安装');
      result = await runInstall(adb, device.serial, apk, []);
    }
  } else {
    result = await runInstall(adb, device.serial, apk, []);
  }

  if (result.ok) {
    console.log(`✅ 已安装到 ${device.serial}`);
    return true;
  }

  if (/INSTALL_FAILED_UPDATE_INCOMPATIBLE|signatures do not match|INSTALL_FAILED_VERSION_DOWNGRADE/i.test(result.text)) {
    const pkg = resolvePackage();
    if (opts.noReinstall) {
      throw new CliError(
        EXIT.CONFIRM,
        `安装被拒绝(签名不一致或版本回退),当前已关闭自动替换。\n` +
          `去掉 --no-reinstall 后重试,即会自动卸载重装(会清空${pkg ? ' ' + pkg : ''}的本地数据)`
      );
    }
    if (!pkg) {
      throw new CliError(EXIT.FAIL, '安装被拒绝且未能识别包名,无法自动卸载重装;可用 --package 指定包名');
    }
    console.log(`⚠ 签名不一致或版本回退 → 自动卸载重装(会清空 ${pkg} 在设备上的本地数据)`);
    const un = await execFileP(adb, ['-s', device.serial, 'uninstall', pkg], { timeout: 60000 });
    if (!un.ok && !/Unknown package|not installed/i.test(`${un.stdout}${un.stderr}`)) {
      console.log(`  卸载返回:${((un.stdout || '') + (un.stderr || '')).trim().split(/\r?\n/).slice(-2).join(' ')}`);
    }
    const again = await runInstall(adb, device.serial, apk, []);
    if (again.ok) {
      console.log(`✅ 重装完成:${pkg} → ${device.serial}`);
      return true;
    }
    throw new CliError(EXIT.FAIL, '重装失败,详情见上方 adb 输出');
  }

  throw new CliError(EXIT.FAIL, `安装失败,详情见上方 adb 输出:\n${result.text.trim().split(/\r?\n/).slice(-5).join('\n')}`);
}

async function resolveLauncherActivity(device, pkg) {
  const adb = detectAdb();
  const r = await execFileP(adb, ['-s', device.serial, 'shell', 'cmd', 'package', 'resolve-activity', '--brief', pkg], { timeout: 10000 });
  if (!r.ok) return '';
  const lines = r.stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.indexOf('/') !== -1);
  return lines.length ? lines[lines.length - 1] : '';
}

async function launchApp(device) {
  const adb = detectAdb();
  const pkg = resolvePackage();
  if (!pkg) {
    throw new CliError(
      EXIT.ENV,
      '未能识别 applicationId,无法自动启动\n可在模块 build.gradle 确认 applicationId,或用 --package <包名> 指定'
    );
  }
  console.log('');
  const activity = await resolveLauncherActivity(device, pkg);
  if (activity) {
    console.log(`▶ adb -s ${device.serial} shell am start -n ${activity}`);
    const r = await execFileP(adb, ['-s', device.serial, 'shell', 'am', 'start', '-n', activity], { timeout: 20000 });
    const text = `${r.stdout || ''}${r.stderr || ''}`;
    console.log(text.trimEnd());
    if (r.ok && !/^\s*Error/im.test(text)) {
      console.log(`✅ 已启动:${pkg}`);
      return true;
    }
  }
  console.log(`▶ adb -s ${device.serial} shell monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`);
  const m = await execFileP(adb, ['-s', device.serial, 'shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1'], { timeout: 20000 });
  const mText = `${m.stdout || ''}${m.stderr || ''}`;
  console.log(mText.trimEnd());
  const ok = m.ok && /Events injected:\s*[1-9]/.test(mText) && !/No activities found|monkey aborted|Error:/i.test(mText);
  if (ok) console.log(`✅ 已启动:${pkg}`);
  else throw new CliError(EXIT.FAIL, `启动失败:${pkg}\n确认 App 已安装且含有 LAUNCHER activity`);
  return ok;
}

async function isAppRunning(device, pkg) {
  const r = await execFileP(detectAdb(), ['-s', device.serial, 'shell', 'pidof', pkg], { timeout: 5000 });
  return r.ok && !!r.stdout.trim();
}

function openLogcat(device) {
  const adb = detectAdb();
  const pkg = resolvePackage();
  const args = ['-s', device.serial, 'logcat', '-v', 'time'];
  console.log(`▶ adb ${args.join(' ')}${pkg ? `(优先只看 ${pkg} 的进程,Ctrl-C 停止)` : '(Ctrl-C 停止)'}`);
  const start = (extra) => {
    const child = cp.spawn(adb, args.concat(extra || []), { stdio: 'inherit', windowsHide: true });
    const onSignal = () => {
      try { child.kill('SIGKILL'); } catch (e) { /* 可能已结束 */ }
      process.exit(EXIT.OK);
    };
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    child.on('close', () => process.exit(EXIT.OK));
  };
  if (!pkg) {
    start();
    return;
  }
  // 优先只看本应用进程;多进程时取第一个 pid;拿不到 pid 时回落全量日志
  execFileP(adb, ['-s', device.serial, 'shell', 'pidof', pkg], { timeout: 5000 }).then((r) => {
    const pid = (r.stdout || '').trim().split(/\s+/)[0];
    if (pid && /^\d+$/.test(pid)) {
      console.log(`  进程 ${pkg} pid=${pid}`);
      start([`--pid=${pid}`]);
    } else {
      console.log(`  未取到 ${pkg} 的 pid(App 未运行?),输出全量日志`);
      start();
    }
  });
}

/* ------------------------------------------------------------------ */
/* AVD 启动                                                            */
/* ------------------------------------------------------------------ */

async function findEmulatorByAvdName(name) {
  const { devices } = await listDevices();
  for (const device of devices.filter((d) => d.serial.startsWith('emulator-') && d.state === 'device')) {
    const result = await execFileP(detectAdb(), ['-s', device.serial, 'emu', 'avd', 'name'], { timeout: 5000 });
    if (result.ok && result.stdout.split(/\r?\n/)[0].trim() === name) {
      return device;
    }
  }
  return null;
}

/** 启动 AVD 并等待它上线,最多 180 秒,用 sys.boot_completed 校验。 */
async function startAvd(name) {
  const emu = emulatorPath();
  if (!emu) {
    throw new CliError(EXIT.ENV, '未找到 emulator(SDK 下无 emulator 目录)\n检查 SDK 探测:node ar.js doctor');
  }
  const avds = await listAvds();
  if (!avds.includes(name)) {
    throw new CliError(EXIT.ENV, `AVD "${name}" 不存在\n可用:${avds.join(', ') || '(未创建任何 AVD)'}`);
  }

  let existing = await findEmulatorByAvdName(name);
  if (!existing) {
    console.log(`▶ ${path.basename(emu)} -avd ${name}`);
    const proc = cp.spawn(emu, ['-avd', name], { detached: true, stdio: 'ignore' });
    proc.once('error', (error) => {
      throw new CliError(EXIT.FAIL, `启动模拟器失败:${error.message}`);
    });
    proc.unref();
  }

  const deadline = Date.now() + 180000;
  let target = existing;
  while (Date.now() < deadline) {
    if (!target) target = await findEmulatorByAvdName(name);
    if (target) {
      const boot = await execFileP(detectAdb(), ['-s', target.serial, 'shell', 'getprop', 'sys.boot_completed'], { timeout: 5000 });
      if (boot.ok && boot.stdout.trim() === '1') {
        process.stdout.write('\n');
        console.log(`✅ 模拟器已就绪:${target.serial}`);
        return target;
      }
      process.stdout.write(`\r⏳ 设备已上线,等待 Android 启动完成… (${Math.round((180000 - (deadline - Date.now())) / 1000)}s/180s)`);
    } else {
      process.stdout.write(`\r⏳ 等待目标模拟器上线… (${Math.round((180000 - (deadline - Date.now())) / 1000)}s/180s)`);
    }
    await sleep(3000);
  }
  throw new CliError(EXIT.ENV, '模拟器 180 秒内未就绪,请检查 AVD 是否正常(可用 node ar.js doctor 查看环境)');
}

/* ------------------------------------------------------------------ */
/* 命令实现                                                            */
/* ------------------------------------------------------------------ */

function requireConfirmation(action, detail) {
  if (opts.yes) return;
  throw new CliError(
    EXIT.CONFIRM,
    `${action}是破坏性操作,需要显式确认:${detail}\n与用户确认后,加 --yes 重新执行`
  );
}

async function cmdDoctor() {
  requireProjectRoot();
  const root = projectRoot();
  const sdk = detectSdkDir();
  const adb = detectAdb();
  const adbUsable = detectAdbUsable();
  const adbVer = adbUsable ? execFileSyncSafe(adb, ['version']).split(/\r?\n/)[0] : '';
  const javaDetail = detectJavaHomeDetail();
  const javaVer = javaVersionOf(javaDetail.home);
  const gradleVer = gradleVersionFromWrapper();
  const { devices, error } = await listDevices();

  console.log('════════ Android Runner 环境自检 ════════');
  const rows = [
    ['工程根目录', root || '❌ 未找到 gradlew(请在 Gradle 工程内运行)'],
    ['Gradle', gradlewPath() || '❌ 缺少 gradlew'],
    ['Gradle 版本', gradleVer || '未知'],
    ['Gradle 任务', gradleTaskFor()],
    ['Android SDK', sdk || '❌ 未探测到(检查 local.properties / ANDROID_HOME)'],
    ['adb', `${adbUsable ? adb : '❌ 未找到(检查 --adb 参数)'}${adbVer ? '  ' + adbVer : ''}`],
    ['JAVA_HOME', `${javaDetail.home || '❌ 未探测到'}(来源:${javaDetail.source}${javaVer ? ',' + javaVer : ''})`]
  ];
  for (const [k, v] of rows) {
    console.log(`  ${padLabel(k, 14)}: ${v}`);
  }

  console.log('');
  if (error) {
    console.log(`  设备          : ❌ ${error}`);
  } else if (!devices.length) {
    console.log('  设备          : ⚠️ 无设备,请连接 USB 并开启 USB 调试');
  } else {
    for (const d of devices) {
      const flag = d.state === 'device' ? '✅' : d.state === 'unauthorized' ? '🔒 未授权' : `⚠️ ${d.state}`;
      console.log(`  设备          : ${flag} ${d.serial}${d.model ? ' · ' + d.model : ''}`);
    }
  }

  console.log('');
  const avds = await listAvds();
  console.log(
    `  模拟器        : ${
      !emulatorPath()
        ? '未安装 emulator(SDK 下无 emulator 目录)'
        : avds.length
          ? avds.join('、')
          : '未创建 AVD'
    }`
  );
  console.log(`  包名          : ${resolvePackage() || '⚠️ 未能从 build.gradle 识别(可用 --package 指定)'}`);
  const apk = resolveApk();
  console.log(
    `  APK           : ${apk && fs.existsSync(apk) ? `${apk}(${new Date(fs.statSync(apk).mtimeMs).toLocaleString()})` : '尚未构建'}`
  );
  console.log('══════════════════════════════════════');

  const problems = [];
  if (!root) problems.push('找到 Gradle 工程根目录');
  if (!sdk) problems.push('探测 Android SDK');
  if (!adbUsable) problems.push('探测 adb');
  if (!javaDetail.home) problems.push('探测 JDK');
  const ready = devices.filter((d) => d.state === 'device');
  if (!ready.length) problems.push('连接一台可用设备');

  if (problems.length) {
    throw new CliError(EXIT.ENV, `环境自检发现 ${problems.length} 项待处理:${problems.join('、')}(详情见上方报告)`);
  }
  console.log('✅ 环境自检通过:工程、SDK、JDK、adb、设备均就绪');
}

/** 按终端显示宽度补齐(中文占 2 格),用于自检报告对齐。 */
function padLabel(text, width) {
  let w = 0;
  for (const ch of text) {
    w += /[一-龥():,]/.test(ch) ? 2 : 1;
  }
  return text + ' '.repeat(Math.max(0, width - w));
}

async function cmdDevices() {
  const root = projectRoot();
  const { devices, error } = await listDevices();
  const avds = await listAvds();
  const pref = devicePreference();

  if (error && opts.json) {
    console.log(JSON.stringify({ error, devices: [], avds, preference: pref }, null, 2));
    throw new CliError(EXIT.ENV, `adb 执行失败:${error}`);
  }
  if (error) {
    throw new CliError(EXIT.ENV, `adb 执行失败:${error}\n检查 --adb 参数或 PATH 中的 adb`);
  }

  const described = await Promise.all(
    devices.map(async (d) => {
      const base = {
        serial: d.serial,
        state: d.state,
        model: d.model,
        isEmulator: d.serial.indexOf('emulator-') === 0
      };
      if (d.state === 'device') {
        const [model, android] = await Promise.all([resolveModel(d), resolveAndroidVersion(d.serial)]);
        base.model = model || d.model;
        base.android = android;
      }
      return base;
    })
  );

  if (opts.json) {
    console.log(JSON.stringify({ root: root || null, devices: described, avds, preference: pref }, null, 2));
    if (!described.some((d) => d.state === 'device')) {
      throw new CliError(EXIT.ENV, noDeviceMessage(devices.filter((d) => d.state !== 'device')));
    }
    return;
  }

  console.log(`工程根目录:${root || '(未找到 gradlew)'}`);
  if (pref) {
    const online = described.some((d) => d.serial === pref.serial && d.state === 'device');
    console.log(`当前目标设备:${pref.serial}${pref.model ? ' · ' + pref.model : ''}${online ? '' : '  ⚠️ 已断开'}`);
  } else {
    console.log('当前目标设备:未选择(单设备时会自动选用)');
  }
  console.log('');
  const ready = described.filter((d) => d.state === 'device');
  const unavailable = described.filter((d) => d.state !== 'device');
  if (ready.length) {
    console.log('已连接设备:');
    for (const d of ready) {
      const mark = pref && pref.serial === d.serial ? ' ← 当前' : '';
      console.log(`  ${d.serial}  ${[d.model, d.android ? `Android ${d.android}` : '', d.isEmulator ? '模拟器' : '真机'].filter(Boolean).join(' · ')}${mark}`);
    }
  } else {
    console.log('已连接设备:无');
    if (unavailable.length) {
      console.log('不可用设备:');
      for (const d of unavailable) {
        const why = d.state === 'unauthorized' ? '未授权:请在手机上点「允许 USB 调试」'
          : d.state === 'offline' ? '离线:拔插 USB 或执行 adb kill-server'
          : d.state;
        console.log(`  ${d.serial}  ${why}`);
      }
    }
  }
  console.log('');
  console.log(`模拟器 AVD:${avds.length ? avds.join('、') : (emulatorPath() ? '未创建' : '未安装 emulator')}`);
  if (!ready.length) {
    throw new CliError(EXIT.ENV, noDeviceMessage(unavailable) + (avds.length ? `\n可用模拟器:${avds.join(', ')}\n启动并选中:node ar.js use --emulator <名字>` : ''));
  }
}

async function cmdUse() {
  if (opts.emulator) {
    const device = await startAvd(opts.emulator);
    rememberDevice(device);
    console.log(`已记住目标设备:${device.serial}(工程:${projectRoot()})`);
    return;
  }
  if (opts.clear) {
    clearDevicePreference();
    console.log('已清除目标设备偏好');
    return;
  }
  if (!opts.serial) {
    const pref = devicePreference();
    if (pref) {
      console.log(`当前目标设备:${pref.serial}${pref.model ? ' · ' + pref.model : ''}`);
      console.log('重新选择:node ar.js use <序列号>   启动模拟器:node ar.js use --emulator <名字>   清除:node ar.js use --clear');
      return;
    }
    console.log('未设置目标设备(单设备时会自动选用)');
    console.log('设置:node ar.js use <序列号>   查看设备:node ar.js devices');
    return;
  }
  const { devices, error } = await listDevices();
  if (error) throw new CliError(EXIT.ENV, `adb 执行失败:${error}`);
  const device = devices.find((d) => d.serial === opts.serial && d.state === 'device');
  if (!device) {
    const raw = devices.find((d) => d.serial === opts.serial);
    if (raw) throw new CliError(EXIT.ENV, `设备 ${opts.serial} 当前状态为 ${raw.state},不可用`);
    throw new CliError(EXIT.ENV, `设备 ${opts.serial} 未连接\n当前设备:${devices.map((d) => d.serial).join(', ') || '(无)'}\n查看详情:node ar.js devices`);
  }
  const model = await resolveModel(device);
  rememberDevice({ serial: device.serial, model: model || device.model });
  console.log(`已记住目标设备:${device.serial}${model ? ' · ' + model : ''}(工程:${projectRoot()})`);
}

async function cmdInfo() {
  const root = projectRoot();
  if (!root) {
    if (opts.json) {
      console.log(JSON.stringify({ root: null, isProject: false }, null, 2));
      throw new CliError(EXIT.ENV, '当前目录不是 Gradle 工程(未找到 gradlew)');
    }
    throw new CliError(EXIT.ENV, '当前目录不是 Gradle 工程(未找到 gradlew)\n请在 Gradle 工程根目录(或其子目录)运行');
  }
  const javaDetail = detectJavaHomeDetail();
  const info = {
    root,
    isProject: true,
    gradlew: gradlewPath(),
    gradleVersion: gradleVersionFromWrapper() || '',
    module: module(),
    variant: variant(),
    task: gradleTaskFor(),
    modules: discoverModules(root, module()),
    sdk: detectSdkDir() || '',
    adb: detectAdb(),
    adbUsable: detectAdbUsable(),
    javaHome: javaDetail.home || '',
    javaSource: javaDetail.source,
    javaVersion: javaVersionOf(javaDetail.home) || '',
    packageName: resolvePackage() || '',
    apk: apkInfo(findApkForConfiguration()),
    preference: devicePreference()
  };
  if (opts.json) {
    console.log(JSON.stringify(info, null, 2));
    return;
  }
  for (const [k, v] of Object.entries(info)) {
    const text = v && typeof v === 'object' ? JSON.stringify(v) : String(v);
    console.log(`${padLabel(k, 14)}: ${text}`);
  }
}

async function cmdBuild() {
  requireProjectRoot();
  const device = await pickDevice().catch((e) => {
    // 仅编译不强制要求设备;无设备时照常编译
    if (e.code === EXIT.ENV && /没有检测到设备|未授权|offline/.test(e.message)) {
      console.log(`⚠ ${e.message.split('\n')[0]}\n(仅编译,不校验设备)`);
      return null;
    }
    throw e;
  });
  await build(device);
}

async function cmdInstall() {
  requireProjectRoot();
  const device = await pickDevice();
  await installApk(device);
}

async function cmdRun() {
  requireProjectRoot();
  const device = await pickDevice();
  const pkg = resolvePackage();
  console.log(`目标设备:${device.serial}${device.model ? ' · ' + device.model : ''}${pkg ? ` · ${pkg}` : ''}`);
  console.log('步骤:编译 → 安装 → 启动');
  await build(device);
  await installApk(device);
  await launchApp(device);
  console.log(`🎉 运行完成:${pkg || '(未识别包名)'} → ${device.serial}`);
}

async function cmdLaunch() {
  requireProjectRoot();
  const device = await pickDevice();
  await launchApp(device);
}

async function cmdStop() {
  requireProjectRoot();
  const device = await pickDevice();
  const pkg = resolvePackage();
  if (!pkg) throw new CliError(EXIT.ENV, '未识别 applicationId,无法停止应用(可用 --package 指定)');
  const r = await execFileP(detectAdb(), ['-s', device.serial, 'shell', 'am', 'force-stop', pkg], { timeout: 10000 });
  if (!r.ok) throw new CliError(EXIT.FAIL, `停止失败:${r.message || r.stderr}`);
  console.log(`✅ 已停止 ${pkg}(${device.serial})`);
}

async function cmdRestart() {
  requireProjectRoot();
  const device = await pickDevice();
  const pkg = resolvePackage();
  if (!pkg) throw new CliError(EXIT.ENV, '未识别 applicationId,无法重启应用(可用 --package 指定)');
  console.log('步骤:停止 → 启动');
  const stop = await execFileP(detectAdb(), ['-s', device.serial, 'shell', 'am', 'force-stop', pkg], { timeout: 10000 });
  console.log(`停止 ${pkg}:${stop.ok ? '成功' : '失败'}`);
  await launchApp(device);
}

async function cmdUninstall() {
  requireProjectRoot();
  requireConfirmation('卸载', `将从设备移除应用并清空其数据`);
  const device = await pickDevice();
  const pkg = resolvePackage();
  if (!pkg) throw new CliError(EXIT.ENV, '未识别 applicationId,无法卸载(可用 --package 指定)');
  const r = await execFileP(detectAdb(), ['-s', device.serial, 'uninstall', pkg], { timeout: 60000 });
  console.log(`${(r.stdout || '') + (r.stderr || '')}`.trimEnd());
  if (r.ok && /Success/i.test(r.stdout || '')) {
    console.log(`✅ 已从 ${device.serial} 卸载 ${pkg}`);
  } else {
    throw new CliError(EXIT.FAIL, `卸载失败:${((r.stdout || '') + (r.stderr || '')).trim().split(/\r?\n/).slice(-3).join('\n')}`);
  }
}

async function cmdClearData() {
  requireProjectRoot();
  requireConfirmation('清除数据', '登录态等本地数据会丢失');
  const device = await pickDevice();
  const pkg = resolvePackage();
  if (!pkg) throw new CliError(EXIT.ENV, '未识别 applicationId,无法清数据(可用 --package 指定)');
  const r = await execFileP(detectAdb(), ['-s', device.serial, 'shell', 'pm', 'clear', pkg], { timeout: 30000 });
  console.log(`${(r.stdout || '') + (r.stderr || '')}`.trimEnd());
  if (r.ok && /Success/i.test(r.stdout || '')) {
    console.log(`✅ 已清除 ${pkg} 在 ${device.serial} 上的应用数据`);
  } else {
    throw new CliError(EXIT.FAIL, `清除数据失败:${((r.stdout || '') + (r.stderr || '')).trim().split(/\r?\n/).slice(-3).join('\n')}`);
  }
}

async function cmdLogcat() {
  requireProjectRoot();
  const device = await pickDevice();
  openLogcat(device);
}

/* ------------------------------------------------------------------ */
/* 图形面板(HTML,浏览器打开)                                          */
/* ------------------------------------------------------------------ */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtSize(bytes) {
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function fmtAgo(ms) {
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.round(h / 24)} 天前`;
}

function deviceStateLabel(state) {
  if (state === 'device') return '在线';
  if (state === 'unauthorized') return '未授权';
  if (state === 'offline') return '离线';
  return state || '未知';
}

function renderDashboard(d) {
  const deviceCards = d.devices.map((dev) => {
    const current = d.pref && d.pref.serial === dev.serial && dev.state === 'device';
    const cls = dev.state === 'device' ? 'ok' : dev.state === 'unauthorized' ? 'warn' : 'bad';
    const sub = [
      dev.android ? `Android ${esc(dev.android)}` : '',
      dev.isEmulator ? '模拟器' : '真机',
      esc(dev.serial)
    ].filter(Boolean).join(' · ');
    return `<div class="card device ${cls}${current ? ' current' : ''}">
      <div class="card-top"><span class="name">${esc(dev.model || dev.serial)}</span>
        <span class="badge">${current ? '当前目标 · ' : ''}${esc(deviceStateLabel(dev.state))}</span></div>
      <div class="sub">${sub}</div>
    </div>`;
  }).join('\n');

  const noDevice = d.deviceError
    ? `<div class="card bad"><div class="card-top"><span class="name">adb 异常</span></div><div class="sub">${esc(d.deviceError)}</div></div>`
    : `<div class="card warn"><div class="card-top"><span class="name">未检测到设备</span></div><div class="sub">检查 USB 线、开发者选项与 USB 调试开关;或启动右侧任一模拟器</div></div>`;

  const avdChips = d.avds.length
    ? d.avds.map((a) => `<span class="chip">${esc(a)}</span>`).join('\n')
    : '<span class="chip muted">未创建 AVD</span>';

  const envRows = [
    ['工程根目录', d.root, !!d.root],
    ['Gradle', `v${d.gradleVer || '?'} · ${esc(d.task)}`, !!d.gradleVer],
    ['Android SDK', d.sdk, !!d.sdk],
    ['adb', `${esc(d.adb)}${d.adbUsable ? '' : '  (不可用)'}`, d.adbUsable],
    ['JAVA_HOME', `${esc(d.java.home || '未探测到')} · ${esc(d.java.source)}${d.javaVer ? ' · ' + esc(d.javaVer) : ''}`, !!d.java.home]
  ].map(([k, v, ok]) => `<div class="env-row"><span class="env-k">${ok ? '✅' : '❌'} ${esc(k)}</span><span class="env-v">${esc(v)}</span></div>`).join('\n');

  const apkCard = d.apk
    ? `<div class="card ok"><div class="card-top"><span class="name">${esc(d.apk.name)}</span><span class="badge">${fmtSize(d.apk.size)} · ${fmtAgo(d.apk.modifiedAt)}</span></div><div class="sub">${esc(d.apk.path)}</div></div>`
    : `<div class="card warn"><div class="card-top"><span class="name">尚未构建</span></div><div class="sub">模块 ${esc(d.module)} 的 ${esc(d.variant)} APK 还没有输出,先执行编译</div></div>`;

  const actions = [
    ['▶ 运行到设备', '把当前 Android 工程运行到设备(编译、安装、启动)'],
    ['⚒ 仅编译', '编译当前 Android 工程'],
    ['⤓ 仅安装 APK', '把最新构建的 APK 安装到设备'],
    ['≣ 查看日志', '打开当前应用的 logcat 日志'],
    ['✓ 环境自检', '对当前 Android 工程做运行环境自检'],
    ['⟳ 刷新面板', '刷新 Android 图形面板']
  ].map(([label, phrase]) =>
    `<button class="action" data-phrase="${esc(phrase)}">${esc(label)}</button>`
  ).join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Android Runner · ${esc(path.basename(d.root || ''))}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #10141a; color: #d7dde5; font: 14px/1.55 -apple-system, "PingFang SC", "Segoe UI", sans-serif; }
  .wrap { max-width: 880px; margin: 0 auto; padding: 28px 20px 48px; }
  h1 { font-size: 20px; margin: 0 0 4px; display: flex; align-items: center; gap: 10px; }
  h1 .logo { width: 26px; height: 26px; border-radius: 7px; background: linear-gradient(135deg, #3ddc84, #2bb673); display: inline-flex; align-items: center; justify-content: center; font-size: 15px; color: #0b1210; }
  .meta { color: #8a94a3; font-size: 12.5px; margin-bottom: 22px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: #8a94a3; margin: 26px 0 10px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 10px; }
  .card { background: #1a2029; border: 1px solid #2a323d; border-radius: 12px; padding: 12px 14px; }
  .card.current { border-color: #3ddc84; box-shadow: 0 0 0 1px #3ddc84 inset; }
  .card.ok { border-left: 3px solid #3ddc84; }
  .card.warn { border-left: 3px solid #e8b13f; }
  .card.bad { border-left: 3px solid #e5534b; }
  .card-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .card .name { font-weight: 600; color: #eef2f6; }
  .badge { font-size: 11.5px; color: #aab4c0; background: #232b35; border-radius: 999px; padding: 2px 9px; white-space: nowrap; }
  .sub { color: #97a1ad; font-size: 12.5px; margin-top: 4px; word-break: break-all; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .chip { background: #1a2029; border: 1px solid #2a323d; border-radius: 999px; padding: 5px 13px; font-size: 12.5px; color: #c3ccd6; }
  .chip.muted { color: #6f7a86; }
  .env { background: #1a2029; border: 1px solid #2a323d; border-radius: 12px; padding: 4px 14px; }
  .env-row { display: flex; gap: 14px; padding: 8px 0; border-bottom: 1px solid #232b35; font-size: 13px; }
  .env-row:last-child { border-bottom: 0; }
  .env-k { flex: 0 0 130px; color: #c3ccd6; }
  .env-v { color: #97a1ad; word-break: break-all; }
  .actions { display: flex; flex-wrap: wrap; gap: 10px; }
  .action { background: #232b35; color: #eef2f6; border: 1px solid #343e4a; border-radius: 10px; padding: 9px 16px; font-size: 13.5px; cursor: pointer; transition: background .15s; }
  .action:hover { background: #2c3642; }
  .toast { position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%) translateY(20px); background: #3ddc84; color: #0b1210; padding: 9px 18px; border-radius: 10px; font-size: 13px; opacity: 0; pointer-events: none; transition: all .2s; }
  .toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
  .foot { margin-top: 30px; color: #6f7a86; font-size: 12px; }
</style>
</head>
<body>
<div class="wrap">
  <h1><span class="logo">🤖</span> Android Runner</h1>
  <div class="meta">${esc(path.basename(d.root))} · 模块 ${esc(d.module)} · ${esc(d.variant)} · 生成于 ${new Date().toLocaleString()} · 刷新:对 ZCode 说「刷新 Android 面板」</div>

  <h2>设备</h2>
  <div class="grid">${deviceCards || noDevice}</div>
  <h2>模拟器(AVD)</h2>
  <div class="chips">${avdChips}</div>

  <h2>应用</h2>
  <div class="grid">
    ${apkCard}
    <div class="card"><div class="card-top"><span class="name">${esc(d.pkg || '未识别包名')}</span><span class="badge">applicationId</span></div>
      <div class="sub">${d.pkg ? '从模块 build.gradle / output-metadata.json 自动识别' : '检查模块 build.gradle,或运行时用 --package 指定'}</div></div>
  </div>

  <h2>环境</h2>
  <div class="env">${envRows}</div>

  <h2>快捷操作(点击复制,粘贴到 ZCode 发送)</h2>
  <div class="actions">${actions}</div>

  <div class="foot">Android Runner for ZCode · 移植自 VSCode 扩展 Android Device Runner (menggod/android-runner, MIT) · 静态快照,不代表实时状态</div>
</div>
<div class="toast" id="toast">已复制,粘贴到 ZCode 即可执行</div>
<script>
  document.querySelectorAll('.action').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var text = btn.getAttribute('data-phrase');
      function done() {
        var t = document.getElementById('toast');
        t.classList.add('show');
        setTimeout(function () { t.classList.remove('show'); }, 1600);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { fallback(); });
      } else { fallback(); }
      function fallback() {
        var ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); done(); } catch (e) {}
        document.body.removeChild(ta);
      }
    });
  });
</script>
</body>
</html>`;
}

async function cmdDashboard() {
  requireProjectRoot();
  const root = projectRoot();
  const { devices, error } = await listDevices();
  const described = await Promise.all(
    devices.map(async (dev) => {
      const base = { serial: dev.serial, state: dev.state, model: dev.model, isEmulator: dev.serial.indexOf('emulator-') === 0 };
      if (dev.state === 'device') {
        const [model, android] = await Promise.all([resolveModel(dev), resolveAndroidVersion(dev.serial)]);
        base.model = model || dev.model;
        base.android = android;
      }
      return base;
    })
  );
  const javaDetail = detectJavaHomeDetail();
  const apk = apkInfo(findApkForConfiguration());
  const html = renderDashboard({
    root,
    deviceError: error,
    devices: described,
    avds: await listAvds(),
    pref: devicePreference(),
    sdk: detectSdkDir() || '',
    adb: detectAdb(),
    adbUsable: detectAdbUsable(),
    java: javaDetail,
    javaVer: javaVersionOf(javaDetail.home),
    gradleVer: gradleVersionFromWrapper(),
    task: gradleTaskFor(),
    module: module(),
    variant: variant(),
    pkg: resolvePackage(),
    apk
  });
  const out = path.join(os.homedir(), '.android-runner', 'dashboard.html');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html, 'utf8');
  console.log(`✅ 图形面板已生成:${out}`);
  if (opts.open) {
    const opener = isWin() ? 'cmd.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const args = isWin() ? ['/c', 'start', '', out] : [out];
    cp.spawn(opener, args, { detached: true, stdio: 'ignore' }).unref();
    console.log('已在默认浏览器打开');
  } else {
    console.log('在浏览器打开:node ar.js dashboard --open');
  }
}

/* ------------------------------------------------------------------ */
/* 入口                                                                */
/* ------------------------------------------------------------------ */

const IMPL = {
  doctor: cmdDoctor,
  devices: cmdDevices,
  use: cmdUse,
  info: cmdInfo,
  build: cmdBuild,
  install: cmdInstall,
  run: cmdRun,
  launch: cmdLaunch,
  stop: cmdStop,
  restart: cmdRestart,
  uninstall: cmdUninstall,
  'clear-data': cmdClearData,
  logcat: cmdLogcat,
  dashboard: cmdDashboard
};

(async () => {
  try {
    await IMPL[command]();
    process.exit(EXIT.OK);
  } catch (e) {
    if (e instanceof CliError) {
      console.error(`\n❌ ${e.message}`);
      process.exit(e.code);
    }
    console.error(`\n❌ 未捕获异常:${e && e.stack ? e.stack : e}`);
    process.exit(EXIT.FAIL);
  }
})();
