/**
 * ai-pair panel page logic — bundled with esbuild and inlined into panel.html.
 *
 * Host connection: official ext-apps App SDK first (gives callServerTool for
 * the cascade settings UI); if the SDK cannot connect, fall back to the legacy
 * window.zcode API (read-only: viewing works, settings must go through chat).
 */
import { App } from "@modelcontextprotocol/ext-apps";
import { esc, renderMarkdown, renderPlain } from "./markdown.mjs";

const DATA_URI = "ui://ai-pair/reviews.json";
// draft：设置视图里未点「保存」的级联选择。轮询/主题变化会整页重渲染，
// 没有它，下拉框里未保存的选择会被冲回服务端持久化的旧值。
const state = { data: null, selectedId: null, view: "list", loading: false, actionText: null, error: null, draft: {} };
let host = null; // { mode: "app"|"legacy", app?, api? }

// ---------------------------------------------------------------------------
// Host connection & data access
// ---------------------------------------------------------------------------

async function connectHost() {
  try {
    const app = new App({ name: "ai-pair-panel", version: "0.4.8" }, { availableDisplayModes: ["inline", "fullscreen"] });
    await Promise.race([
      app.connect(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("connect timeout")), 3000)),
    ]);
    return { mode: "app", app };
  } catch (e) {
    if (window.zcode) return { mode: "legacy", api: window.zcode };
    throw new Error("无法连接宿主：请在 ZCode 桌面端的插件沙箱里打开");
  }
}

async function readData() {
  if (host.mode === "app") {
    const res = await host.app.readServerResource({ uri: DATA_URI });
    return JSON.parse(res.contents[0].text);
  }
  const res = await host.api.readResource(DATA_URI);
  return JSON.parse(res.contents[0].text);
}

