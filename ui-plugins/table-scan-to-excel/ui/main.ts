import css from "./kit.css";
import panelCss from "./panel.css";
import { applyTheme, call, h, initHost, locale, onHostContext, onToolResult, sendMessage, toast } from "./kit.ts";
import { cellRef, checkTable, parseNumber, type Issue, type ScanTable } from "../src/check.ts";

const style = document.createElement("style");
style.textContent = css + panelCss;
document.head.append(style);

interface Session { image: string; width: number; height: number; tables: ScanTable[] }
const T = (cn: string, en: string) => (locale() === "zh" ? cn : en);
const state: {
  image?: string;
  width: number;
  height: number;
  src?: string;
  session?: Session;
  tab: number;
  sel?: [number, number];
  dirty: boolean;
  zoom: boolean;
  files?: { path: string; done: boolean }[];
  exported?: string[];
} = { width: 0, height: 0, tab: 0, dirty: false, zoom: false };
const root = document.getElementById("root")!;

async function busy<R>(work: () => Promise<R>): Promise<R | undefined> {
  root.classList.add("busy");
  try {
    return await work();
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), "error");
    return undefined;
  } finally {
    root.classList.remove("busy");
  }
}

async function loadFiles(force = false) {
  if (state.files && !force) return;
  state.files = (await call<{ images: { path: string; done: boolean }[] }>("workspace_files").catch(() => ({ images: [] }))).images;
  render();
}

async function openImage(image: string, session?: Session | null) {
  if (state.dirty && state.image && state.image !== image && !confirm(T("当前修改还没保存，确定切换？", "Discard unsaved edits?"))) return;
  await busy(async () => {
    const view = await call<{ data: string; width: number; height: number; session: Session | null }>("image_view", { image });
    state.image = image;
    state.src = `data:image/jpeg;base64,${view.data}`;
    state.width = view.width;
    state.height = view.height;
    state.session = session ?? view.session ?? undefined;
    state.tab = 0;
    state.sel = undefined;
    state.dirty = false;
    state.exported = undefined;
    render();
  });
}

onToolResult((value) => {
  if (!value) return;
  const kind = value.kind;
  if (kind === "open") void openImage(String(value.image), value.session as Session | null);
  else if (kind === "session" || kind === "saved" || kind === "exported") {
    const s = value.session as Session;
    if (state.image !== s.image) {
      state.image = s.image;
      void openImage(s.image, s);
    } else {
      state.session = s;
      state.dirty = false;
      if (state.tab >= s.tables.length) state.tab = 0;
    }
    if (kind === "exported") state.exported = value.files as string[];
    void loadFiles(true);
    render();
  }
});

const table = () => state.session?.tables[state.tab];
const key = (r: number, c: number) => `${r}:${c}`;
const has = (list: [number, number][], r: number, c: number) => list.some(([a, b]) => a === r && b === c);

function confirmCell(r: number, c: number) {
  const t = table();
  if (!t || has(t.confirmed, r, c)) return;
  t.confirmed.push([r, c]);
  state.dirty = true;
}

async function save() {
  if (!state.session || !state.image) return;
  await busy(async () => {
    await call("table_save", { image: state.image, tables: state.session!.tables });
    state.dirty = false;
    toast(T("已保存", "Saved"));
    render();
  });
}

async function exportAs(format: "xlsx" | "csv") {
  if (!state.session || !state.image) return;
  await busy(async () => {
    const result = await call<{ files: string[]; open: number }>("table_export", { image: state.image, format, tables: state.session!.tables });
    state.dirty = false;
    state.exported = result.files;
    toast(T(`已导出 ${result.files.join("、")}`, `Exported ${result.files.join(", ")}`));
    render();
  });
}

function select(r: number, c: number, focus = true) {
  state.sel = [r, c];
  document.querySelectorAll("td.sel").forEach((el) => el.classList.remove("sel"));
  const td = document.querySelector<HTMLTableCellElement>(`td[data-k="${key(r, c)}"]`);
  td?.classList.add("sel");
  if (focus) td?.querySelector("input")?.focus();
  renderSelection();
  placeHighlight();
}

