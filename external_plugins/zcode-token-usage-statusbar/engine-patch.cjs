/* v179 自动压缩阈值引擎补丁（主进程热换模块，由 inject-main.cjs 相对 require；v258 起随
 * loader 热换循环零重启生效）。
 * 原理：桌面客户端把 agent 引擎放在 <resources>/glm/zcode.cjs（独立子进程加载，
 * spawn env 白名单构造，NODE_OPTIONS 注入不可行）。auto-compact 阈值判定在
 * getAutoCompactThreshold（源码 core/src/compact/policy.ts，bundle 内锚点唯一）。
 * 本模块按 ENGINE_TARGETS 的 SHA256 白名单对引擎做两处一次性改写：
 *   1) prologue：在文件头 "use strict"; 之后插入阈值改道 hook——每次决策读
 *      <runtime>/autocompact.json（mtime 缓存），任何异常回退引擎默认 → fail-open；
 *   2) 判定点：默认阈值表达式改道 globalThis hook（hook 缺席/返回空 → 原式兜回）。
 * 红线：fail-closed——引擎 SHA 不在登记表、锚点不唯一、"use strict"; 前缀缺失
 * 均拒绝写盘并在 status() 明示；restore 按当前内容反向还原，不动客户端其它字节。
 * 阈值数值热生效（hook 每轮决策读文件，无需重启）；补丁本身冷生效（引擎子进程
 * 下次 spawn 起用）。作用范围仅桌面客户端引擎，终端 CLI 不受影响。 */
"use strict";
const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");

const MARK = "__zusageAutoCompactThreshold";
const PROLOGUE_PREFIX = "/* zcode-token-usage-statusbar v179 auto-compact threshold hook */";
const BACKUP_PREFIX = ".pre-acthreshold-";
const SENTINEL = "engine-patch.json";
/* 锚点/replacement 与已装 bundle 逐字节核对（bufferTokens 全 bundle 唯一）。
 * `??Math.max(0,t-n)` 兜底必须有：hook 存在但返回空（配置缺失/损坏）时若直接返回
 * undefined，阈值判定会恒 false——那等于永远不压缩而不是回默认。 */
const anchorFor = (fn, dflt) => "n=" + fn + "(e.bufferTokens)??" + dflt + ";return Math.max(0,t-n)";
const replacementFor = (fn, dflt) => "n=" + fn + "(e.bufferTokens)??" + dflt +
  ";return (globalThis." + MARK + "&&globalThis." + MARK + "(t,n))??Math.max(0,t-n)";
/* 最新登记版本的锚点对；旧版本符号轮换见 ENGINE_TARGETS 各条目。 */
const ANCHOR = anchorFor("Hue", "xZo");
const REPLACEMENT = replacementFor("Hue", "xZo");

/* hook 本体：插入引擎文件头。优先级 enabled:false > thresholdPercent(30-99，
 * v194 起总窗口口径：引擎判定只认扣除输出预留后的有效窗口 eff，按 eff+21K 近似
 * 还原标称窗口计算并钳在 eff 内——设置 91 即原生按钮 91% 处触发) >
 * thresholdTokens(>=1000) > bufferTokens(>=0)；任何形式换算出的阈值统一地板
 * 1% effective——阈值被压到 0 会让每轮都触发压缩、rapid-refill 熔断中断用户 turn。
 * statSync 每轮决策一次 + mtime 缓存，改 JSON 下一轮即生效。 */
