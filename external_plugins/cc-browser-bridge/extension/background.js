// Claude API Browser Bridge — 扩展后台（MV3 Service Worker）
// 通过 WebSocket 连接本地桥接服务 (server/bridge.js)，把工具调用翻译成
// chrome.debugger (CDP) 与 chrome.scripting 操作，复刻原生 Claude in Chrome 的能力。

const DEFAULT_SERVER = "ws://127.0.0.1:8765/ws";
const HEARTBEAT_MS = 20000;
const VERSION = chrome.runtime.getManifest?.().version || "0.3.0";

let ws = null;
let connected = false;
let armed = true; // popup 里可暂停
let serverUrl = DEFAULT_SERVER;
let reconnectTimer = null;
let heartbeatTimer = null;

const attachedTabs = new Set(); // 已 attach debugger 的 tabId
const lastShot = new Map();     // tabId -> { scale }（截图像素 / CSS 像素）
const lastMouse = new Map();     // tabId -> 最近一次鼠标位置（CSS 像素）

// ---------- 小工具 ----------
const cb = (fn, ...a) =>
  new Promise((resolve, reject) => {
    fn(...a, (r) => {
      const e = chrome.runtime.lastError;
      if (e) reject(new Error(e.message));
      else resolve(r);
    });
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Chrome's session storage survives worker sleep and resets with the browser, as tab IDs do.
const targets = new Map();
const recent = new Map();
const groups = new Map();
const untouchedGroups = new Set();
const sessionStorage = chrome.storage.session;
const stateReady = sessionStorage ? cb(sessionStorage.get, ["targets", "activityGroups"]).then((state) => {
  for (const [client, tabId] of state.targets || []) targets.set(client, tabId);
  for (const [tabId, group] of state.activityGroups || []) groups.set(tabId, group);
}).catch(() => {}) : Promise.resolve();

const WAITING_MARK_MS = 45_000;
const GROUP_STYLE = {
  working: { title: "🤖 AI 执行中", color: "blue" },
  waiting: { title: "🤖 AI 等待指令", color: "grey" },
};
let running = null;
let activityTimer = null;
let groupWork = stateReady;

function storeSession(key, entries) {
  if (!sessionStorage) return Promise.resolve();
  return cb(sessionStorage.set, { [key]: [...entries] }).catch(() => {});
}

async function activeTab() {
  const tabs = await cb(chrome.tabs.query, { active: true, lastFocusedWindow: true });
  if (!tabs || !tabs.length) throw new Error("找不到活动标签页");
  return tabs[0];
}

async function getTab(tabId) {
  if (!Number.isSafeInteger(tabId) || tabId < 0) throw new Error("需要有效的 tab_id，请先列出标签页");
  const tab = await cb(chrome.tabs.get, tabId).catch(() => null);
  if (!tab) throw unavailableTab(tabId);
  return tab;
}

function unavailableTab(tabId) {
  return new Error("目标标签页 " + tabId + " 已不可用，请重新列出标签页并明确选择目标");
}

async function bindTab(client, tab) {
  if (targets.get(client) === tab.id) return;
  targets.set(client, tab.id);
  recent.delete(client);
  await storeSession("targets", targets);
}

async function resolveTab(client, explicit, requireTarget) {
  if (explicit != null) return getTab(explicit);
  if (targets.has(client)) return getTab(targets.get(client));
  if (requireTarget) throw new Error("目标标签页已失效，请重新列出标签页并明确选择目标");
  return activeTab();
}

async function selectTab(client, tab) {
  await bindTab(client, tab);
  if (connected && armed) recent.set(client, { tab, until: Date.now() + WAITING_MARK_MS });
  refreshActivity();
}

async function clearTarget(client) {
  recent.delete(client);
  if (targets.delete(client)) await storeSession("targets", targets);
  refreshActivity();
}

function displayedWork() {
  return connected && running?.conn === ws ? running : null;
}

function waitingTabs(now = Date.now()) {
  if (!connected || !armed) return [];
  return [...recent.values()].filter((item) => item.until > now).map((item) => item.tab);
}

function activityStatus() {
  const work = displayedWork();
  if (work) return { state: "working", title: work.tab.title || "标签页 " + work.tab.id };
  const tabs = new Map(waitingTabs().map((tab) => [tab.id, tab]));
  if (tabs.size) return { state: "waiting", title: tabs.values().next().value.title || "浏览器标签页", count: tabs.size };
  return { state: "idle" };
}

async function ownsGroup(tabId, marker) {
  const tab = await cb(chrome.tabs.get, tabId).catch(() => null);
  if (tab?.groupId !== marker.id) return false;
  const group = await cb(chrome.tabGroups.get, marker.id).catch(() => null);
  const style = GROUP_STYLE[marker.state];
  if (!style || group?.title !== style.title || group.color !== style.color) return false;
  const tabs = await cb(chrome.tabs.query, { groupId: marker.id, windowId: tab.windowId });
  return tabs.length === 1 && tabs[0].id === tabId;
}

async function updateGroups() {
  if (!chrome.tabGroups || !chrome.tabs.group) return;
  const desired = new Map(waitingTabs().map((tab) => [tab.id, "waiting"]));
  const work = displayedWork();
  if (work) desired.set(work.tab.id, "working");
  let changed = false;
  for (const [tabId, marker] of groups) {
    const next = desired.get(tabId);
    if (marker.state === next) continue;
    // A group that the user renamed, recolored, or added tabs to now belongs to them.
    if (!await ownsGroup(tabId, marker)) {
      groups.delete(tabId);
      untouchedGroups.add(tabId);
      changed = true;
    } else if (next) {
      const updated = await cb(chrome.tabGroups.update, marker.id, GROUP_STYLE[next]).catch(() => null);
      if (updated) { marker.state = next; changed = true; }
    } else {
      await cb(chrome.tabs.ungroup, tabId).catch(() => {});
      groups.delete(tabId);
      changed = true;
    }
  }
  for (const tabId of untouchedGroups) if (!desired.has(tabId)) untouchedGroups.delete(tabId);
  for (const [tabId, state] of desired) {
    if (groups.has(tabId) || untouchedGroups.has(tabId)) continue;
    const tab = await cb(chrome.tabs.get, tabId).catch(() => null);
    if (!tab || tab.pinned || tab.groupId !== -1) continue;
    const id = await cb(chrome.tabs.group, { tabIds: tabId, createProperties: { windowId: tab.windowId } }).catch(() => null);
    if (id == null) continue;
    try {
      await cb(chrome.tabGroups.update, id, GROUP_STYLE[state]);
      groups.set(tabId, { id, state });
      changed = true;
    } catch (e) {
      // If a window closes during the update Chrome cleans it up. The toolbar badge still works.
    }
  }
  if (changed) await storeSession("activityGroups", groups);
}

function refreshActivity() {
  setBadge();
  clearTimeout(activityTimer);
  const now = Date.now();
  for (const [client, item] of recent) if (item.until <= now) recent.delete(client);
  if (recent.size) {
    const next = Math.min(...[...recent.values()].map((item) => item.until));
    activityTimer = setTimeout(refreshActivity, next - now);
  }
  // Chrome tab strip painting is optional and should never delay the tool call.
  groupWork = groupWork.then(updateGroups).catch(() => {});
}

function pageRestricted(url) {
  return /^chrome(-extension)?:\/\/(webstore|extensions)/i.test(url || "") ||
    /^(devtools|view-source):/i.test(url || "");
}

async function ensureAttached(tabId) {
  if (attachedTabs.has(tabId)) return;
  try {
    await cb(chrome.debugger.attach, { tabId }, "1.3");
  } catch (e) {
    if (!/already attached/i.test(String(e.message))) {
      if (/Another debugger/i.test(String(e.message)))
        throw new Error("该标签页已被其他调试器占用（可能开着 DevTools 或其他扩展），请关闭后重试");
      throw e;
    }
  }
  attachedTabs.add(tabId);
}

async function cdp(tabId, method, params = {}) {
  await ensureAttached(tabId);
  return cb(chrome.debugger.sendCommand, { tabId }, method, params);
}

chrome.debugger.onDetach.addListener((source) => {
  attachedTabs.delete(source.tabId);
});

// 截图过大时等比缩小（Claude 视觉推荐长边 ~1568，computer-use 惯例宽 ~1280）
// 返回值附带 srcW/srcH（解码出的原始位图尺寸），供调用方做比例校验
async function shrinkBase64Png(b64, maxW, maxH) {
  const blob = await (await fetch("data:image/png;base64," + b64)).blob();
  const bmp = await createImageBitmap(blob);
  const w = bmp.width, h = bmp.height;
  const scale = Math.min(maxW / w, maxH ? maxH / h : 1, 1);
  if (scale >= 1) return { data: b64, width: w, height: h, srcW: w, srcH: h };
  const nw = Math.max(1, Math.round(w * scale));
  const nh = Math.max(1, Math.round(h * scale));
  const cnv = new OffscreenCanvas(nw, nh);
  cnv.getContext("2d").drawImage(bmp, 0, 0, nw, nh);
  const out = await cnv.convertToBlob({ type: "image/png" });
  const buf = new Uint8Array(await out.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000)
    bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return { data: btoa(bin), width: nw, height: nh, srcW: w, srcH: h };
}

// 注入页面并在指定世界执行的自包含 agent：快照 / 按 ref 交互 / 读页面
function pageAgent(args) {
  // args: {mode:"snapshot"|"click"|"hover"|"type"|"select_option"|"read_page"|"scroll"|"metrics",
  //        ref:Number, text:String, value:String, clear:Bool, press_enter:Bool,
  //        direction:"up"|"down", amount:Number}
  const MAX_NAME = 70;
  const INTERACTIVE = [
    "a[href]", "button", "input", "select", "textarea", "summary", "label",
    "[role]", '[contenteditable=""]', '[contenteditable="true"]',
    "[onclick]", "[tabindex]",
    "h1", "h2", "h3", "h4", "h5", "h6",
    'img[alt]:not([alt=""])', "video", "audio"
  ].join(",");
  const isVisible = (el) => {
    const st = getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden" || st.opacity === "0") return false;
    const r = el.getBoundingClientRect();
    return r.width >= 1 && r.height >= 1;
  };
  // 稳定引用注册表：挂在 window 上（扩展隔离世界），跨多次注入调用存活；
  // 页面导航/重载后随 document 销毁，旧 ref 自动全部失效。
  // ref 编号 = 文档 epoch × 2^20 + 本地索引：
  //   - 同一元素无论经历多少次 snapshot，ref 编号不变；新元素只能拿到新编号；
  //   - 元素被移除后其 ref 永久失效，不会重新绑定到别的元素；
  //   - epoch 为每个新文档（含 iframe 等独立 window）随机分配，跨文档/跨导航
  //     永不复用——旧文档的 ref 不可能命中新文档的元素（避免 ref=0 漂移）。
  const REG_KEY = "__ccBridgeRefRegistry";
  const REF_SPACE = 1 << 20; // 1048576：每文档本地索引空间
  const newEpoch = () => {
    try {
      if (typeof crypto !== "undefined" && crypto.getRandomValues) {
        const u = new Uint32Array(1);
        crypto.getRandomValues(u);
        return (u[0] % 1073741823) + 1; // [1, 2^30)
      }
    } catch (e) {}
    return Math.floor(Math.random() * 1073741823) + 1;
  };
  const ensureReg = () => {
    if (!window[REG_KEY] || !window[REG_KEY].els || !window[REG_KEY].byEl)
      window[REG_KEY] = { epoch: newEpoch(), els: [], byEl: new WeakMap() };
    return window[REG_KEY];
  };
  const refOf = (reg, el) => {
    let idx = reg.byEl.get(el);
    if (idx === undefined) {
      reg.els.push(el);
      idx = reg.els.length - 1;
      reg.byEl.set(el, idx);
    }
    return reg.epoch * REF_SPACE + idx;
  };
  const resolveRef = (ref) => {
    const reg = window[REG_KEY];
    const n = Number(ref);
    if (!reg || !Array.isArray(reg.els))
      return { error: "页面还没有可用引用（可能已导航/重载），请先 browser_snapshot" };
    if (!Number.isInteger(n) || n < 0)
      return { error: "ref 必须是 browser_snapshot 返回的编号" };
    const epoch = Math.floor(n / REF_SPACE);
    const idx = n % REF_SPACE;
    if (epoch !== reg.epoch)
      return { error: "ref 来自其他页面/文档或已过期（ref 编号跨文档不通用），请重新 browser_snapshot" };
    if (idx >= reg.els.length)
      return { error: "ref " + ref + " 不存在，请重新 browser_snapshot 获取最新 ref" };
    const el = reg.els[idx];
    if (!el || !el.isConnected)
      return { error: "ref 指向的元素已从页面移除，请重新 browser_snapshot；该 ref 不会重新绑定到其他元素" };
    return { el };
  };
  const collect = () => {
    const out = [];
    const root = document.body || document.documentElement;
    if (!root) return out;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      try { if (n.matches(INTERACTIVE) && isVisible(n)) out.push(n); } catch (e) {}
    }
    return out;
  };
  const roleOf = (el) => {
    const t = el.tagName.toLowerCase();
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    if (t === "a") return "link";
    if (t === "button") return "button";
    if (t === "select") return "combobox";
    if (t === "textarea") return "textbox";
    if (t === "summary") return "expand";
    if (t === "label") return "label";
    if (/^h[1-6]$/.test(t)) return "heading";
    if (t === "img") return "image";
    if (t === "video") return "video";
    if (t === "audio") return "audio";
    if (t === "input") {
      const ty = (el.getAttribute("type") || "text").toLowerCase();
      if (ty === "button" || ty === "submit" || ty === "reset") return "button";
      if (ty === "checkbox") return "checkbox";
      if (ty === "radio") return "radio";
      if (ty === "range") return "slider";
      return "textbox";
    }
    return el.hasAttribute("onclick") || el.getAttribute("tabindex") != null ? "clickable" : "text";
  };
  const clean = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
  const nameOf = (el) => {
    let n = clean(el.getAttribute("aria-label")) || clean(el.getAttribute("title")) ||
            clean(el.getAttribute("alt")) || clean(el.getAttribute("placeholder"));
    if (!n) {
      const t = el.tagName.toLowerCase();
      if (t === "input") {
        const ty = (el.type || "").toLowerCase();
        if (ty === "button" || ty === "submit" || ty === "reset") n = clean(el.value);
        else if ((ty === "checkbox" || ty === "radio") && el.labels && el.labels[0]) n = clean(el.labels[0].innerText);
      } else if (t === "select") {
        n = clean(el.selectedOptions && el.selectedOptions[0] && el.selectedOptions[0].text);
      } else {
        n = clean(el.innerText);
      }
    }
    return n;
  };

  const mode = args.mode;

  if (mode === "metrics") {
    return {
      w: innerWidth, h: innerHeight, dpr: devicePixelRatio,
      scrollX: scrollX, scrollY: scrollY,
      docH: document.documentElement.scrollHeight, title: document.title, url: location.href
    };
  }

  if (mode === "read_page") {
    const text = (document.body ? document.body.innerText : "").replace(/\n{3,}/g, "\n\n");
    return { title: document.title, url: location.href, text: text.slice(0, 20000) };
  }

  if (mode === "snapshot") {
    const reg = ensureReg();
    const els = collect();
    // 清理已脱离文档的引用槽（置 null，编号永不复用），防止内存长期滞留
    for (let i = 0; i < reg.els.length; i++) {
      const e = reg.els[i];
      if (!e || !e.isConnected) { if (e) reg.byEl.delete(e); reg.els[i] = null; }
    }
    const lines = [];
    for (let i = 0; i < els.length && i < 600; i++) {
      const el = els[i];
      const ref = refOf(reg, el);
      const t = el.tagName.toLowerCase();
      const r = el.getBoundingClientRect();
      let line = "[" + ref + "] " + roleOf(el) + " \"" + nameOf(el) + "\"";
      if (t === "input" || t === "textarea") {
        const ty = (el.type || "").toLowerCase();
        if (ty === "password") line += " value=••••";
        else if (el.value) line += " value=\"" + clean(el.value) + "\"";
        if (el.checked) line += " [checked]";
        if (el.disabled) line += " [disabled]";
      }
      if (t === "select") {
        const opts = [];
        for (let j = 0; j < el.options.length && opts.length < 6; j++)
          opts.push(el.options[j].value + ":" + clean(el.options[j].text));
        line += " options=[" + opts.join(" | ") + "]";
      }
      if (t === "a" && el.href) line += " href=\"" + String(el.href).slice(0, 90) + "\"";
      line += " @(" + Math.round(r.x + scrollX) + "," + Math.round(r.y + scrollY) + " " + Math.round(r.width) + "x" + Math.round(r.height) + ")";
      lines.push(line);
    }
    return { count: els.length, title: document.title, url: location.href, snapshot: lines.join("\n") };
  }

  // ---- 需要 ref 的操作：从注册表解析，绝不按当次 collect 下标重绑 ----
  if (mode === "click" || mode === "hover") {
    if (args.ref == null) return { error: "缺少 ref（来自 browser_snapshot）" };
    const rr = resolveRef(args.ref);
    if (rr.error) return rr;
    const el = rr.el;
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    const base = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 };
    try { el.dispatchEvent(new PointerEvent("pointerover", base)); } catch (e) {}
    el.dispatchEvent(new MouseEvent("mouseover", base));
    if (mode === "hover") return { ok: true, hovered: args.ref };
    el.dispatchEvent(new PointerEvent("pointerdown", base));
    el.dispatchEvent(new MouseEvent("mousedown", base));
    try { el.focus({ preventScroll: true }); } catch (e) {}
    // 下面派发的 click 事件会触发浏览器默认激活行为（checkbox/radio 勾选、链接跳转等）；
    // 不再手动改 checked——手动改一次 + 默认行为一次会双重切换（真实 Chrome 已复现
    // 初始 false -> click -> false）
    el.dispatchEvent(new PointerEvent("pointerup", base));
    el.dispatchEvent(new MouseEvent("mouseup", base));
    el.dispatchEvent(new MouseEvent("click", base));
    return { ok: true, clicked: args.ref, role: roleOf(el), name: nameOf(el) };
  }

  if (mode === "type") {
    let target = null;
    if (args.ref != null) {
      const rr = resolveRef(args.ref);
      if (rr.error) return rr;
      target = rr.el;
    }
    if (!target) target = document.activeElement;
    if (!target || target === document.body)
      return { error: "没有可输入的目标：请提供 ref，或先点击输入框获得焦点" };
    if (target.disabled || target.readOnly) return { error: "目标元素是 disabled/readonly，无法输入" };
    target.focus();
    const t = target.tagName.toLowerCase();
    const ce = target.isContentEditable;
    if (ce) {
      if (args.clear !== false) {
        const sel = window.getSelection();
        sel.selectAllChildren(target);
        document.execCommand("delete");
      }
      document.execCommand("insertText", false, args.text);
    } else {
      const proto = t === "textarea" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      const keep = args.clear === false ? target.value : "";
      setter.call(target, keep + args.text);
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (args.press_enter) {
      target.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
      const form = target.closest ? target.closest("form") : null;
      if (form) { try { form.requestSubmit(); } catch (e) { try { form.submit(); } catch (e2) {} } }
    }
    return { ok: true, typed: args.text.length, value: ce ? "" : target.value };
  }

  if (mode === "select_option") {
    if (args.ref == null) return { error: "缺少 ref（来自 browser_snapshot）" };
    const rr = resolveRef(args.ref);
    if (rr.error) return rr;
    const el = rr.el;
    if (el.tagName.toLowerCase() !== "select") return { error: "ref " + args.ref + " 不是 <select>" };
    const val = String(args.value);
    const opt = Array.prototype.find.call(el.options, (o) => o.value === val) ||
                Array.prototype.find.call(el.options, (o) => o.text.trim() === val);
    if (!opt) return { error: "没有匹配的选项: " + val + "；可用: " + Array.prototype.map.call(el.options, (o) => o.value).join(", ") };
    el.value = opt.value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, selected: opt.value };
  }

  if (mode === "scroll") {
    if (args.ref != null) {
      const rr = resolveRef(args.ref);
      if (rr.error) return rr;
      rr.el.scrollIntoView({ block: "center" });
      return { ok: true, scrollY: Math.round(scrollY) };
    }
    const amt = args.amount || 600;
    window.scrollBy({ top: args.direction === "up" ? -amt : amt, behavior: "instant" });
    return { ok: true, scrollY: Math.round(scrollY), docH: document.documentElement.scrollHeight };
  }

  return { error: "未知 mode: " + mode };
}

