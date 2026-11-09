// KiCad board panel (MCP App). One App per page, handlers installed before connect(), host theme/locale honoured, side kept in the host's session widget state.
import { App } from "@modelcontextprotocol/ext-apps";
import { EmptyResultSchema } from "@modelcontextprotocol/core";
import { h, applyTheme, json } from "./dom.js";
import logoSvg from "./logo.svg";
import { initTabs, tabBar, tabContent, TABS, startLive, stopLive, liveBadge } from "./tabs.js";

const app = new App({ name: "kicad-board", version: __PLUGIN_VERSION__ }, { availableDisplayModes: ["inline", "fullscreen"] });   // __PLUGIN_VERSION__: esbuild define from package.json (scripts/build.mjs)
const root = document.getElementById("root");
const show = (...kids) => root.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));
// the plugin logo as a small mark in the header (title/comments stripped; the page decides the size)
const logo = () => { const el = h("span", { class: "logo", "aria-hidden": "true" }); el.innerHTML = logoSvg.replace(/<title>.*?<\/title>|<!--[\s\S]*?-->/g, ""); return el; };
const state = { info: null, side: "top", tab: "board", img: null, err: null, busy: false, note: null, opening: false };

const T = {
  en: { none: "no board yet", hint: "Ask the agent to run pcb_build, or press Refresh", top: "top", bottom: "bottom", refresh: "Refresh", parts: "Parts", artifacts: "Artifacts",
    rendering: "rendering…", ask: "Ask agent to review", open: "Open in KiCad", opening: "Opening…", sync: "Sync now", edited: "edited in KiCad",
    session: (rel) => `Editing in KiCad — press ⌘S there and this panel updates by itself · ${rel}`, synced: (t) => `last sync ${t}`, nolaunch: (n) => `KiCad was not started: ${n}`,
    askText: (i) => `Review the KiCad board "${i.name}" (${i.width_mm}×${i.height_mm} mm): DRC ${i.drc_passed ? "passed" : "failed"}. What would you improve for rev B?` },
  zh: { none: "还没有电路板", hint: "让 Agent 运行 pcb_build，或点「刷新」", top: "顶层", bottom: "底层", refresh: "刷新", parts: "元件", artifacts: "产物",
    rendering: "渲染中…", ask: "让 Agent 评审", open: "在 KiCad 中编辑", opening: "正在打开…", sync: "立即同步", edited: "已在 KiCad 中编辑",
    session: (rel) => `正在 KiCad 中编辑 —— 在 KiCad 里按 ⌘S 保存，这里会自动同步 · ${rel}`, synced: (t) => `上次同步 ${t}`, nolaunch: (n) => `没有启动 KiCad：${n}`,
    askText: (i) => `评审 KiCad 电路板「${i.name}」（${i.width_mm}×${i.height_mm} mm），DRC ${i.drc_passed ? "通过" : "未通过"}。rev B 你会改进什么？` },
};
const isZh = () => (app.getHostContext?.()?.locale || "en").toLowerCase().startsWith("zh");
const t = () => (isZh() ? T.zh : T.en);
initTabs({ app, render: () => render(), zh: isZh, info: () => state.info, tab: () => state.tab, openKicad: () => openInKicad() });

app.ontoolresult = (r) => { const d = json(r); if (d && (d.pcb_artifact_id !== undefined || d.ok === false)) { state.info = d; render(); loadImage(); } };
app.onhostcontextchanged = () => { applyTheme(app); render(); };
app.onteardown = async () => { // the host releases the page: stop its timers (nothing needs saving: the board lives in the plugin server)
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  stopLive();
  return {};
};

async function boot() {
  await app.connect();
  applyTheme(app);
  const saved = app.getHostContext?.()?.["zcode/widgetState"];
  if (saved?.side === "top" || saved?.side === "bottom") state.side = saved.side;
  if (TABS.includes(saved?.tab)) state.tab = saved.tab;
  render();
  startLive();
  setTimeout(() => { if (!state.info) refresh(); }, 400); // opened by hand: no tool result arrives, so ask for the board ourselves
}
boot().catch((e) => { state.err = String(e?.message || e); render(); });