/** 按表格在原图中的位置，把选中格子大致标出来（行列等分，近似）。 */
function placeHighlight() {
  const hl = document.getElementById("hl");
  const t = table();
  if (!hl || !t?.bounds || !state.sel || !state.width) {
    if (hl) hl.style.display = "none";
    return;
  }
  const [r, c] = state.sel;
  const merge = t.merges.find((m) => m.row === r && m.col === c);
  const rows = t.rows.length;
  const cols = t.rows[0]?.length ?? 1;
  const b = t.bounds;
  const x = b.x + (b.width * c) / cols;
  const y = b.y + (b.height * r) / rows;
  const w = (b.width * (merge?.colSpan ?? 1)) / cols;
  const hh = (b.height * (merge?.rowSpan ?? 1)) / rows;
  Object.assign(hl.style, { display: "block", left: `${(x / state.width) * 100}%`, top: `${(y / state.height) * 100}%`, width: `${(w / state.width) * 100}%`, height: `${(hh / state.height) * 100}%` });
  const box = document.getElementById("imgbox");
  if (box) {
    const top = (y / state.height) * box.scrollHeight - box.clientHeight / 3;
    box.scrollTo({ top: Math.max(0, top), left: Math.max(0, (x / state.width) * box.scrollWidth - box.clientWidth / 3), behavior: "smooth" });
  }
}

function issuesOf(t: ScanTable) {
  return checkTable(t);
}

function renderSelection() {
  const bar = document.getElementById("selbar");
  const t = table();
  if (!bar || !t) return;
  if (!state.sel) {
    bar.replaceChildren(h("span", { class: "muted" }, T("点表格里的格子，左边原图会大致标出它的位置。", "Click a cell to see roughly where it is in the image.")));
    return;
  }
  const [r, c] = state.sel;
  const found = issuesOf(t).filter((i) => i.row === r && i.col === c);
  const value = t.rows[r][c];
  const n = parseNumber(value);
  bar.replaceChildren(
    ...[
    h("b", {}, cellRef(r, c)),
    h("span", { class: "muted" }, n ? T(`数字 ${n.value}`, `number ${n.value}`) : value ? T("文字", "text") : T("空", "empty")),
    ...found.map((i) => h("span", { class: `badge ${i.kind === "total_mismatch" ? "bad" : ""}` }, i.message)),
    has(t.confirmed, r, c) ? h("span", { class: "badge ok" }, T("已确认", "confirmed")) : null,
    found.length
      ? h("button", { onclick: () => { confirmCell(r, c); renderTable(); select(r, c, false); } }, T("确认无误", "Looks right"))
      : null,
    found.length
      ? h("button", { onclick: () => void sendMessage(T(`请再看一下 ${state.image} 里表格「${t.name}」的 ${cellRef(r, c)} 格（现在是“${value}”）：${found.map((i) => i.message).join("；")}。看清楚后用 table_submit 更新。`, `Please look again at cell ${cellRef(r, c)} ("${value}") of table "${t.name}" in ${state.image}: ${found.map((i) => i.message).join("; ")}. Update it with table_submit.`)) }, T("让 Agent 再看", "Ask the agent"))
      : null,
    ].filter((x): x is HTMLElement => !!x),
  );
}