// 在页面 MAIN 世界执行 JS（代码会被包成 async 函数体，可用 await / return）
async function evalInPage(a) {
  const fn = new Function("return (async()=>{" + a.code + "})()");
  const r = await fn();
  if (r === undefined) return { ok: true, result: null };
  try { JSON.stringify(r); return { ok: true, result: r }; }
  catch (e) { return { ok: true, result: String(r).slice(0, 2000) }; }
}

async function inject(tabId, func, args) {
  const [res] = await cb(chrome.scripting.executeScript, { target: { tabId }, func, args: [args] });
  if (res && res.error) throw new Error(String(res.error.message || res.error));
  return res ? res.result : null;
}

// 整页截图的设备尺寸覆盖结束后恢复原滚动位置（覆盖期间内容全可见，
// 滚动偏移会被重置；清除覆盖后浏览器不一定恢复到原位）
function scrollToAgent(a) {
  try { window.scrollTo(a.x || 0, a.y || 0); } catch (e) {}
  return { ok: true, x: Math.round(scrollX), y: Math.round(scrollY) };
}

// CDP 键盘映射
const KEYMAP = {
  enter:   { code: 13, key: "Enter", text: "\r" },
  return:  { code: 13, key: "Enter", text: "\r" },
  tab:     { code: 9,  key: "Tab" },
  escape:  { code: 27, key: "Escape" },
  esc:     { code: 27, key: "Escape" },
  backspace: { code: 8, key: "Backspace" },
  delete:  { code: 46, key: "Delete" },
  space:   { code: 32, key: " ", text: " " },
  arrowup:   { code: 38, key: "ArrowUp" },
  arrowdown: { code: 40, key: "ArrowDown" },
  arrowleft: { code: 37, key: "ArrowLeft" },
  arrowright:{ code: 39, key: "ArrowRight" },
  home:    { code: 36, key: "Home" },
  end:     { code: 35, key: "End" },
  pageup:  { code: 33, key: "PageUp" },
  pagedown:{ code: 34, key: "PageDown" },
};
for (let i = 1; i <= 12; i++) KEYMAP["f" + i] = { code: 111 + i, key: "F" + i };

