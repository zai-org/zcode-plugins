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
// 官方 GitCode 镜像仓库（specs/github-mirror-fallback.md）：更新日志回退、GitHub 渠道
// 镜像检查/安装回退与 release_tool --gitcode-repo 的发布目标都是这一个仓库。
const GITCODE_MIRROR_REPOSITORY = "tanranran/zcode-token-usage-statusbar";
// 镜像回退的官方上游仓库：只有注册到这一仓库的 GitHub Release 渠道才允许自动镜像——
// fork/第三方副本注册的渠道内容可能与官方不同，静默换装官方字节会无提示覆盖 fork 改动。
const GITHUB_UPSTREAM_REPOSITORY = "ByteRax/zcode-token-usage-statusbar";
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
function defaultProbeHead(url) {
  return new Promise((resolve, reject) => {
    let request = null;
    const timer = setTimeout(() => finish(new Error("改名探测超时")), 10000);
    if (typeof timer.unref === "function") timer.unref();
    function finish(error, value) {
      if (typeof clearTimeout === "function") clearTimeout(timer);
      if (error) { if (request) request.destroy(); reject(error); } else resolve(value);
    }
    try {
      request = https.request(url, { method: "HEAD", timeout: 8000,
        headers: { "User-Agent": "zcode-token-usage-statusbar-release-updater" } }, (response) => {
        response.resume();
        finish(null, { status: response.statusCode, location: response.headers.location });
      });
      request.on("timeout", () => request.destroy(new Error("改名探测超时")));
      request.on("error", finish);
      request.end();
    } catch (error) { finish(error); }
  });
}
function defaultLookupFullName(repository) {
  // 改名仓库：api.github.com/repos/旧名 先 301 到 /repositories/<id>，再返回当前 full_name。
  // 只放行 api.github.com 一个主机（不沿用含资产域与 GitCode 域的下载白名单，重定向到别处即拒绝），
  // 且响应必须是自洽的仓库对象（整数 id、owner.login/name 与 full_name 一致），任何其它形状按失败处理。
  return fetchBytes("https://api.github.com/repos/" + repository, MAX_JSON, undefined, ["api.github.com"]).then((body) => {
    const row = JSON.parse(body.toString("utf8"));
    const owner = row && row.owner && typeof row.owner.login === "string" ? row.owner.login : "";
    return row && Number.isSafeInteger(row.id) && owner && typeof row.name === "string" && typeof row.full_name === "string" &&
      row.full_name.toLowerCase() === (owner + "/" + row.name).toLowerCase() ? row.full_name : null;
  });
}
// 仓库改名探测（install-release.md §6）：信号只有仓库真实所有者执行改名才会产生，且一律出自
// GitHub 官方答复，是唯一信任锚。两个独立来源——①API：旧名 301 到 /repositories/<id> 后给出当前
// full_name（本机实测 github.com 网页主机经代理常整体 504 而 API 主机稳定，目标用户群恰是代理环境）；
// ②网页 HEAD：301/302 的 Location 指向新名，不占 API 匿名配额（API 被限流时仍可用）。API 给出合法
// 仓库名即为定论（含「同名」=未改名），只在 API 失败时才落到网页。任何失败一律 null——调用方必须把
// 「探测无果」当「未改名」原样报错，绝不静默换源；第二、三参仅供测试注入，生产走默认直连。
async function probeRepositoryRename(repository, head, lookup) {
  if (typeof repository !== "string" || githubRepository(repository) !== repository) return null;
  const renamedTo = (name) => {
    const found = typeof name === "string" ? githubRepository(name) : null;
    return found && found === name && found.toLowerCase() !== repository.toLowerCase() ? found : null;
  };
  try {
    const name = await (lookup || defaultLookupFullName)(repository);
    if (typeof name === "string" && githubRepository(name) === name) return renamedTo(name);
  } catch (e) { /* 限流/不可达/404：落到网页来源 */ }
  try {
    const response = await (head || defaultProbeHead)("https://github.com/" + repository);
    if (!response || ![301, 302, 303, 307, 308].includes(response.status) ||
        typeof response.location !== "string" || !response.location) return null;
    const target = new URL(response.location, "https://github.com");
    if (target.protocol !== "https:" || target.hostname !== "github.com") return null;
    const match = /^\/([A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*?)(?:\.git)?\/?$/.exec(target.pathname);
    return match ? renamedTo(match[1]) : null;
  } catch (e) { return null; }
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
/* allowedHosts：更新日志拉取传 NOTES_API_HOSTS，把只读 API 域与资产下载域分开维护；
 * 省略时保持原有资产下载白名单，不放宽任何既有调用面。 */
/* API 域要 JSON：GitCode v5 对 octet-stream 明确 400（Invalid Accept header，
 * 2026-11-04 实测；vnd.github+json 在两家 API 均可用，资产域保持 octet-stream）。 */
function releaseAcceptHeader(hostname) {
  return hostname === "api.github.com" ? "application/vnd.github+json"
    : hostname === "api.gitcode.com" ? "application/json"
    : "application/octet-stream";
}
async function fetchBytes(url, limit, onProgress, allowedHosts) {
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
          (allowedHosts || DOWNLOAD_HOSTS).includes(parsed.hostname);
        if (!allowed) throw new Error("拒绝非 GitHub/GitCode HTTPS 更新地址");
        const request = https.get(parsed, { headers: { "User-Agent": "zcode-token-usage-statusbar-release-updater",
          "Accept": releaseAcceptHeader(parsed.hostname),
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
          if (response.statusCode !== 200) {
            const statusError = new Error(`Release 请求失败 (${response.statusCode})`);
            statusError.status = response.statusCode;   // 更新日志按 404/403/429 分类（缺失/限流），其余消费方只读 message
            finish(statusError); return;
          }
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
function githubReleaseFromCatalog(catalog, repository) {
  // GitHub Release 渠道的清单兜底：API 匿名配额按出口 IP 共享（代理节点常耗尽，403/429），
  // 而清单刷新走 zipball 下载桶不受限。从注册 ref（plugin-releases 分支）的渠道清单合成
  // 与 API 行同构的候选；清单 sha256 随 catalogSha256 保留，供下载 manifest 交叉比对。
  if (!githubRepository(repository) || repository !== githubRepository(repository)) throw new Error("GitHub 仓库标识无效");
  const entries = catalog && catalog.plugins;
  const matches = Array.isArray(entries) ? entries.filter((p) => p && p.name === "zcode-token-usage-statusbar") : [];
  const entry = matches.length === 1 ? matches[0] : null;
  const source = entry && entry.source;
  if (!catalog || catalog.name !== "zusage-marketplace" || !entry || typeof entry.version !== "string" ||
      !STABLE.test(entry.version) || !source || typeof source !== "object" || source.source !== "url" ||
      source.type !== "zip" || typeof source.url !== "string" || source.headers !== undefined ||
      (source.stripRoot !== undefined && source.stripRoot !== false) ||
      source.path !== "plugins/zcode-token-usage-statusbar" ||
      typeof source.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(source.sha256)) throw new Error("GitHub 渠道清单格式无效");
  const tag = "v" + entry.version;
  const archiveName = `zcode-token-usage-statusbar-v${entry.version}.zip`;
  const expectedPath = `/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(archiveName)}`;
  const parsed = parseAssetUrl(source.url);
  if (!parsed || parsed.host !== "github" || !sameRepository(parsed.repository, repository) ||
      parsed.path !== expectedPath) throw new Error("GitHub 渠道清单下载源与注册仓库或版本不一致");
  return {
    flavor: "github", version: entry.version, tag, repository, catalogSha256: source.sha256,
    archive: { name: archiveName, size: null, browser_download_url: source.url },
    manifest: { name: "release-manifest.json",
      browser_download_url: `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent("release-manifest.json")}` },
    url: `https://github.com/${repository}/releases/tag/${encodeURIComponent(tag)}` };
}
function validateGithubCatalogRelease(release) {
  // 安装提交后复核清单兜底意图：与 githubReleaseFromCatalog 同一形状门。
  if (!release || release.flavor !== "github" || !githubRepository(release.repository) ||
      release.repository !== githubRepository(release.repository) || typeof release.version !== "string" ||
      !STABLE.test(release.version) || release.tag !== "v" + release.version ||
      typeof release.catalogSha256 !== "string" || !/^[a-f0-9]{64}$/.test(release.catalogSha256) || !release.archive ||
      release.archive.name !== `zcode-token-usage-statusbar-v${release.version}.zip` ||
      release.archive.size !== null) return null;
  const archive = parseAssetUrl(release.archive.browser_download_url);
  const manifest = parseAssetUrl(release.manifest && release.manifest.browser_download_url);
  const downloadPath = `/releases/download/${encodeURIComponent(release.tag)}/`;
  let page = null;
  try { page = new URL(release.url); } catch (e) { }
  if (!archive || archive.host !== "github" || !sameRepository(archive.repository, release.repository) ||
      archive.path !== downloadPath + encodeURIComponent(release.archive.name) ||
      !manifest || manifest.host !== "github" || !sameRepository(manifest.repository, release.repository) ||
      manifest.path !== downloadPath + encodeURIComponent("release-manifest.json") ||
      !page || page.protocol !== "https:" || page.hostname !== "github.com" ||
      page.pathname !== `/${release.repository}/releases/tag/${encodeURIComponent(release.tag)}`) return null;
  return { ...release, version: release.version };
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
  const cleanup = () => { try { fs.rmSync(directory, { recursive: true, force: true }); } catch (e) { } };
  try {
    const archive = path.join(directory, release.archive.name), info = path.join(directory, "release-manifest.json");
    const output = path.join(directory, "marketplace");
    fs.writeFileSync(archive, bytes, { flag: "wx" }); fs.writeFileSync(info, manifestBody, { flag: "wx" });
    const result = await runUnpack(python, [path.join(__dirname, "release_unpack.py"), "--archive", archive,
      "--manifest", info, "--repository", release.flavor === "gitcode" ? manifest.repository : release.repository,
      "--version", release.version, "--output", output]);
    // 解包器返回 Path.resolve() 后的真实路径；Windows 上 os.tmpdir() 可能是 8.3 短路径
    // （fs.realpathSync 不展开短名），两侧字符串不等但指向同一目录，须按真实路径归一后再比。
    // 校验锚点语义由此是「同一真实目录」，不再是字符串形态；解析失败回退原值，
    // 退回严格字符串比较，不放宽校验。
    const canonical = (value) => { try { return fs.realpathSync.native(value); } catch (e) { return value; } };
    if (!result || result.ok !== true || result.version !== release.version ||
        canonical(result.marketplaceRoot) !== canonical(output) ||
        canonical(result.pluginRoot) !== canonical(path.join(output, "plugins", "zcode-token-usage-statusbar"))) throw new Error("发布包校验或解压结果无效");
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
/* ---------- GitHub 渠道的官方 GitCode 镜像回退（specs/github-mirror-fallback.md）----------
 * 触发方（plugin-updater.cjs）已限定：GitHub flavor、检查双路径失败且属网络/限流类。
 * 这里只负责「从镜像取到可信的最新版本行」：版本号来自 GitCode v5 API（notes 同款
 * 只读域），资产身份来自该 tag 的 release-manifest.json（发布链与 GitHub Release 同产物，
 * sha256 逐字节一致），下载环节（downloadRelease）还会再下载 manifest 与 zip 复核。 */
function checkGitcodeMirrorRelease(compareVersions, fetch = fetchBytes, targetVersion) {
  return (async () => {
    // targetVersion：下载阶段半通回退（API 可达、github.com 下载域不可达）按已选定版本
    // 钉死取镜像 manifest，不再问 API 列表——镜像行必须与面板已呈现的 Release 版本一致。
    let best = typeof targetVersion === "string" && STABLE.test(targetVersion) ? targetVersion : null;
    if (!best) {
      // 翻页与 checkRelease 同款防御：不信任 direction=desc 被服务端正确执行（notes 实测
      // 默认升序），满页即续拉，版本号在客户端重排取最大；满安全分页上限仍未尽则拒绝
      // （不静默用已收集页内最大值——错选旧版会装错版本，宁可失败重试）。
      for (let page = 1; page <= 10; page++) {
        const body = await fetch(`https://api.gitcode.com/api/v5/repos/${GITCODE_MIRROR_REPOSITORY}/releases?per_page=100&page=${page}&direction=desc`,
          NOTES_LIST_MAX_JSON, undefined, Object.values(NOTES_API_HOSTS).map((h) => h.api));
        let rows;
        try { rows = JSON.parse(body.toString("utf8")); }
        catch (e) { throw new Error("GitCode 镜像 Release 列表不是有效 JSON"); }
        if (!Array.isArray(rows)) throw new Error("GitCode 镜像 Release 列表格式无效");
        for (const row of rows) {
          if (!row || row.prerelease === true || typeof row.tag_name !== "string") continue;
          const version = row.tag_name.startsWith("v") ? row.tag_name.slice(1) : "";
          if (!STABLE.test(version)) continue;
          if (!best || compareVersions(version, best) > 0) best = version;
        }
        if (rows.length < 100) break;
        if (page === 10) throw new Error("GitCode 镜像 Release 列表超过安全分页上限");
      }
      if (!best) throw new Error("GitCode 镜像尚无稳定版本 Release");
    }
    const tag = "v" + best;
    const manifestUrl = `https://gitcode.com/${GITCODE_MIRROR_REPOSITORY}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent("release-manifest.json")}`;
    let manifest;
    try {
      manifest = JSON.parse((await fetch(manifestUrl, MAX_JSON)).toString("utf8"));
    } catch (e) {
      throw new Error(`GitCode 镜像缺少 v${best} 的发布 manifest`);
    }
    const asset = manifest && manifest.asset;
    if (!manifest || manifest.schemaVersion !== 1 || manifest.pluginId !== PLUGIN_ID ||
        manifest.version !== best || manifest.tag !== tag || !asset ||
        asset.name !== `zcode-token-usage-statusbar-v${best}.zip` ||
        !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_ASSET ||
        typeof asset.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error("GitCode 镜像发布 manifest 身份或资产无效");
    const expectedPath = `/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(asset.name)}`;
    return {
      flavor: "gitcode", mirror: true, version: best, tag, repository: GITCODE_MIRROR_REPOSITORY,
      archive: { name: asset.name, size: asset.size, browser_download_url: `https://gitcode.com/${GITCODE_MIRROR_REPOSITORY}${expectedPath}` },
      manifest: { name: "release-manifest.json", browser_download_url: manifestUrl },
      url: `https://gitcode.com/${GITCODE_MIRROR_REPOSITORY}/releases/tag/${encodeURIComponent(tag)}` };
  })();
}
function validateGithubMirrorRelease(release) {
  // 安装提交后复核持久化的镜像回退意图：仓库钉死内置镜像常量、URL 形状与版本/资产自洽。
  // 本地状态文件可伪造 mirror 标志，但至多把安装指向官方镜像的已校验资产，无提权面。
  if (!release || release.flavor !== "gitcode" || release.mirror !== true ||
      release.repository !== GITCODE_MIRROR_REPOSITORY || typeof release.version !== "string" ||
      !STABLE.test(release.version) || release.tag !== "v" + release.version || !release.archive ||
      release.archive.name !== `zcode-token-usage-statusbar-v${release.version}.zip` ||
      !Number.isSafeInteger(release.archive.size) || release.archive.size <= 0) return null;
  const archive = parseAssetUrl(release.archive.browser_download_url);
  const manifest = parseAssetUrl(release.manifest && release.manifest.browser_download_url);
  const downloadPath = `/releases/download/${encodeURIComponent(release.tag)}/`;
  let page = null;
  try { page = new URL(release.url); } catch (e) { }
  if (!archive || archive.host !== "gitcode" || archive.repository !== GITCODE_MIRROR_REPOSITORY ||
      archive.path !== downloadPath + encodeURIComponent(release.archive.name) ||
      !manifest || manifest.host !== "gitcode" || manifest.repository !== GITCODE_MIRROR_REPOSITORY ||
      manifest.path !== downloadPath + encodeURIComponent("release-manifest.json") ||
      !page || page.protocol !== "https:" || page.hostname !== "gitcode.com" ||
      page.pathname !== `/${GITCODE_MIRROR_REPOSITORY}/releases/tag/${encodeURIComponent(release.tag)}`) return null;
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
/* ---------- 更新日志（⚙ 更新页「更新日志」卡片的数据源）----------
 * Release 正文只存在于 GitHub/GitCode 的 Release 里（发版时 --notes-file 写入），
 * 检查链路不保留 body；这里按需单拉：URL 一律由本模块按已验证来源构造，渲染进程
 * 只允许传 flavor/repository/version。主机白名单独立于资产下载白名单（NOTES_API_HOSTS），
 * 匿名 GET，不携带任何凭据。 */

const NOTES_MAX_JSON = 256 * 1024;
const NOTES_LIST_MAX_JSON = 1024 * 1024;
const NOTES_LIST_MAX = 20;   // 历史版本一次最多取 20 条，不做全量扫描
// 官方 GitCode 镜像（与 release_tool.py publish --gitcode-repo 的发布目标一致，正文双写同源）：
// GitHub API 匿名配额按出口 IP 共享、限流/不可达常见，notes 拉取失败时回退镜像取同号正文。
const NOTES_GITCODE_MIRROR = GITCODE_MIRROR_REPOSITORY;
const NOTES_API_HOSTS = {
  github: { repo: githubRepository, api: "api.github.com", base: "https://api.github.com", origin: "https://github.com" },
  gitcode: { repo: gitcodeRepository, api: "api.gitcode.com", base: "https://api.gitcode.com/api/v5", origin: "https://gitcode.com" },
};

function notesTag(version) {
  return typeof version === "string" && STABLE.test(version) ? "v" + version : null;
}
/* GitCode v5 API 与 Gitee 同构：REST 路径在 /api/v5 前缀下——裸 api.gitcode.com/repos/...
 * 返回 404（2026-11-04 匿名实测；v1.5.9–v1.5.10 缺前缀，GitCode 渠道更新日志被整体误判
 * 为 missing）。published_at 恒空，用 created_at；列表默认升序，需显式 direction=desc
 * （代码内仍按版本号重排，不依赖该参数）。 */
function notesHost(flavor, repository) {
  const host = NOTES_API_HOSTS[flavor];
  if (!host) return null;
  const repo = host.repo(repository);
  return repo && repo === repository ? { host, repo } : null;
}
function notesRow(row, flavor, repo, tag) {
  if (!row || typeof row !== "object" || typeof row.tag_name !== "string" || row.tag_name !== tag ||
      typeof row.body !== "string" || !row.body.trim()) return null;
  const host = NOTES_API_HOSTS[flavor];
  const name = typeof row.name === "string" && row.name.trim() ? row.name.trim().slice(0, 200) : tag;
  const publishedAt = typeof row.published_at === "string" && row.published_at ? row.published_at
    : typeof row.created_at === "string" ? row.created_at : "";
  return { flavor, repository: repo, version: tag.slice(1), tag, name,
    body: row.body, publishedAt, prerelease: row.prerelease === true,
    url: `${host.origin}/${repo}/releases/tag/${encodeURIComponent(tag)}` };
}
function classifyNotesStatus(code) {
  return code === 404 || code === 422 ? "missing" : code === 403 || code === 429 ? "rate-limited" : "error";
}
/* 更新日志专用取回器：只放行两个只读 API 域，与资产下载白名单（DOWNLOAD_HOSTS）分开维护 */
function notesFetch(url, limit) {
  return fetchBytes(url, limit, undefined, Object.values(NOTES_API_HOSTS).map((h) => h.api));
}
async function fetchReleaseNotes(options) {
  const { flavor, repository, version, fetch = notesFetch, limit = NOTES_MAX_JSON } = options || {};
  const found = notesHost(flavor, repository);
  const tag = notesTag(version);
  if (!found || !tag) return { ok: false, reason: "unsupported" };
  const { host, repo } = found;
  let body;
  try { body = await fetch(`${host.base}/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`, limit); }
  catch (error) {
    if (error && typeof error.status === "number") return { ok: false, reason: classifyNotesStatus(error.status) };
    return { ok: false, reason: "network", message: String((error && error.message) || error).slice(0, 300) };
  }
  let row;
  try { row = JSON.parse(body.toString("utf8")); }
  catch (e) { return { ok: false, reason: "error", message: "更新日志响应不是有效 JSON" }; }
  const notes = notesRow(row, flavor, repo, tag);
  return notes ? { ok: true, notes } : { ok: false, reason: "missing" };
}
async function fetchReleaseNotesList(options) {
  const { flavor, repository, fetch = notesFetch } = options || {};
  const found = notesHost(flavor, repository);
  if (!found) return { ok: false, reason: "unsupported" };
  const { host, repo } = found;
  let body;
  try { body = await fetch(`${host.base}/repos/${repo}/releases?per_page=100&page=1&direction=desc`, NOTES_LIST_MAX_JSON); }
  catch (error) {
    if (error && typeof error.status === "number") return { ok: false, reason: classifyNotesStatus(error.status) };
    return { ok: false, reason: "network", message: String((error && error.message) || error).slice(0, 300) };
  }
  let rows;
  try { rows = JSON.parse(body.toString("utf8")); }
  catch (e) { return { ok: false, reason: "error", message: "更新日志列表响应不是有效 JSON" }; }
  if (!Array.isArray(rows)) return { ok: false, reason: "error", message: "更新日志列表格式无效" };
  // 只保留本项目命名惯例（v+稳定语义版）的条目；prerelease 与更新器候选过滤同规则不放行。
  const seen = new Set(), picked = [];
  for (const row of rows) {
    if (!row || typeof row.tag_name !== "string" || row.prerelease === true) continue;
    const tag = notesTag(row.tag_name.startsWith("v") ? row.tag_name.slice(1) : "");
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    picked.push({ flavor, repository: repo, version: tag.slice(1), tag,
      name: typeof row.name === "string" && row.name.trim() ? row.name.trim().slice(0, 200) : tag,
      publishedAt: typeof row.published_at === "string" && row.published_at ? row.published_at
        : typeof row.created_at === "string" ? row.created_at : "",
      prerelease: row.prerelease === true,
      url: `${host.origin}/${repo}/releases/tag/${encodeURIComponent(tag)}` });
  }
  picked.sort((a, b) => {
    const av = a.version.split(".").map(Number), bv = b.version.split(".").map(Number);
    for (let i = 0; i < 3; i++) { if (av[i] !== bv[i]) return bv[i] - av[i]; }
    return 0;
  });
  return { ok: true, releases: picked.slice(0, NOTES_LIST_MAX) };
}
function createNotesCache(options) {
  const { file, now = Date.now, ttlMs = 60 * 60 * 1000, maxEntries = 24, maxBodyChars = 64 * 1024 } = options || {};
  let entries = null;   // 惰性加载；损坏文件按空缓存处理，下次写入重建，绝不抛错拖垮更新页
  const validNotes = (notes) => {
    // 与 put 同一形状门复用于加载：篡改/损坏的缓存条目按缺失处理，超大 body 与
    // 越界时间戳（会让 Date 构造抛 RangeError）都不进渲染链。
    if (!notes || typeof notes !== "object") return false;
    if (notes.body !== undefined && (typeof notes.body !== "string" || notes.body.length > maxBodyChars)) return false;
    if (notes.releases !== undefined && !Array.isArray(notes.releases)) return false;
    return true;
  };
  const load = () => {
    if (entries) return entries;
    entries = {};
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      const rows = data && typeof data === "object" && !Array.isArray(data) ? data.entries : null;
      if (rows && typeof rows === "object" && !Array.isArray(rows)) {
        for (const key of Object.keys(rows)) {
          const value = rows[key];
          if (typeof key === "string" && key.length <= 400 && value && typeof value === "object" &&
              typeof value.fetchedAt === "number" && Number.isSafeInteger(value.fetchedAt) &&
              value.fetchedAt >= 0 && value.fetchedAt <= 8.64e15 && validNotes(value.notes)) entries[key] = value;
        }
      }
    } catch (e) { if (e.code !== "ENOENT") entries = {}; }
    return entries;
  };
  const persist = () => {
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, entries }, null, 2));
      fs.renameSync(tmp, file);
    } catch (e) { try { fs.unlinkSync(tmp); } catch (_) { } }   // 缓存写失败只少磁盘命中，内存仍有
  };
  return {
    key: (flavor, repository, slot) => `${flavor}|${repository}|${slot || ""}`.slice(0, 400),
    get(key) {
      const row = load()[key];
      return row && row.notes ? row : null;
    },
    fresh(key) {
      const row = this.get(key);
      return !!row && now() - row.fetchedAt >= 0 && now() - row.fetchedAt < ttlMs;
    },
    put(key, notes) {
      const rows = load();
      const trimmed = notes && typeof notes.body === "string" && notes.body.length > maxBodyChars
        ? { ...notes, body: notes.body.slice(0, maxBodyChars), truncated: true } : notes;
      rows[key] = { notes: trimmed, fetchedAt: now() };
      const keys = Object.keys(rows);
      if (keys.length > maxEntries) {
        keys.sort((a, b) => (rows[a].fetchedAt || 0) - (rows[b].fetchedAt || 0));
        for (const k of keys.slice(0, keys.length - maxEntries)) delete rows[k];
      }
      persist();
      return trimmed;   // 返回截断后的载荷：新鲜拉取与缓存命中两条路径的正文上限一致
    },
  };
}
function createNotesService(options) {
  const { fetch = notesFetch, cache } = options || {};
  const inflight = new Map();   // 同一身份的并发请求去重：第二次调用复用同一次网络往返
  /* 统一返回形状：成功 = { ok, <notes 字段平铺 | releases>, fromCache?, cachedAt?, stale? }；
   * 失败 = { ok:false, reason, message? }。缓存只存载荷本体（ok 包装不落盘），键带
   * n:/list 命名空间——version 不经 STABLE 校验就进键名，也不能与列表键碰撞。 */
  async function serve(key, refresh) {
    if (cache && !refresh.fresh && cache.fresh(key)) {
      const row = cache.get(key);
      if (row) return { ...row.notes, ok: true, fromCache: true, cachedAt: row.fetchedAt };
    }
    const pending = inflight.get(key);
    if (pending) return pending;
    const job = (async () => {
      const result = await refresh.run();
      const payload = result.ok ? (result.notes || { releases: result.releases }) : null;
      if (result.ok && result.mirror && payload) payload.mirror = true;   // 镜像回退标记落进载荷：缓存命中后仍可标注实际来源
      if (result.ok && cache) return { ...cache.put(key, payload), ok: true };   // put 返回截断后的载荷：两条路径正文上限一致
      if (result.ok) return { ...payload, ok: true };
      if (cache && !refresh.fresh) {
        const row = cache.get(key);
        // 拉取失败但有过期缓存：退回旧值并标 stale，保证限流/离线时仍可读已见过的日志
        if (row) return { ...row.notes, ok: true, fromCache: true, cachedAt: row.fetchedAt, stale: true };
      }
      return result;
    })();
    inflight.set(key, job);
    try { return await job; } finally { inflight.delete(key); }
  }
  /* GitHub 匿名配额按出口 IP 共享，限流（403/429）与代理不可达常见——与更新检查的
   * 清单回退同哲学：失败时退官方 GitCode 镜像取同号内容，结果带 mirror:true 供
   * 浮层标注来源。仅 github 形态回退（gitcode 渠道本身不受此限）。 */
  const notesFallback = (primary, runner) => async () => {
    const result = await runner();
    if (result.ok || (result.reason !== "rate-limited" && result.reason !== "network")) return result;
    if (primary.flavor === "gitcode") return result;   // gitcode 形态本身就在镜像域上，没有第二跳
    const mirror = await runner({ flavor: "gitcode", repository: NOTES_GITCODE_MIRROR });
    if (mirror.ok) return { ...mirror, mirror: true };   // 镜像命中：缓存仍按原身份键存放（同项目同号内容）
    if (mirror.reason === "missing") return { ...mirror, mirror: true };   // 镜像确认同号无 Release：比主源限流更准确，如实显示缺失
    return result;
  };
  return {
    getNotes(params) {
      const { flavor, repository, version, force } = params || {};
      const key = cache ? cache.key(flavor, repository, "n:" + (version || "")) : "n:" + flavor + "|" + repository + "|" + version;
      return serve(key, { fresh: force === true,
        run: notesFallback({ flavor, repository }, (override) => fetchReleaseNotes(override
          ? { ...override, version, fetch }
          : { flavor, repository, version, fetch })) });
    },
    getList(params) {
      const { flavor, repository, force } = params || {};
      const key = cache ? cache.key(flavor, repository, "list") : "list:" + flavor + "|" + repository;
      return serve(key, { fresh: force === true,
        run: notesFallback({ flavor, repository }, (override) => fetchReleaseNotesList(override
          ? { ...override, fetch }
          : { flavor, repository, fetch })) });
    },
  };
}

module.exports = { sameRepository, sameAssetUrl, githubRepository, gitcodeRepository, readChannel, checkRelease, gitcodeReleaseFromCatalog, githubReleaseFromCatalog, validateGitcodeRelease, validateGithubCatalogRelease,
  checkGitcodeMirrorRelease, validateGithubMirrorRelease, GITCODE_MIRROR_REPOSITORY, GITHUB_UPSTREAM_REPOSITORY,
  downloadRelease, validateRelease, validateManifest, catalogChannel, probeRepositoryRename,
  fetchBytes, fetchReleaseNotes, fetchReleaseNotesList, createNotesCache, createNotesService, notesTag, releaseAcceptHeader, NOTES_API_HOSTS, NOTES_MAX_JSON, NOTES_LIST_MAX_JSON, NOTES_LIST_MAX, MAX_ASSET, MAX_JSON, PLUGIN_ID };