async function callTool(name, args) {
  if (host.mode !== "app") {
    throw new Error(`当前页面是旧版兼容模式（只读）。请在对话里让 AI 执行 ${name} 工具来完成此操作。`);
  }
  const res = await host.app.callServerTool({ name, arguments: args || {} });
  const text = (res?.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
  if (res?.isError) throw new Error(text || "工具调用失败");
  return text;
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

function applyTheme() {
  try {
    let theme = "light";
    if (host.mode === "legacy") theme = host.api.theme === "dark" ? "dark" : "light";
    else {
      const ctx = host.app.getHostContext ? host.app.getHostContext() : null;
      theme = ctx && ctx.theme === "dark" ? "dark" : "light";
    }
    document.documentElement.dataset.theme = theme;
    const vars =
      (host.mode === "legacy" ? host.api.hostContext : host.app.getHostContext ? host.app.getHostContext() : null)
        ?.styles?.variables;
    if (vars) {
      const rootStyle = document.documentElement.style;
      Object.keys(vars).forEach((key) => rootStyle.setProperty(key, vars[key]));
    }
  } catch (e) {
    /* 主题信息不可用时保持兜底色 */
  }
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

// esc 由 ui/markdown.mjs 提供（与渲染逻辑共用同一份转义实现）
function time(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch (e) {
    return iso;
  }
}
function statusChip(status) {
  var map = { complete: ["ok", "✓ 完成"], running: ["run", "◌ 评审中"], failed: ["fail", "✗ 失败"] };
  var m = map[status] || ["", status];
  return '<span class="chip ' + m[0] + '">' + m[1] + "</span>";
}
function sevChips(sev) {
  if (!sev) return "";
  var out = "";
  if (sev.CRITICAL) out += '<span class="chip crit">CRITICAL ×' + sev.CRITICAL + "</span>";
  if (sev.WARNING) out += '<span class="chip warn">WARNING ×' + sev.WARNING + "</span>";
  if (sev.SUGGESTION) out += '<span class="chip sugg">SUGGESTION ×' + sev.SUGGESTION + "</span>";
  return out;
}
// 报告正文用 renderMarkdown（marked + DOMPurify，见 ui/markdown.mjs）
function slotLabel(key) {
  return (state.data && state.data.slots && state.data.slots[key] && state.data.slots[key].label) || (key === "reviewer1" ? "评审模型 1" : "评审模型 2");
}
// 角色名（正确性把关 / 设计与可维护性），与 server 端 SLOTS.role 同源下发
function slotRole(key) {
  return (state.data && state.data.slots && state.data.slots[key] && state.data.slots[key].role) || "";
}

// token 数格式化：1234 → 1.2k
function fmtTokens(n) {
  n = Number(n) || 0;
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}
// 一次评审的总 token（providers + cross 求和；summary 里服务端已算好，旧记录兜底求和）
function totalTokens(r) {
  if (r.tokens && typeof r.tokens.total === "number") return r.tokens.total;
  var sum = 0;
  Object.keys(r.providers || {}).forEach(function (k) {
    var p = r.providers[k];
    sum += (p.tokens && p.tokens.total) || 0;
  });
  Object.keys(r.cross || {}).forEach(function (k) {
    var p = r.cross[k];
    sum += (p.tokens && p.tokens.total) || 0;
  });
  return sum;
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

function render() {
  var app = document.getElementById("app");
  if (!state.data) {
    app.innerHTML = state.error
      ? '<div class="empty">' + esc(state.error) + "</div>"
      : '<div class="empty">加载中…</div>';
    return;
  }

  if (state.view === "settings") return renderSettings(app);
  if (state.selectedId) return renderDetail(app);

  var d = state.data;
  var missing = [];
  if (!d.slotsConfigured.reviewer1) missing.push(slotLabel("reviewer1") + " 的渠道");
  if (!d.slotsConfigured.reviewer2) missing.push(slotLabel("reviewer2") + " 的渠道");
  var configWarn = missing.length
    ? '<div class="config-warn">⚠ 未选择 ' + esc(missing.join("、")) +
      '：点右上角「⚙ 设置」级联选择，无需手填。</div>'
    : "";

  var items = (d.reviews || []).map(function (r) {
    var chips = Object.keys(r.providers || {})
      .map(function (name) {
        var p = r.providers[name];
        return esc(slotLabel(name)) + " " + (p.status === "complete" ? "✓" : p.status === "running" ? "◌" : "✗");
      })
      .map(function (s) { return '<span class="chip">' + s + "</span>"; })
      .join(" ");
    var sev = Object.keys(r.providers || {})
      .map(function (name) { return r.providers[name].severity; })
      .filter(Boolean);
    var merged = sev.length
      ? {
          CRITICAL: sev.reduce(function (a, s) { return a + (s.CRITICAL || 0); }, 0),
          WARNING: sev.reduce(function (a, s) { return a + (s.WARNING || 0); }, 0),
          SUGGESTION: sev.reduce(function (a, s) { return a + (s.SUGGESTION || 0); }, 0),
        }
      : null;
    var tokens = totalTokens(r);
    var hasCross = Object.keys(r.cross || {}).length > 0;
    return (
      '<li class="item" data-id="' + esc(r.id) + '">' +
      '<div class="title"><span class="t">' + esc(r.title) + "</span>" +
      (r.status !== "running"
        ? '<button class="del" data-id="' + esc(r.id) + '" title="删除这条评审">✕</button>'
        : "") +
      "</div>" +
      '<div class="meta">' + statusChip(r.status) + sevChips(merged) + chips +
      (tokens > 0 ? '<span class="chip" title="提问+回复 token 总量（由所选渠道计费）"> Σ ' + esc(fmtTokens(tokens)) + " tok</span>" : "") +
      (hasCross ? '<span class="chip xcross" title="启用了交叉质证轮">⇄ 质证</span>' : "") +
      '<span class="chip">' + esc(time(r.createdAt)) + "</span></div></li>"
    );
  });

  app.innerHTML =
    "<h1>AI Pair 评审<span class='spacer'></span>" +
    (items.length ? '<button id="clear">清空</button>' : "") +
    '<button id="settings">⚙ 设置</button>' +
    '<button id="refresh">' + (state.loading ? '<span class="spin">◌</span>' : "⟳") + " 刷新</button></h1>" +
    configWarn +
    (items.length
      ? '<ul class="list">' + items.join("") + "</ul>" +
        '<p class="muted">点击任意评审查看完整报告；评审进行中会自动刷新。✕ 删除单条，需二次确认。</p>'
      : '<div class="empty">还没有评审记录<br><br>在对话里让 AI 改完代码后说「送 ai-pair 评审」，' +
        "或让它调用 request_review 工具。</div>");

  app.querySelector("#refresh").onclick = function () { load(); };
  app.querySelector("#settings").onclick = function () {
    state.view = "settings";
    state.actionText = null;
    render();
  };
  Array.prototype.forEach.call(app.querySelectorAll("li.item"), function (li) {
    li.onclick = function () {
      state.selectedId = li.getAttribute("data-id");
      saveState();
      render();
    };
  });

  // 删除（两步确认：第一次点击进入待确认态，2.5 秒内再点执行）
  function armDelete(btn, fn) {
    if (btn.dataset.armed) {
      fn();
      return;
    }
    btn.dataset.armed = "1";
    btn.classList.add("armed");
    var old = btn.textContent;
    btn.textContent = "确认删除?";
    setTimeout(function () {
      if (!btn.isConnected) return;
      delete btn.dataset.armed;
      btn.classList.remove("armed");
      btn.textContent = old;
    }, 2500);
  }
  function runDelete(args, btn) {
    callTool("delete_review", args)
      .then(function (text) {
        return load();
      })
      .catch(function (err) {
        btn.title = (err && err.message) || "删除失败"; // 错误原因透出到悬停提示（评审报告：吞错误）
        btn.textContent = "✕ 失败";
        setTimeout(function () {
          if (btn.isConnected) {
            delete btn.dataset.armed;
            btn.classList.remove("armed");
            btn.textContent = "✕";
          }
        }, 2000);
      });
  }
  Array.prototype.forEach.call(app.querySelectorAll("button.del"), function (btn) {
    btn.onclick = function (e) {
      e.stopPropagation(); // 不触发条目点击（进详情）
      armDelete(btn, function () { runDelete({ id: btn.getAttribute("data-id") }, btn); });
    };
  });
  var clearBtn = app.querySelector("#clear");
  if (clearBtn) {
    clearBtn.onclick = function () {
      armDelete(clearBtn, function () { runDelete({ all: true }, clearBtn); });
    };
  }
}

function renderDetail(app) {
  var r = (state.data.full || {})[state.selectedId];
  if (!r) {
    app.innerHTML =
      "<h1><button id='back'>← 返回</button><button id='settings'>⚙ 设置</button></h1><div class='empty'>评审记录不存在（可能已被清理）。</div>";
    wireHeaderButtons(app);
    return;
  }
  var providers = Object.keys(r.providers || {}).map(function (name) {
    var p = r.providers[name];
    var body;
    if (p.status === "running") body = '<div class="report"><span class="spin">◌</span> 评审中…（模型 ' + esc(p.model) + "）</div>";
    else if (p.status === "failed") body = '<div class="report">评审失败：' + esc(p.error || "未知错误") + "</div>";
    else {
      // 旧记录（0.4.0 之前）没有 tokens 字段，显示"—"而不是 0（0 会被误读为无消耗）
      var tok = p.tokens && typeof p.tokens.total === "number"
        ? " | tokens " + esc(fmtTokens(p.tokens.prompt)) + " + " + esc(fmtTokens(p.tokens.completion))
        : " | tokens —";
      body =
        '<div class="report">' + renderMarkdown(p.report) + "</div>" +
        '<p class="muted">来源: ' + esc(p.source || slotLabel(name)) + "（model: " + esc(p.model) + "） | 耗时 " +
        Math.round((p.latencyMs || 0) / 1000) + "s" + tok + "</p>";
    }
    var role = slotRole(name);
    return '<div class="provider"><h2>' + esc(slotLabel(name)) + (role ? " · " + esc(role) : "") + " " + statusChip(p.status) + "</h2>" + body + "</div>";
  });

  // 交叉质证区块（启用了质证轮才有）
  var crossBlocks = Object.keys(r.cross || {}).map(function (name) {
    var p = r.cross[name];
    var body;
    if (p.status === "running") body = '<div class="report"><span class="spin">◌</span> 质证中…（模型 ' + esc(p.model) + "）</div>";
    else if (p.status === "failed") body = '<div class="report">质证失败：' + esc(p.error || "未知错误") + "</div>";
    else {
      var v = p.verdicts || {};
      var vchips =
        '<span class="chip ok">认同 ×' + (v.AGREE || 0) + "</span>" +
        '<span class="chip crit">有误 ×' + (v.WRONG || 0) + "</span>" +
        '<span class="chip sugg">遗漏 ×' + (v.MISS || 0) + "</span> ";
      var ctok = p.tokens && typeof p.tokens.total === "number"
        ? " | tokens " + esc(fmtTokens(p.tokens.prompt)) + " + " + esc(fmtTokens(p.tokens.completion))
        : " | tokens —";
      body =
        '<div class="meta">' + vchips + "</div>" +
        '<div class="report">' + renderMarkdown(p.report) + "</div>" +
        '<p class="muted">（model: ' + esc(p.model) + "） | 耗时 " + Math.round((p.latencyMs || 0) / 1000) + "s" + ctok + "</p>";
    }
    var role = slotRole(name);
    return '<div class="provider xcross"><h2>⇄ ' + esc(slotLabel(name)) + (role ? " · " + esc(role) : "") + " 质证 " + statusChip(p.status) + "</h2>" + body + "</div>";
  });

  var tokens = totalTokens(r);
  app.innerHTML =
    "<h1><button id='back'>← 返回</button>" + esc(r.title) + statusChip(r.status) + "<span class='spacer'></span><button id='settings'>⚙ 设置</button></h1>" +
    '<p class="muted">' + esc(time(r.createdAt)) + " · 焦点: " + esc(((r.material && r.material.focus) || r.focus) === "content" ? "内容" : "代码") +
    (tokens > 0 ? " · 合计 " + esc(fmtTokens(tokens)) + " tokens（由所选渠道计费，不占主对话）" : "") + "</p>" +
    providers.join("") +
    crossBlocks.join("") +
    '<p class="muted">两份报告相互独立；结论冲突时由你裁决，CRITICAL 项建议优先处理' +
    (Object.keys(r.cross || {}).length ? "，质证中 [WRONG]/[MISS] 项值得优先核对" : "") + "。</p>";
  wireHeaderButtons(app);
}

// ---------------------------------------------------------------------------
// Settings view: cascade channel → model for each reviewer slot
// ---------------------------------------------------------------------------

function renderSettings(app) {
  var d = state.data;
  var channels = d.channels || [];

  function slotBlock(key) {
    var info = (d.slots || {})[key] || {};
    var persisted = info.selection || null;
    // 未保存的草稿优先于已持久化的选择（草稿的渠道值就是 channelId）
    var sel = state.draft[key]
      ? { channelId: state.draft[key].channel, channelName: "", model: state.draft[key].model }
      : persisted;
    var dirty = Boolean(state.draft[key]);
    var current = info.configured
      ? "当前: " + esc(info.channel || "(渠道)") + " / " + esc(info.model || "(默认)")
      : "当前: ⬜ 未配置";
    if (dirty) current += " · 已修改未保存";
    var channelOptions = '<option value="">（清除选择）</option>' +
      channels.map(function (c) {
        var selected = sel && (c.id === sel.channelId || c.name === sel.channelName) ? " selected" : "";
        return '<option value="' + esc(c.id) + '" data-name="' + esc(c.name) + '"' + selected + ">" +
          esc(c.name) + (c.kind === "anthropic" ? " [anthropic]" : "") + "</option>";
      }).join("");
    var modelOptions = modelOptionsFor(key, channels, sel);
    var focus = info.focus || {};
    return (
      '<div class="slot-block" data-slot="' + esc(key) + '">' +
      "<h2>" + esc(info.label || slotLabel(key)) + " · " + esc(info.role || "") + "</h2>" +
      '<p class="muted">' + current + "</p>" +
      '<p class="muted">代码评审重点: ' + esc(focus.dev || "") + "<br>内容评审重点: " + esc(focus.content || "") + "</p>" +
      '<label class="field"><span>渠道</span><select class="ch">' + channelOptions + "</select></label>" +
      '<label class="field"><span>模型</span><select class="md">' + modelOptions + "</select></label>" +
      "</div>"
    );
  }

  function modelOptionsFor(key, channels, sel) {
    var chosenId = "";
    if (sel) {
      var match = channels.filter(function (c) { return c.id === sel.channelId || c.name === sel.channelName; })[0];
      chosenId = match ? match.id : "";
    }
    var channel = channels.filter(function (c) { return c.id === chosenId; })[0];
    var models = channel ? channel.models.slice() : [];
    if (sel && sel.model && models.indexOf(sel.model) === -1) models.unshift(sel.model);
    var opts = '<option value="">（渠道默认）</option>';
    if (!channel) opts = '<option value="">（先选渠道）</option>';
    opts += models.map(function (m) {
      var selected = sel && sel.model === m ? " selected" : "";
      return '<option value="' + esc(m) + '"' + selected + ">" + esc(m) + "</option>";
    }).join("");
    return opts;
  }

  var legacyNote = host.mode !== "app"
    ? '<div class="config-warn">旧版兼容模式（只读）：请在对话里让 AI 跑 configure_reviewers / list_models 工具完成配置。</div>'
    : "";

  var crossChecked = d.options && typeof d.options.cross === "boolean" ? d.options.cross : false;
  app.innerHTML =
    "<h1><button id='back'>← 返回</button>评审设置</h1>" +
    '<p class="muted">渠道与模型来自 ZCode「管理模型」的已有配置，密钥自动复用、绝不重复填写。两个评审位建议选不同厂商的模型，异构评审的价值才在。</p>' +
    legacyNote +
    slotBlock("reviewer1") +
    slotBlock("reviewer2") +
    '<label class="cross-field"><input type="checkbox" id="cross"' + (crossChecked ? " checked" : "") + "/>" +
    "<span>⇄ 交叉质证轮（默认）：两位评审员完成后互相复核对方报告，标出认同/有误/遗漏。渠道 token 约翻倍</span></label>" +
    '<div class="actions"><button id="save">保存（立即生效）</button> <button id="test">测试连接</button></div>' +
    (state.actionText ? '<pre class="action-result">' + renderPlain(state.actionText) + "</pre>" : "");

  app.querySelector("#back").onclick = back;

  // 渠道切换 → 记入草稿并重建该槽位的模型下拉
  Array.prototype.forEach.call(app.querySelectorAll(".slot-block"), function (block) {
    var key = block.getAttribute("data-slot");
    var chSel = block.querySelector(".ch");
    var mdSel = block.querySelector(".md");
    chSel.onchange = function () {
      var channels = state.data.channels || [];
      var channel = channels.filter(function (c) { return c.id === chSel.value; })[0];
      var models = channel ? channel.models : [];
      state.draft[key] = { channel: chSel.value, model: "" };
      mdSel.innerHTML = '<option value="">' + (channel ? "（渠道默认）" : "（先选渠道）") + "</option>" +
        models.map(function (m) { return '<option value="' + esc(m) + '">' + esc(m) + "</option>"; }).join("");
    };
    mdSel.onchange = function () {
      if (!state.draft[key]) {
        // 只改模型不动渠道：以当前已选渠道为基准记草稿
        state.draft[key] = { channel: chSel.value, model: mdSel.value };
      } else {
        state.draft[key].model = mdSel.value;
      }
    };
  });

  var saveBtn = app.querySelector("#save");
  if (saveBtn) {
    saveBtn.onclick = function () {
      var args = {};
      var crossBox = app.querySelector("#cross");
      if (crossBox) args.cross = crossBox.checked;
      Array.prototype.forEach.call(app.querySelectorAll(".slot-block"), function (block) {
        var key = block.getAttribute("data-slot");
        var ch = block.querySelector(".ch").value;
        var md = block.querySelector(".md").value;
        if (ch) args[key] = { channel: ch, model: md };
      });
      state.actionText = "保存中…";
      render();
      callTool("configure_reviewers", args)
        .then(function (text) {
          state.draft = {}; // 已持久化，清空草稿
          state.actionText = text;
          return load();
        })
        .catch(function (err) {
          state.actionText = "保存失败：" + (err && err.message) + "（草稿已保留，可直接重试）";
          render();
        });
    };
    app.querySelector("#test").onclick = function () {
      state.actionText = "测试中…（可能需要几秒）";
      render();
      callTool("list_models", {})
        .then(function (text) {
          state.actionText = text;
          render();
        })
        .catch(function (err) {
          state.actionText = "测试失败：" + (err && err.message);
          render();
        });
    };
  }
}

// ---------------------------------------------------------------------------
// Common wiring
// ---------------------------------------------------------------------------

function wireHeaderButtons(app) {
  var backBtn = app.querySelector("#back");
  if (backBtn) backBtn.onclick = back;
  var settingsBtn = app.querySelector("#settings");
  if (settingsBtn) settingsBtn.onclick = function () {
    state.view = "settings";
    state.actionText = null;
    state.draft = {}; // 重新进入设置视图，从已持久化的值开始
    render();
  };
}

function saveState() {
  if (host.mode !== "legacy") return;
  var api = host.api;
  if (api.setWidgetState) {
    api.setWidgetState(Object.assign({}, api.widgetState || {}, { selectedId: state.selectedId }))
      .catch(function () {});
  }
}

function back() {
  state.selectedId = null;
  state.view = "list";
  saveState();
  render();
}

function load() {
  if (state.loading) return;
  state.loading = true;
  render();
  readData()
    .then(function (data) {
      state.data = data;
      state.loading = false;
      state.error = null;
      render();
      var api = host.mode === "legacy" ? host.api : null;
      if (api && api.notifyIntrinsicHeight) api.notifyIntrinsicHeight();
    })
    .catch(function (err) {
      state.loading = false;
      state.error = "读取评审数据失败：" + (err && err.message);
      render();
    });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

connectHost()
  .then(function (h) {
    host = h;
    applyTheme();
    if (host.mode === "legacy") {
      var api = host.api;
      if (api.widgetState && api.widgetState.selectedId) state.selectedId = api.widgetState.selectedId;
      if (api.onResourceUpdated) {
        api.onResourceUpdated(function (uri) {
          if (uri === DATA_URI) load();
        });
      }
      if (api.onResourceListChanged) api.onResourceListChanged(function () { load(); });
      window.addEventListener("zcode:globals", applyTheme);
    } else {
      // App 模式：订阅资源更新（能力存在时）+ 兜底轮询。
      // 设置视图暂停轮询：整页重渲染会打断下拉框操作（草稿虽已保护，体验仍差）。
      var app = host.app;
      try {
        if (app.onhostcontextchanged) app.onhostcontextchanged = applyTheme;
      } catch (e) { /* ignore */ }
      setInterval(function () {
        if (state.view !== "settings") load();
      }, 5000);
    }
    load();
  })
  .catch(function (err) {
    document.getElementById("app").innerHTML = '<div class="empty">' + esc(err && err.message) + "</div>";
  });