const MODBITS = { ctrl: 2, control: 2, alt: 1, shift: 8, meta: 4, cmd: 4, command: 4 };

async function pressKey(tabId, keyStr) {
  const parts = String(keyStr).split("+").map((s) => s.trim()).filter(Boolean);
  const main = parts[parts.length - 1].toLowerCase();
  const mods = parts.slice(0, -1).map((m) => m.toLowerCase());
  let modifiers = 0;
  for (const m of mods) {
    if (!(m in MODBITS)) throw new Error("不认识的修饰键: " + m);
    modifiers |= MODBITS[m];
  }
  let info = KEYMAP[main];
  if (!info) {
    if (main.length === 1) {
      const code = main.toUpperCase().charCodeAt(0);
      info = { code, key: main, text: modifiers ? undefined : main };
    } else throw new Error("不支持的按键: " + main + "（可用 Enter/Tab/Escape/Backspace/Delete/ArrowUp/空格字符/字母数字/组合键）");
  }
  const down = { type: "keyDown", key: info.key, windowsVirtualKeyCode: info.code, nativeVirtualKeyCode: info.code, modifiers };
  if (info.text && !modifiers) down.text = info.text;
  if (info.key === "Enter" && !modifiers) down.unmodifiedText = "\r";
  await cdp(tabId, "Input.dispatchKeyEvent", down);
  await sleep(30);
  await cdp(tabId, "Input.dispatchKeyEvent", { type: "keyUp", key: info.key, windowsVirtualKeyCode: info.code, nativeVirtualKeyCode: info.code, modifiers });
  return { ok: true, key: keyStr };
}

