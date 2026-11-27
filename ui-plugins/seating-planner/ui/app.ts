import css from "./kit.css";
import appCss from "./app.css";
import { applyTheme, call, h, initHost, locale, onHostContext, onToolResult, put, toast, updateContext } from "./kit.ts";

type L = [string, string];
interface Field { key: string; label: L; type: string; options?: { value: string; label: L }[]; default?: unknown; help?: L; min?: number; max?: number }
interface Column { key: string; label: L; type?: string; options?: string[]; readOnly?: boolean; wide?: boolean }
interface Issue { level: string; message: string; row?: number; key?: string }
interface Info { app: string; prefix: string; title: L; inputs: { exts: string[]; min: number; max: number; label: L; folders?: boolean }; settings: Field[]; exports: { id: string; label: L; description: string }[]; files: string[]; folders: string[]; projects: string[] }
interface View { project: string; inputs: string[]; settings: Record<string, unknown>; columns: Column[]; rows: Record<string, unknown>[]; totalRows: number; canAdd: boolean; issues: Issue[]; summary: string; stats: Record<string, unknown>; preview: string; exported: string[]; justExported?: string[] }

const T = (l: L | undefined) => (l ? (locale() === "zh" ? l[0] : l[1]) : "");
const t = (zh: string, en: string) => (locale() === "zh" ? zh : en);
const PAGE = 100;

