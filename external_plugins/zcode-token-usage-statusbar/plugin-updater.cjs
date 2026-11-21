"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFile, spawn } = require("child_process");
const crypto = require("crypto");
const { isDeepStrictEqual } = require("util");
const releaseChannel = require("./plugin-release.cjs");
const { resolvePluginStorage } = require("./plugin-storage.cjs");

const PLUGIN_ID = "zcode-token-usage-statusbar@zusage-marketplace";
const INTERVAL_MS = 60 * 60 * 1000;
// 仓库改名只会表现为这两类来源校验失败（plugin-release.cjs 的 validateRelease / githubReleaseFromCatalog），
// 文案变动须同步；tests/plugin-release-updater.test.cjs 的改名用例走真实校验函数，失配会变红。
const RENAME_SUSPECT = /GitHub Release 资产来源或大小无效|GitHub 渠道清单下载源与注册仓库或版本不一致/;
// GitHub 不可达/限流类失败的 message 特征：fetchBytes 的超时与状态码文案，加 Node 原生
// DNS/连接/证书错误（request.on("error") 透传）。「socket disconnected before secure TLS」
// 是无代理直连 github.com 的实测形态（2026-11-12 真机沙箱），与 ECONNRESET 同族。
const GITHUB_UNREACHABLE = /超时|时限|ENOTFOUND|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|EPROTO|证书|socket hang up|socket disconnected|TLS connection|请求失败 \((?:403|429|5\d\d)\)/;
// Release 渠道的检查、下载与宿主安装整条链都走 GitHub 域；GitHub 不可达时插件侧回退救不了
// 宿主 CLI 的下载环节，改注册 GitCode 镜像渠道（清单与资产同源发布）是用户可自助完成的
// 完整出路（issue #310：1.5.17→1.5.18 用户网络不通 GitHub，检查双路径即失败）。
const GITCODE_MIRROR_HINT = "；GitHub 无法访问时可改用 GitCode 镜像渠道 https://gitcode.com/tanranran/zcode-token-usage-statusbar.git#plugin-releases-gitcode";

function cliExecutable(executable, platform = process.platform) {
  // 仅 macOS 换用 Helper bundle：主 bundle 二进制启动即以 LaunchServices Foreground 登记，
  // 检查更新拉起的 CLI 会让 Dock 闪现「zcode-cli」图标；Helper 带 LSUIElement，登记 UIElement
  // 不进 Dock（宿主自身 CLI 同链）。其余平台或结构不符回退调用方二进制，更新链不受影响。
  if (platform !== "darwin") return executable;
  const helper = path.join(path.dirname(path.dirname(executable)),
    "Frameworks", "ZCode Helper.app", "Contents", "MacOS", "ZCode Helper");
  try {
    if (fs.statSync(helper).isFile()) {
      fs.accessSync(helper, fs.constants.X_OK);   // 不可执行时回退，宁可闪图标不可更新失败
      return helper;
    }
  } catch (e) { }
  return executable;
}

function compareVersions(a, b) {
  const parse = (v) => /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v || "");
  const aa = parse(a), bb = parse(b);
  if (!aa || !bb) throw new Error("插件版本号缺失或不是语义版本，无法确认更新状态");
  for (let i = 1; i <= 3; i++) {
    if (Number(aa[i]) !== Number(bb[i])) return Number(aa[i]) > Number(bb[i]) ? 1 : -1;
  }
  if (!aa[4] && !bb[4]) return 0;
  if (!aa[4]) return 1;
  if (!bb[4]) return -1;
  const ap = aa[4].split("."), bp = bb[4].split(".");
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    if (ap[i] === bp[i]) continue;
    if (ap[i] === undefined) return -1;
    if (bp[i] === undefined) return 1;
    const an = /^\d+$/.test(ap[i]), bn = /^\d+$/.test(bp[i]);
    if (an && bn) return Number(ap[i]) > Number(bp[i]) ? 1 : -1;
    if (an !== bn) return an ? -1 : 1;
    return ap[i] > bp[i] ? 1 : -1;
  }
  return 0;
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return fallback; }
}
function readConfig(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch (e) { return e.code === "ENOENT" ? {} : null; }
}
function writeJson(file, value) {
  const tmp = file + "." + process.pid + ".tmp";
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
    fs.renameSync(tmp, file);
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) { }
  }
}
function runFile(command, args, options, input, onSpawn) {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, options, (error, stdout, stderr) => {
      let data;
      try { data = JSON.parse(stdout); } catch (e) { }
      if (error) {
        const detail = data && data.diagnostics && data.diagnostics.map((d) => d.message).join("; ");
        reject(new Error(detail || String(stderr || error.message).trim().slice(0, 1000)));
      } else if (!data) reject(new Error("插件管理器没有返回有效 JSON"));
      else resolve(data);
    });
    if (onSpawn) {
      try { if (child.pid) onSpawn(child.pid); }
      catch (e) { child.kill(); reject(e); }
    }
    if (input !== undefined) { child.stdin.on("error", () => {}); child.stdin.end(input); }
  });
}

// merge applies direct child replacements under Python's config lock, after defaults/changes.
// Example: updateConfig(HERE, {}, py, undefined, { mobile_relay: { enabled } }).
async function updateConfig(runtime, changes, python, defaults, merge) {
  const result = await runFile(python, [path.join(__dirname, "runtime_lock.py"), "--update-config", runtime], {
    windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024,
  }, JSON.stringify({ changes, defaults, merge }));
  if (result.ok !== true || typeof result.changed !== "boolean") throw new Error("配置更新没有返回有效确认");
  return result;
}