// 截图坐标 -> CSS 像素
function pointerPosition(tabId, args) {
  if (args.x != null && args.y != null) return cssPoint(tabId, args.x, args.y);
  return lastMouse.get(tabId) || { x: 0, y: 0 };
}

function cssPoint(tabId, x, y) {
  const s = lastShot.get(tabId);
  const scale = s ? s.scale : 1;
  return { x: Math.round(x / scale), y: Math.round(y / scale) };
}

async function cdpClick(tabId, x, y, opts = {}) {
  const p = cssPoint(tabId, x, y);
  lastMouse.set(tabId, p);
  const button = opts.button || "left";
  const count = opts.click_count || 1;
  await cdp(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
  await cdp(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button, clickCount: count });
  await sleep(40);
  await cdp(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button, clickCount: count });
  return { ok: true, x: p.x, y: p.y };
}

// ---------- 工具实现 ----------
const handlers = {
  async metrics(args, tab) {
    return inject(tab.id, pageAgent, { mode: "metrics" });
  },

  async snapshot(_args, tab) {
    if (pageRestricted(tab.url)) throw new Error("该页面（" + tab.url + "）不允许注入脚本");
    return inject(tab.id, pageAgent, { mode: "snapshot" });
  },

  async read_page(_args, tab) {
    if (pageRestricted(tab.url)) throw new Error("该页面（" + tab.url + "）不允许注入脚本");
    return inject(tab.id, pageAgent, { mode: "read_page" });
  },

  async click_ref(args, tab) {
    return inject(tab.id, pageAgent, { mode: "click", ref: args.ref });
  },

  async hover_ref(args, tab) {
    return inject(tab.id, pageAgent, { mode: "hover", ref: args.ref });
  },

  async click_xy(args, tab) {
    return cdpClick(tab.id, args.x, args.y, args);
  },

  async move_to(args, tab) {
    const p = cssPoint(tab.id, args.x, args.y);
    lastMouse.set(tab.id, p);
    await cdp(tab.id, "Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
    return { ok: true, x: p.x, y: p.y };
  },

  async cursor_position(_args, tab) {
    return lastMouse.get(tab.id) || { x: 0, y: 0 };
  },

  async mouse_down(args, tab) {
    const p = pointerPosition(tab.id, args);
    lastMouse.set(tab.id, p);
    await cdp(tab.id, "Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 });
    return { ok: true };
  },

  async mouse_up(args, tab) {
    const p = pointerPosition(tab.id, args);
    lastMouse.set(tab.id, p);
    await cdp(tab.id, "Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 });
    return { ok: true };
  },

  async drag_to(args, tab) {
    const from = cssPoint(tab.id, args.from_x, args.from_y);
    const to = cssPoint(tab.id, args.to_x, args.to_y);
    await cdp(tab.id, "Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", clickCount: 1 });
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      await cdp(tab.id, "Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: Math.round(from.x + ((to.x - from.x) * i) / steps),
        y: Math.round(from.y + ((to.y - from.y) * i) / steps),
        button: "left",
      });
      await sleep(16);
    }
    await cdp(tab.id, "Input.dispatchMouseEvent", { type: "mouseReleased", x: to.x, y: to.y, button: "left", clickCount: 1 });
    lastMouse.set(tab.id, to);
    return { ok: true };
  },

  async type(args, tab) {
    if (args.ref != null) {
      return inject(tab.id, pageAgent, { mode: "type", ref: args.ref, text: args.text, clear: args.clear, press_enter: args.press_enter });
    }
    // 无 ref：对当前焦点元素操作（CDP trusted 输入）。与带 ref 分支语义一致：
    // clear !== false 时先全选清空，press_enter 时输入后回车（表单会提交）。
    // 全选用 CDP 编辑命令 commands:["selectAll"]：合成的 Meta/Ctrl+A 按键事件
    // 不保证触发浏览器默认编辑行为（真实 Chrome 实测不清空），编辑命令平台无关且必定生效。
    if (args.clear !== false) {
      await cdp(tab.id, "Input.dispatchKeyEvent", {
        type: "keyDown", modifiers: 0, windowsVirtualKeyCode: 0, nativeVirtualKeyCode: 0,
        commands: ["selectAll"],
      });
      await cdp(tab.id, "Input.dispatchKeyEvent", {
        type: "keyUp", modifiers: 0, windowsVirtualKeyCode: 0, nativeVirtualKeyCode: 0,
      });
      await pressKey(tab.id, "Backspace");
    }
    if (args.text) await cdp(tab.id, "Input.insertText", { text: String(args.text) });
    if (args.press_enter) await pressKey(tab.id, "Enter");
    return { ok: true, typed: String(args.text || "").length };
  },

  async press_key(args, tab) {
    return pressKey(tab.id, args.key);
  },

  async select_option(args, tab) {
    return inject(tab.id, pageAgent, { mode: "select_option", ref: args.ref, value: args.value });
  },

  async scroll(args, tab) {
    if (args.ref != null) return inject(tab.id, pageAgent, { mode: "scroll", ref: args.ref });
    if (args.x != null) {
      // CDP 滚轮（坐标来自截图），trusted 滚动
      const p = cssPoint(tab.id, args.x, args.y ?? 10);
      const amt = args.amount || 600;
      await cdp(tab.id, "Input.dispatchMouseEvent", {
        type: "mouseWheel", x: p.x, y: p.y,
        deltaX: 0,
        deltaY: args.direction === "up" ? -amt : amt,
      });
      await sleep(300);
      return { ok: true };
    }
    return inject(tab.id, pageAgent, { mode: "scroll", direction: args.direction || "down", amount: args.amount });
  },

  async screenshot(_args, tab) {
    if (tab.status !== "complete") await sleep(250);
    const metrics = await inject(tab.id, pageAgent, { mode: "metrics" }).catch(() => null);
    // captureVisibleTab captures whichever tab is visible at completion. CDP addresses the chosen tab.
    const shot = await cdp(tab.id, "Page.captureScreenshot", { format: "png", fromSurface: true });
    if (!shot?.data) throw new Error("目标标签页没有返回截图");
    const img = await shrinkBase64Png(shot.data, 1280, null);
    const scale = metrics?.w ? img.width / metrics.w : 1;
    lastShot.set(tab.id, { scale, at: Date.now() });
    return { data: img.data, width: img.width, height: img.height, scale, title: tab.title, url: tab.url };
  },

  async screenshot_full(_args, tab) {
    await ensureAttached(tab.id);
    // 背景：Chrome 当前 compositor 的 captureBeyondViewport 有平铺异常——
    // 即使显式给出整页 clip，也只产出「视口高 + 零头」的表面并重复顶部内容
    // （真实 Chrome 两轮复验：视口 1280x626，返回 1280x923、y≈626 起重复）。
    // 改用设备尺寸覆盖方案（Puppeteer 经典 fullPage）：
    //   1) Page.getLayoutMetrics 取 CSS content bounds（必须在覆盖前取）；
    //   2) Emulation.setDeviceMetricsOverride 把虚拟视口临时扩成整页尺寸
    //      （deviceScaleFactor:0 = 保留原 DPR；不动窗口、不改用户配置）；
    //   3) 覆盖期间内容可能因 reflow 变高（vh 单位/滚动条消失），实测后必要时
    //      扩一次覆盖尺寸，直到内容完全放入虚拟视口；
    //   4) 普通 captureScreenshot（不用 captureBeyondViewport）截完整合成表面；
    //   5) finally 里 clearDeviceMetricsOverride 并恢复原滚动位置；
    //   6) 校验返回位图比例，静默截尾/平铺直接报错，绝不返回坏图。
    const lm = await cdp(tab.id, "Page.getLayoutMetrics");
    const size = (lm && (lm.cssContentSize || lm.contentSize)) || {};
    let ovW = Math.max(1, Math.ceil(Number(size.width) || 1));
    let ovH = Math.max(1, Math.ceil(Number(size.height) || 1));
    const metrics = await (async () => {
      try { return await inject(tab.id, pageAgent, { mode: "metrics" }); }
      catch (e) { return null; }
    })();
    let res = null;
    try {
      await cdp(tab.id, "Emulation.setDeviceMetricsOverride", {
        width: ovW, height: ovH, deviceScaleFactor: 0, mobile: false,
      });
      await sleep(250); // 等 reflow 与重新光栅化
      let fits = false;
      for (let i = 0; i < 3 && !fits; i++) {
        const lm2 = await cdp(tab.id, "Page.getLayoutMetrics");
        const s2 = (lm2 && (lm2.cssContentSize || lm2.contentSize)) || {};
        const w2 = Math.ceil(Number(s2.width) || ovW);
        const h2 = Math.ceil(Number(s2.height) || ovH);
        if (w2 <= ovW && h2 <= ovH) { fits = true; break; }
        ovW = Math.max(ovW, w2);
        ovH = Math.max(ovH, h2);
        await cdp(tab.id, "Emulation.setDeviceMetricsOverride", {
          width: ovW, height: ovH, deviceScaleFactor: 0, mobile: false,
        });
        await sleep(200);
      }
      if (!fits)
        throw new Error("整页截图失败：内容尺寸随虚拟视口扩张不收敛（页面可能大量使用 vh/动态布局），无法安全整页截图");
      res = await cdp(tab.id, "Page.captureScreenshot", { format: "png", fromSurface: true });
    } finally {
      try { await cdp(tab.id, "Emulation.clearDeviceMetricsOverride"); } catch (e) {}
      if (metrics && (metrics.scrollX || metrics.scrollY)) {
        try { await inject(tab.id, scrollToAgent, { x: metrics.scrollX || 0, y: metrics.scrollY || 0 }); } catch (e) {}
      }
    }
    if (!res || !res.data) throw new Error("整页截图失败：未返回图像数据");
    const img = await shrinkBase64Png(res.data, 1280, 7800);
    // 比例校验：捕获表面应是虚拟视口 ovW×ovH（按水平比例归一化），显著不符
    // 说明 compositor 截尾/平铺，宁报错不返坏图
    const cssH = (img.srcH * ovW) / img.srcW;
    if (Math.abs(cssH - ovH) > Math.max(8, ovH * 0.02))
      throw new Error("整页截图校验失败：期望内容高度≈" + ovH + "px，实际≈" + Math.round(cssH) + "px");
    // 像素:CSS 比例按实际返回位图 / 虚拟视口宽度计算（自动涵盖 DPR 与缩小）
    const scale = img.width / ovW;
    lastShot.set(tab.id, { scale, at: Date.now() });
    return { data: img.data, width: img.width, height: img.height, scale, title: tab.title, url: tab.url, full_page: true };
  },

  async navigate(args, tab) {
    let url = String(args.url || "");
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = "https://" + url;
    await cb(chrome.tabs.update, tab.id, { url });
    await sleep(900);
    return { ok: true, url };
  },

  async history(args, tab) {
    const action = args.action || "back";
    if (action === "reload") await cb(chrome.tabs.reload, tab.id);
    else if (action === "back") await cb(chrome.tabs.goBack, tab.id);
    else if (action === "forward") await cb(chrome.tabs.goForward, tab.id);
    else throw new Error("action 必须是 back/forward/reload");
    await sleep(700);
    return { ok: true, action };
  },

  async tabs(args, client, conn) {
    const action = args.action || "list";
    if (action === "list") {
      const list = await cb(chrome.tabs.query, {});
      const target = targets.get(client);
      return {
        target_tab_id: target ?? null,
        tabs: list.map((t) => ({
          tab_id: t.id, title: String(t.title || "").slice(0, 80), url: String(t.url || "").slice(0, 120),
          active: t.active, window_id: t.windowId, targeted: t.id === target,
        })),
      };
    }
    if (action === "release") {
      await clearTarget(client);
      return { ok: true, released: true };
    }
    if (action === "new") {
      const tab = await cb(chrome.tabs.create, { url: args.url || "about:blank", active: args.active === true });
      await selectTab(client, tab);
      return { tab_id: tab.id, title: tab.title, url: tab.pendingUrl || tab.url };
    }
    if (action === "select" || action === "activate") {
      const tab = await getTab(args.tab_id);
      checkCommand(conn);
      if (action === "activate") {
        await cb(chrome.tabs.update, tab.id, { active: true });
        try { await cb(chrome.windows.update, tab.windowId, { focused: true }); } catch (e) {}
      }
      await selectTab(client, tab);
      return { ok: true, tab_id: tab.id, title: tab.title, url: tab.url };
    }
    if (action === "close") {
      const tab = await getTab(args.tab_id);
      checkCommand(conn);
      await cb(chrome.tabs.remove, tab.id);
      return { ok: true, tab_id: tab.id };
    }
    throw new Error("action 必须是 list/select/release/new/activate/close");
  },

  async evaluate(args, tab) {
    if (pageRestricted(tab.url)) throw new Error("该页面（" + tab.url + "）不允许注入脚本");
    const [res] = await cb(chrome.scripting.executeScript, {
      target: { tabId: tab.id }, world: "MAIN", func: evalInPage, args: [{ code: String(args.code) }],
    });
    if (res && res.error) throw new Error(String(res.error.message || res.error));
    return res ? res.result : null;
  },
};