export function startApp(name: string, version: string) {
  const style = document.createElement("style");
  style.textContent = css + appCss;
  document.head.append(style);
  const root = document.getElementById("root")!;
  const state: { info?: Info; view?: View; picked: Set<string>; filter: string; page: number; startSettings: Record<string, unknown>; focusRow?: number; mode: "start" | "project" } = { picked: new Set(), filter: "", page: 0, startSettings: {}, mode: "start" };

  async function busy<R>(work: () => Promise<R>, label: string): Promise<R | undefined> {
    root.classList.add("busy");
    const st = document.getElementById("status");
    if (st) st.textContent = label;
    try {
      return await work();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
      return undefined;
    } finally {
      root.classList.remove("busy");
      const s2 = document.getElementById("status");
      if (s2) s2.textContent = "";
    }
  }
  const P = () => state.info?.prefix ?? name;
  function show(v: Record<string, unknown>) {
    const prev = state.view?.project;
    state.view = v as unknown as View;
    state.mode = "project";
    if (prev !== state.view.project) state.page = 0;
    render();
  }
  onToolResult((v) => {
    if (v?.kind === "project" && v.app === name) show(v);
  });

  async function refreshInfo() {
    const info = await call<Info>("app_info", {});
    state.info = info;
    render();
  }

  function fieldInput(f: Field, value: unknown, onChange: (v: unknown) => void) {
    const v = value ?? f.default ?? "";
    if (f.type === "bool") return h("input", { type: "checkbox", checked: !!v, "data-key": f.key, onchange: (e: Event) => onChange((e.target as HTMLInputElement).checked) });
    if (f.type === "select")
      return h("select", { "data-key": f.key, onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value) }, ...(f.options ?? []).map((o) => h("option", { value: o.value, selected: String(v) === o.value }, T(o.label))));
    if (f.type === "textarea") return h("textarea", { rows: 3, "data-key": f.key, value: String(v), onchange: (e: Event) => onChange((e.target as HTMLTextAreaElement).value) });
    return h("input", {
      type: f.type === "number" ? "number" : f.type === "color" ? "color" : f.type === "date" ? "date" : "text",
      "data-key": f.key,
      value: String(v),
      min: f.min,
      max: f.max,
      step: f.type === "number" ? "any" : undefined,
      onchange: (e: Event) => onChange(f.type === "number" ? Number((e.target as HTMLInputElement).value) : (e.target as HTMLInputElement).value),
    });
  }
  function settingsForm(values: Record<string, unknown>, onChange: (key: string, v: unknown) => void) {
    const fields = state.info?.settings ?? [];
    if (!fields.length) return null;
    return h("div", { class: "settings" }, ...fields.map((f) => h("label", { class: `set set-${f.type}`, title: T(f.help) }, h("span", {}, T(f.label)), fieldInput(f, values[f.key], (v) => onChange(f.key, v)))));
  }

  function renderStart() {
    const info = state.info;
    if (!info) return h("div", { class: "empty" }, t("正在连接…", "Connecting…"));
    const list = info.inputs.folders ? info.folders : info.files;
    const shown = list.filter((f) => !state.filter || f.toLowerCase().includes(state.filter.toLowerCase())).slice(0, 400);
    const needs = info.inputs.min;
    const open = () =>
      busy(async () => {
        const r = await call(`${P()}_open`, { inputs: [...state.picked], settings: state.startSettings });
        show(r);
      }, t("正在读取…", "Reading…"));
    return h(
      "div",
      { class: "start" },
      h("div", { class: "card" },
        h("h2", {}, T(info.inputs.label)),
        needs === 0 && !list.length ? h("p", { class: "muted" }, t("这个工具不需要输入文件，直接点“开始”。", "No input file needed — just press Start.")) : null,
        list.length > 8 ? h("input", { class: "filter", placeholder: t("筛选文件…", "Filter files…"), value: state.filter, oninput: (e: Event) => { state.filter = (e.target as HTMLInputElement).value; render(); } }) : null,
        list.length
          ? h("div", { class: "files" }, ...shown.map((f) => h("label", { class: "file" }, h("input", { type: info.inputs.max === 1 ? "radio" : "checkbox", name: "pick", checked: state.picked.has(f), onchange: (e: Event) => { if (info.inputs.max === 1) state.picked.clear(); if ((e.target as HTMLInputElement).checked) state.picked.add(f); else state.picked.delete(f); render(); } }), h("span", {}, f))))
          : needs > 0 ? h("div", { class: "empty" }, t(`工作区里没有 ${info.inputs.exts.join(" / ")} 文件。把文件放进项目文件夹，或让助手帮你处理。`, `No ${info.inputs.exts.join(" / ")} files in the workspace yet. Add some to the project folder or ask the assistant.`)) : null,
      ),
      info.settings.length ? h("div", { class: "card" }, h("h2", {}, t("设置", "Settings")), settingsForm(state.startSettings, (k, v) => { state.startSettings[k] = v; })) : null,
      h("div", { class: "row" },
        h("button", { class: "primary open", disabled: state.picked.size < needs || state.picked.size > info.inputs.max, onclick: open }, needs === 0 && !state.picked.size ? t("开始", "Start") : t(`打开（${state.picked.size}）`, `Open (${state.picked.size})`)),
        h("button", { onclick: () => busy(refreshInfo, "") }, t("刷新文件列表", "Refresh files")),
      ),
      info.projects.length
        ? h("div", { class: "card" }, h("h2", {}, t("已保存的项目", "Saved projects")), h("div", { class: "row" }, ...info.projects.map((p) => h("button", { class: "proj", onclick: () => busy(async () => show(await call(`${P()}_status`, { project: p })), "") }, p))))
        : null,
    );
  }

  let editQueue: Promise<unknown> = Promise.resolve();
  function edit(args: Record<string, unknown>) {
    const v = state.view!;
    editQueue = editQueue
      .then(async () => {
        const r = await call(`${P()}_edit`, { project: v.project, ...args });
        state.view = r as unknown as View;
        renderProjectParts();
      })
      .catch((e) => toast(String((e as Error)?.message ?? e), "error"));
    return editQueue;
  }

  function cell(c: Column, row: Record<string, unknown>, index: number) {
    const value = row[c.key];
    if (c.readOnly) return h("td", { "data-key": c.key, class: `ro ${c.type === "number" ? "num" : ""}` }, typeof value === "number" ? fmtNum(value) : String(value ?? ""));
    const onChange = (v: unknown) => edit({ set: [{ row: index, values: { [c.key]: v } }] });
    let input: HTMLElement;
    if (c.type === "bool") input = h("input", { type: "checkbox", checked: !!value, onchange: (e: Event) => onChange((e.target as HTMLInputElement).checked) });
    else if (c.type === "select") input = h("select", { onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value) }, ...[...new Set([String(value ?? ""), ...(c.options ?? [])])].map((o) => h("option", { value: o, selected: o === String(value ?? "") }, o)));
    else input = h("input", { type: "text", class: c.type === "number" ? "num" : "", value: String(value ?? ""), onchange: (e: Event) => onChange((e.target as HTMLInputElement).value) });
    return h("td", { "data-key": c.key, class: c.wide ? "wide" : "" }, input);
  }
  const fmtNum = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

  function tableEl() {
    const v = state.view!;
    const issuesByRow = new Map<number, Issue[]>();
    for (const i of v.issues) if (i.row !== undefined) issuesByRow.set(i.row, [...(issuesByRow.get(i.row) ?? []), i]);
    const pages = Math.max(1, Math.ceil(v.rows.length / PAGE));
    state.page = Math.min(state.page, pages - 1);
    const start = state.page * PAGE;
    const slice = v.rows.slice(start, start + PAGE);
    if (!v.rows.length) return h("div", { class: "empty" }, t("没有数据行。", "No rows."));
    return h("div", {},
      h("div", { class: "tablewrap" },
        h("table", { class: "data edit" },
          h("thead", {}, h("tr", {}, h("th", {}, "#"), ...v.columns.map((c) => h("th", { class: c.readOnly ? "ro" : "" }, T(c.label))), v.canAdd ? h("th", {}, "") : null)),
          h("tbody", {}, ...slice.map((row, k) => {
            const index = start + k;
            const iss = issuesByRow.get(index);
            return h("tr", { class: `${iss?.some((i) => i.level === "error") ? "err" : iss ? "warn" : ""} ${state.focusRow === index ? "focus" : ""}`, "data-row": index, title: iss?.map((i) => i.message).join("\n") },
              h("td", { class: "idx" }, String(index)), ...v.columns.map((c) => cell(c, row, index)),
              v.canAdd ? h("td", {}, h("button", { class: "del", title: t("删除这一行", "Delete row"), onclick: () => edit({ remove: [index] }) }, "×")) : null);
          })),
        ),
      ),
      h("div", { class: "row" },
        pages > 1 ? h("span", { class: "pager" }, h("button", { disabled: state.page === 0, onclick: () => { state.page--; renderProjectParts(); } }, "‹"), ` ${state.page + 1} / ${pages} `, h("button", { disabled: state.page >= pages - 1, onclick: () => { state.page++; renderProjectParts(); } }, "›")) : null,
        v.totalRows > v.rows.length ? h("span", { class: "muted" }, t(`面板显示前 ${v.rows.length} 行，共 ${v.totalRows} 行`, `Showing ${v.rows.length} of ${v.totalRows} rows`)) : null,
        v.canAdd ? h("button", { class: "add", onclick: () => edit({ add: [{}] }) }, t("＋ 新增一行", "+ Add row")) : null,
      ),
    );
  }

  function issuesEl() {
    const v = state.view!;
    if (!v.issues.length) return h("div", { class: "issues ok" }, h("span", { class: "badge ok" }, t("没有发现问题", "No issues")));
    const counts = { error: 0, warn: 0, info: 0 } as Record<string, number>;
    for (const i of v.issues) counts[i.level] = (counts[i.level] ?? 0) + 1;
    return h("details", { class: "issues", open: v.issues.length <= 12 },
      h("summary", {}, counts.error ? h("span", { class: "badge bad" }, t(`${counts.error} 个错误`, `${counts.error} error(s)`)) : null, " ", counts.warn ? h("span", { class: "badge" }, t(`${counts.warn} 个提醒`, `${counts.warn} warning(s)`)) : null, " ", counts.info ? h("span", { class: "badge ok" }, t(`${counts.info} 条说明`, `${counts.info} note(s)`)) : null),
      h("ul", {}, ...v.issues.slice(0, 200).map((i) => h("li", { class: `lvl-${i.level}`, onclick: () => { if (i.row !== undefined) { state.focusRow = i.row; state.page = Math.floor(i.row / PAGE); renderProjectParts(); document.querySelector(`tr[data-row="${i.row}"]`)?.scrollIntoView({ block: "center" }); } } }, i.row !== undefined ? h("b", {}, `#${i.row} `) : null, i.key ? h("code", {}, i.key) : null, " ", i.message))),
    );
  }

  function exportsEl() {
    const v = state.view!;
    const info = state.info;
    const run = (formats?: string[]) =>
      busy(async () => {
        const r = await call(`${P()}_export`, { project: v.project, ...(formats ? { formats } : {}) }, 900_000);
        state.view = r as unknown as View;
        renderProjectParts();
        toast(t(`已导出 ${state.view.exported.length} 个文件`, `Exported ${state.view.exported.length} file(s)`));
        updateContext(`User exported ${v.project}: ${state.view.exported.join(", ")}`).catch(() => undefined);
      }, t("正在导出…", "Exporting…"));
    return h("div", { class: "card exports" },
      h("h2", {}, t("导出", "Export")),
      h("div", { class: "row" }, ...(info?.exports ?? []).map((e) => h("button", { class: "exp", title: e.description, "data-id": e.id, onclick: () => run([e.id]) }, T(e.label))), (info?.exports.length ?? 0) > 1 ? h("button", { class: "primary expall", onclick: () => run() }, t("全部导出", "Export all")) : null),
      v.exported.length ? h("div", { class: "exported" }, h("div", { class: "muted" }, t("已导出：", "Exported:")), h("ul", {}, ...v.exported.map((f) => h("li", {}, h("code", {}, f))))) : null,
    );
  }

  function renderProjectParts() {
    const v = state.view;
    if (!v) return;
    const parts: Record<string, () => Node | null> = {
      summary: () => h("div", {}, h("div", { class: "summary" }, v.summary), Object.keys(v.stats).length ? h("div", { class: "chips" }, ...Object.entries(v.stats).map(([k, s]) => h("span", { class: "chip" }, h("b", {}, String(s)), " ", k))) : null),
      issues: issuesEl,
      table: tableEl,
      preview: () => (v.preview ? (() => { const d = h("div", { class: "preview" }); d.innerHTML = v.preview; return d; })() : null),
      exports: exportsEl,
    };
    for (const [id, make] of Object.entries(parts)) {
      const el = document.getElementById(`part-${id}`);
      if (el) put(el, make());
    }
  }

  function renderProject() {
    const v = state.view!;
    return h("div", { class: "project" },
      h("div", { class: "row head" },
        h("span", { class: "pname" }, v.project),
        v.inputs.length ? h("span", { class: "muted" }, v.inputs.length > 3 ? t(`${v.inputs.length} 个输入`, `${v.inputs.length} inputs`) : v.inputs.join(" · ")) : null,
        h("button", { class: "back", onclick: () => { state.mode = "start"; busy(refreshInfo, ""); } }, t("← 换文件", "← Other files")),
      ),
      state.info?.settings.length ? h("details", { class: "card", open: true }, h("summary", {}, t("设置", "Settings")), settingsForm(v.settings, (k, val) => edit({ settings: { [k]: val } }))) : null,
      h("div", { id: "part-summary" }),
      h("div", { id: "part-issues" }),
      h("div", { class: "split2" }, h("div", { id: "part-table", class: "tablecol" }), h("div", { id: "part-preview", class: "previewcol" })),
      h("div", { id: "part-exports" }),
    );
  }

  function render() {
    const title = state.info ? T(state.info.title) : name;
    put(root, h("div", { class: "top" }, h("h1", {}, title), h("span", { id: "status", class: "muted" })), state.mode === "project" && state.view ? renderProject() : renderStart());
    if (state.mode === "project") renderProjectParts();
  }

  onHostContext(() => { applyTheme(); render(); });
  render();
  initHost(name, version).then(() => { applyTheme(); refreshInfo().catch((e) => toast(String(e?.message ?? e), "error")); });
}