function readState(file, currentTime) {
  const value = readJson(file, {});
  const saved = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const timestamp = (v) => Number.isSafeInteger(v) && v >= 0 && v <= currentTime ? v : 0;
  let pendingVersion = "";
  try { if (typeof saved.pendingVersion === "string") { compareVersions(saved.pendingVersion, saved.pendingVersion); pendingVersion = saved.pendingVersion; } } catch (e) { }
  // lastFailure：上次安装失败的目标身份（版本 + 语义化校验 + 渠道）。损坏即丢弃，
  // 绝不让坏记录冒充「已安装」或「已成功」——它只供更新日志卡片标注失败目标。
  let lastFailure = null;
  if (saved.lastFailure && typeof saved.lastFailure === "object" && !Array.isArray(saved.lastFailure)) {
    const f = saved.lastFailure;
    try {
      if (typeof f.version === "string" && compareVersions(f.version, f.version) === 0 &&
          Number.isSafeInteger(f.at) && f.at > 0 && f.at <= currentTime &&
          (f.channel === "release" || f.channel === "market")) {
        lastFailure = { version: f.version, at: f.at, channel: f.channel };
      }
    } catch (e) { }
  }
  // lastError：最近一次检查/安装失败的错误消息（检查/安装成功即清）。与 lastFailure
  // （安装目标身份）互补——检查阶段失败（网络/渠道/宿主 CLI 无输出）此前完全不落盘，
  // 浮层不在时 plugin-update.json 里没有任何痕迹（issue #247）。损坏即丢弃。
  let lastError = null;
  if (saved.lastError && typeof saved.lastError === "object" && !Array.isArray(saved.lastError)) {
    const le = saved.lastError;
    if (typeof le.message === "string" && le.message && Number.isSafeInteger(le.at) && le.at > 0 && le.at <= currentTime) {
      lastError = { message: le.message.slice(0, 500), at: le.at };
    }
  }
  // repoMigration：仓库改名迁移记录（install-release.md §6）。from/to 必须是合法且不同的
  // GitHub owner/repo，损坏即丢弃——豁免随之失效，回到按注册名检查并在失败后重新探测。
  let repoMigration = null;
  if (saved.repoMigration && typeof saved.repoMigration === "object" && !Array.isArray(saved.repoMigration)) {
    const m = saved.repoMigration;
    if (typeof m.from === "string" && typeof m.to === "string" &&
        releaseChannel.githubRepository(m.from) === m.from &&
        releaseChannel.githubRepository(m.to) === m.to &&
        m.from.toLowerCase() !== m.to.toLowerCase()) {
      repoMigration = { from: m.from, to: m.to, at: Number.isSafeInteger(m.at) && m.at > 0 ? m.at : 0 };
    }
  }
  return { checkedAt: timestamp(saved.checkedAt), lastAttempt: timestamp(saved.lastAttempt),
    pendingSync: saved.pendingSync === true, pendingVersion,
    pendingPid: Number.isSafeInteger(saved.pendingPid) && saved.pendingPid > 0 ? saved.pendingPid : 0,
    pendingRelease: saved.pendingRelease === undefined || saved.pendingRelease === null ? null : saved.pendingRelease,
    lastFailure, lastError, repoMigration };
}
function legacyLockBusy(runtime) {
  // An already-running wx updater cannot honor v2 locks. Respect its live owner,
  // never unlink its file, and retire old updater processes by restarting ZCode.
  const file = path.join(runtime, "plugin-update.lock");
  try {
    const owner = readJson(file, {});
    if (owner && Number.isSafeInteger(owner.pid) && owner.pid > 0) {
      try { process.kill(owner.pid, 0); return true; }
      catch (e) { return e.code !== "ESRCH"; }
    }
    return Date.now() - fs.statSync(file).mtimeMs < 600000;
  } catch (e) { if (e.code === "ENOENT") return false; throw e; }
}
function acquireUpdateLock(runtime, python, helper) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, [helper, "--hold", path.join(runtime, "plugin-update-v2.lock")], {
      windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
    });
    let settled = false, output = "", detail = "";
    const timer = setTimeout(() => fail(new Error("插件更新锁未返回就绪状态")), 10000);
    const fail = (error) => {
      if (settled) return;
      settled = true; clearTimeout(timer); child.stdin.destroy(); child.kill(); reject(error);
    };
    child.stdin.on("error", () => {});
    child.once("error", fail);
    child.stderr.on("data", (chunk) => { detail = (detail + chunk).slice(0, 1000); });
    child.once("close", (code) => {
      if (!settled) fail(new Error(detail.trim() || `插件更新锁进程提前退出 (${code})`));
    });
    child.stdout.on("data", (chunk) => {
      if (settled) return;
      output += chunk;
      if (output.length > 1000) { fail(new Error("插件更新锁返回无效 JSON")); return; }
      if (!output.includes("\n")) return;
      let data;
      try { data = JSON.parse(output.trim()); } catch (e) { fail(new Error("插件更新锁返回无效 JSON")); return; }
      if (!data || typeof data.locked !== "boolean" || Object.keys(data).length !== 1) {
        fail(new Error("插件更新锁返回无效 JSON")); return;
      }
      settled = true; clearTimeout(timer);
      if (!data.locked) { child.stdin.end(); resolve(null); return; }
      let releasing;
      resolve(() => {
        if (!releasing) releasing = new Promise((done) => {
          if (child.exitCode !== null || child.signalCode !== null) { done(); return; }
          child.once("close", done); child.stdin.end();
        });
        return releasing;
      });
    });
  });
}

// 渠道身份只比 kind/repository/source；flavor 由 source 可推导，不参与比较，
// 这样旧版本持久化的更新意图（无 flavor 字段）在新代码下仍然等价，不会误判来源变化。
function sameChannel(a, b, migration) {
  return !!a && !!b && a.kind === b.kind && repositoryMatches(a.repository, b.repository, migration) &&
    isDeepStrictEqual(a.source === undefined ? null : a.source, b.source === undefined ? null : b.source);
}
// 仓库改名迁移豁免（install-release.md §6）：仅当迁移记录 from/to 均为合法 GitHub 仓库且
// 精确等于注册名与生效名（大小写不敏感）时允许 repository 不同；kind 与 source 恒严格相等。
// 缺省/损坏/非 GitHub 形态的迁移记录一律回退严格比对；GitCode 渠道调用方必须传 null。
function repositoryMatches(registered, effective, migration) {
  if ((registered || "") === (effective || "")) return true;
  const record = migration;
  return !!(record && typeof record.from === "string" && typeof record.to === "string" &&
    releaseChannel.githubRepository(record.from) === record.from &&
    releaseChannel.githubRepository(record.to) === record.to &&
    record.from.toLowerCase() === String(registered || "").toLowerCase() &&
    record.to.toLowerCase() === String(effective || "").toLowerCase());
}
function channelFlavor(channel) {
  // 持久化意图的渠道形态：注册为 GitCode git 来源即镜像渠道，其余远端一律按 GitHub 校验。
  return !!(channel && channel.source && channel.source.source === "git" &&
    releaseChannel.gitcodeRepository(channel.source.url)) ? "gitcode" : "github";
}

function verifyCommittedRelease(record, expected, currentChannel, migration) {
  const release = expected && expected.release, manifest = expected && expected.manifest;
  if (!release || !manifest || !expected.channel) throw new Error("Release 更新意图无效或市场来源已变化，停止运行时同步");
  const flavor = expected.channel.flavor || channelFlavor(expected.channel);
  // 迁移豁免仅限 GitHub 渠道；GitCode 渠道无迁移语义，repository 一律严格相等。渠道形态取自宿主注册来源
  // （currentChannel），而不是持久化意图里的 flavor——后者在本地可写的状态文件里可被篡改。
  const registeredFlavor = currentChannel ? currentChannel.flavor || channelFlavor(currentChannel) : "";
  if (!sameChannel(currentChannel, expected.channel, registeredFlavor === "gitcode" ? null : migration)) throw new Error("Release 更新意图无效或市场来源已变化，停止运行时同步");
  // GitHub 意图有两个来源：API 行（archive.size 有效）与清单兜底（catalogSha256 标记），
  // 各用同源形状门复核；GitCode 意图只来自渠道清单；镜像回退行只发生在 GitHub 渠道
  // （specs/github-mirror-fallback.md），仓库钉死内置镜像常量，URL/版本/资产自洽经严格门复核，
  // 本地伪造 mirror 标志至多把安装指向官方镜像的已校验资产，无提权面。
  const mirrorRow = release.mirror === true && registeredFlavor !== "gitcode";
  const validated = mirrorRow
    ? releaseChannel.validateGithubMirrorRelease(release)
    : flavor === "gitcode"
      ? releaseChannel.validateGitcodeRelease(release)
      : release.catalogSha256 !== undefined
        ? releaseChannel.validateGithubCatalogRelease(release)
        : releaseChannel.validateRelease({ tag_name: release.tag, draft: false, prerelease: false,
          assets: [release.archive, release.manifest] }, release.repository);
  if (!validated || validated.version !== release.version || expected.channel.kind !== "release" ||
      (flavor !== validated.flavor && validated.mirror !== true) ||
      !releaseChannel.sameRepository(expected.channel.repository, release.repository) &&
      !(mirrorRow && releaseChannel.sameRepository(release.repository, releaseChannel.GITCODE_MIRROR_REPOSITORY)))
    throw new Error("Release 更新意图无效，停止运行时同步");
  releaseChannel.validateManifest(manifest, validated);
  if (release.catalogSha256 !== undefined && manifest.asset.sha256 !== release.catalogSha256) throw new Error("发布 manifest 与渠道清单的 SHA256 不一致，停止运行时同步");
  if (record.version !== release.version || !record.source || !releaseChannel.sameAssetUrl(record.source.url, release.archive.browser_download_url) ||
      record.source.sha256 !== manifest.asset.sha256 || record.source.source !== "url" || record.source.type !== "zip" ||
      record.source.path !== "plugins/zcode-token-usage-statusbar" ||
      (record.source.stripRoot !== undefined && record.source.stripRoot !== false) || record.source.headers !== undefined) throw new Error("官方安装结果与选定 Release 不一致，停止运行时同步");
}