const PROLOGUE = PROLOGUE_PREFIX + "\n;(function(){try{var _zf=require(\"fs\"),_zp=require(\"path\"),_zh=require(\"os\").homedir();" +
  "var _ff=_zp.join(_zh,\".zcode\",\"zcode-token-usage-statusbar\",\"autocompact.json\"),_zc={m:0,v:null,bad:false};" +
  "globalThis." + MARK + "=function(eff){try{var st=_zf.statSync(_ff);" +
  "if(st.mtimeMs!==_zc.m){_zc.m=st.mtimeMs;try{_zc.v=JSON.parse(_zf.readFileSync(_ff,\"utf8\"));" +
  "_zc.bad=!_zc.v||typeof _zc.v!==\"object\"||Array.isArray(_zc.v);}catch(e2){_zc.bad=true;}}" +
  "if(_zc.bad||!_zc.v)return;var c=_zc.v,t;" +
  "if(c.enabled===false)return Number.MAX_SAFE_INTEGER;" +
  "if(isFinite(c.thresholdPercent))t=Math.min(eff,Math.floor((eff+21000)*(Math.min(99,Math.max(30,c.thresholdPercent))/100)));" +
  "else if(isFinite(c.thresholdTokens))t=Math.min(eff,Math.max(1000,c.thresholdTokens));" +
  "else if(isFinite(c.bufferTokens))t=eff-Math.min(Math.max(0,c.bufferTokens),Math.max(0,eff-1));" +
  "else return;" +
  "return Math.max(t,Math.floor(eff*0.01));}catch(e){}};}catch(e){}})();\n";

/* v194 前的 hook 本体（eff×pct 口径）：仅供已打补丁引擎的原位迁移与还原匹配。
 * 由新串程序化推导并守卫漂移——将来再改 prologue 时按同款模式滚动 legacy。 */
const PROLOGUE_V1 = (() => {
  const NEW_SEG = "t=Math.min(eff,Math.floor((eff+21000)*(Math.min(99,Math.max(30,c.thresholdPercent))/100)));";
  const OLD_SEG = "t=Math.floor(eff*(Math.min(99,Math.max(10,c.thresholdPercent))/100));";
  if (!PROLOGUE.includes(NEW_SEG)) throw new Error("prologue percent segment drifted; roll PROLOGUE_V1 forward");
  return PROLOGUE.replace(NEW_SEG, OLD_SEG);
})();

/* 登记表：客户端升级后引擎字节变化，必须实测新 SHA 并在此补条目（renderer_bridge
 * HOST_TARGETS 同款维护模型）；表外版本拒绝补丁并明示，绝不盲打。滚动 ANCHOR/REPLACEMENT
 * 到新版本时，旧条目必须同步改为 anchorFor/replacementFor 显式字面量——只有表首条目
 * 允许引用常量，否则旧条目会静默继承新版本锚点（tests/engine-patch.test.cjs 锁表守护）。 */
const ENGINE_TARGETS = [
  {
    build: "3.19.0",
    engineSha256: "6b84e928d9258fe020c6ab8c75fa2c123b0cd658fe43c0ce141a13df677fb0ea",
    anchor: ANCHOR,
    replacement: REPLACEMENT,
    prologue: PROLOGUE,
  },
  {
    build: "3.18.2",
    engineSha256: "08726b5ef69e1e9072828baa4656713cb3aac93bb096938681278c5600312b2c",
    anchor: anchorFor("iTe", "PWo"),
    replacement: replacementFor("iTe", "PWo"),
    prologue: PROLOGUE,
  },
  {
    build: "3.18.1",
    engineSha256: "666f9c5a0a566eb8cbb906625e219aa2657e9f6a0e0ea8a73471fabdc54110b6",
    anchor: anchorFor("oTe", "vWo"),
    replacement: replacementFor("oTe", "vWo"),
    prologue: PROLOGUE,
  },
  {
    build: "3.18.0",
    engineSha256: "26785f28ab8fb9f8b0f3821f2bf71d294f4d0b8bf28108785292f86c7e14090d",
    anchor: anchorFor("nTe", "K9o"),
    replacement: replacementFor("nTe", "K9o"),
    prologue: PROLOGUE,
  },
  {
    build: "3.17.2",
    engineSha256: "d9afd58d694f98a5279bf548cdc7646413c125762e86730605a6071f9e0346d6",
    anchor: anchorFor("cke", "jBo"),
    replacement: replacementFor("cke", "jBo"),
    prologue: PROLOGUE,
  },
  {
    build: "3.17.1",
    engineSha256: "9afd565a104d660259e6bdeeaa5cb8abc74a908559e21aa3c5f6a06f2a9da6c6",
    anchor: anchorFor("ake", "DBo"),
    replacement: replacementFor("ake", "DBo"),
    prologue: PROLOGUE,
  },
];