// ---------- WebSocket 连接 ----------
let cmdChain = Promise.resolve(); // 严格串行：上一条命令结束（无论成败）才执行下一条

function setBadge() {
  const work = displayedWork();
  const [text, color] = work ? ["▶", "#2563eb"] : !connected ? ["○", "#9ca3af"] :
    armed ? ["●", "#16a34a"] : ["Ⅱ", "#b45309"];
  Promise.resolve(chrome.action.setBadgeText({ text })).catch(() => {});
  Promise.resolve(chrome.action.setBadgeBackgroundColor({ color })).catch(() => {});
}

function connect() {
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
  clearTimeout(reconnectTimer);
  let conn;
  try { conn = ws = new WebSocket(serverUrl); } catch (e) { scheduleReconnect(); return; }

  // 所有回调绑定本连接对象：旧连接迟到的 onmessage/onclose/onerror
  // 不得对当前连接产生副作用（错误置位/触发重连/接收命令）
  conn.onopen = () => {
    if (ws !== conn) return;
    connected = true;
    refreshActivity();
    conn.send(JSON.stringify({ type: "hello", version: VERSION, background_tabs: true }));
  };
  conn.onclose = () => {
    if (ws !== conn) return;
    connected = false;
    recent.clear();
    refreshActivity();
    scheduleReconnect();
  };
  conn.onerror = () => {
    if (ws !== conn) return;
    try { conn.close(); } catch (e) {}
  };

  conn.onmessage = (ev) => {
    if (ws !== conn) return; // 旧连接迟到的消息直接忽略
    let msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    if (msg.type === "pong" || msg.type === "ping") return;
    const { id, tool } = msg;
    if (id == null || !tool) return;
    // 入队串行执行；单条命令的异常被吞掉，不影响后续命令
    cmdChain = cmdChain.then(() => runCommand(conn, msg)).catch(() => {});
  };
}