function verifyRuntimeSync(options) {
  const { runtime, pluginRoot, home = os.homedir(), env = process.env } = options;
  const readObject = (file, missing) => {
    let value;
    try { value = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch (error) { if (error.code === "ENOENT") return missing; throw error; }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("同步验收记录不是 JSON 对象: " + file);
    return value;
  };
  const root = fs.realpathSync(pluginRoot);
  const manifest = readObject(path.join(root, ".zcode-plugin", "plugin.json"), null);
  if (!manifest || manifest.name !== PLUGIN_ID.split("@")[0]) throw new Error("同步插件清单身份无效");
  compareVersions(manifest.version, manifest.version);
  const pending = readObject(path.join(runtime, "plugin-update.json"), null);
  const hasPending = pending && (pending.pendingSync === true || (pending.pendingRelease !== undefined && pending.pendingRelease !== null) || pending.pendingPid);
  if (legacyLockBusy(runtime)) throw new Error("旧更新进程仍在运行，停止运行时同步");
  if (pending && pending.pendingPid) {
    if (!Number.isSafeInteger(pending.pendingPid) || pending.pendingPid <= 0) throw new Error("安装进程记录无效");
    try { process.kill(pending.pendingPid, 0); throw new Error("插件安装进程仍在运行，停止运行时同步"); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
  }
  const storage = resolvePluginStorage(home, env);
  if (fs.existsSync(path.join(storage, "marketplaces", ".zusage-marketplace.transaction.json"))) throw new Error("官方市场事务尚未完成，停止运行时同步");
  const inventory = readObject(path.join(storage, "installed_plugins.json"), null);
  if (inventory && !Array.isArray(inventory.plugins)) throw new Error("官方安装记录形状无效");
  const records = inventory ? inventory.plugins.filter((row) => row && row.id === PLUGIN_ID && row.scope === "user") : [];
  if (!records.length) {
    if (hasPending || inventory) throw new Error("同步所需用户插件安装记录不存在");
    return { ok: true, pluginRoot: root, version: manifest.version, identity: { record: null, channel: null, pending, manifest } };
  }
  if (records.length !== 1) throw new Error("同步所需用户插件安装记录不唯一");
  const record = records[0];
  if (record.enabled === false) throw new Error("同步插件已被禁用，停止运行时同步");
  if (typeof record.installPath !== "string" || fs.realpathSync(record.installPath) !== root) throw new Error("同步插件与官方安装记录不一致：安装器须从官方安装记录指向的插件根目录（插件缓存目录）运行，而非运行时目录");
  if (record.version !== manifest.version) throw new Error("同步插件与官方安装记录版本不一致，停止运行时同步");
  const selected = releaseChannel.readChannel(home, storage);
  const currentChannel = { kind: selected.kind, repository: selected.repository || "", source: selected.marketplace ? selected.marketplace.source : null };
  if (hasPending) {
    if (pending.pendingSync !== true) throw new Error("待同步意图不完整，停止运行时同步");
    if (pending.pendingVersion && compareVersions(record.version, pending.pendingVersion) <= 0) throw new Error("插件安装尚未提交新版，停止运行时同步");
    if (pending.pendingRelease !== undefined && pending.pendingRelease !== null) verifyCommittedRelease(record, pending.pendingRelease, currentChannel, pending.repoMigration || null);
    else if (currentChannel.kind === "release") throw new Error("历史更新意图缺少 Release 校验信息，停止运行时同步");
  }
  return { ok: true, pluginRoot: root, version: manifest.version, identity: { record, channel: currentChannel, pending, manifest } };
}

function listOverview(data) {
  // The official CLI answers different shapes by flag: plain `plugins list --json`
  // returns a top-level array of installed entries (no scope field, per-entry
  // diagnostics), while `--available` returns { installed, available, diagnostics }.
  // Accept both so an absent plugin is a real absence, never a shape mismatch.
  if (Array.isArray(data)) {
    const diagnostics = [];
    for (const entry of data) {
      if (entry && entry.id === PLUGIN_ID && Array.isArray(entry.diagnostics)) diagnostics.push(...entry.diagnostics);
    }
    return { installed: data, available: [], diagnostics };
  }
  if (data && typeof data === "object") {
    const installed = Array.isArray(data.installed) ? data.installed : null;
    const available = Array.isArray(data.available) ? data.available : null;
    // An envelope without either list is a shape we do not know; an empty list
    // is a real absence. Never let shape drift masquerade as "not installed".
    if (!installed && !available) throw new Error("插件管理器返回了无法识别的插件列表");
    return { installed: installed || [], available: available || [],
      diagnostics: Array.isArray(data.diagnostics) ? data.diagnostics : [] };
  }
  throw new Error("插件管理器返回了无法识别的插件列表");
}

function createUpdater(options) {
  const { runtime, home, resourcesPath, executable, notify = () => {}, now = Date.now } = options;
  const configFile = path.join(runtime, "config.json");
  const stateFile = path.join(runtime, "plugin-update.json");
  const environment = options.env || process.env;
  let storageRoot = null, localError = "";
  const storage = () => {
    const root = resolvePluginStorage(home, environment);
    if (storageRoot && storageRoot !== root) throw new Error("更新期间插件存储目录已变化，请重新启动更新器");
    storageRoot = root;
    return root;
  };
  const bundle = path.join(resourcesPath, "glm", "zcode.cjs");
  const markerFile = path.join(runtime, ".plugin-restart-required");
  // marker 的 mtime 作红点代际：不存在/读取失败为 0（overlay 用它区分「新待办」与「已查看」）
  const markerMtime = () => {
    try { return fs.statSync(markerFile).mtimeMs || 0; } catch (e) { return 0; }
  };
  // marker.version 记录本次实际写入运行目录的新版本（syncInstalled 先更新 currentVersion 再 record_restart），
  // 是「已安装待重启」的唯一可靠目标身份；损坏/缺失返回空串，由浮层明确说明无法匹配。
  const markerVersion = () => {
    let value = null;
    try { value = JSON.parse(fs.readFileSync(markerFile, "utf8")); } catch (e) { return ""; }
    const version = value && typeof value === "object" && typeof value.version === "string" ? value.version : "";
    try { if (version) { compareVersions(version, version); return version; } } catch (e) { }
    return "";
  };
  const saved = readState(stateFile, now());
  const prev = options.initialState && typeof options.initialState === "object" ? options.initialState : null;
  let state = { phase: prev && prev.phase === "updated" ? "updated" : "idle", supported: false, auto: false, currentVersion: "",
    latestVersion: prev && typeof prev.latestVersion === "string" ? prev.latestVersion : "",
    ...saved, restartRequired: fs.existsSync(markerFile), markerAt: 0,
    skipped: prev && Array.isArray(prev.skipped) ? prev.skipped.slice() : [],
    error: "", channel: "", channelHost: "", channelRepo: "",
    releaseUrl: prev && typeof prev.releaseUrl === "string" ? prev.releaseUrl : "",
    progress: null,
    checkedVia: prev && typeof prev.checkedVia === "string" ? prev.checkedVia : "",
    markerVersion: "" };
  state.markerAt = state.restartRequired ? markerMtime() : 0;
  state.markerVersion = state.restartRequired ? markerVersion() : "";
  let busy = false, runtimeSyncNeeded = false;
  let selectedRelease = null, selectedChannel = null;
  const channel = () => {
    const source = options.channel ? options.channel() : releaseChannel.readChannel(home, storage());
    return { kind: source.kind, flavor: source.flavor || "", repository: source.repository || "", source: source.marketplace ? source.marketplace.source : null };
  };
  const fetchRelease = options.fetchRelease || releaseChannel.fetchBytes;
  // 改名探测（install-release.md §6）默认走真实网络；调用方接管了网络层（注入 fetchRelease，即测试/沙箱）
  // 却没注入 probeRename 时关闭，避免默认回归无意联网；旧 release 模块（版本错配）无该导出时同样返回 null。
  const probeRename = options.probeRename || (options.fetchRelease ? async () => null
    : async (repository) => typeof releaseChannel.probeRepositoryRename === "function"
      ? releaseChannel.probeRepositoryRename(repository) : null);
  const prepareRelease = options.prepareRelease || ((release, onProgress) => releaseChannel.downloadRelease(release, python(), fetchRelease, undefined, onProgress));
  const readReleaseCatalog = options.readReleaseCatalog || (() => {
    const root = path.join(storage(), "marketplaces");
    if (fs.existsSync(path.join(root, ".zusage-marketplace.transaction.json"))) throw new Error("官方插件市场事务尚未完成，请稍后重试");
    return readJson(path.join(root, "zusage-marketplace", "marketplace.json"), null);
  });
  const python = () => process.env.ZUSAGE_PLUGIN_PYTHON || (readConfig(configFile) || {}).python_path || (process.platform === "win32" ? "python" : "python3");
  const helper = path.join(__dirname, "runtime_lock.py");
  const lock = options.acquireLock || (() => acquireUpdateLock(runtime, python(), helper));
  const cli = options.cli || ((args, onSpawn) => runFile(cliExecutable(executable), [bundle, "plugins", ...args, "--json"], {
    cwd: home, env: { ...environment, HOME: home, USERPROFILE: home, ELECTRON_RUN_AS_NODE: "1", ZCODE_STORAGE_DIR: path.dirname(storage()) }, windowsHide: true,
    timeout: 120000, maxBuffer: 4 * 1024 * 1024,
  }, undefined, onSpawn));
  const sync = options.sync || ((root) => runFile(python(), [
    path.join(root, "overlay_install.py"), "sync",
  ], { cwd: home, env: { ...process.env, ZUSAGE_PLUGIN_RUNTIME: runtime },
    windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 }));

  function installedRecord() {
    const inventory = readJson(path.join(storage(), "installed_plugins.json"), {});
    const records = inventory && inventory.plugins;
    return Array.isArray(records) ? records.find((p) => p && p.id === PLUGIN_ID && p.scope === "user"
      && typeof p.installPath === "string" && p.installPath && typeof p.version === "string") : null;
  }
  function refreshLocal() {
    const config = readConfig(configFile);
    state.auto = !!config && (!Object.prototype.hasOwnProperty.call(config, "plugin_auto_update") || config.plugin_auto_update === true);
    let record = null;
    localError = "";
    try { record = installedRecord(); } catch (error) { localError = error.message; }
    state.supported = !!(record && record.installPath && (options.cli || fs.existsSync(bundle)));
    state.currentVersion = record && record.version || "";
    state.restartRequired = fs.existsSync(markerFile);
    state.markerAt = state.restartRequired ? markerMtime() : 0;
    state.markerVersion = state.restartRequired ? markerVersion() : "";
    // 渠道身份是注册来源的既成事实，不必等检查：未检查时也随状态发布，供「更新日志」
    // 卡片的选择与来源展示使用（读取失败保持空串，由浮层按未知渠道降级）。
    try {
      const source = channel();
      state.channel = source.kind;
      state.channelHost = source.flavor === "gitcode" ? "gitcode" : source.flavor === "github" ? "github" : "";
      state.channelRepo = source.repository || "";
    } catch (e) {
      state.channel = ""; state.channelHost = ""; state.channelRepo = "";
    }
    return record;
  }
  function publish() {
    state.restartRequired = fs.existsSync(markerFile);
    state.markerAt = state.restartRequired ? markerMtime() : 0;
    state.markerVersion = state.restartRequired ? markerVersion() : "";
    notify({ ...state, busy });
  }
  function load() { Object.assign(state, readState(stateFile, now())); }
  function save() {
    writeJson(stateFile, { checkedAt: state.checkedAt, lastAttempt: state.lastAttempt,
      pendingSync: state.pendingSync, pendingVersion: state.pendingVersion, pendingPid: state.pendingPid, pendingRelease: state.pendingRelease, lastFailure: state.lastFailure || null, lastError: state.lastError || null,
      repoMigration: state.repoMigration || null });
  }
  function diagnostics(data) {
    const errors = (data.diagnostics || []).filter((d) => d.severity === "error" && (!d.pluginId || d.pluginId === PLUGIN_ID));
    if (errors.length) throw new Error(errors.map((d) => d.message).join("; "));
  }
  async function refreshMarketplace() {
    // 宿主 CLI 的 GitHub zipball 快路径在网络劣化（codeload 慢/超时）或版本回归时可能
    // 静默失败（exit 0 无输出 → runFile 报「没有返回有效 JSON」）。市场缓存清单是
    // Release 渠道安装与清单兜底检查的版本源，刷新失败先重试；仍失败则给出可行动的
    // 错误，不让它伪装成「检查过了、什么都没发生」（issue #247）。
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const market = await cli(["marketplace", "update", "zusage-marketplace"]);
        diagnostics(market);
        return market;
      } catch (error) { lastError = error; }
    }
    throw new Error("市场清单刷新连续 3 次失败: " + String((lastError && lastError.message) || lastError));
  }
  function migrationRepoFor(source) {
    // 已确认的改名迁移（install-release.md §6）：注册名命中记录 from 时直接返回 to，
    // 后续检查零额外请求；记录形状非法或注册名已变化返回 null（豁免随之失效）。
    const migration = state.repoMigration;
    return !!(migration && typeof migration.from === "string" && typeof migration.to === "string" &&
      releaseChannel.githubRepository(migration.from) === migration.from &&
      releaseChannel.githubRepository(migration.to) === migration.to &&
      migration.from.toLowerCase() === String(source.repository || "").toLowerCase()) ? migration.to : null;
  }
  async function checkGithubRelease(source, repo) {
    // GitHub Release 渠道检查：repo 为迁移后新名时，API 响应体按新名规范化、资产比对自洽；
    // 失败（限流/不可达/迁移窗口校验挂）退回注册 ref 渠道清单，清单也按同名查；健康信号不兜底。
    // 两条 GitHub 路径都失败且属网络/限流类时，第三跳官方 GitCode 镜像（specs/github-mirror-fallback.md）：
    // 镜像把检查/下载/安装整体挪出 GitHub 域，GitHub 完全不可达的用户也能更新（issue #310）。
    const target = repo || migrationRepoFor(source) || source.repository;
    let apiError;
    try {
      return { release: await releaseChannel.checkRelease(target, compareVersions, fetchRelease), checkedVia: "release-api" };
    } catch (error) { apiError = error; }
    if (/不能安装开发分支|安全分页上限/.test(apiError.message)) throw apiError;
    let fallbackError;
    try {
      return { release: await catalogFallback(source, apiError, target), checkedVia: "release-catalog" };
    } catch (error) { fallbackError = error; }
    if (!GITHUB_UNREACHABLE.test(String((apiError && apiError.message) || apiError))) throw fallbackError;
    // 注册仓库门控（specs/github-mirror-fallback.md）：只有官方上游仓库的 GitHub Release 渠道
    // 才自动镜像——fork/第三方副本注册的渠道内容可能与官方不同，静默换装官方字节会无提示
    // 覆盖 fork 改动；改名迁移生效时注册名对不上上游，同样不镜像（如实报错即可）。
    if (typeof releaseChannel.GITHUB_UPSTREAM_REPOSITORY !== "string" ||
        !releaseChannel.sameRepository(source.repository, releaseChannel.GITHUB_UPSTREAM_REPOSITORY)) throw fallbackError;
    try {
      const release = typeof releaseChannel.checkGitcodeMirrorRelease === "function"
        ? await releaseChannel.checkGitcodeMirrorRelease(compareVersions, fetchRelease) : null;
      if (release) return { release, checkedVia: "release-mirror" };
      throw new Error("GitCode 镜像检查不可用");
    } catch (mirrorError) {
      // 三层原因如实合并，末尾附可自助执行的换渠道注册地址：自动镜像救不了时，换注册渠道仍是完整出路。
      throw new Error(fallbackError.message + "；GitCode 镜像回退也失败: " + mirrorError.message + GITCODE_MIRROR_HINT);
    }
  }
  function patchReleaseCatalogForMirror(release, manifest) {
    // 镜像回退安装的缓存清单补丁（specs/github-mirror-fallback.md）：读原字节 → 把本插件
    // entry 的 version/source.url/source.sha256 指向官方镜像同版本资产（url 即镜像行
    // archive URL，sha256 为已下载校验过的 manifest.asset.sha256）→ 原子写入并读回校验。
    // restore() 以保存的原字节原子写回，幂等；恢复失败静默容忍（宿主 marketplace update 收敛）。
    const file = path.join(storage(), "marketplaces", "zusage-marketplace", "marketplace.json");
    // 与 readReleaseCatalog 同款事务守卫（标记在 marketplaces/ 根下）：宿主市场事务进行中
    // 不动缓存清单——补丁窗口与事务提交交错时 restore 会吞掉宿主刚写入的新清单，宁可中止。
    if (fs.existsSync(path.join(path.dirname(path.dirname(file)), ".zusage-marketplace.transaction.json"))) throw new Error("官方插件市场事务尚未完成，镜像安装中止");
    let original;
    try { original = fs.readFileSync(file); }
    catch (error) { throw new Error("镜像安装需要可读的市场缓存清单: " + error.message); }
    let parsed;
    try { parsed = JSON.parse(original.toString("utf8")); }
    catch (error) { throw new Error("市场缓存清单不是有效 JSON，镜像安装中止"); }
    const rows = parsed && Array.isArray(parsed.plugins) ? parsed.plugins.filter((p) => p && p.name === "zcode-token-usage-statusbar") : [];
    const entry = rows.length === 1 ? rows[0] : null;
    const source = entry && entry.source;
    if (!entry || !source || typeof source !== "object" || source.source !== "url" || source.type !== "zip" ||
        typeof source.url !== "string") throw new Error("市场缓存清单缺少本插件的 zip 源，镜像安装中止");
    entry.version = release.version;
    entry.source = { ...source, url: release.archive.browser_download_url, sha256: manifest.asset.sha256 };
    const write = (bytes) => {
      const tmp = file + ".zusage-mirror." + process.pid + ".tmp";
      try {
        fs.writeFileSync(tmp, bytes);
        fs.renameSync(tmp, file);
      } finally { try { fs.unlinkSync(tmp); } catch (e) { } }
    };
    write(Buffer.from(JSON.stringify(parsed, null, 2) + "\n", "utf8"));
    let restored = false;
    return {
      assertApplied() {
        const data = readJson(file, null);
        const row = data && Array.isArray(data.plugins) ? data.plugins.find((p) => p && p.name === "zcode-token-usage-statusbar") : null;
        if (!row || row.version !== release.version || !row.source || typeof row.source !== "object" ||
            row.source.url !== release.archive.browser_download_url || row.source.sha256 !== manifest.asset.sha256)
          throw new Error("镜像缓存清单补丁未生效，中止安装");
      },
      restore() {
        if (restored) return;
        restored = true;
        try { write(original); } catch (e) { }
      },
    };
  }
  function channelMatchesRegistration(effective, current = channel()) {
    // 非迁移路径保持原整体深比较（含 flavor）；仅存在迁移记录时才允许 repository 经记录豁免，
    // kind 与 source 恒严格——与 verifyCommittedRelease 的 sameChannel 门同构。
    return isDeepStrictEqual(current, effective) ||
      (!!state.repoMigration && sameChannel(current, effective, state.repoMigration));
  }
  async function catalogFallback(source, cause, repoOverride) {
    // GitHub API 检查失败（限流/不可达）时退回注册 ref 的渠道清单：清单刷新走 zipball
    // 下载桶不占 API 配额，渠道身份与安装校验链都不变。兜底再失败则合并原因一起上报。
    // repoOverride：仓库改名迁移生效时按新名查清单（注册名已对不上清单下载源）。
    try {
      await refreshMarketplace();
      if (!isDeepStrictEqual(channel(), source)) throw new Error("更新期间市场来源已变化");
      return releaseChannel.githubReleaseFromCatalog(readReleaseCatalog(), repoOverride || source.repository);
    } catch (error) {
      // 指引与镜像回退统一由 checkGithubRelease 的第三跳收口，这里只如实合并两层原因。
      throw new Error(String((cause && cause.message) || cause) + "；渠道清单回退也失败: " + error.message);
    }
  }
  async function check(auto = false, install = false, force = false) {
    if (busy) { if (!auto) publish(); return; }
    refreshLocal();
    if (!state.supported) { state.phase = localError ? "error" : "unavailable"; state.error = localError; publish(); return; }
    busy = true;
    // 手动检查要立刻有反馈：取锁、恢复待处理意图等前置步骤可能耗时数秒，不能让面板毫无动静。
    if (!auto) { state.phase = "checking"; state.error = ""; publish(); }
    let release;
    try {
      if (legacyLockBusy(runtime)) { if (!auto) throw new Error("另一个更新进程仍在运行，请稍后重试"); return; }
      release = await lock();
      if (!release || legacyLockBusy(runtime)) { if (!auto) throw new Error("另一个更新进程仍在运行，请稍后重试"); return; }
      load();
      if (state.pendingSync && await recoverPending()) return;
      refreshLocal();
      // force：hook 兼容性触发（已装版本未登记适配当前宿主 build，issue #247）绕过 1h
      // 限频立即尝试升级；自动更新开关、锁与 busy 门控全部不变。
      if (auto && !state.auto) return;
      if (auto && !force && state.lastAttempt && now() - state.lastAttempt < INTERVAL_MS) return;
      state.phase = "checking"; state.error = ""; publish();
      state.lastAttempt = now();
      save();
      const source = channel();
      state.channel = source.kind; state.channelHost = source.flavor === "gitcode" ? "gitcode" : source.flavor === "github" ? "github" : "";
      state.channelRepo = source.repository || "";   // 更新日志卡片按渠道仓库构造 Release 页链接（market/local 为空）
      state.releaseUrl = ""; selectedRelease = null; selectedChannel = source; state.checkedVia = ""; state.mirror = false;
      if (source.kind === "release" && source.flavor === "gitcode") {
        // GitCode 渠道：宿主从注册 ref 拉取的渠道清单是唯一版本源，不调 GitCode API。
        await refreshMarketplace();
        if (!isDeepStrictEqual(channel(), source)) throw new Error("更新期间市场来源已变化");
        selectedRelease = releaseChannel.gitcodeReleaseFromCatalog(readReleaseCatalog(), source.repository);
        state.checkedVia = "release-catalog";
      } else if (source.kind === "release") {
        const outcome = await checkGithubRelease(source).catch(async (error) => {
          // 疑似仓库改名（install-release.md §6）：只有「来源/仓库不一致」类校验失败才可能由改名引起
          // （GitHub 把资产 URL 规范化为新名、清单下载源与注册名对不上）；超时、限流、宿主 CLI 刷新失败
          // 等纯网络类失败不探测——它们在受限网络里本就慢，探测只会把失败的检查再拖长。探测对象是仓库
          // 当前所在名（已有迁移记录取记录里的新名，否则是注册名）；命中则按新名整体重查一次，重查成功
          // 才更新迁移记录（随本轮 save() 落盘），未经证实的目标不持久化。探测是尽力而为，任何失败都
          // 不得掩盖原始错误；探测无果原样抛错，绝不静默换源。探测结果等于注册名视为改回，清除记录。
          if (!error || !RENAME_SUSPECT.test(String(error.message))) throw error;
          let renamed = null;
          try { renamed = await probeRename(migrationRepoFor(source) || source.repository); } catch (probeError) { }
          if (typeof renamed !== "string" || releaseChannel.githubRepository(renamed) !== renamed) throw error;
          const back = renamed.toLowerCase() === String(source.repository).toLowerCase();
          let retried;
          try { retried = await checkGithubRelease(source, back ? source.repository : renamed); }
          catch (retryError) { throw new Error("仓库已改名为 " + renamed + "，按新名重新检查仍失败：" + retryError.message); }
          state.repoMigration = back ? null : { from: source.repository, to: renamed, at: now() };
          return retried;
        });
        selectedRelease = outcome.release;
        if (!selectedRelease.mirror && selectedRelease.repository !== source.repository)
          selectedChannel = { ...source, repository: selectedRelease.repository };
        state.checkedVia = outcome.checkedVia;
      }
      if (selectedRelease) {
        state.releaseUrl = selectedRelease.url;
        state.latestVersion = selectedRelease.version;
        state.mirror = selectedRelease.mirror === true;   // 本轮检查经官方 GitCode 镜像（面板来源行标注用）
        const record = installedRecord();
        if (!record) throw new Error("用户级插件安装记录不存在");
        state.currentVersion = record.version;
        maybeClearFailure();
        const newer = compareVersions(state.latestVersion, record.version) > 0;
        state.lastError = null;   // 检查成功：上次失败记录随之清除
        state.phase = newer ? "available" : "current"; state.checkedAt = now(); save(); publish();
        if ((auto || install) && newer) {
          const overview = listOverview(await cli(["list"])); diagnostics(overview);
          const installed = (overview.installed || []).find((p) => p && p.id === PLUGIN_ID && (!p.scope || p.scope === "user"));
          if (!installed) throw new Error("用户插件未注册，不能安装 Release");
          if (installed.enabled !== false) await installUpdate(auto);
        }
      } else {
        state.checkedVia = "market";
        await refreshMarketplace();
        const overview = listOverview(await cli(["list", "--available"]));
        diagnostics(overview);
        if (!isDeepStrictEqual(channel(), source)) throw new Error("更新期间市场来源已变化");
        const installed = (overview.installed || []).find((p) => p && p.id === PLUGIN_ID && (!p.scope || p.scope === "user"));
        const available = (overview.available || []).find((p) => p && p.id === PLUGIN_ID);
        if (!installed || !available) throw new Error("未找到已安装插件或市场中的插件，请检查市场来源");
        state.currentVersion = installed.version || "";
        state.latestVersion = available.version || "";
        maybeClearFailure();
        const newer = compareVersions(state.latestVersion, state.currentVersion) > 0;
        state.lastError = null;   // 检查成功：上次失败记录随之清除
        state.phase = newer ? "available" : "current";
        state.checkedAt = now(); save(); publish();
        if ((auto || install) && newer && installed.enabled !== false) await installUpdate(auto);
      }
    } catch (e) {
      state.phase = "error"; state.error = e.message; state.progress = null;
      maybeClearFailure();   // 检查失败也不能让已过时的失败标注残留（当前版本已追上目标时）
      // 检查/安装失败持久化（取消类不算失败，与 recordInstallFailure 同口径）：
      // 浮层不在时 plugin-update.json 是失败原因的唯一痕迹（issue #247）。
      if (!e || e.cancel !== true) {
        state.lastError = { message: String((e && e.message) || e).slice(0, 500), at: now() };
        try { save(); } catch (saveError) { }
      }
    } finally {
      if (release) await release();
      busy = false;
      if (runtimeSyncNeeded) {
        runtimeSyncNeeded = false;
        // v258：在 busy=false 释放之后调用宿主热替换钩子（onRuntimeSynced = hotReloadMainModules +
        // acknowledgeRestart），使包含 plugin-updater/release/storage 自身变更的更新也能当场热换并
        // 销账 marker，随后 publish() 直接读到已清零的 restartRequired，⚙ 红点零闪烁。
        if (fs.existsSync(markerFile) && typeof options.onRuntimeSynced === "function") {
          try { await options.onRuntimeSynced(); } catch (e) { }
        }
        state.restartRequired = fs.existsSync(markerFile);
        state.markerAt = state.restartRequired ? markerMtime() : 0;
      }
      publish();
    }
  }
  function clearPending() {
    state.pendingSync = false; state.pendingVersion = ""; state.pendingPid = 0; state.pendingRelease = null;
    save();
  }
  function recordInstallFailure() {
    // 安装失败保留目标身份（plugin-update.json 的 lastFailure），「更新日志」卡片据此明确
    // 标注该版本未安装成功；成功路径由 syncInstalled 清除。卸载/禁用/来源切换类取消
    // （cancelError）不经过这里——那不是目标版本的安装失败。
    const version = selectedRelease ? selectedRelease.version : state.latestVersion;
    if (!version) return;
    try {
      compareVersions(version, version);
      state.lastFailure = { version, at: now(), channel: selectedRelease ? "release" : "market" };
    } catch (e) { }
  }
  const cancelError = (message) => Object.assign(new Error(message), { cancel: true });
  function maybeClearFailure() {
    // 当前版本已追上失败目标（如后来手动装成功）：失败标注已过时，随下一次检查一并清除。
    if (!state.lastFailure || !state.currentVersion) return;
    try { if (compareVersions(state.currentVersion, state.lastFailure.version) >= 0) state.lastFailure = null; } catch (e) { }
  }
  async function recoverPending() {
    // Legacy pendingSync meant an acknowledged CLI commit. New intents are saved
    // before launch and must prove a version change in official user inventory.
    // A CLI orphaned by parent shutdown can still be writing inventory/runtime.
    // Wait even after its version commit; normal completion clears its PID.
    if (state.pendingPid) {
      try { process.kill(state.pendingPid, 0); state.phase = "updating"; state.progress = { stage: "install" }; return true; }
      catch (e) { if (e.code !== "ESRCH") { state.phase = "updating"; state.progress = { stage: "install" }; return true; } }
      state.pendingPid = 0;
    }
    const record = installedRecord();
    if (!record) throw new Error("更新恢复所需的安装记录不存在");
    if (!state.pendingVersion || compareVersions(record.version, state.pendingVersion) > 0) {
      if (!state.pendingRelease && channel().kind === "release") throw new Error("历史更新意图缺少 Release 校验信息，停止运行时同步");
      await syncInstalled(); return true;
    }
    state.lastAttempt = 0;
    clearPending();
    state.phase = "idle";
    return false;
  }
  async function installUpdate(auto) {
    let record = refreshLocal();
    if (!record) throw cancelError("插件已卸载，更新已取消");
    if (auto && !state.auto) return;
    if (!channelMatchesRegistration(selectedChannel)) throw cancelError("更新期间市场来源已变化");
    compareVersions(record.version, record.version);
    let downloaded = null;
    let mirrorPatch = null;
    // 中途放弃（插件被卸载/禁用、自动更新被关闭、版本已不再更新）时退回「发现新版本」，
    // 不能让 downloading 阶段与进度条停在面板上。
    const abandon = () => { state.phase = "available"; state.progress = null; };
    try {
      if (selectedRelease) {
        const currentChannel = channel();
        // 仓库改名迁移生效时 selectedRelease/selectedChannel 已按新名选定（check 阶段）；
        // 非迁移路径保持原比较（大小写不敏感的仓库一致），迁移路径额外允许经 repoMigration 豁免。
        // 镜像回退行（specs/github-mirror-fallback.md）仓库是官方 GitCode 镜像而非注册仓库，
        // 按内置镜像常量豁免 repository 比对，渠道注册身份守卫不变。
        if (!channelMatchesRegistration(selectedChannel, currentChannel) || currentChannel.kind !== "release" ||
            !(releaseChannel.sameRepository(currentChannel.repository, selectedRelease.repository) ||
              (selectedRelease.mirror === true && releaseChannel.sameRepository(selectedRelease.repository, releaseChannel.GITCODE_MIRROR_REPOSITORY)) ||
              repositoryMatches(currentChannel.repository, selectedRelease.repository, state.repoMigration || null))) throw cancelError("更新期间市场来源已变化");
        state.phase = "downloading"; state.progress = { stage: "download", loaded: 0, total: selectedRelease.archive.size || 0 }; publish();
        let lastPublished = 0;
        const downloadProgress = (progress) => {
          state.progress = progress;
          // 下载字节进度按 ~150ms 节流推送；阶段切换与下载完成一律立即推送。
          const complete = progress.stage !== "download" || (progress.total && progress.loaded >= progress.total);
          if (complete || now() - lastPublished >= 150) { lastPublished = now(); publish(); }
        };
        try {
          downloaded = await prepareRelease(selectedRelease, downloadProgress);
        } catch (downloadError) {
          // 半通网络（api.github.com 可达、github.com 下载域不可达）下检查走 API 成功、
          // 下载必然失败：同版本转官方镜像行重试一次（specs/github-mirror-fallback.md）。
          // 仅 GitHub 渠道（GitCode 渠道下载的就是镜像域资产，超时重试同源即可，转镜像行
          // 反而过不了提交复核）且注册仓库为官方上游（fork 渠道不静默换装官方字节）；
          // 镜像缺该版本或非网络类失败则如实报原错。后续安装分支按 mirror 标记走镜像链。
          if (selectedRelease.mirror === true || selectedRelease.flavor !== "github" ||
              typeof releaseChannel.GITHUB_UPSTREAM_REPOSITORY !== "string" ||
              !releaseChannel.sameRepository(currentChannel.repository, releaseChannel.GITHUB_UPSTREAM_REPOSITORY) ||
              !GITHUB_UNREACHABLE.test(String(downloadError.message))) throw downloadError;
          let mirror = null;
          try {
            if (typeof releaseChannel.checkGitcodeMirrorRelease === "function")
              mirror = await releaseChannel.checkGitcodeMirrorRelease(compareVersions, fetchRelease, selectedRelease.version);
          } catch (mirrorError) {
            // 镜像侧失败不顶替 GitHub 下载根因，合并两层原因便于排查。
            throw new Error(downloadError.message + "；GitCode 镜像重试也失败: " + mirrorError.message);
          }
          if (!mirror || mirror.version !== selectedRelease.version) throw downloadError;
          selectedRelease = mirror;
          state.checkedVia = "release-mirror"; state.mirror = true;
          state.releaseUrl = mirror.url;
          downloaded = await prepareRelease(selectedRelease, downloadProgress);
        }
        releaseChannel.validateManifest(downloaded.manifest, selectedRelease);
        // 清单兜底意图：下载到的 manifest 必须与检查时的渠道清单同代同资产，防清单与
        // Release 资产错代（API 路径由行内 size 强比对承担等价约束）。
        if (selectedRelease.catalogSha256 !== undefined && downloaded.manifest.asset.sha256 !== selectedRelease.catalogSha256) throw new Error("发布 manifest 与渠道清单的 SHA256 不一致");
        state.progress = { stage: "verify" }; publish();
        if (selectedRelease.mirror === true) {
          // 镜像回退安装（specs/github-mirror-fallback.md）：宿主 plugins install 在缓存清单
          // 存在时不联网拉取、按 entry.source.url 下载并 sha256 校验（引擎 install 链实证）。
          // 把本插件 entry 指向官方镜像同版本资产（与 GitHub Release 同产物同 sha256），
          // 安装结束原子恢复原清单；版本源是刚下载校验过的 manifest，不走 GitHub 清单
          // 刷新与新鲜度门（那是 #247 防宿主按旧清单装旧版的守卫，镜像模式无此路径）。
          mirrorPatch = patchReleaseCatalogForMirror(selectedRelease, downloaded.manifest);
          mirrorPatch.assertApplied();
          if (!isDeepStrictEqual(channel(), currentChannel)) throw cancelError("更新期间市场来源已变化");
        } else {
          await refreshMarketplace();
          if (!isDeepStrictEqual(channel(), currentChannel)) throw cancelError("更新期间市场来源已变化");
          // 清单新鲜度（issue #247）：宿主 CLI 静默失败（exit 0 但没拉取）时缓存清单停在
          // 旧版，随后的 plugins install 会照旧装旧版、最后报误导性的「未提交新版安装记录」。
          // 这里先比对清单版本与已选 Release，把根因点名。
          let catalogRelease;
          try {
            const catalog = readReleaseCatalog();
            // 迁移生效时按检查选定的（新）名查清单新鲜度，注册旧名对不上新清单下载源。
            catalogRelease = currentChannel.flavor === "gitcode"
              ? releaseChannel.gitcodeReleaseFromCatalog(catalog, currentChannel.repository)
              : releaseChannel.githubReleaseFromCatalog(catalog, selectedRelease.repository);
          } catch (error) {
            throw new Error("市场清单刷新后读取不到有效清单: " + error.message);
          }
          if (compareVersions(catalogRelease.version, selectedRelease.version) < 0)
            throw new Error("市场清单刷新后仍为 v" + catalogRelease.version + "，宿主未能拉取到 v"
              + selectedRelease.version + "；可手动执行 zcode plugins marketplace update zusage-marketplace 排查，或改用 GitCode 镜像渠道 https://gitcode.com/tanranran/zcode-token-usage-statusbar.git#plugin-releases-gitcode");
        }
        record = refreshLocal();
        if (!record) throw cancelError("插件已卸载，更新已取消");
        if (auto && !state.auto) { abandon(); return; }
        if (compareVersions(selectedRelease.version, record.version) <= 0) { abandon(); return; }
        const overview = listOverview(await cli(["list"])); diagnostics(overview);
        const installed = (overview.installed || []).find((p) => p && p.id === PLUGIN_ID && (!p.scope || p.scope === "user"));
        if (!installed) throw cancelError("用户插件已卸载，Release 安装已取消");
        if (installed.enabled === false) { abandon(); return; }
        if (!isDeepStrictEqual(channel(), currentChannel)) throw cancelError("更新期间市场来源已变化");
        record = refreshLocal();
        if (!record) throw cancelError("插件已卸载，更新已取消");
        if ((auto && !state.auto) || compareVersions(selectedRelease.version, record.version) <= 0) { abandon(); return; }
      }
      state.phase = "updating"; state.progress = { stage: "install" };
      state.pendingSync = true; state.pendingVersion = record.version; state.pendingPid = 0;
      // 意图渠道存检查选定的 selectedChannel：迁移生效时 repository 为新名（与 release 自洽），
      // source/kind 保留注册原值；复核侧经 pending.repoMigration 豁免注册旧名比对。
      state.pendingRelease = selectedRelease ? { release: selectedRelease, manifest: downloaded.manifest, channel: selectedChannel } : null;
      save(); publish();
      const command = selectedRelease ? ["install", PLUGIN_ID, "--scope", "user"] : ["update", PLUGIN_ID];
      try {
        let result;
        try { result = await cli(command, (pid) => { state.pendingPid = pid; save(); }); }
        finally { state.pendingPid = 0; save(); }
        diagnostics(result);
        if (result.ok !== true) throw new Error("插件管理器未确认更新成功");
      } catch (e) {
        const committed = installedRecord();
        if (committed && compareVersions(committed.version, state.pendingVersion) > 0) {
          if (selectedRelease) verifyReleaseCommit(committed);
          await syncInstalled(); return;
        }
        state.lastAttempt = 0; clearPending(); throw e;
      }
      const committed = installedRecord();
      if (!committed || compareVersions(committed.version, state.pendingVersion) <= 0) {
        state.lastAttempt = 0; clearPending(); throw new Error("插件管理器未提交新版安装记录");
      }
      if (selectedRelease) verifyReleaseCommit(committed);
      await syncInstalled();
    } catch (e) { if (!e || e.cancel !== true) recordInstallFailure(); save(); throw e; }   // 失败身份立即落盘（clearPending 已先写过一次）；取消类不误标失败
    finally {
      // 镜像补丁恢复先于临时目录清理：宿主 install 结束（成败皆然）缓存清单必须回到原字节，
      // 恢复失败容忍——GitHub 恢复可达后宿主 marketplace update 会以注册来源清单收敛。
      if (mirrorPatch) mirrorPatch.restore();
      if (downloaded && downloaded.cleanup) downloaded.cleanup();
    }
  }
  function verifyReleaseCommit(record) {
    verifyCommittedRelease(record, state.pendingRelease, channel(), state.repoMigration || null);
  }
  async function recordRestart(report) {
    if (report.restartRecorded === true) return;
    const changed = Array.isArray(report.changed) ? report.changed : [];
    const cold = changed.filter((f) => f === "inject-main.cjs" || f === "plugin-updater.cjs" || f === "plugin-release.cjs" || f === "plugin-storage.cjs" || f === "quota-client.cjs"
      || ((readConfig(configFile) || {}).hot_reload === false && (f === "overlay.js" || f === "zusage.py")));
    if (!cold.length) return;
    const hashes = {};
    for (const name of cold) {
      try { hashes[name] = crypto.createHash("sha256").update(fs.readFileSync(path.join(runtime, name))).digest("hex"); }
      catch (e) { if (e.code !== "ENOENT") throw e; }
    }
    await runFile(python(), [helper, "--record-restart", runtime], {
      windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024,
    }, JSON.stringify({ hashes, changed, version: state.currentVersion }));
  }
  async function syncInstalled() {
    // 更新器只信任宿主安装记录，不接收页面提供的脚本路径。
    const record = installedRecord();
    if (!record || !record.installPath) throw new Error("更新后的安装记录不存在");
    if (state.pendingRelease !== null) verifyReleaseCommit(record);
    state.phase = "updating"; state.progress = { stage: "sync" }; publish();
    const report = await sync(record.installPath);
    if (!report || typeof report !== "object" || Array.isArray(report)) throw new Error("运行时同步没有返回有效报告");
    state.currentVersion = record.version;
    // Current packages persist the marker themselves. This also covers old
    // packages' changed reports, before clearing durable pending coordination.
    await recordRestart(report);
    runtimeSyncNeeded = fs.existsSync(markerFile);
    state.lastFailure = null;   // 安装成功：失败目标标注随 pending 一并清除（一次落盘）
    state.lastError = null;   // 同上：恢复路径成功不让旧失败消息残留在「已更新」状态旁（issue #247 review）
    clearPending();
    state.skipped = Array.isArray(report.preserved) ? report.preserved : [];
    state.restartRequired = fs.existsSync(markerFile);
    state.markerAt = state.restartRequired ? markerMtime() : 0;
    state.phase = "updated"; state.error = ""; state.progress = null;
  }
  async function request(req) {
    if (!req) return;
    if (req.action === "auto" && typeof req.enabled === "boolean") {
      try {
        await updateConfig(runtime, { plugin_auto_update: req.enabled }, python());
        refreshLocal(); state.error = "";
        publish();
        if (req.enabled) await check(true);
      } catch (e) { state.phase = "error"; state.error = e.message; publish(); }
    } else if (req.action === "check") await check();
    else if (req.action === "update") {
      // 手动更新也先刷新版本，避免过期的“有新版”状态触发重装或降级。
      await check(false, true);
    }
  }
  async function tick(force = false) {
    refreshLocal();
    if (localError) { state.phase = "error"; state.error = localError; }
    publish();
    if (busy) return;
    load();
    if (state.supported && (state.pendingSync || (state.auto && (!state.lastAttempt || now() - state.lastAttempt >= INTERVAL_MS) || force))) await check(true, false, force);
  }
  function noteRuntimeAcked() {
    // v258：主进程热替换销账后同步红点——marker 已被 ack 清除时立即撤下（publish 内
    // 重算 restartRequired/markerAt/markerVersion 并推送），不等下一轮 tick；marker
    // 仍在（如 inject-main.cjs 待重启）则保持不动。
    if (state.restartRequired === fs.existsSync(markerFile)) return;
    publish();
  }
  refreshLocal();
  return { request, tick, status: () => ({ ...state, busy }), noteRuntimeAcked };
}

