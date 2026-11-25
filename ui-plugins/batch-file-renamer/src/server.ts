import { createApp, htmlTable, toCsv, type AppDef, type Issue, type Project } from "./kit/app.ts";
import { KitError, type Workspace } from "./kit/workspace.ts";
import { plan, type Rules } from "./rename.ts";

export const NAME = "batch-file-renamer";
export const VERSION = "0.1.0";

const rulesOf = (p: Project): Rules => ({
  find: String(p.settings.find ?? ""), replace: String(p.settings.replace ?? ""), regex: Boolean(p.settings.regex), template: String(p.settings.template || "{name}"),
  start: Number(p.settings.start ?? 1), pad: Number(p.settings.pad ?? 3), case: (p.settings.case as Rules["case"]) ?? "keep", extCase: (p.settings.extCase as Rules["extCase"]) ?? "lower",
  spaces: (p.settings.spaces as Rules["spaces"]) ?? "keep", sort: (p.settings.sort as Rules["sort"]) ?? "name",
});
const filesOf = (p: Project) => p.rows.map((r) => ({ path: String(r.path), mtime: String(r.mtime ?? ""), override: String(r.override ?? "") }));
const existsSync = (p: Project) => new Set((p.meta.others as string[] | undefined ?? []).map((x) => x.toLowerCase()));