function renderTable() {
  const wrap = document.getElementById("gridwrap");
  const t = table();
  if (!wrap || !t) return;
  const issues = issuesOf(t);
  const kinds = new Map<string, Issue["kind"]>();
  for (const i of issues) if (kinds.get(key(i.row, i.col)) !== "total_mismatch") kinds.set(key(i.row, i.col), i.kind);
  const covered = new Set<string>();
  for (const m of t.merges) for (let r = m.row; r < m.row + m.rowSpan; r++) for (let c = m.col; c < m.col + m.colSpan; c++) if (r !== m.row || c !== m.col) covered.add(key(r, c));
  const cols = t.rows[0]?.length ?? 0;
  const letters = h("tr", { class: "ch" }, h("td", {}), ...Array.from({ length: cols }, (_, c) => h("td", {}, cellRef(0, c).replace(/\d+$/, ""))));
  const body = t.rows.map((row, r) =>
    h(
      "tr",
      {},
      h("td", { class: "rh" }, String(r + 1)),
      ...row.map((value, c) => {
        if (covered.has(key(r, c))) return null;
        const m = t.merges.find((x) => x.row === r && x.col === c);
        const kind = kinds.get(key(r, c));
        const input = h("input", {
          value,
          class: r >= t.headerRows && parseNumber(value) ? "num" : "",
          size: Math.max(4, Math.min(28, [...value].reduce((w, ch) => w + (/[\u2e80-\uffff]/.test(ch) ? 2 : 1), 0) + 1)),
          onfocus: () => select(r, c, false),
          onchange: (e: Event) => {
            t.rows[r][c] = (e.target as HTMLInputElement).value;
            confirmCell(r, c);
            state.dirty = true;
            renderTable();
            renderIssues();
            select(r, c, false);
          },
          onkeydown: (e: KeyboardEvent) => {
            if (e.key === "Enter") {
              (e.target as HTMLInputElement).blur();
              const next = r + (m?.rowSpan ?? 1);
              if (next < t.rows.length) select(next, c);
            }
          },
        });
        return h(
          "td",
          {
            "data-k": key(r, c),
            class: [r < t.headerRows ? "head" : "", kind ?? "", has(t.confirmed, r, c) ? "confirmed" : "", state.sel && state.sel[0] === r && state.sel[1] === c ? "sel" : ""].join(" "),
            rowSpan: m?.rowSpan ?? 1,
            colSpan: m?.colSpan ?? 1,
            title: issues.filter((i) => i.row === r && i.col === c).map((i) => i.message).join("\n") || undefined,
          },
          input,
        );
      }),
    ),
  );
  wrap.replaceChildren(h("table", { class: "cells" }, letters, ...body));
}

function renderIssues() {
  const box = document.getElementById("issues");
  const t = table();
  if (!box || !t) return;
  const issues = issuesOf(t);
  const counts = document.getElementById("counts");
  if (counts) counts.replaceChildren(issues.length ? h("span", { class: "badge" }, T(`${issues.length} 处待核对`, `${issues.length} to check`)) : h("span", { class: "badge ok" }, T("全部核对完", "All checked")));
  box.replaceChildren(
    issues.length
      ? h("ul", {}, ...issues.map((i) => h("li", { onclick: () => select(i.row, i.col) }, h("b", {}, cellRef(i.row, i.col)), " ", i.message)))
      : h("div", { class: "muted" }, T("合计都对得上，没有存疑的格子。可以导出了。", "All totals add up and nothing is flagged — ready to export.")),
  );
}