function checkCommand(conn) {
  if (conn !== ws || conn.readyState !== 1) throw new Error("桥接连接已更换");
  if (!armed) throw new Error("扩展已被暂停：点击扩展图标，取消勾选『暂停』后重试");
}

async function runCommand(conn, msg) {
  const { id, tool, client_id = "local", require_target } = msg;
  const args = msg.args || {};
  // 执行开始时：必须是当前连接且仍处于 OPEN——连接已断开（尚未重连）的排队命令直接取消，
  // 旧连接的命令不在新连接上执行
  if (conn !== ws || conn.readyState !== 1) return;
  let ok = true, result = null, error = null;
  try {
    await stateReady;
    if (conn !== ws || conn.readyState !== 1) return;
    const release = tool === "tabs" && args.action === "release";
    if (!release) checkCommand(conn);
    if (!Object.hasOwn(handlers, tool)) throw new Error("扩展不支持的操作: " + tool);
    if (tool === "tabs") {
      result = await handlers.tabs(args, client_id, conn);
    } else {
      const tab = await resolveTab(client_id, args.tab_id, require_target);
      checkCommand(conn);
      await bindTab(client_id, tab);
      checkCommand(conn);
      if ((tab.discarded || tab.frozen) && tool !== "navigate" && tool !== "history")
        throw new Error("Chrome 已休眠此标签页，请手动打开该页一次后重试");
      const work = running = { tab, conn, closed: false };
      refreshActivity();
      try {
        const value = await handlers[tool](args, tab);
        result = value != null && typeof value === "object" ? { ...value, tab_id: tab.id } : value;
      } catch (e) {
        if (work.closed || /no tab with (?:given )?id/i.test(e.message)) {
          work.closed = true;
          throw unavailableTab(tab.id);
        }
        throw e;
      } finally {
        running = null;
        if (!work.closed && connected && armed && conn === ws && conn.readyState === 1)
          recent.set(client_id, { tab, until: Date.now() + WAITING_MARK_MS });
        refreshActivity();
      }
    }
  } catch (e) {
    ok = false;
    error = String((e && e.message) || e);
  }
  if (conn !== ws || conn.readyState !== 1) {
    // 执行期间连接已切换/断开：旧结果不发给新连接（旧连接也已关闭，无处可发）
    return;
  }
  try {
    conn.send(JSON.stringify({ type: "result", id, ok, result, error }));
  } catch (e) {}
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, 2500);
}

