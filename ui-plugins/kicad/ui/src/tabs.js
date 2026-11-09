// Tabs of the KiCad panel next to the real KiCad windows: Layers, 3D, Schematic, Checks, Library (Board and Artifacts are drawn by main.js).
// Everything comes from app-only tools of the plugin server (kicad-cli, headless); each tab loads lazily and keeps what it drew, keyed by the board artifact id, so a
// save in KiCad (a new artifact) refreshes the tabs and a re-render never redraws a big image. DOM nodes that hold state (layer stack, inputs) are created once and re-attached.
import { h, json, text } from "./dom.js";

export const TABS = ["board", "live", "layers", "3d", "schematic", "checks", "library", "artifacts"];
let ctx = null; // { app, render, info(), tab(), zh() }
export const initTabs = (c) => { ctx = c; };

const T = {
  en: { board: "Board", live: "Live", layers: "Layers", "3d": "3D", schematic: "Schematic", checks: "Checks", library: "Library", artifacts: "Artifacts",
    loading: "loading…", all: "All", none: "None", defaults: "Default", mirror: "Mirror (view from below)", layerHint: "SVG per layer from kicad-cli; the colours are KiCad's default theme.",
    views: { iso: "Iso", iso_rear: "Iso rear", top: "Top", bottom: "Bottom", front: "Front", side: "Side" }, view3dHint: "Pre-rendered views (kicad-cli pcb render), not an interactive viewer. For a 3D mesh with a part table ask the agent for pcb_export_glb.",
    zoomIn: "Zoom in", zoomOut: "Zoom out", fit: "Fit", refresh: "Refresh", noSch: "No schematic", sheet: "Sheet",
    drc: "DRC", erc: "ERC", errors: "errors", warnings: "warnings", unconnected: "unconnected", passed: "passed", failed: "failed", noViolations: "No violations.",
    ercNone: "No schematic in the edit project, so there is nothing to run ERC on.", ercRan: (p) => `ERC of ${p}`, location: "at", positions: "board mm",
    search: "Search symbols and footprints, e.g. ne555, 0603 resistor, ldo 3.3v", kindBoth: "Both", kindSymbol: "Symbols", kindFootprint: "Footprints", go: "Search",
    symbols: "Symbols", footprints: "Footprints", pins: "Pins", defaultFp: "Default footprint", pick: "Pick a symbol or footprint to see its drawing.", noHits: "Nothing found.", unit1: "unit 1 shown",
    drawing: "drawing…", failedTo: "Could not load",
    liveOn: "Live", liveOther: "Live: other board", liveOff: "Live off", liveTitleOn: (n) => `Connected to the running KiCad PCB Editor: ${n}`, liveStatusTitle: "Live link to KiCad",
    liveOffNote: "Everything else in this panel and the ⌘S round trip keep working without the live link.", liveCounts: (c) => `${c.footprints} parts · ${c.tracks} tracks · ${c.vias} vias · ${c.zones} zones · ${c.nets} nets`,
    liveWatching: (n, t) => `${n} in KiCad · updated ${t} · checked every 1.5 s, no ⌘S needed`, liveSelected: "Selected in KiCad", liveNone: "nothing", liveDelta: "Δ since opened", liveBase: "Set baseline now",
    liveNets: "Nets", liveParts: "Parts", footprint: "footprint", value: "value", side: "side", rot: "rot", unsaved: "These are the editor's current values, saved or not: ⌘S in KiCad writes them to the file, and only then does the panel import them (new board artifact + DRC).",
    truncated: (n) => `Showing the first ${n} parts.` },
  zh: { board: "电路板", live: "实时", layers: "图层", "3d": "3D", schematic: "原理图", checks: "检查", library: "元件库", artifacts: "产物",
    loading: "加载中…", all: "全部", none: "无", defaults: "默认", mirror: "镜像（从背面看）", layerHint: "每层一张 kicad-cli 导出的 SVG，颜色为 KiCad 默认主题。",
    views: { iso: "斜视", iso_rear: "斜视（后）", top: "顶视", bottom: "底视", front: "正视", side: "侧视" }, view3dHint: "预渲染视图（kicad-cli pcb render），不是可交互的查看器。需要 3D 网格和元件表请让 Agent 调用 pcb_export_glb。",
    zoomIn: "放大", zoomOut: "缩小", fit: "适应", refresh: "刷新", noSch: "没有原理图", sheet: "图页",
    drc: "DRC", erc: "ERC", errors: "错误", warnings: "警告", unconnected: "未连接", passed: "通过", failed: "未通过", noViolations: "没有违规项。",
    ercNone: "编辑工程里没有原理图，无可运行 ERC。", ercRan: (p) => `ERC：${p}`, location: "位置", positions: "板上 mm",
    search: "搜索符号和封装，例如 ne555、0603 resistor、ldo 3.3v", kindBoth: "全部", kindSymbol: "符号", kindFootprint: "封装", go: "搜索",
    symbols: "符号", footprints: "封装", pins: "引脚", defaultFp: "默认封装", pick: "选一个符号或封装查看图形。", noHits: "没有结果。", unit1: "仅显示单元 1",
    drawing: "绘制中…", failedTo: "无法加载",
    liveOn: "实时", liveOther: "实时：另一块板", liveOff: "实时未连接", liveTitleOn: (n) => `已连接正在运行的 KiCad PCB 编辑器：${n}`, liveStatusTitle: "与 KiCad 的实时连接",
    liveOffNote: "面板里的其他功能和 ⌘S 往返不受影响，没有实时连接也能用。", liveCounts: (c) => `${c.footprints} 个元件 · ${c.tracks} 条走线 · ${c.vias} 个过孔 · ${c.zones} 个铜区 · ${c.nets} 个网络`,
    liveWatching: (n, t) => `KiCad 中的 ${n} · 更新于 ${t} · 每 1.5 秒检查一次，无需 ⌘S`, liveSelected: "KiCad 中选中的对象", liveNone: "无", liveDelta: "打开以来的变化 Δ", liveBase: "现在设为基准",
    liveNets: "网络", liveParts: "元件", footprint: "封装", value: "值", side: "面", rot: "角度", unsaved: "这里显示的是编辑器当前的值，无论是否已保存：在 KiCad 里按 ⌘S 才会写入文件，之后面板才会导入（新的板子产物 + DRC）。",
    truncated: (n) => `只显示前 ${n} 个元件。` },
};
const tr = () => (ctx.zh() ? T.zh : T.en);
const rerender = () => ctx.render();
const call = (name, args) => ctx.app.callServerTool({ name, arguments: args });
const svgUri = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
const errText = (e) => String(e?.message || e);
const tool = async (name, args) => { const r = await call(name, args); const d = json(r); if (d && d.ok === false) throw new Error(d.error || `${name} failed`); return { r, d }; };
const colorOf = (svg) => (svg.match(/(?:fill|stroke):\s*(#[0-9a-fA-F]{6})/g) || []).map((m) => m.slice(-7)).find((c) => c !== "#000000") || "#888888";

export function tabBar(active, onPick) {
  const L = tr();
  return h("div", { class: "tabs", role: "tablist" }, TABS.map((id) => h("button", { role: "tab", class: "tab", "aria-selected": active === id, onclick: () => onPick(id) }, L[id])));
}

// ------------------------------------------------------------------------------------------------------------------------------ Layers
const lay = { forId: null, info: null, on: new Set(), mirror: false, svgs: {}, imgs: {}, busy: new Set(), err: null, stack: null };
async function fetchLayer(id) {
  if (lay.svgs[id] || lay.busy.has(id)) return;
  const forId = lay.forId;
  lay.busy.add(id); rerender();
  try {
    const { r } = await tool("kicad_layer_svg", { layer: id, artifact_id: forId });
    if (lay.forId !== forId) return;
    const svg = text(r) || "";
    lay.svgs[id] = svg;
    lay.imgs[id] = h("img", { class: "layer", alt: id, src: svgUri(svg) });
    lay.color = { ...lay.color, [id]: colorOf(svg) };
  } catch (e) { if (lay.forId === forId) lay.err = errText(e); }
  lay.busy.delete(id); rerender();
}
async function loadLayers(info) {
  Object.assign(lay, { forId: info.pcb_artifact_id, info: null, svgs: {}, imgs: {}, busy: new Set(), err: null, color: {} });
  lay.stack = null;
  try {
    const { d } = await tool("kicad_layers", {});
    if (lay.forId !== info.pcb_artifact_id) return;
    lay.info = d;
    if (!lay.on.size) lay.on = new Set(d.layers.filter((l) => l.default).map((l) => l.id));
    lay.on.forEach(fetchLayer);
  } catch (e) { lay.err = errText(e); }
  rerender();
}
function layersTab(info) {
  const L = tr();
  if (lay.forId !== info.pcb_artifact_id) loadLayers(info);
  if (!lay.info) return [lay.err ? h("p", { class: "bad" }, lay.err) : h("div", { class: "card mut" }, L.loading)];
  const ids = lay.info.layers.map((l) => l.id);
  if (!lay.stack) lay.stack = h("div", { class: "stack", style: { aspectRatio: `${lay.info.width_mm || 34} / ${lay.info.height_mm || 22}` } });
  lay.stack.replaceChildren(...ids.filter((id) => lay.imgs[id]).map((id) => { lay.imgs[id].style.display = lay.on.has(id) ? "" : "none"; return lay.imgs[id]; }));
  lay.stack.style.transform = lay.mirror ? "scaleX(-1)" : "";
  const toggle = (id) => { if (lay.on.has(id)) lay.on.delete(id); else { lay.on.add(id); fetchLayer(id); } rerender(); };
  const setAll = (set) => { lay.on = new Set(set); lay.on.forEach(fetchLayer); rerender(); };
  return [
    h("div", { class: "split" },
      h("div", { class: "lyrs" },
        h("div", { class: "row" },
          h("button", { onclick: () => setAll(lay.info.layers.filter((l) => l.default).map((l) => l.id)) }, L.defaults), h("button", { onclick: () => setAll(ids) }, L.all), h("button", { onclick: () => setAll([]) }, L.none)),
        [...lay.info.layers].reverse().map((l) => h("label", { class: "lyr" },
          h("input", { type: "checkbox", checked: lay.on.has(l.id), onchange: () => toggle(l.id), "aria-label": l.id }),
          h("span", { class: "sw", style: { background: lay.color?.[l.id] || "transparent" } }), h("span", {}, l.label), h("span", { class: "mono mut" }, lay.busy.has(l.id) ? "…" : l.id))),
        h("label", { class: "lyr mirror" }, h("input", { type: "checkbox", checked: lay.mirror, onchange: () => { lay.mirror = !lay.mirror; rerender(); }, "aria-label": "mirror" }), h("span", {}, L.mirror))),
      h("div", { class: "stagewrap" }, lay.stack)),
    lay.err && h("p", { class: "bad" }, lay.err), h("p", { class: "mut small" }, L.layerHint)];
}

// ------------------------------------------------------------------------------------------------------------------------------ 3D
const v3 = { forId: null, view: "iso", imgs: {}, busy: new Set(), err: null };
async function fetchView(view) {
  if (v3.imgs[view] || v3.busy.has(view)) return;
  const forId = v3.forId;
  v3.busy.add(view); rerender();
  try {
    const { r } = await tool("kicad_3d_image", { view, artifact_id: forId });
    if (v3.forId !== forId) return;
    const c = (r.content || []).find((x) => x.type === "image");
    if (!c) throw new Error(text(r) || "no image");
    v3.imgs[view] = `data:${c.mimeType || "image/png"};base64,${c.data}`;
  } catch (e) { if (v3.forId === forId) v3.err = errText(e); }
  v3.busy.delete(view); rerender();
}
function view3dTab(info) {
  const L = tr();
  if (v3.forId !== info.pcb_artifact_id) { Object.assign(v3, { forId: info.pcb_artifact_id, imgs: {}, busy: new Set(), err: null }); fetchView(v3.view); }
  const img = v3.imgs[v3.view];
  return [h("div", { class: "row" }, Object.keys(L.views).map((v) => h("button", { "aria-pressed": v3.view === v, onclick: () => { v3.view = v; v3.err = null; fetchView(v); rerender(); } }, L.views[v]))),
    h("div", { style: { marginTop: "10px" } }, img ? h("img", { class: "board", src: img, alt: `3D ${v3.view}` }) : v3.err ? h("p", { class: "bad" }, v3.err) : h("div", { class: "card mut" }, L.loading)),
    h("p", { class: "mut small" }, L.view3dHint)];
}

// ------------------------------------------------------------------------------------------------------------------------------ Schematic
const sch = { forId: null, data: null, svg: null, img: null, zoom: 1, busy: false, err: null };
async function loadSchematic(sheet = "") {
  const forId = sch.forId;
  sch.busy = true; sch.err = null; rerender();
  try {
    const { r, d } = await tool("kicad_schematic", { sheet });
    if (sch.forId !== forId) return;
    sch.data = d;
    sch.svg = d.exists ? text(r) : null;
    sch.img = sch.svg ? h("img", { class: "sch", alt: d.sheet || "schematic", src: svgUri(sch.svg) }) : null;
  } catch (e) { sch.err = errText(e); }
  sch.busy = false; rerender();
}
function schematicTab(info) {
  const L = tr();
  if (sch.forId !== info.pcb_artifact_id) { Object.assign(sch, { forId: info.pcb_artifact_id, data: null, svg: null, img: null, err: null }); loadSchematic(); }
  const d = sch.data;
  if (sch.err) return [h("p", { class: "bad" }, sch.err), h("button", { onclick: () => loadSchematic() }, L.refresh)];
  if (!d) return [h("div", { class: "card mut" }, L.loading)];
  if (!d.exists) return [h("div", { class: "card empty" }, h("strong", {}, L.noSch), h("p", { class: "mut" }, d.message), h("button", { onclick: () => loadSchematic(), disabled: sch.busy }, sch.busy ? "…" : L.refresh))];
  if (sch.img) sch.img.style.width = `${Math.round(sch.zoom * 100)}%`;
  return [h("div", { class: "row" }, h("span", { class: "mono mut" }, d.path),
      (d.sheets || []).length > 1 && h("select", { "aria-label": L.sheet, onchange: (e) => loadSchematic(e.target.value) }, d.sheets.map((s) => h("option", { value: s, selected: s === d.sheet }, s))),
      h("span", { class: "sp" }), h("button", { onclick: () => { sch.zoom = Math.max(0.5, sch.zoom / 1.25); rerender(); }, "aria-label": L.zoomOut }, "−"), h("button", { onclick: () => { sch.zoom = 1; rerender(); } }, L.fit),
      h("button", { onclick: () => { sch.zoom = Math.min(8, sch.zoom * 1.25); rerender(); }, "aria-label": L.zoomIn }, "+"), h("button", { onclick: () => loadSchematic(d.sheet), disabled: sch.busy }, sch.busy ? "…" : L.refresh)),
    h("div", { class: "paper scroll-big" }, sch.img)];
}

// ------------------------------------------------------------------------------------------------------------------------------ Checks
const chk = { forId: null, data: null, busy: false, err: null };
async function loadChecks() {
  const forId = chk.forId;
  chk.busy = true; chk.err = null; rerender();
  try {
    const { d } = await tool("kicad_checks", { artifact_id: forId });
    if (chk.forId === forId) chk.data = d;
  } catch (e) { if (chk.forId === forId) chk.err = errText(e); }
  chk.busy = false; rerender();
}
const violationRows = (list) => list.map((v) => h("tr", {}, h("td", { class: v.severity === "error" ? "bad" : "warn" }, v.severity || ""), h("td", { class: "mono" }, v.type || ""), h("td", {}, v.description || ""),
  h("td", { class: "mono mut" }, (v.items || []).map((i) => `${i.what ? i.what + " " : ""}(${i.x_mm}, ${i.y_mm})`).join(" · "))));
function checksTab(info) {
  const L = tr();
  if (chk.forId !== info.pcb_artifact_id) { Object.assign(chk, { forId: info.pcb_artifact_id, data: null, err: null }); loadChecks(); }
  if (chk.err) return [h("p", { class: "bad" }, chk.err), h("button", { onclick: () => loadChecks() }, L.refresh)];
  const d = chk.data;
  if (!d) return [h("div", { class: "card mut" }, L.loading)];
  const drc = d.drc, s = d.schematic || {}, erc = s.erc;
  const table = (cols, rows) => h("div", { class: "scroll" }, h("table", {}, h("tr", {}, cols.map((c) => h("th", {}, c))), rows));
  return [
    h("div", { class: "row" }, h("h2", { style: { margin: 0 } }, L.drc), h("span", { class: "badge " + (drc.passed ? "ok" : "bad") }, `${drc.passed ? L.passed : L.failed} · ${drc.errors} ${L.errors} · ${drc.warnings} ${L.warnings} · ${drc.unconnected} ${L.unconnected}`),
      h("span", { class: "sp" }), h("button", { onclick: () => loadChecks(), disabled: chk.busy }, chk.busy ? "…" : L.refresh)),
    drc.violations.length ? table(["", "type", "", L.positions], violationRows(drc.violations)) : !drc.unconnected_items.length && h("p", { class: "mut" }, L.noViolations),
    drc.unconnected_items.length > 0 && table([L.unconnected, "", L.positions], drc.unconnected_items.map((u) => h("tr", {}, h("td", {}, u.description || ""), h("td", {}), h("td", { class: "mono mut" }, (u.items || []).map((i) => `${i.what ? i.what + " " : ""}(${i.x_mm}, ${i.y_mm})`).join(" · "))))),
    h("div", { class: "row", style: { marginTop: "14px" } }, h("h2", { style: { margin: 0 } }, L.erc),
      erc && h("span", { class: "badge " + (erc.errors ? "bad" : erc.warnings ? "warn" : "ok") }, `${erc.errors} ${L.errors} · ${erc.warnings} ${L.warnings}`), s.path && h("span", { class: "mono mut" }, s.path)),
    !s.exists && h("p", { class: "mut" }, L.ercNone), s.erc_error && h("p", { class: "bad" }, s.erc_error),
    erc && (erc.violations.length ? table(["", "type", "", L.positions], violationRows(erc.violations)) : h("p", { class: "mut" }, L.noViolations))];
}

// ------------------------------------------------------------------------------------------------------------------------------ Library
const lib = { q: "", kind: "both", res: null, busy: false, err: null, sel: null, drawing: null, info: null, input: null };
async function searchLib() {
  lib.q = lib.input?.value ?? lib.q;
  if (!lib.q.trim()) return;
  lib.busy = true; lib.err = null; rerender();
  try { lib.res = (await tool("pcb_search_parts", { query: lib.q.trim(), kind: lib.kind })).d; } catch (e) { lib.err = errText(e); }
  lib.busy = false; rerender();
}
async function pickLib(kind, id) {
  lib.sel = { kind, id }; lib.drawing = null; lib.info = null; lib.err = null; rerender();
  const mine = lib.sel;
  try {
    const { r } = await tool("kicad_library_preview", { kind, lib_id: id });
    if (lib.sel === mine) lib.drawing = h("img", { class: "sch", alt: id, src: svgUri(text(r) || ""), style: { maxHeight: "46vh", width: "100%" } });
  } catch (e) { if (lib.sel === mine) lib.err = `${tr().failedTo} ${id}: ${errText(e)}`; }
  if (lib.sel === mine && kind === "symbol") { try { lib.info = (await tool("pcb_part_info", { symbol: id })).d; } catch { /* the drawing is enough */ } }
  rerender();
}
function libraryTab() {
  const L = tr();
  if (!lib.input) lib.input = h("input", { type: "search", class: "grow", placeholder: L.search, "aria-label": L.search, onkeydown: (e) => { if (e.key === "Enter") searchLib(); } });
  lib.input.placeholder = L.search;
  const pickRow = (kind, x) => h("tr", { class: "pick" + (lib.sel?.id === x.lib_id ? " sel" : ""), onclick: () => pickLib(kind, x.lib_id) }, h("td", { class: "mono" }, x.lib_id), h("td", {}, (x.description || "").slice(0, 110)));
  const sym = lib.info?.symbol;
  return [
    h("div", { class: "row" }, lib.input, ["both", "symbol", "footprint"].map((k) => h("button", { "aria-pressed": lib.kind === k, onclick: () => { lib.kind = k; rerender(); } }, k === "both" ? L.kindBoth : k === "symbol" ? L.kindSymbol : L.kindFootprint)),
      h("button", { class: "primary", onclick: searchLib, disabled: lib.busy }, lib.busy ? "…" : L.go)),
    lib.err && h("p", { class: "bad" }, lib.err),
    h("div", { class: "split lib" },
      h("div", {}, lib.res ? [
        (lib.res.symbols || []).length > 0 && [h("h2", {}, L.symbols), h("div", { class: "scroll" }, h("table", {}, lib.res.symbols.map((x) => pickRow("symbol", x))))],
        (lib.res.footprints || []).length > 0 && [h("h2", {}, L.footprints), h("div", { class: "scroll" }, h("table", {}, lib.res.footprints.map((x) => pickRow("footprint", x))))],
        !(lib.res.symbols || []).length && !(lib.res.footprints || []).length && h("p", { class: "mut" }, L.noHits)].flat() : h("p", { class: "mut" }, L.search)), // h() flattens one level: the groups above are arrays
      h("div", {}, lib.sel ? [h("div", { class: "mono" }, lib.sel.id), h("div", { class: "paper", style: { marginTop: "6px" } }, lib.drawing || h("div", { class: "mut pad" }, L.drawing)),
        lib.sel.kind === "symbol" && h("p", { class: "mut small" }, L.unit1),
        sym && h("div", {}, h("p", {}, sym.description), sym.default_footprint && h("p", {}, `${L.defaultFp}: `, h("a", { class: "mono link", href: "#", onclick: (e) => { e.preventDefault(); pickLib("footprint", sym.default_footprint); } }, sym.default_footprint)),
          h("div", { class: "scroll" }, h("table", {}, h("tr", {}, ["#", L.pins, ""].map((c) => h("th", {}, c))), sym.pins.map((p) => h("tr", {}, h("td", { class: "mono" }, p.number), h("td", {}, p.name), h("td", { class: "mut" }, p.type))))))] : h("p", { class: "mut" }, L.pick)))];
}

// ------------------------------------------------------------------------------------------------------------------------------ Live (running PCB Editor, KiCad API)
// The server reads the editor through KiCad's IPC API; the page only sees board facts (never the socket path or a token). Status every 3 s (cheap), the snapshot every 1.5 s
// while the Live tab is open; an unchanged board answers with its signature only, so nothing is redrawn and almost nothing travels over the bridge.
const live = { st: null, snap: null, sig: "", base: null, busy: false };
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const livePos = (parts) => Object.fromEntries((parts || []).map((p) => [p.ref, [p.x_mm, p.y_mm, p.rotation_deg]]));
async function pollLiveStatus() {
  if (document.hidden || !ctx.info()?.ok) return;
  try {
    const { d } = await tool("kicad_live_status", {});
    if (sameJson(d, live.st)) return;
    live.st = d;
    if (!d.available) Object.assign(live, { snap: null, sig: "", base: null });
    rerender();
  } catch { /* an older server without the live tools: the indicator just stays away */ }
}
async function pollLiveSnapshot() {
  if (document.hidden || ctx.tab() !== "live" || !live.st?.available || live.busy) return;
  live.busy = true;
  try {
    const { d } = await tool("kicad_live_snapshot", { since: live.sig });
    if (d.live === false) { live.st = { ...live.st, available: false, reason: d.reason || live.st.reason }; Object.assign(live, { snap: null, sig: "", base: null }); rerender(); }
    else if (!d.unchanged) {
      live.snap = d; live.sig = d.signature;
      if (!live.base || live.base.board !== d.board?.path) live.base = { board: d.board?.path, pos: livePos(d.parts) };
      rerender();
    }
  } catch { /* the next tick retries */ }
  live.busy = false;
}
let liveTimers = [];
export function startLive() { stopLive(); liveTimers = [setInterval(pollLiveStatus, 3000), setInterval(pollLiveSnapshot, 1500)]; pollLiveStatus(); }
export function stopLive() { liveTimers.forEach(clearInterval); liveTimers = []; }
export function liveBadge(onClick) {
  const L = tr(), st = live.st;
  if (!st) return null;
  const on = st.available, other = st.reachable && st.board && st.board.matches_session === false;
  return h("button", { class: "badge live " + (on ? "ok" : other ? "warn" : "mut"), title: on ? L.liveTitleOn(st.board?.name || "") : st.reason || L.liveStatusTitle, onclick: onClick, "aria-label": L.liveStatusTitle },
    h("span", { class: "dot" + (on ? " live" : "") }), on ? L.liveOn : other ? L.liveOther : L.liveOff);
}
const fmtDelta = (now, base) => {
  if (!base) return "";
  const dx = +(now[0] - base[0]).toFixed(2), dy = +(now[1] - base[1]).toFixed(2), dr = +(((now[2] - base[2] + 540) % 360) - 180).toFixed(1);
  const bits = [];
  if (dx || dy) bits.push(`${dx >= 0 ? "+" : "−"}${Math.abs(dx)}, ${dy >= 0 ? "+" : "−"}${Math.abs(dy)} mm`);
  if (dr) bits.push(`${dr > 0 ? "+" : "−"}${Math.abs(dr)}°`);
  return bits.join(" · ");
};
function liveTab() {
  const L = tr(), st = live.st;
  if (!st) return [h("div", { class: "card mut" }, L.loading)];
  if (!st.available) return [h("div", { class: "card empty" }, h("strong", {}, L.liveOff), h("p", { class: "mut" }, st.reason || L.liveStatusTitle), h("p", { class: "mut small" }, L.liveOffNote),
    h("button", { onclick: pollLiveStatus }, L.refresh))];
  const s = live.snap;
  if (!s) return [h("div", { class: "card mut" }, L.loading)];
  const moved = (p) => fmtDelta([p.x_mm, p.y_mm, p.rotation_deg], live.base?.pos?.[p.ref]);
  const sel = (s.selection || []).map((x) => x.ref || [x.kind, x.pad && `pad ${x.pad}`, x.net && `(${x.net})`].filter(Boolean).join(" "));
  return [
    h("div", { class: "row" }, h("span", { class: "dot live" }), h("span", {}, L.liveWatching(s.board?.name || "", s.read_at || "")), h("span", { class: "sp" }), h("button", { onclick: () => { live.base = { board: s.board?.path, pos: livePos(s.parts) }; rerender(); } }, L.liveBase)),
    h("p", { class: "mut small", style: { margin: "4px 0 8px" } }, L.liveCounts(s.counts)),
    h("div", { class: "card" }, h("strong", {}, `${L.liveSelected}: `), sel.length ? sel.join(", ") + (s.selection_count > sel.length ? ` … (${s.selection_count})` : "") : h("span", { class: "mut" }, L.liveNone)),
    h("h2", {}, L.liveParts),
    h("div", { class: "scroll tall" }, h("table", {}, h("tr", {}, ["ref", L.footprint, L.value, "x", "y", L.rot, L.side, L.liveDelta].map((c) => h("th", {}, c))),
      (s.parts || []).map((p) => { const dl = moved(p); return h("tr", { class: dl ? "moved" : "" }, h("td", { class: "mono" }, p.ref), h("td", { class: "mono" }, p.footprint), h("td", {}, p.value), h("td", {}, p.x_mm), h("td", {}, p.y_mm), h("td", {}, p.rotation_deg), h("td", {}, p.side), h("td", { class: dl ? "warn" : "mut" }, dl)); }))),
    s.parts_truncated && h("p", { class: "mut small" }, L.truncated((s.parts || []).length)),
    h("details", {}, h("summary", {}, `${L.liveNets} (${(s.nets || []).length})`), h("div", { class: "scroll" }, h("table", {}, h("tr", {}, ["net", "pads", "tracks", "vias"].map((c) => h("th", {}, c))),
      (s.nets || []).map((n) => h("tr", {}, h("td", { class: "mono" }, n.name), h("td", {}, n.pads), h("td", {}, n.tracks), h("td", {}, n.vias)))))),
    h("p", { class: "mut small" }, L.unsaved)];
}

// ------------------------------------------------------------------------------------------------------------------------------ entry
export function tabContent(id, info) {
  if (id === "live") return liveTab(info);
  if (id === "layers") return layersTab(info);
  if (id === "3d") return view3dTab(info);
  if (id === "schematic") return schematicTab(info);
  if (id === "checks") return checksTab(info);
  if (id === "library") return libraryTab(info);
  return [];
}