function render() {
  applyTheme();
  const files = state.files ?? [];
  const picker = h(
    "select",
    { onchange: (e: Event) => void openImage((e.target as HTMLSelectElement).value) },
    h("option", { value: "" }, T("选择表格图片…", "Choose a table image…")),
    ...files.map((f) => h("option", { value: f.path, selected: f.path === state.image }, `${f.done ? "✓ " : ""}${f.path}`)),
  );
  const t = table();
  const toolbar = h(
    "div",
    { class: "toolbar" },
    h("b", {}, T("扫描表格转 Excel", "Table Scan to Excel")),
    picker,
    h("span", { id: "counts" }),
    h("span", { class: "spacer" }),
    state.image && !state.session ? h("button", { class: "primary", onclick: () => void sendMessage(T(`请用 table_scan_open 打开 ${state.image}，识别里面的表格后用 table_submit 提交。`, `Open ${state.image} with table_scan_open, transcribe the table(s) and submit them with table_submit.`)) }, T("让 Agent 识别", "Ask the agent to read it")) : null,
    t ? h("button", { onclick: () => void save(), disabled: !state.dirty }, state.dirty ? T("保存修改", "Save edits") : T("已保存", "Saved")) : null,
    t ? h("button", { onclick: () => void exportAs("csv") }, "CSV") : null,
    t ? h("button", { class: "primary", onclick: () => void exportAs("xlsx") }, T("导出 Excel", "Export Excel")) : null,
  );
  if (!state.image) {
    root.replaceChildren(toolbar, h("div", { class: "empty" }, T("选一张表格照片或扫描件（PNG/JPG），或者在对话里让 Agent 用 table_scan_open 打开。Agent 读出表格后，这里左边是原图、右边是可编辑的表格：存疑的格子标黄，合计对不上的标红，核对后导出 Excel。", "Pick a photo or scan of a table (PNG/JPG), or ask the agent to open one with table_scan_open. After the agent reads it you get the image on the left and an editable table on the right: doubtful cells in yellow, totals that don't add up in red. Then export to Excel.")));
    return;
  }
  const img = h("div", { class: `imgwrap ${state.zoom ? "zoom" : ""}` }, h("img", { src: state.src, alt: state.image }), h("div", { class: "hl", id: "hl", style: { display: "none" } }));
  const left = h("div", {}, h("div", { class: "row small" }, h("span", { class: "muted" }, `${state.width}×${state.height}`), h("button", { onclick: () => { state.zoom = !state.zoom; render(); } }, state.zoom ? T("缩小", "Fit") : T("放大", "Zoom")), t?.bounds ? h("span", { class: "muted" }, T("橙框为大致位置", "orange box = approximate position")) : null), h("div", { class: "imgbox", id: "imgbox" }, img));
  let right: HTMLElement;
  if (!state.session || !t) {
    right = h("div", { class: "empty" }, T("这张图还没识别。点上方“让 Agent 识别”，Agent 会读图并把表格提交到这里。", "Not transcribed yet. Click “Ask the agent to read it” — the agent reads the image and submits the table here."));
  } else {
    right = h(
      "div",
      {},
      state.session.tables.length > 1 ? h("div", { class: "tabs" }, ...state.session.tables.map((x, i) => h("button", { class: i === state.tab ? "on" : "", onclick: () => { state.tab = i; state.sel = undefined; render(); } }, x.name))) : null,
      h(
        "div",
        { class: "row small" },
        h("label", {}, T("工作表名", "Sheet name"), h("input", { type: "text", value: t.name, onchange: (e: Event) => { t.name = (e.target as HTMLInputElement).value.slice(0, 31) || t.name; state.dirty = true; render(); } })),
        h("label", {}, T("表头行数", "Header rows"), h("input", { type: "number", min: 0, max: t.rows.length, value: t.headerRows, style: { width: "56px" }, onchange: (e: Event) => { t.headerRows = Math.max(0, Math.min(t.rows.length, Number((e.target as HTMLInputElement).value) || 0)); state.dirty = true; render(); } })),
        h("span", { class: "muted" }, T(`${t.rows.length} 行 × ${t.rows[0]?.length ?? 0} 列，${t.merges.length} 处合并`, `${t.rows.length} rows × ${t.rows[0]?.length ?? 0} cols, ${t.merges.length} merged`)),
      ),
      h("div", { class: "selbar", id: "selbar" }),
      h("div", { class: "gridwrap", id: "gridwrap" }),
      h("div", { class: "issues", id: "issues" }),
      state.exported ? h("div", { class: "card small" }, T("已导出：", "Exported: "), state.exported.join(T("、", ", ")), T("。仍存疑的格子在 Excel 里有底色和批注。", " — cells still flagged keep a colour and a comment in Excel.")) : null,
    );
  }
  root.replaceChildren(toolbar, h("div", { class: "layout" }, left, right));
  renderTable();
  renderIssues();
  renderSelection();
  if (state.sel) placeHighlight();
}

onHostContext(() => render());
render();
void initHost("table-scan-to-excel", "0.1.0").then(() => loadFiles());