async function saveView() {
  if (!app.getHostCapabilities?.()?.experimental?.["zcode/widgetState"]) return;
  try { await app.request({ method: "ui/set-widget-state", params: { widgetState: { side: state.side, tab: state.tab } } }, EmptyResultSchema); } catch { /* temporary presentation state only */ }
}
/** `share`: the user asked for this (Refresh, top/bottom): then, and only then, the board summary is offered to the next message as context. */
async function refresh({ share = false } = {}) {
  state.busy = true; state.err = null; render();
  try {
    const r = await app.callServerTool({ name: "kicad_board_view", arguments: { side: state.side } });
    state.info = json(r);
    await loadImage();
    if (share && state.info?.ok && app.getHostCapabilities?.()?.updateModelContext) app.updateModelContext({ content: [{ type: "text", text: `KiCad panel: board ${state.info.name} ${state.info.width_mm}x${state.info.height_mm} mm, DRC ${state.info.drc_passed ? "passed" : "FAILED"}, ${state.info.parts?.length ?? 0} parts.` }] })?.catch?.(() => {});
  } catch (e) { state.err = String(e?.message || e); }
  state.busy = false; render();
}
async function loadImage() {
  if (!state.info?.ok) { state.img = null; return render(); }
  try {
    const r = await app.callServerTool({ name: "kicad_board_image", arguments: { side: state.side } });
    const c = (r.content || []).find((x) => x.type === "image");
    state.img = c ? `data:${c.mimeType || "image/png"};base64,${c.data}` : null;
  } catch (e) { state.err = String(e?.message || e); }
  render();
}
// ---- real KiCad GUI: open the board in the PCB Editor, then poll for saves (the server imports each save as a new artifact and runs DRC on it)
let pollTimer = null;
function syncPolling() {
  const active = !!state.info?.edit?.active;
  if (active && !pollTimer) pollTimer = setInterval(pollEdits, 2500);
  if (!active && pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}
async function pollEdits() {
  if (document.hidden || state.busy) return;
  try {
    const r = await app.callServerTool({ name: "kicad_edit_status", arguments: {} });
    const st = json(r);
    if (st?.session && st.changed) { state.note = null; await refresh(); }
  } catch { /* the next tick retries */ }
}
async function openInKicad() {
  state.opening = true; state.err = null; state.note = null; render();
  try {
    const r = await app.callServerTool({ name: "kicad_open_in_kicad", arguments: {} });
    const d = json(r);
    if (!d?.ok) state.err = d?.error || "could not open KiCad";
    else if (!d.launched) state.note = t().nolaunch(d.launch_note);
    await refresh();
  } catch (e) { state.err = String(e?.message || e); }
  state.opening = false; render();
}
async function syncNow() {
  try { const r = await app.callServerTool({ name: "kicad_sync_edits", arguments: {} }); const d = json(r); if (d && !d.ok) state.err = d.error; else await refresh(); } catch (e) { state.err = String(e?.message || e); }
  render();
}

function setSide(side) { state.side = side; saveView(); refresh({ share: true }); }
/** One way to change tab (the header badge and the tab bar). */
function switchTab(id) { state.tab = id; saveView(); render(); }

function render() {
  const i = state.info, L = t();
  syncPolling();
  const canAsk = !!app.getHostCapabilities?.()?.message;
  show(
    h("div", { class: "row" },
      h("div", { class: "title" }, logo(), h("div", {}, h("h1", {}, "KiCad · ", i?.name || L.none), h("div", { class: "mut" }, i?.ok ? `${i.width_mm} × ${i.height_mm} mm · ${i.layers} layers · ${i.parts?.length ?? 0} parts · ${i.nets?.length ?? 0} nets` : (i?.error || L.hint)))),
      h("div", { class: "sp" }),
      i?.ok && liveBadge(() => switchTab("live")),
      i?.ok && i.edited && h("span", { class: "badge warn" }, L.edited),
      i?.ok && h("span", { class: "badge " + (i.drc_passed ? "ok" : "bad") }, i.drc_passed ? `DRC ✓ ${i.drc?.errors ?? 0} errors · ${i.drc?.unconnected ?? 0} unconnected` : `DRC ✗ ${i.drc?.errors ?? "?"} errors · ${i.drc?.unconnected ?? "?"} unconnected`),
      ["top", "bottom"].map((s) => h("button", { "aria-pressed": state.side === s, onclick: () => setSide(s) }, L[s])),
      h("button", { onclick: () => refresh({ share: true }), disabled: state.busy }, state.busy ? "…" : L.refresh),
      i?.ok && h("button", { class: "primary", onclick: openInKicad, disabled: state.opening }, state.opening ? L.opening : L.open),
      i?.ok && canAsk && h("button", { onclick: () => app.sendMessage({ role: "user", content: [{ type: "text", text: L.askText(i) }] }).catch((e) => { state.err = String(e?.message || e); render(); }) }, L.ask)),
    state.err && h("p", { class: "bad" }, state.err),
    state.note && h("p", { class: "warn" }, state.note),
    i?.ok && i.edit?.active && h("div", { class: "banner" }, h("span", { class: "dot live" }), h("span", {}, L.session(i.edit.relative)), i.edit.last_sync_at && h("span", { class: "mut" }, ` · ${L.synced(i.edit.last_sync_at.slice(11, 19))}`),
      h("span", { class: "sp" }), h("button", { onclick: syncNow }, L.sync)),
    i?.ok && tabBar(state.tab, switchTab),
    i?.ok && state.tab === "board" && [
      h("div", { style: { marginTop: "10px" } }, state.img ? h("img", { class: "board", src: state.img, alt: "3D render of the board" }) : h("div", { class: "card mut" }, L.rendering)),
      h("h2", {}, L.parts),
      h("div", { class: "scroll" }, h("table", {}, h("tr", {}, ["ref", "symbol", "value", "x", "y"].map((c) => h("th", {}, c))),
        (i.parts || []).map((p) => h("tr", {}, h("td", { class: "mono" }, p.ref), h("td", { class: "mono" }, p.symbol), h("td", {}, p.value), h("td", {}, p.x_mm), h("td", {}, p.y_mm)))))],
    i?.ok && state.tab === "artifacts" && h("div", { class: "scroll", style: { marginTop: "10px" } }, h("table", {}, (i.artifacts || []).slice().reverse().map((a) => h("tr", {}, h("td", { class: "mono" }, a.artifact_id), h("td", {}, a.kind), h("td", { class: "mono" }, a.name), h("td", { class: "mut" }, `${(a.size / 1024).toFixed(1)} KiB`))))),
    i?.ok && !["board", "artifacts"].includes(state.tab) && h("div", { style: { marginTop: "10px" } }, tabContent(state.tab, i)));
}
