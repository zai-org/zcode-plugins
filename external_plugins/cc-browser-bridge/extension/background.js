// Claude API Browser Bridge — 扩展后台（MV3 Service Worker）
// 通过 WebSocket 连接本地桥接服务 (server/bridge.js)，把工具调用翻译成
// chrome.debugger (CDP) 与 chrome.scripting 操作，复刻原生 Claude in Chrome 的能力。

const DEFAULT_SERVER = "ws://127.0.0.1:8765/ws";
const HEARTBEAT_MS = 20000;
const VERSION = "0.1.0";

let ws = null;
let connected = false;
let armed = true; // popup 里可暂停
let serverUrl = DEFAULT_SERVER;
let reconnectTimer = null;
let heartbeatTimer = null;

const attachedTabs = new Set(); // 已 attach debugger 的 tabId
const lastShot = new Map();     // tabId -> { scale }（截图像素 / CSS 像素）
let lastMouse = { x: 0, y: 0 }; // 最近一次鼠标位置（CSS 像素）

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

async function activeTab() {
  const tabs = await cb(chrome.tabs.query, { active: true, lastFocusedWindow: true });
  if (!tabs || !tabs.length) throw new Error("找不到活动标签页");
  const t = tabs[0];
  if (/^(chrome|edge|about|devtools):/i.test(t.url || "") && !/^chrome:\/\/newtab/i.test(t.url)) {
    // chrome:// 页面大部分操作受限，但截图可用，这里只对需要注入的操作在各自 handler 里报错
  }
  return t;
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

// 页面接管标识：Claude 操作期间页面右下角显示悬浮胶囊，4 秒无操作自动消失。
// 挂在 documentElement 下、无 role/tabindex/onclick → 不会被 snapshot 枚举；
// pointer-events:none → 不影响坐标点击命中。
function indicatorAgent(args) {
  const ID = "__cc_bridge_indicator__";
  const STYLE_ID = "__cc_bridge_indicator_style__";
  const remove = () => {
    const el = document.getElementById(ID); if (el) el.remove();
    const st = document.getElementById(STYLE_ID); if (st) st.remove();
  };
  if (args.mode === "hide") { remove(); return { ok: true }; }
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent =
      "@keyframes __ccblink{0%,100%{opacity:1}50%{opacity:.2}}" +
      "#__cc_bridge_indicator__{position:fixed;bottom:18px;right:18px;z-index:2147483647;" +
      "background:#D97757;color:#fff;padding:8px 14px;border-radius:999px;" +
      "font:13px/1.4 -apple-system,'PingFang SC','Microsoft YaHei',sans-serif;" +
      "box-shadow:0 4px 14px rgba(0,0,0,.28);pointer-events:none;display:flex;align-items:center;gap:8px;max-width:60vw}" +
      "#__cc_bridge_indicator__ .dot{width:8px;height:8px;border-radius:50%;background:#fff;animation:__ccblink 1s infinite;flex:none}" +
      "#__cc_bridge_indicator__ .lbl{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}";
    document.documentElement.appendChild(style);
  }
  let el = document.getElementById(ID);
  if (!el) {
    el = document.createElement("div");
    el.id = ID;
    const dot = document.createElement("span"); dot.className = "dot";
    const lbl = document.createElement("span"); lbl.className = "lbl";
    el.appendChild(dot); el.appendChild(lbl);
    document.documentElement.appendChild(el);
  }
  el.querySelector(".lbl").textContent = "Browser Bridge 正在操作此页面 · " + (args.label || "");
  clearTimeout(window.__ccBridgeIndTimer);
  window.__ccBridgeIndTimer = setTimeout(remove, 4000);
  return { ok: true };
}

const INDICATOR_TOOLS = new Set([
  "snapshot", "read_page", "click_ref", "click_xy", "hover_ref", "move_to",
  "mouse_down", "mouse_up", "drag_to", "type", "press_key", "select_option",
  "scroll", "evaluate",
]);
const SHOT_TOOLS = new Set(["screenshot", "screenshot_full"]);