function startHeartbeat() {
  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "ping" }));
    }
  }, HEARTBEAT_MS);
}

function tabRemoved(tabId) {
  attachedTabs.delete(tabId);
  lastShot.delete(tabId);
  lastMouse.delete(tabId);
  if (running?.tab.id === tabId) running.closed = true;
  // Keep the closed target selection so the next implicit call fails instead of acting on another tab.
  for (const [client, item] of recent) if (item.tab.id === tabId) recent.delete(client);
  refreshActivity();
}

chrome.tabs.onRemoved.addListener(tabRemoved);
chrome.tabs.onReplaced?.addListener((_newId, oldId) => tabRemoved(oldId));
chrome.tabs.onUpdated?.addListener((tabId, change) => {
  if (change.url != null || change.status === "loading") lastShot.delete(tabId);
  if (change.title == null) return;
  if (running?.tab.id === tabId) running.tab.title = change.title;
  for (const item of recent.values()) if (item.tab.id === tabId) item.tab.title = change.title;
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "status") {
    sendResponse({ connected, armed, serverUrl, version: VERSION, activity: activityStatus() });
  } else if (msg && msg.type === "arm") {
    armed = !!msg.armed;
    chrome.storage.local.set({ armed });
    if (!armed) recent.clear();
    refreshActivity();
  } else if (msg && msg.type === "set_server") {
    // 保存确认协议：持久化成功才回 ok 并切换/重连；失败保持旧地址与旧连接
    const next = String(msg.url || DEFAULT_SERVER);
    chrome.storage.local.set({ server_url: next }, () => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: "地址未保存：" + chrome.runtime.lastError.message });
        return;
      }
      serverUrl = next;
      if (ws) { try { ws.close(); } catch (e) {} }
      connect();
      sendResponse({ ok: true, serverUrl: next });
    });
    return true; // 异步回执，保持消息通道开启
  }
  return false;
});

chrome.storage.local.get(["armed", "server_url"], (st) => {
  if (st.armed === false) armed = false;
  if (st.server_url) serverUrl = st.server_url;
  refreshActivity();
  connect();
  startHeartbeat();
});

// Service Worker 被唤醒时（如 debugger 事件）重新连上
chrome.debugger.onEvent.addListener(() => {});