const NEUTRAL = { find: "", replace: "", regex: false, template: "{name}", case: "keep", spaces: "keep" };
interface Move { from: string; to: string }
async function moveAll(ws: Workspace, moves: Move[]) {
  const sources = new Set(moves.map((m) => m.from.toLowerCase()));
  for (const m of moves) if (!sources.has(m.to.toLowerCase()) && (await ws.exists(m.to))) throw new KitError("exists", `Target already exists: ${m.to}. Nothing was renamed.`);
  const tag = Date.now().toString(36);
  const staged: (Move & { orig: string })[] = [];
  // 两步改名：先全部改成临时名，避免 a→b、b→a 互换或仅大小写变化时冲突
  for (const [i, m] of moves.entries()) {
    const dir = m.from.includes("/") ? m.from.slice(0, m.from.lastIndexOf("/") + 1) : "";
    const tmp = `${dir}.rename-${tag}-${i}`;
    await ws.move(m.from, tmp);
    staged.push({ from: tmp, to: m.to, orig: m.from });
  }
  const done: (Move & { orig: string })[] = [];
  try {
    for (const m of staged) { await ws.move(m.from, m.to); done.push(m); }
  } catch (e) {
    // 出错时尽量全部还原成原名
    for (const m of done) await ws.move(m.to, m.from).catch(() => undefined);
    for (const m of staged) await ws.move(m.from, m.orig).catch(() => undefined);
    throw e;
  }
}

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "rename",
  title: ["批量重命名", "Batch File Renamer"],
  openDescription:
    "Rename many files in a workspace folder with rules: find/replace (optionally regex), a name template with {name} {n} {date} {parent} {ext}, numbering with start and padding, upper/lower/title case, spaces to dashes/underscores, lower-case extensions, and per-file manual names. Shows old → new for every file, flags duplicate targets, names that clash with other files and illegal characters before anything changes. Export “rename” applies it (two-step, safe for swaps and case-only changes) and writes a log; “undo” reverts the last rename.",
  inputs: { exts: [], min: 1, max: 5, folders: true, label: ["选择要重命名的文件夹", "Pick the folder whose files to rename"] },
  settings: [
    { key: "recursive", label: ["包含子文件夹", "Include subfolders"], type: "bool", default: false, reload: true },
    { key: "only", label: ["只改这些扩展名（逗号分隔，留空=全部）", "Only these extensions (comma-separated, empty = all)"], type: "text", default: "", reload: true },
    { key: "find", label: ["查找", "Find"], type: "text", default: "" },
    { key: "replace", label: ["替换为", "Replace with"], type: "text", default: "" },
    { key: "regex", label: ["用正则表达式", "Regular expression"], type: "bool", default: false, help: ["替换里可用 $1、$2", "Use $1, $2 in the replacement"] },
    { key: "template", label: ["新文件名模板", "Name template"], type: "text", default: "{name}", help: ["{name} 原名（已替换） {n} 序号 {date} 修改日期 {parent} 所在文件夹 {ext} 扩展名", "{name} old name (after replace) {n} number {date} modified date {parent} folder {ext} extension"] },
    { key: "start", label: ["起始序号", "Start number"], type: "number", default: 1, min: 0 },
    { key: "pad", label: ["序号位数", "Number digits"], type: "number", default: 3, min: 1, max: 8 },
    { key: "sort", label: ["编号顺序", "Number in order of"], type: "select", default: "name", options: [{ value: "name", label: ["文件名", "File name"] }, { value: "mtime", label: ["修改时间", "Modified time"] }] },
    { key: "case", label: ["大小写", "Case"], type: "select", default: "keep", options: [{ value: "keep", label: ["不变", "Keep"] }, { value: "lower", label: ["全小写", "lower"] }, { value: "upper", label: ["全大写", "UPPER"] }, { value: "title", label: ["首字母大写", "Title Case"] }] },
    { key: "spaces", label: ["空格", "Spaces"], type: "select", default: "keep", options: [{ value: "keep", label: ["保留（合并连续空格）", "Keep (collapse runs)"] }, { value: "dash", label: ["改成 -", "To -"] }, { value: "underscore", label: ["改成 _", "To _"] }, { value: "remove", label: ["去掉", "Remove"] }] },
    { key: "extCase", label: ["扩展名", "Extension"], type: "select", default: "lower", options: [{ value: "lower", label: ["统一小写", "lower-case"] }, { value: "keep", label: ["不变", "Keep"] }] },
  ],
  columns: () => [
    { key: "path", label: ["当前文件", "Current file"], readOnly: true, wide: true },
    { key: "override", label: ["手动指定新名", "Manual new name"] },
    { key: "_to", label: ["新文件名", "New name"], readOnly: true, wide: true },
    { key: "_state", label: ["状态", "State"], readOnly: true },
  ],
  async load({ ws, files, settings }) {
    const only = String(settings.only ?? "").split(/[,，\s]+/).filter(Boolean).map((e) => (e.startsWith(".") ? e : "." + e).toLowerCase());
    const rows = [];
    const others: string[] = [];
    for (const dir of files) {
      const list = await ws.list({ dir, recursive: Boolean(settings.recursive), limit: 5000 }).catch(() => { throw new KitError("not_found", `Folder not found: ${dir}`); });
      for (const f of list) {
        if (f.path.startsWith(`${NAME}/`)) continue;
        const ext = f.path.slice(f.path.lastIndexOf(".")).toLowerCase();
        if (only.length && !only.includes(ext)) { others.push(f.path); continue; }
        rows.push({ path: f.path, mtime: (await ws.mtime(f.path)).toISOString(), override: "" });
      }
    }
    if (!rows.length) throw new KitError("empty", "No files to rename in that folder.");
    return { rows, meta: { others } };
  },
  compute(p) {
    const others = existsSync(p);
    const planned = plan(filesOf(p), rulesOf(p), (x) => others.has(x.toLowerCase()));
    const issues: Issue[] = [];
    planned.forEach((x, i) => { if (x.error) issues.push({ level: "error", row: i, message: x.error }); });
    const changed = planned.filter((x) => x.changed && !x.error).length;
    const rows = p.rows.map((r, i) => ({ ...r, _to: planned[i].to.split("/").pop(), _state: planned[i].error ? "✗" : planned[i].changed ? "→" : "=" }));
    const last = p.meta.lastRename as Move[] | undefined;
    const preview =
      `<p>${changed} / ${planned.length} files will be renamed${last?.length ? ` · last rename: ${last.length} files (undo available)` : ""}</p>` +
      htmlTable(["Before / 原名", "After / 新名"], planned.filter((x) => x.changed).slice(0, 200).map((x) => [x.from.split("/").pop()!, x.to.split("/").pop()!]));
    return { rows, issues, preview, summary: `${planned.length} files, ${changed} to rename${issues.length ? `, ${issues.length} problem(s)` : ""}`, stats: { files: planned.length, rename: changed, problems: issues.length } };
  },
  exports: [
    {
      id: "plan", label: ["改名清单 CSV", "Plan CSV"], description: "rename-plan.csv with old and new names (changes nothing)",
      async run({ project, write }) {
        const others = existsSync(project);
        const planned = plan(filesOf(project), rulesOf(project), (x) => others.has(x.toLowerCase()));
        return [await write("rename-plan.csv", toCsv(["from", "to", "problem"], planned.map((x) => [x.from, x.to, x.error ?? ""])))];
      },
    },
    {
      id: "rename", label: ["执行改名", "Rename files"], description: "rename the files on disk and write rename-log.csv (undo reverts it)",
      async run({ ws, project, write }) {
        const others = existsSync(project);
        const planned = plan(filesOf(project), rulesOf(project), (x) => others.has(x.toLowerCase()));
        const bad = planned.filter((x) => x.error);
        if (bad.length) throw new KitError("has_errors", `Fix ${bad.length} problem(s) first, e.g. ${bad[0].from}: ${bad[0].error}`);
        const moves = planned.filter((x) => x.changed).map((x) => ({ from: x.from, to: x.to }));
        if (!moves.length) return { files: [], note: "Nothing to rename — every file already has its new name." };
        for (const m of moves) if (!(await ws.exists(m.from))) throw new KitError("not_found", `File moved or deleted since opening: ${m.from}. Reopen the folder.`);
        await moveAll(ws, moves);
        const to = new Map(moves.map((m) => [m.from, m.to]));
        project.rows = project.rows.map((r) => ({ ...r, path: to.get(String(r.path)) ?? r.path, override: "" }));
        project.meta.lastRename = moves;
        // 改完后把规则复位，避免再次套用模板（例如 {n} 重新编号）
        Object.assign(project.settings, NEUTRAL);
        const log = await write(`rename-log-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.csv`, toCsv(["from", "to"], moves.map((m) => [m.from, m.to])));
        return { files: [log], note: `Renamed ${moves.length} file(s). The rules were reset so the new names stay as they are.` };
      },
    },
    {
      id: "undo", manual: true, label: ["撤销上次改名", "Undo last rename"], description: "rename the files from the last “rename” back to their old names",
      async run({ ws, project, write }) {
        const last = project.meta.lastRename as Move[] | undefined;
        if (!last?.length) throw new KitError("nothing_to_undo", "No rename to undo in this project.");
        const back = last.map((m) => ({ from: m.to, to: m.from }));
        for (const m of back) if (!(await ws.exists(m.from))) throw new KitError("not_found", `Can't undo: ${m.from} is gone or was renamed again.`);
        await moveAll(ws, back);
        const to = new Map(back.map((m) => [m.from, m.to]));
        project.rows = project.rows.map((r) => ({ ...r, path: to.get(String(r.path)) ?? r.path }));
        delete project.meta.lastRename;
        Object.assign(project.settings, NEUTRAL);
        return { files: [await write("undo-log.csv", toCsv(["from", "to"], back.map((m) => [m.from, m.to])))], note: `Restored ${back.length} file name(s).` };
      },
    },
  ],
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