// 整页截图的设备尺寸覆盖结束后恢复原滚动位置（覆盖期间内容全可见，
// 滚动偏移会被重置；清除覆盖后浏览器不一定恢复到原位）
function scrollToAgent(a) {
  try { window.scrollTo(a.x || 0, a.y || 0); } catch (e) {}
  return { ok: true, x: Math.round(scrollX), y: Math.round(scrollY) };
}

async function showIndicator(tool) {
  try {
    const tab = await activeTab();
    await inject(tab.id, indicatorAgent, { mode: "show", label: tool });
  } catch (e) { /* 标识失败不影响命令执行 */ }
}

async function hideIndicator() {
  try {
    const tab = await activeTab();
    await inject(tab.id, indicatorAgent, { mode: "hide" });
    await sleep(60); // 等移除渲染生效，避免拍进截图
  } catch (e) { /* 忽略 */ }
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
function cssPoint(tabId, x, y) {
  const s = lastShot.get(tabId);
  const scale = s ? s.scale : 1;
  return { x: Math.round(x / scale), y: Math.round(y / scale) };
}

async function cdpClick(tabId, x, y, opts = {}) {
  const p = cssPoint(tabId, x, y);
  lastMouse = p;
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
  async metrics(args) {
    const tab = await activeTab();
    return inject(tab.id, pageAgent, { mode: "metrics" });
  },

  async snapshot() {
    const tab = await activeTab();
    if (pageRestricted(tab.url)) throw new Error("该页面（" + tab.url + "）不允许注入脚本");
    return inject(tab.id, pageAgent, { mode: "snapshot" });
  },

  async read_page() {
    const tab = await activeTab();
    if (pageRestricted(tab.url)) throw new Error("该页面（" + tab.url + "）不允许注入脚本");
    return inject(tab.id, pageAgent, { mode: "read_page" });
  },

  async click_ref(args) {
    const tab = await activeTab();
    return inject(tab.id, pageAgent, { mode: "click", ref: args.ref });
  },

  async hover_ref(args) {
    const tab = await activeTab();
    return inject(tab.id, pageAgent, { mode: "hover", ref: args.ref });
  },

  async click_xy(args) {
    const tab = await activeTab();
    return cdpClick(tab.id, args.x, args.y, args);
  },

  async move_to(args) {
    const tab = await activeTab();
    const p = cssPoint(tab.id, args.x, args.y);
    lastMouse = p;
    await cdp(tab.id, "Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
    return { ok: true, x: p.x, y: p.y };
  },

  async cursor_position() {
    return { x: lastMouse.x, y: lastMouse.y };
  },

  async mouse_down(args) {
    const tab = await activeTab();
    const p = cssPoint(tab.id, args.x, args.y);
    await cdp(tab.id, "Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 });
    return { ok: true };
  },

  async mouse_up(args) {
    const tab = await activeTab();
    const p = cssPoint(tab.id, args.x ?? lastMouse.x, args.y ?? lastMouse.y);
    await cdp(tab.id, "Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 });
    return { ok: true };
  },

  async drag_to(args) {
    const tab = await activeTab();
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
    lastMouse = to;
    return { ok: true };
  },

  async type(args) {
    const tab = await activeTab();
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

  async press_key(args) {
    const tab = await activeTab();
    return pressKey(tab.id, args.key);
  },

  async select_option(args) {
    const tab = await activeTab();
    return inject(tab.id, pageAgent, { mode: "select_option", ref: args.ref, value: args.value });
  },

  async scroll(args) {
    const tab = await activeTab();
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

  async screenshot() {
    const tab = await activeTab();
    if (tab.status !== "complete") await sleep(700);
    // 确保目标标签处于激活状态（captureVisibleTab 只能截当前可见标签）
    if (!tab.active) await cb(chrome.tabs.update, tab.id, { active: true });
    await sleep(200);
    const metrics = await (async () => {
      try { return await inject(tab.id, pageAgent, { mode: "metrics" }); }
      catch (e) { return null; }
    })();
    const dataUrl = await cb(chrome.tabs.captureVisibleTab, tab.windowId, { format: "png" });
    const raw = dataUrl.split(",")[1];
    const img = await shrinkBase64Png(raw, 1280, null);
    const scale = metrics ? img.width / metrics.w : 1;
    lastShot.set(tab.id, { scale, at: Date.now() });
    return { data: img.data, width: img.width, height: img.height, scale, title: tab.title, url: tab.url };
  },

  async screenshot_full() {
    const tab = await activeTab();
    if (!tab.active) await cb(chrome.tabs.update, tab.id, { active: true });
    await sleep(200);
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

  async navigate(args) {
    let url = String(args.url || "");
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = "https://" + url;
    let tabId = args.tab_id;
    if (tabId == null) {
      const tab = await activeTab();
      tabId = tab.id;
    }
    await cb(chrome.tabs.update, tabId, { url });
    await sleep(900);
    return { ok: true, url };
  },

  async history(args) {
    const tab = await activeTab();
    const action = args.action || "back";
    if (action === "reload") await cb(chrome.tabs.reload, tab.id);
    else if (action === "back") await cb(chrome.tabs.goBack, tab.id);
    else if (action === "forward") await cb(chrome.tabs.goForward, tab.id);
    else throw new Error("action 必须是 back/forward/reload");
    await sleep(700);
    return { ok: true, action };
  },

  async tabs(args) {
    const action = args.action || "list";
    if (action === "list") {
      const list = await cb(chrome.tabs.query, {});
      return {
        tabs: list.map((t) => ({
          tab_id: t.id, title: String(t.title || "").slice(0, 80), url: String(t.url || "").slice(0, 120),
          active: t.active, window_id: t.windowId,
        })),
      };
    }
    if (action === "new") {
      const t = await cb(chrome.tabs.create, { url: args.url || "about:blank", active: true });
      await sleep(900);
      return { tab_id: t.id, title: t.title, url: t.url };
    }
    if (action === "activate") {
      if (args.tab_id == null) throw new Error("需要 tab_id");
      await cb(chrome.tabs.update, args.tab_id, { active: true });
      const t = await cb(chrome.tabs.get, args.tab_id);
      try { await cb(chrome.windows.update, t.windowId, { focused: true }); } catch (e) {}
      await sleep(250);
      return { ok: true, tab_id: args.tab_id };
    }
    if (action === "close") {
      if (args.tab_id == null) throw new Error("需要 tab_id");
      await cb(chrome.tabs.remove, args.tab_id);
      attachedTabs.delete(args.tab_id);
      return { ok: true };
    }
    throw new Error("action 必须是 list/new/activate/close");
  },

  async evaluate(args) {
    const tab = await activeTab();
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
  chrome.action.setBadgeText({ text: connected ? "●" : "○" });
  chrome.action.setBadgeBackgroundColor({ color: connected ? "#16a34a" : "#9ca3af" });
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
    setBadge();
    conn.send(JSON.stringify({ type: "hello", version: VERSION }));
  };
  conn.onclose = () => {
    if (ws !== conn) return;
    connected = false;
    setBadge();
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

async function runCommand(conn, msg) {
  const { id, tool, args } = msg;
  // 执行开始时：必须是当前连接且仍处于 OPEN——连接已断开（尚未重连）的排队命令直接取消，
  // 旧连接的命令不在新连接上执行
  if (conn !== ws || conn.readyState !== 1) return;
  let ok = true, result = null, error = null;
  // 执行开始时（而不是消息到达时）重新检查暂停状态
  if (!armed) { ok = false; error = "扩展已被暂停：点击扩展图标，取消勾选『暂停』后重试"; }
  else if (!handlers[tool]) { ok = false; error = "扩展不支持的操作: " + tool; }
  else {
    if (SHOT_TOOLS.has(tool)) await hideIndicator();
    else if (INDICATOR_TOOLS.has(tool)) showIndicator(tool); // 故意不 await，不阻塞命令
    try { result = await handlers[tool](args || {}); }
    catch (e) { ok = false; error = String((e && e.message) || e); }
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

chrome.tabs.onRemoved.addListener((tabId) => {
  attachedTabs.delete(tabId);
  lastShot.delete(tabId);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "status") {
    sendResponse({ connected, armed, serverUrl, version: VERSION });
  } else if (msg && msg.type === "arm") {
    armed = !!msg.armed;
    chrome.storage.local.set({ armed });
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
  connect();
  startHeartbeat();
});

// Service Worker 被唤醒时（如 debugger 事件）重新连上
chrome.debugger.onEvent.addListener(() => {});
connect();