function resolveEnginePath(resourcesPath) {
  const candidates = [
    path.join(resourcesPath, "glm", "zcode.cjs"),
    path.join(resourcesPath, "glm", process.platform + "-" + process.arch, "zcode.cjs"),
  ];
  for (const p of candidates) {
    try { if (fs.statSync(p).isFile()) return p; } catch (e) { /* 换下一布局 */ }
  }
  return null;
}

function sha256hex(buf) { return createHash("sha256").update(buf).digest("hex"); }

/* 同目录临时文件 + rename 原子替换；Windows 下引擎被运行中的 agent 子进程占用时
 * rename 抛 EPERM/EBUSY，由调用方降级为 busy 待重启态，不阻塞主进程启动。 */
function atomicWrite(file, content) {
  let mode = 0o644;
  try { mode = fs.statSync(file).mode & 0o777; } catch (e) { /* 新文件用默认 */ }
  const tmp = file + ".zusage-tmp-" + process.pid;
  try {
    fs.writeFileSync(tmp, content, { mode });
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (e2) { /* tmp 已不存在 */ }
    throw e;
  }
}

function insertPrologue(text, prologue) {
  // 指令序言必须在最前：插到 shebang 与 "use strict"; 之后，保持引擎严格模式不退化
  const m = text.match(/^(#![^\n]*\n)?[ \t]*"use strict";/);
  if (!m) return null;
  return text.slice(0, m[0].length) + "\n" + prologue + text.slice(m[0].length);
}

function buildPatchedSource(text, target) {
  const count = text.split(target.anchor).length - 1;
  if (count !== 1) return { error: "anchor_count_" + count };
  const output = insertPrologue(text.replace(target.anchor, target.replacement), target.prologue);
  if (output == null) return { error: "strict_prefix_missing" };
  return { output };
}

function createEnginePatcher(opts) {
  const log = opts.log || (() => { });
  const configPath = path.join(opts.runtime, "autocompact.json");
  const sentinelPath = path.join(opts.runtime, SENTINEL);
  // st 缓存最近一次真实执行结果，status() 只读它——pushPluginState 高频调用零读盘
  const st = { enabled: false, state: "off", build: null, engineSha256: null, drifted: null, lastError: null };

  const set = (state, lastError, extra) => {
    st.state = state;
    st.lastError = lastError || null;
    if (extra) for (const k of Object.keys(extra)) st[k] = extra[k];
    if (state === "off" || state === "unsupported_build" || state === "engine_missing") st.build = extra && extra.build || null;
    // drifted 只在 unsupported_build 下有意义（issue #191），其它状态一律清掉防跨调用残留
    st.drifted = state === "unsupported_build" && extra && extra.drifted || null;
    if (lastError) log(state + ": " + lastError);
    return state;
  };

  function readJson(file) {
    try {
      const d = JSON.parse(fs.readFileSync(file, "utf8"));
      return d && typeof d === "object" && !Array.isArray(d) ? d : null;
    } catch (e) { return null; }
  }
  function readSentinel() { return readJson(sentinelPath); }
  function writeSentinel(d) {
    try { atomicWrite(sentinelPath, Buffer.from(JSON.stringify(d, null, 2) + "\n", "utf8")); }
    catch (e) { log("sentinel write failed: " + e.message); }
  }

  function ensure() {
    st.enabled = true;
    const enginePath = resolveEnginePath(opts.resourcesPath);
    if (!enginePath) return set("engine_missing", "glm/zcode.cjs not found under resources");
    let content;
    try { content = fs.readFileSync(enginePath); } catch (e) { return set("engine_missing", e.message); }
    const sha = sha256hex(content);
    st.engineSha256 = sha;
    const text = content.toString("utf8");
    // 幂等检查必须先于登记表查询：补丁写盘后文件字节已变，SHA 只匹配未打补丁原版；
    // 已含 prologue 的文件按替换体内容识别（字节级精确，外来补丁不会误配）。
    if (text.includes(PROLOGUE_PREFIX)) {
      const t2 = ENGINE_TARGETS.find((t) => text.includes(t.replacement));
      if (!t2) return set("error", "patched_inconsistent");
      if (text.includes(t2.prologue)) return set("applied", null, { build: t2.build });
      /* 旧版 hook 本体在位（v194 前 eff×pct 口径）：原位换装新 prologue——锚点替换体
       * 两版相同无需重打；旧串逐字节匹配，匹配不到=外来/半截补丁不接手。 */
      if (!text.includes(PROLOGUE_V1)) return set("error", "patched_inconsistent");
      try { atomicWrite(enginePath, Buffer.from(text.replace(PROLOGUE_V1, t2.prologue), "utf8")); } catch (e) {
        const busy = e && (e.code === "EBUSY" || e.code === "EPERM" || e.code === "EACCES");
        return set(busy ? "busy" : "error", e.message);
      }
      try {
        const after = fs.readFileSync(enginePath, "utf8");
        if (!after.includes(t2.prologue) || after.includes(PROLOGUE_V1)) return set("error", "verify_failed");
      } catch (e) { return set("error", e.message); }
      writeSentinel({ patched: true, build: t2.build });
      log("patch prologue migrated: " + t2.build);
      return set("applied", null, { build: t2.build });
    }
    const target = ENGINE_TARGETS.find((t) => t.engineSha256 === sha);
    if (!target) {
      /* issue #191：桌面 build 仍在登记表（如 3.17.2.9661 匹配 3.17.2）而引擎 sha 脱钩，
       * =引擎文件被供应商/CLI 侧单独热更，与"全新桌面版本"区分开供 ⚙ 面板明示。
       * 前缀匹配按点分界，"3.17.20" 不得误配 "3.17.2"。fail-closed 不变，仅附注。 */
      const dv = typeof opts.appVersion === "string" ? opts.appVersion : "";
      const drift = ENGINE_TARGETS.find((t) => t.build && (dv === t.build || dv.startsWith(t.build + ".")));
      return set("unsupported_build", "engine sha " + sha.slice(0, 12) + " not in ENGINE_TARGETS",
        { drifted: drift ? drift.build : null });
    }
    if (text.includes(PROLOGUE_PREFIX)) {
      // 幂等：本补丁两处编辑同一次写盘，prologue 在而替换体不在=外来/半打补丁，不接手
      if (text.includes(target.replacement)) return set("applied", null, { build: target.build });
      return set("error", "patched_inconsistent");
    }
    const built = buildPatchedSource(text, target);
    if (built.error) return set("error", built.error);
    try {
      // 首次打补丁留一份未打补丁原字节备份（已有备份不叠加，避免堆文件）
      const hasBackup = fs.readdirSync(path.dirname(enginePath)).some((f) => f.startsWith(BACKUP_PREFIX));
      if (!hasBackup) {
        let mode = 0o644;
        try { mode = fs.statSync(enginePath).mode & 0o777; } catch (e) { /* 已读成功，stat 失败极罕见 */ }
        fs.writeFileSync(path.join(path.dirname(enginePath), BACKUP_PREFIX + new Date().toISOString().replace(/[:.]/g, "-")), content, { mode });
      }
      atomicWrite(enginePath, Buffer.from(built.output, "utf8"));
    } catch (e) {
      const busy = e && (e.code === "EBUSY" || e.code === "EPERM" || e.code === "EACCES");
      return set(busy ? "busy" : "error", e.message);
    }
    try {
      const after = fs.readFileSync(enginePath, "utf8");
      if (!after.includes(PROLOGUE_PREFIX) || !after.includes(target.replacement)) return set("error", "verify_failed");
    } catch (e) { return set("error", e.message); }
    writeSentinel({ patched: true, build: target.build, engineSha256: sha });
    log("patch applied: " + target.build + " (" + sha.slice(0, 12) + ")");
    return set("applied", null, { build: target.build });
  }

  function restore() {
    st.enabled = false;
    const enginePath = resolveEnginePath(opts.resourcesPath);
    if (!enginePath) return set("engine_missing", "glm/zcode.cjs not found under resources");
    let text;
    try { text = fs.readFileSync(enginePath, "utf8"); } catch (e) { return set("engine_missing", e.message); }
    st.engineSha256 = sha256hex(Buffer.from(text, "utf8"));
    if (!text.includes(MARK)) {
      writeSentinel({ patched: false });
      return set("off");   // 引擎本就干净（可能被客户端更新整体替换）
    }
    const target = ENGINE_TARGETS.find((t) => t.engineSha256 === st.engineSha256)
      || ENGINE_TARGETS.find((t) => text.includes(t.replacement) && (text.includes(t.prologue) || text.includes(PROLOGUE_V1)));
    if (!target) return set("error", "restore_pattern_missing");
    const pro = text.includes(target.prologue) ? target.prologue : PROLOGUE_V1;   // v194 前装机的旧本体也能还原
    let out = text.replace("\n" + pro, "").replace(target.replacement, target.anchor);
    if (out.includes(MARK)) return set("error", "restore_incomplete");
    try { atomicWrite(enginePath, Buffer.from(out, "utf8")); } catch (e) {
      const busy = e && (e.code === "EBUSY" || e.code === "EPERM" || e.code === "EACCES");
      return set(busy ? "busy" : "error", e.message);
    }
    writeSentinel({ patched: false });
    log("patch restored");
    return set("off");
  }

  /* 主进程启动时调用一次：开→补丁；关→仅在哨兵记录已打补丁时才读引擎还原
   *（多数用户从未开启，避免每次启动都读 15MB 引擎）。 */
  function syncStartup() {
    if (opts.isEnabled()) return ensure();
    const s = readSentinel();
    if (s && s.patched) return restore();
    st.enabled = false;
    return set("off");
  }

  /* ⚙ 写阈值配置：mode+value 归一为白名单 JSON（hook 侧按固定优先级消费），
   * 非法输入直接拒绝，不落盘。 */
  function writeConfig(mode, value) {
    let out;
    if (mode === "default") out = { enabled: true };
    else if (mode === "disabled") out = { enabled: false };
    else if (mode === "percent" || mode === "tokens" || mode === "buffer") {
      const n = Math.round(Number(value));
      const ok = isFinite(n) && (mode === "percent" ? n >= 30 && n <= 99 : mode === "tokens" ? n >= 1000 : n >= 0);   // v194：30-99
      if (!ok) throw new Error("invalid value for " + mode);
      out = mode === "percent" ? { enabled: true, thresholdPercent: n }
        : mode === "tokens" ? { enabled: true, thresholdTokens: n }
          : { enabled: true, bufferTokens: n };
    } else throw new Error("invalid mode");
    atomicWrite(configPath, Buffer.from(JSON.stringify(out) + "\n", "utf8"));
    return out;
  }
  function readConfig() { return readJson(configPath); }
  /* status() 附带当前阈值配置：⚙ 面板据此反推模式/数值；mtime 缓存，广播高频调用零读盘 */
  const cfgCache = { m: 0, v: null, known: false };
  function readConfigCached() {
    try {
      const m = fs.statSync(configPath).mtimeMs;
      if (!cfgCache.known || m !== cfgCache.m) { cfgCache.m = m; cfgCache.v = readJson(configPath); cfgCache.known = true; }
    } catch (e) { cfgCache.v = null; cfgCache.known = true; }
    return cfgCache.v;
  }

  function status() {
    return { enabled: st.enabled, state: st.state, build: st.build, engineSha256: st.engineSha256, drifted: st.drifted, config: readConfigCached(), configPath, lastError: st.lastError };
  }

  return { ensure, restore, syncStartup, writeConfig, readConfig, status, configPath };
}

module.exports = { createEnginePatcher, ENGINE_TARGETS, PROLOGUE, PROLOGUE_V1, PROLOGUE_PREFIX, ANCHOR, REPLACEMENT, MARK, resolveEnginePath, insertPrologue, buildPatchedSource };
