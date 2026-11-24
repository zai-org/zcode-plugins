// popup：连接状态（文字+颜色）、暂停开关、服务地址保存（URL 解析规范化；等后台真实回执，绝不未确认就报成功）
const $ = (id) => document.getElementById(id);
let timer = null;

const EXT_VERSION = (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || "";

// 状态文案：检测中 / 已连接（扩展版本取自 manifest，与后台握手版本区分）/ 已连接·已暂停 / 未连接（面向用户，不含内部文件名）
function statusView(st) {
  if (!st) return { cls: "", dot: "", text: "检测中…" };
  const ver = EXT_VERSION ? ` · 扩展 v${EXT_VERSION}` : "";
  if (st.connected) {
    if (st.armed === false) return { cls: "warn", dot: "warn", text: `已连接${ver} · 已暂停` };
    return { cls: "ok", dot: "on", text: `已连接${ver}` };
  }
  return {
    cls: "bad", dot: "",
    text: "未连接：请打开 ZCode 等客户端建立会话，或重新运行一次连接引导；也可以检查下方服务地址是否正确。",
  };
}

function activityText(st) {
  if (!st?.connected) return "—";
  const { state, title, count } = st.activity || {};
  if (state === "working") return (st.armed ? "正在执行" : "正在完成当前操作") + " · " + title;
  if (st.armed === false) return "已暂停";
  if (state === "waiting") return "等待指令 · " + (count > 1 ? count + " 个标签页" : title);
  return "空闲";
}

// 服务地址草稿保护（R3）：输入框只被「首次成功状态」初始化一次，之后轮询绝不覆盖用户草稿
// （包括清空后的空草稿）；不依赖 value 是否为空判断初始化，而是跟踪用户是否输入过。
// 保存成功且回执到达时没有新编辑，才回填规范化地址。
let serverUrlReady = false; // 首次成功状态是否已消费初始化机会
let editSeq = 0;            // 用户每次输入自增；保存流程借此识别「保存期间是否有新编辑」
$("serverUrl").addEventListener("input", () => { editSeq++; });

function refresh() {
  chrome.runtime.sendMessage({ type: "status" }, (st) => {
    if (chrome.runtime.lastError || !st) {
      // 读取失败不得保留旧的「已连接」
      $("dot").className = "dot";
      const el = $("state");
      el.className = "v warn";
      el.textContent = "未能读取状态：请重新打开本弹窗。";
      $("activity").textContent = "—";
      return;
    }
    const v = statusView(st);
    $("dot").className = "dot" + (v.dot ? " " + v.dot : "");
    const el = $("state");
    el.className = "v" + (v.cls ? " " + v.cls : "");
    el.textContent = v.text;
    $("activity").textContent = activityText(st);
    $("pause").checked = !st.armed;
    if (!serverUrlReady) {
      serverUrlReady = true; // 首次成功状态只消费一次；之后轮询不再改写输入框
      if (editSeq === 0) $("serverUrl").value = st.serverUrl; // 用户已开始输入（含已清空）则不覆盖
    }
  });
}

function setHint(text, isErr) {
  const el = $("hint");
  el.textContent = text;
  el.classList.toggle("err", !!isErr);
}

// URL 解析规范化：仅缺 /ws 时补；已有 /ws 不变（修复 /ws/ws）；拒绝 http(s) 前缀伪装、凭据、坏端口；
// 保留合法 ws/wss 与 IPv6；空值报错。
function normalizeUrl(raw) {
  let s = String(raw || "").trim();
  if (!s) return { err: "地址不能为空。" };
  if (!/^wss?:\/\//i.test(s)) {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return { err: "地址无效：请使用 ws:// 或 wss:// 开头。" };
    s = "ws://" + s;
  }
  let u;
  try { u = new URL(s); } catch (e) { return { err: "地址无效。" }; }
  if (u.protocol !== "ws:" && u.protocol !== "wss:") return { err: "地址无效：仅支持 ws/wss。" };
  if (!u.hostname) return { err: "地址无效：缺少主机名。" };
  if (u.username || u.password) return { err: "地址无效：不支持在地址中携带凭据。" };
  let p = u.pathname.replace(/\/+$/, "");
  if (!/\/ws$/.test(p)) p += "/ws";
  return { url: u.protocol + "//" + u.host + p + u.search };
}

$("pause").addEventListener("change", (e) => {
  chrome.runtime.sendMessage({ type: "arm", armed: !e.target.checked });
});

$("save").addEventListener("click", () => {
  const n = normalizeUrl($("serverUrl").value);
  if (n.err) { setHint(n.err, true); return; }
  const seq0 = editSeq; // 保存时刻的编辑序号：成功回填仅在没有新编辑时进行
  const btn = $("save");
  btn.disabled = true; // 保存期间防重复提交
  let settled = false;
  const finish = (text, isErr) => {
    if (settled) return; // 超时后迟到的回应一律忽略，不再改写提示
    settled = true;
    clearTimeout(tooLate);
    btn.disabled = false;
    setHint(text, isErr);
  };
  const tooLate = setTimeout(() => {
    finish("保存未确认：扩展未在 2 秒内响应。请确认扩展已启用（角标有显示），或重新打开本弹窗再试。", true);
  }, 2000);
  try {
    chrome.runtime.sendMessage({ type: "set_server", url: n.url }, (resp) => {
      if (chrome.runtime.lastError) return finish("保存失败：" + chrome.runtime.lastError.message, true);
      if (resp && resp.ok === true && resp.serverUrl) {
        if (!settled && editSeq === seq0) $("serverUrl").value = resp.serverUrl; // 保存期间无新编辑：回填规范化值
        finish("已保存并开始重连：" + resp.serverUrl + "。连接结果见上方状态。", false);
      } else {
        finish("保存失败：" + ((resp && resp.error) || "扩展返回未知结果，地址未更改。"), true);
      }
    });
  } catch (e) {
    finish("保存失败：" + ((e && e.message) || e), true);
  }
});

refresh();
timer = setInterval(refresh, 1000);
window.addEventListener("unload", () => clearInterval(timer));