async function runAutoCommand(argv) {
  if (argv[0] !== "--auto") throw new Error("仅支持 --auto 后台更新模式");
  const values = {};
  let force = false;
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "--force") { force = true; continue; }   // issue #247：兼容性触发绕过 1h 限频
    if (!["--resources", "--runtime"].includes(argv[i]) || !argv[i + 1]) throw new Error("无效自动更新参数");
    values[argv[i]] = argv[i + 1];
    i++;
  }
  if (!values["--resources"] || !values["--runtime"]) throw new Error("缺少客户端或运行时目录");
  const updater = createUpdater({ runtime: path.resolve(values["--runtime"]), home: os.homedir(),
    resourcesPath: path.resolve(values["--resources"]), executable: process.execPath });
  await updater.tick(force);
  const state = updater.status();
  process.stdout.write(JSON.stringify(state) + "\n");
  if (state.phase === "error") process.exitCode = 1;
}

module.exports = { cliExecutable, createUpdater, compareVersions, INTERVAL_MS, PLUGIN_ID, runAutoCommand, updateConfig, verifyRuntimeSync, listOverview };
if (require.main === module) {
  const argv = process.argv.slice(2);
  if (argv[0] === "--verify-runtime-sync") {
    try {
      if (argv.length !== 3) throw new Error("同步验收需要运行时与插件路径");
      process.stdout.write(JSON.stringify(verifyRuntimeSync({ runtime: path.resolve(argv[1]), pluginRoot: path.resolve(argv[2]) })) + "\n");
    } catch (error) { console.error("[zusage-plugin] 同步验收失败:", error.message); process.exitCode = 1; }
  } else runAutoCommand(argv).catch((e) => {
    console.error("[zusage-plugin] 自动更新失败:", e.message);
    process.exitCode = 1;
  });
}
