import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { z } from "zod";
import { createKitServer } from "./kit/server-kit.ts";
import { readTable } from "./kit/table.ts";
import { KitError, Workspace } from "./kit/workspace.ts";
import { type AppConfig, type AppSettings, renderApp, staticPreview } from "./app.ts";
import { type DataIssue, type Field, type Mapping, TYPES, inferField, inferMapping, toRecords } from "./schema.ts";

export const NAME = "sheet-to-app";
export const VERSION = "0.1.0";
export const PANEL_URI = `ui://${NAME}/panel.html`;
const STORE = ".sheet-to-app/apps.json";
const MAX_ROWS = 20000;

export interface Project { id: string; source: string; sheet?: string; columns: string[]; mapping: Mapping; settings: AppSettings; out: string; seedVersion?: string; rows?: number; builtAt?: string }
export interface ServerOptions { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }

export const slugify = (s: string) => s.normalize("NFKD").replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 40);
const hasCjk = (s: string) => /[\u3400-\u9fff]/.test(s);

export function createServer(options: ServerOptions) {
  const ws = new Workspace(options.workspaceRoot);
  const { server, tool } = createKitServer({ name: NAME, version: VERSION, panelUri: PANEL_URI, surface: "editor", panelHtml: () => readFile(join(options.assetRoot, "ui/panel.html"), "utf8"), log: options.log });

  const load = async (): Promise<Record<string, Project>> => ((await ws.exists(STORE)) ? JSON.parse(await ws.readText(STORE)).apps ?? {} : {});
  const save = async (apps: Record<string, Project>) => ws.write(STORE, JSON.stringify({ version: 1, apps }, null, 1) + "\n");
  const get = async (id: string) => { const apps = await load(); const p = apps[id]; if (!p) throw new KitError("not_found", `No app “${id}”. Apps: ${Object.keys(apps).join(", ") || "none — use app_new"}.`); return { apps, p }; };

  async function read(p: Pick<Project, "source" | "sheet">) {
    if (!(await ws.exists(p.source))) throw new KitError("not_found", `${p.source} not found.`);
    const t = await readTable(ws, p.source, p.sheet);
    if (t.rows.length > MAX_ROWS) throw new KitError("too_big", `${t.rows.length} rows; this local app keeps data in the browser and handles up to ${MAX_ROWS}.`);
    return t;
  }

  async function build(p: Project, rows: Record<string, string>[]) {
    const { records, issues } = toRecords(p.mapping, rows);
    const fields = p.mapping.fields.filter((f) => !f.hidden);
    const version = createHash("sha1").update(JSON.stringify([fields.map((f) => [f.key, f.type]), records])).digest("hex").slice(0, 12);
    const now = new Date();
    const cfg: AppConfig = { ...p.settings, id: p.id, fields, keyField: p.mapping.keyField, titleField: p.mapping.titleField, source: p.source, generatedAt: now.toISOString() };
    await ws.write(p.out, renderApp(cfg, { version, date: now.toISOString(), rows: records }));
    const changed = p.seedVersion !== undefined && p.seedVersion !== version;
    p.seedVersion = version; p.rows = records.length; p.builtAt = now.toISOString();
    return { cfg, records, issues, changed };
  }

  const describe = (p: Project, issues: DataIssue[], extra: string[] = []) => {
    const m = p.mapping;
    const lines = [
      `App “${p.settings.title}” (${p.id}) → ${p.out} — ${p.rows} row(s) from ${p.source}${p.sheet ? ` [${p.sheet}]` : ""}. Open the file in a browser; edits are saved in that browser (localStorage).`,
      ...extra,
      `Fields:`,
      ...m.fields.map((f) => `  ${f.hidden ? "(hidden) " : ""}${f.column} → ${f.type}${f.required ? ", required" : ""}${f.options ? ` [${f.options.join(" | ")}]` : ""}${f.list ? ", list" : ""}${f.filter ? ", filter" : ""}${f.key === m.keyField ? ", KEY" : ""}${f.key === m.titleField ? ", title" : ""}`),
      `Data issues in the sheet (${issues.length})${issues.length ? ":" : ": none"}`,
      ...issues.slice(0, 40).map((i) => `  row ${i.row}, ${i.column}: “${i.value}” — ${i.message}`),
    ];
    if (issues.length > 40) lines.push(`  … ${issues.length - 40} more`);
    lines.push(`To publish later: upload the ${p.out.replace(/\/index\.html$/, "/")} folder to any static host (e.g. Cloudflare Pages). Data stays per browser either way.`);
    return lines.join("\n");
  };
  const result = async (p: Project, b: Awaited<ReturnType<typeof build>>, extra: string[] = []) => ({
    text: describe(p, b.issues, extra),
    structured: { kind: "app", project: p, issues: b.issues, preview: staticPreview(b.cfg, b.records), apps: Object.values(await load()).map((x) => ({ id: x.id, title: x.settings.title, out: x.out, rows: x.rows })) },
  });

  tool("app_new", {
    description: "Turn a spreadsheet (.xlsx/.csv/.tsv, first row = headers) into a small offline web app: one HTML file with a searchable, filterable, sortable table, add/edit/delete forms with validation, CSV import/export and JSON backup. Infers each column's type (text, longtext, number, money, date, email, phone, url, select, boolean), required fields, select options and a key column, and lists data problems found in the sheet. Writes apps/<id>/index.html and remembers the mapping so app_update / app_refresh can change it.",
    input: {
      source: z.string().describe("Workspace path of the spreadsheet"),
      sheet: z.string().optional().describe("Worksheet name for .xlsx (default: first non-empty)"),
      title: z.string().optional().describe("App title (default: file name)"),
      lang: z.enum(["zh", "en"]).optional().describe("App UI language (default: Chinese if the headers are Chinese)"),
      id: z.string().optional().describe("Short id used for the folder name"),
    },
    openPanel: true,
  }, async (i) => {
    const t = await read(i);
    const title = i.title?.trim() || basename(i.source, extname(i.source));
    const apps = await load();
    let id = slugify(i.id || title) || slugify(basename(i.source, extname(i.source))) || "app";
    if (/^\d*$/.test(id) || id.length < 2) id = `app-${createHash("sha1").update(i.source).digest("hex").slice(0, 6)}`;
    for (let n = 2; apps[id] && apps[id].source !== i.source; n++) id = `${id.replace(/-\d+$/, "")}-${n}`;
    const mapping = inferMapping(t.columns, t.rows);
    const p: Project = { id, source: i.source, sheet: i.sheet ?? (t.sheets.length > 1 ? t.sheet : undefined), columns: t.columns, mapping, settings: { title, lang: i.lang ?? (hasCjk(t.columns.join("")) ? "zh" : "en"), accent: "#2563eb", pageSize: 20 }, out: `apps/${id}/index.html` };
    const b = await build(p, t.rows);
    apps[id] = p; await save(apps);
    return result(p, b, apps[id] && t.sheets.length > 1 ? [`Workbook sheets: ${t.sheets.join(", ")} (used ${t.sheet}).`] : []);
  });

  const fieldPatch = z.object({
    column: z.string().describe("Column name in the sheet"),
    label: z.string().optional(), type: z.enum(TYPES).optional(), required: z.boolean().optional(),
    options: z.array(z.string()).optional().describe("Options for a select field"),
    list: z.boolean().optional().describe("Show as a table column"), filter: z.boolean().optional(), search: z.boolean().optional(), hidden: z.boolean().optional().describe("Leave this column out of the app"),
  });
  tool("app_update", {
    description: "Change an app's field mapping (type, label, required, options, which columns show / filter / search, hide a column, key and title field) and settings (title, language, accent colour, page size, default sort, a highlight rule such as stock <= 5 → 'Low stock'), then rebuild its HTML.",
    input: {
      id: z.string(),
      fields: z.array(fieldPatch).optional(),
      keyField: z.string().optional().describe("Column whose values must be unique ('' for none)"),
      titleField: z.string().optional().describe("Column used as the record title in the edit form"),
      title: z.string().optional(), lang: z.enum(["zh", "en"]).optional(),
      accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), pageSize: z.number().int().min(5).max(200).optional(),
      sort: z.object({ column: z.string(), dir: z.enum(["asc", "desc"]) }).nullable().optional(),
      highlight: z.object({ column: z.string(), op: z.enum(["<=", ">=", "=", "empty"]), value: z.union([z.string(), z.number()]).optional(), label: z.string() }).nullable().optional().describe("Highlight rows matching a rule; null removes it"),
    },
    openPanel: true,
  }, async (i) => {
    const { apps, p } = await get(i.id);
    const byCol = (c: string) => { const f = p.mapping.fields.find((x) => x.column === c || x.key === c || x.label === c); if (!f) throw new KitError("bad_column", `No column “${c}”. Columns: ${p.mapping.fields.map((x) => x.column).join(", ")}`); return f; };
    const changes: string[] = [];
    for (const patch of i.fields ?? []) {
      const f = byCol(patch.column);
      for (const k of ["label", "type", "required", "options", "list", "filter", "search", "hidden"] as const) if (patch[k] !== undefined) { (f as unknown as Record<string, unknown>)[k] = patch[k]; changes.push(`${f.column}.${k}`); }
      if (patch.type && patch.type !== "select" && !patch.options) delete f.options;
      if (patch.type === "select" && !f.options?.length) throw new KitError("bad_options", `Give options for select field ${f.column}.`);
    }
    if (i.keyField !== undefined) p.mapping.keyField = i.keyField ? byCol(i.keyField).key : undefined;
    if (i.titleField !== undefined) p.mapping.titleField = i.titleField ? byCol(i.titleField).key : undefined;
    const s = p.settings;
    if (i.title) s.title = i.title; if (i.lang) s.lang = i.lang; if (i.accent) s.accent = i.accent; if (i.pageSize) s.pageSize = i.pageSize;
    if (i.sort !== undefined) s.sort = i.sort ? { key: byCol(i.sort.column).key, dir: i.sort.dir } : undefined;
    if (i.highlight !== undefined) {
      if (i.highlight === null) delete s.highlight;
      else { const f = byCol(i.highlight.column); if ((i.highlight.op === "<=" || i.highlight.op === ">=") && !(f.type === "number" || f.type === "money")) throw new KitError("bad_rule", `${f.column} is not a number field.`); s.highlight = { key: f.key, op: i.highlight.op, value: i.highlight.value, label: i.highlight.label }; }
    }
    const t = await read(p);
    const b = await build(p, t.rows);
    apps[p.id] = p; await save(apps);
    return result(p, b, [`Updated: ${changes.join(", ") || "settings"}.`]);
  });

  tool("app_refresh", {
    description: "Re-read an app's spreadsheet after it changed and rebuild: keeps your field mapping and settings, adds new columns (type inferred), drops removed ones, and reports the changes and data issues. People who already opened the app see a banner offering to load the new data (their own edits are kept until they choose).",
    input: { id: z.string() }, openPanel: true,
  }, async (i) => {
    const { apps, p } = await get(i.id);
    const t = await read(p);
    const old = new Map(p.mapping.fields.map((f) => [f.column, f]));
    const added = t.columns.filter((c) => !old.has(c)), removed = p.columns.filter((c) => !t.columns.includes(c));
    const used = new Set(p.mapping.fields.map((f) => f.key));
    const fields: Field[] = t.columns.map((c, n) => {
      const f = old.get(c); if (f) return f;
      const nf = inferField(c, t.rows.map((r) => r[c] ?? ""), n);
      let k = nf.key, j = 2; while (used.has(k)) k = `${nf.key}_${j++}`; nf.key = k; used.add(k);
      nf.list = p.mapping.fields.filter((x) => x.list).length < 7 && nf.type !== "longtext";
      return nf;
    });
    p.mapping.fields = fields; p.columns = t.columns;
    const keys = new Set(fields.map((f) => f.key));
    if (p.mapping.keyField && !keys.has(p.mapping.keyField)) p.mapping.keyField = undefined;
    if (p.mapping.titleField && !keys.has(p.mapping.titleField)) p.mapping.titleField = undefined;
    if (p.settings.highlight && !keys.has(p.settings.highlight.key)) delete p.settings.highlight;
    if (p.settings.sort && !keys.has(p.settings.sort.key)) delete p.settings.sort;
    const before = p.rows;
    const b = await build(p, t.rows);
    apps[p.id] = p; await save(apps);
    return result(p, b, [`Refreshed: ${before} → ${p.rows} row(s); new columns: ${added.join(", ") || "none"}; removed columns: ${removed.join(", ") || "none"}; ${b.changed ? "data changed — open copies will offer to load it" : "data unchanged"}.`]);
  });

  tool("app_check", {
    description: "Check an app's spreadsheet against its field mapping without rebuilding: lists rows with missing required values, wrong types (number, date, email, phone, url, yes/no), values outside the select options and duplicate keys, with sheet row numbers.",
    input: { id: z.string() }, readOnly: true,
  }, async (i) => {
    const { p } = await get(i.id);
    const t = await read(p);
    const { issues } = toRecords(p.mapping, t.rows);
    return { text: `${p.source}: ${t.rows.length} row(s), ${issues.length} issue(s).\n${issues.map((x) => `  row ${x.row}, ${x.column}: “${x.value}” — ${x.message}`).join("\n")}`, structured: { issues } };
  });

  tool("app_list", { description: "List the apps made from spreadsheets in this workspace.", input: {}, readOnly: true }, async () => {
    const apps = Object.values(await load());
    return { text: apps.length ? apps.map((p) => `${p.id}: “${p.settings.title}” ← ${p.source} → ${p.out} (${p.rows} rows, built ${p.builtAt})`).join("\n") : "No apps yet.", structured: { apps: apps.map((x) => ({ id: x.id, title: x.settings.title, out: x.out, rows: x.rows })) } };
  });

  tool("app_state", { description: "Panel state for one app (or the list).", input: { id: z.string().optional() }, visibility: ["app"], readOnly: true }, async (i) => {
    const apps = await load();
    const list = Object.values(apps).map((x) => ({ id: x.id, title: x.settings.title, out: x.out, rows: x.rows }));
    const p = i.id ? apps[i.id] : Object.values(apps).sort((a, b) => (b.builtAt ?? "").localeCompare(a.builtAt ?? ""))[0];
    if (!p) return { text: "", structured: { kind: "none", apps: list } };
    const t = await read(p).catch(() => undefined);
    if (!t) return { text: "", structured: { kind: "app", project: p, issues: [], preview: "", apps: list, missing: true } };
    const { records, issues } = toRecords(p.mapping, t.rows);
    const cfg: AppConfig = { ...p.settings, id: p.id, fields: p.mapping.fields.filter((f) => !f.hidden), keyField: p.mapping.keyField, titleField: p.mapping.titleField, source: p.source, generatedAt: p.builtAt ?? "" };
    return { text: "", structured: { kind: "app", project: p, issues, preview: staticPreview(cfg, records), apps: list } };
  });

  tool("app_sheets", { description: "Spreadsheets in the workspace.", input: {}, visibility: ["app"], readOnly: true }, async () => {
    const paths = (await ws.list({ exts: [".xlsx", ".csv", ".tsv"] })).map((f) => f.path).filter((f) => !f.startsWith("apps/"));
    return { text: "", structured: { files: paths.sort() } };
  });
  return server;
}
