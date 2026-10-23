"use strict";
const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execFile } = require("child_process");

const PLUGIN_ID = "zcode-token-usage-statusbar@zusage-marketplace";
const STABLE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const MAX_ASSET = 16 * 1024 * 1024;
const MAX_JSON = 256 * 1024;
// GitCode 形状于 2026-10-20 实测：browser_download_url 为 GitHub 风格路径，
// 下载重定向到 file-cdn.gitcode.com；两台主机的形状都必须留在各自白名单里。
const RELEASE_HOSTS = {
  github: {
    assetUrl: /^https:\/\/github\.com\/([^/]+\/[^/]+)(\/releases\/download\/[^?#]+)$/,
    downloadHosts: ["api.github.com", "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"],
  },
  gitcode: {
    assetUrl: /^https:\/\/gitcode\.com\/([^/]+\/[^/]+)(\/releases\/download\/[^?#]+)$/,
    downloadHosts: ["gitcode.com", "file-cdn.gitcode.com"],
  },
};
const DOWNLOAD_HOSTS = Object.values(RELEASE_HOSTS).flatMap((host) => host.downloadHosts);

function githubRepository(value) {
  if (typeof value !== "string") return null;
  const match = /^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)?([A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*?)(?:\.git)?\/?$/.exec(value);
  return match ? match[1] : null;
}
function gitcodeRepository(value) {
  if (typeof value !== "string") return null;
  const match = /^(?:https:\/\/gitcode\.com\/|ssh:\/\/git@gitcode\.com\/|git@gitcode\.com:)?([A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*?)(?:\.git)?\/?$/.exec(value);
  return match ? match[1] : null;
}
function sameRepository(a, b) {
  return typeof a === "string" && typeof b === "string" && githubRepository(a) === a && githubRepository(b) === b && a.toLowerCase() === b.toLowerCase();
}
function parseAssetUrl(value) {
  if (typeof value !== "string") return null;
  for (const [host, profile] of Object.entries(RELEASE_HOSTS)) {
    const match = profile.assetUrl.exec(value);
    if (match) return { host, repository: match[1], path: match[2] };
  }
  return null;
}
function sameAssetUrl(actual, expected) {
  const a = parseAssetUrl(actual), b = parseAssetUrl(expected);
  return !!a && !!b && a.host === b.host && sameRepository(a.repository, b.repository) && a.path === b.path;
}
function readCatalog(root) {
  // 市场缓存清单只用来识别“源码清单”这一形态；事务进行中、缺失或损坏时按未知处理，
  // 由后续 Release 流程报出准确原因。
  try {
    if (fs.existsSync(path.join(root, "marketplaces", ".zusage-marketplace.transaction.json"))) return null;
    return JSON.parse(fs.readFileSync(path.join(root, "marketplaces", "zusage-marketplace", "marketplace.json"), "utf8"));
  } catch (e) { return null; }
}
function readChannel(home, root = require("./plugin-storage.cjs").resolvePluginStorage(home)) {
  const file = path.join(root, "known_marketplaces.json");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const entries = data && data.marketplaces;
  if (!Array.isArray(entries)) throw new Error("插件市场来源记录无效");
  const matches = entries.filter((m) => m && (m.id === "zusage-marketplace" || m.name === "zusage-marketplace"));
  const market = matches.length === 1 ? matches[0] : null;
  if (!market || !market.source || typeof market.source !== "object") throw new Error("未找到 zusage-marketplace 的注册来源");
  const source = market.source;
  if (source.source === "directory") return { kind: "local", marketplace: market };
  // 仓库来源但清单指向源码（默认分支的 ./plugins/... 路径源）时没有可校验的 Release：
  // 按 market 渠道交给宿主插件管理器直接更新，与本地目录来源同一条链。
  const kind = catalogChannel(readCatalog(root)) === "source" ? "market" : "release";
  if (source.source === "git") {
    const gitcode = gitcodeRepository(source.url);
    if (gitcode) return { kind, flavor: "gitcode", repository: gitcode, marketplace: market };
  }
  const repository = source.source === "github" ? githubRepository(source.repo || source.repository)
    : source.source === "git" ? githubRepository(source.url) : null;
  if (!repository) throw new Error("远端自动更新仅支持已注册的 GitHub/GitCode 仓库来源");
  return { kind, flavor: "github", repository, marketplace: market };
}
async function fetchBytes(url, limit, onProgress) {
  let activeRequest, activeResponse, timer, settled = false;
  return new Promise((resolve, reject) => {
    const finish = (error, bytes) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) {
        if (activeResponse) activeResponse.destroy();
        if (activeRequest) activeRequest.destroy(error);
        reject(error);
      } else resolve(bytes);
    };
    const visit = (target, redirects) => {
      try {
        const parsed = new URL(target);
        const allowed = parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.port &&
          DOWNLOAD_HOSTS.includes(parsed.hostname);
        if (!allowed) throw new Error("拒绝非 GitHub/GitCode HTTPS 更新地址");
        const request = https.get(parsed, { headers: { "User-Agent": "zcode-token-usage-statusbar-release-updater",
          "Accept": parsed.hostname === "api.github.com" ? "application/vnd.github+json" : "application/octet-stream",
          "X-GitHub-Api-Version": "2022-11-28" } }, (response) => {
          if (settled) { response.destroy(); return; }
          activeResponse = response;
          response.on("error", (error) => finish(error));
          response.on("aborted", () => finish(new Error("发布资源下载中断")));
          if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
            response.resume();
            if (!response.headers.location || redirects >= 3) { finish(new Error("下载重定向无效")); return; }
            try { visit(new URL(response.headers.location, parsed).href, redirects + 1); }
            catch (error) { finish(error); }
            return;
          }
          if (response.statusCode !== 200) { finish(new Error(`Release 请求失败 (${response.statusCode})`)); return; }
          const declared = Number(response.headers["content-length"] || 0);
          if (!Number.isSafeInteger(declared) || declared < 0 || declared > limit) { finish(new Error("发布资源超过大小上限")); return; }
          const chunks = []; let length = 0;
          response.on("data", (chunk) => {
            if (settled) return;
            length += chunk.length;
            if (length > limit) finish(new Error("发布资源超过大小上限"));
            else {
              chunks.push(chunk);
              if (typeof onProgress === "function") onProgress(length, declared);
            }
          });
          response.on("end", () => {
            if (!response.complete || (declared && declared !== length)) finish(new Error("发布资源下载不完整"));
            else finish(null, Buffer.concat(chunks));
          });
        });
        activeRequest = request;
        request.setTimeout(30000, () => finish(new Error("Release 请求超时")));
        request.on("error", (error) => finish(error));
      } catch (error) { finish(error); }
    };
    timer = setTimeout(() => finish(new Error("Release 请求超过总时限")), 60000);
    visit(url, 0);
  });
}
function releaseAssetUrl(repository, tag, name) {
  return `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
}
function validateRelease(release, repository) {
  if (!release || release.draft !== false || release.prerelease !== false || typeof release.tag_name !== "string") return null;
  const version = release.tag_name.startsWith("v") ? release.tag_name.slice(1) : "";
  if (!STABLE.test(version)) return null;
  const names = [`zcode-token-usage-statusbar-v${version}.zip`, "release-manifest.json"];
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const picked = names.map((name) => assets.filter((a) => a && a.name === name));
  if (picked.some((matches) => matches.length !== 1)) return null;
  const [archive, manifest] = picked.map((matches) => matches[0]);
  for (const asset of [archive, manifest]) {
    const limit = asset === archive ? MAX_ASSET : MAX_JSON;
    if (asset.state !== "uploaded" || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > limit ||
        !sameAssetUrl(asset.browser_download_url, releaseAssetUrl(repository, release.tag_name, asset.name))) throw new Error("GitHub Release 资产来源或大小无效");
  }
  return { flavor: "github", version, tag: release.tag_name, repository, archive, manifest,
    url: `https://github.com/${repository}/releases/tag/${encodeURIComponent(release.tag_name)}` };
}
async function checkRelease(repository, compareVersions, fetch = fetchBytes) {
  if (!githubRepository(repository) || repository !== githubRepository(repository)) throw new Error("GitHub 仓库标识无效");
  let best = null;
  for (let page = 1; page <= 10; page++) {
    const body = await fetch(`https://api.github.com/repos/${repository}/releases?per_page=100&page=${page}`, 4 * 1024 * 1024);
    const rows = JSON.parse(body.toString("utf8"));
    if (!Array.isArray(rows)) throw new Error("GitHub Release 列表格式无效");
    for (const row of rows) {
      const candidate = validateRelease(row, repository);
      if (candidate && (!best || compareVersions(candidate.version, best.version) > 0)) best = candidate;
    }
    if (rows.length < 100) {
      if (!best) throw new Error("此 GitHub 仓库尚无带完整发布包的正式 Release，不能安装开发分支");
      return best;
    }
  }
  throw new Error("GitHub Release 列表超过安全分页上限，无法确定最新正式版本");
}
function validateManifest(manifest, release) {
  const asset = manifest && manifest.asset;
  // GitCode 渠道的合成 release 行在下载 manifest 前拿不到资产大小（archive.size 为 null），
  // 大小以下载到的 manifest 为准；GitHub 渠道的 API 行始终带大小，逐项强校验。
  // GitCode 镜像的 manifest.repository 是打包时的上游仓库（如 ByteRax/...），与注册的
  // 镜像仓库（tanranran/...）刻意不同；镜像渠道的身份绑定改由清单 URL、pluginId 与
  // asset.sha256 承担，repository 只要求仍是合法 owner/repo（解包器按 manifest 值复核）。
  const repositoryOk = sameRepository(manifest.repository, release.repository) ||
    (release.flavor === "gitcode" && typeof manifest.repository === "string" &&
     githubRepository(manifest.repository) === manifest.repository);
  if (!manifest || manifest.schemaVersion !== 1 || !repositoryOk ||
      manifest.version !== release.version || manifest.tag !== release.tag || manifest.pluginId !== PLUGIN_ID || !asset ||
      asset.name !== release.archive.name || (release.archive.size !== null && asset.size !== release.archive.size) ||
      !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_ASSET ||
      typeof asset.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error("发布 manifest 与正式版本、来源或资源不一致");
  return manifest;
}
function unpack(command, args) {
  return new Promise((resolve, reject) => execFile(command, args,
    { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) { reject(new Error(String(stderr || error.message).trim().slice(0, 1000))); return; }
      try { resolve(JSON.parse(stdout)); } catch (e) { reject(new Error("发布包校验器未返回有效 JSON")); }
    }));
}
async function downloadRelease(release, python, fetch = fetchBytes, runUnpack = unpack, onProgress) {
  const report = typeof onProgress === "function" ? onProgress : () => { };
  const manifestBody = await fetch(release.manifest.browser_download_url, MAX_JSON);
  const manifest = validateManifest(JSON.parse(manifestBody.toString("utf8")), release);
  report({ stage: "download", loaded: 0, total: manifest.asset.size });
  const bytes = await fetch(release.archive.browser_download_url, MAX_ASSET,
    (loaded, total) => report({ stage: "download", loaded, total: total || manifest.asset.size }));
  if (bytes.length !== manifest.asset.size || crypto.createHash("sha256").update(bytes).digest("hex") !== manifest.asset.sha256) throw new Error("发布包下载大小或 SHA256 校验失败");
  report({ stage: "verify" });
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "zusage-release-")));
  const cleanup = () => fs.rmSync(directory, { recursive: true, force: true });
  try {
    const archive = path.join(directory, release.archive.name), info = path.join(directory, "release-manifest.json");
    const output = path.join(directory, "marketplace");
    fs.writeFileSync(archive, bytes, { flag: "wx" }); fs.writeFileSync(info, manifestBody, { flag: "wx" });
    const result = await runUnpack(python, [path.join(__dirname, "release_unpack.py"), "--archive", archive,
      "--manifest", info, "--repository", release.flavor === "gitcode" ? manifest.repository : release.repository,
      "--version", release.version, "--output", output]);
    if (!result || result.ok !== true || result.version !== release.version || result.marketplaceRoot !== output ||
        result.pluginRoot !== path.join(output, "plugins", "zcode-token-usage-statusbar")) throw new Error("发布包校验或解压结果无效");
    return { directory, marketplaceRoot: output, pluginRoot: result.pluginRoot, release, manifest, cleanup };
  } catch (error) { cleanup(); throw error; }
}
function gitcodeReleaseFromCatalog(catalog, repository) {
  // GitCode 渠道的版本与下载源只信任宿主刚从注册 ref 拉取的渠道清单；不调用 GitCode API。
  // 下载 URL 与安装后复核（verifyCommittedRelease）共用同一套主机模式，形状以 2026-10-20 实测为准。
  if (!githubRepository(repository) || repository !== githubRepository(repository)) throw new Error("GitCode 仓库标识无效");
  const entries = catalog && catalog.plugins;
  const matches = Array.isArray(entries) ? entries.filter((p) => p && p.name === "zcode-token-usage-statusbar") : [];
  const entry = matches.length === 1 ? matches[0] : null;
  const source = entry && entry.source;
  if (!catalog || catalog.name !== "zusage-marketplace" || !entry || typeof entry.version !== "string" ||
      !STABLE.test(entry.version) || !source || typeof source !== "object" || source.source !== "url" ||
      source.type !== "zip" || typeof source.url !== "string" || source.headers !== undefined ||
      (source.stripRoot !== undefined && source.stripRoot !== false) ||
      source.path !== "plugins/zcode-token-usage-statusbar" ||
      typeof source.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(source.sha256)) throw new Error("GitCode 渠道清单格式无效");
  const tag = "v" + entry.version;
  const archiveName = `zcode-token-usage-statusbar-v${entry.version}.zip`;
  const expectedPath = `/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(archiveName)}`;
  const parsed = parseAssetUrl(source.url);
  if (!parsed || parsed.host !== "gitcode" || !sameRepository(parsed.repository, repository) ||
      parsed.path !== expectedPath) throw new Error("GitCode 渠道清单下载源与注册仓库或版本不一致");
  return {
    flavor: "gitcode", version: entry.version, tag, repository,
    archive: { name: archiveName, size: null, browser_download_url: `https://gitcode.com/${repository}${expectedPath}` },
    manifest: { name: "release-manifest.json",
      browser_download_url: `https://gitcode.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent("release-manifest.json")}` },
    url: `https://gitcode.com/${repository}/releases/tag/${encodeURIComponent(tag)}` };
}
function validateGitcodeRelease(release) {
  // 安装提交后复核持久化的 GitCode 更新意图：与 gitcodeReleaseFromCatalog 同一形状门。
  if (!release || release.flavor !== "gitcode" || !githubRepository(release.repository) ||
      release.repository !== githubRepository(release.repository) || typeof release.version !== "string" ||
      !STABLE.test(release.version) || release.tag !== "v" + release.version || !release.archive ||
      release.archive.name !== `zcode-token-usage-statusbar-v${release.version}.zip` ||
      release.archive.size !== null) return null;
  const archive = parseAssetUrl(release.archive.browser_download_url);
  const manifest = parseAssetUrl(release.manifest && release.manifest.browser_download_url);
  const downloadPath = `/releases/download/${encodeURIComponent(release.tag)}/`;
  let page = null;
  try { page = new URL(release.url); } catch (e) { }
  if (!archive || archive.host !== "gitcode" || !sameRepository(archive.repository, release.repository) ||
      archive.path !== downloadPath + encodeURIComponent(release.archive.name) ||
      !manifest || manifest.host !== "gitcode" || !sameRepository(manifest.repository, release.repository) ||
      manifest.path !== downloadPath + encodeURIComponent("release-manifest.json") ||
      !page || page.protocol !== "https:" || page.hostname !== "gitcode.com" ||
      page.pathname !== `/${release.repository}/releases/tag/${encodeURIComponent(release.tag)}`) return null;
  return { ...release, version: release.version };
}
/* 已注册市场的清单指向什么：Release 下载源，还是仓库源码（本地路径/开发分支）。
   readChannel 据此把源码清单的仓库来源判为 market 渠道，交给宿主插件管理器直接更新。 */
function catalogChannel(catalog, pluginName = "zcode-token-usage-statusbar") {
  const entries = catalog && catalog.plugins;
  const matches = Array.isArray(entries) ? entries.filter((p) => p && p.name === pluginName) : [];
  const entry = matches.length === 1 ? matches[0] : null;
  if (!entry) return "unknown";
  const source = entry.source;
  /* 源码清单里 source 常是相对路径字符串（如 "./plugins/zcode-token-usage-statusbar"） */
  if (typeof source === "string") return "source";
  if (!source || typeof source !== "object") return "unknown";
  return source.source === "url" && source.type === "zip" ? "release" : "source";
}
module.exports = { sameRepository, sameAssetUrl, githubRepository, gitcodeRepository, readChannel, checkRelease, gitcodeReleaseFromCatalog, validateGitcodeRelease,
  downloadRelease, validateRelease, validateManifest, catalogChannel,
  fetchBytes, MAX_ASSET, MAX_JSON, PLUGIN_ID };
