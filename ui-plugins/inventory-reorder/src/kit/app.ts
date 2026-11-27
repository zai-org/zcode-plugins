import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { createKitServer } from "./server-kit.ts";
import { KitError, safeFileName, Workspace } from "./workspace.ts";

/** 双语文案：[中文, English]。 */
export type L = [string, string];
export type Row = Record<string, unknown>;

export interface Field {
  key: string;
  label: L;
  type: "text" | "number" | "bool" | "select" | "color" | "textarea" | "date";
  options?: { value: string; label: L }[];
  default?: unknown;
  help?: L;
  min?: number;
  max?: number;
  /** 改了需要重新读取输入文件。 */
  reload?: boolean;
}

export interface Column {
  key: string;
  label: L;
  type?: "text" | "number" | "bool" | "select" | "date";
  options?: string[];
  readOnly?: boolean;
  wide?: boolean;
}

export interface Issue {
  level: "error" | "warn" | "info";
  message: string;
  row?: number;
  key?: string;
}

export interface Project {
  name: string;
  inputs: string[];
  settings: Record<string, unknown>;
  rows: Row[];
  meta: Record<string, unknown>;
  exported?: string[];
  created: string;
  updated: string;
}

export interface Computed {
  /** 与 project.rows 一一对应（同顺序），可附加只读的计算列。 */
  rows?: Row[];
  issues?: Issue[];
  summary: string;
  /** 面板预览：由插件生成、已转义的 HTML（可含 data: 图片）。 */
  preview?: string;
  stats?: Record<string, number | string>;
}

export interface AppCtx {
  ws: Workspace;
  assetRoot: string;
  log: (line: string) => void;
}

export interface ExportCtx extends AppCtx {
  project: Project;
  computed: Computed;
  outDir: string;
  /** 写入导出目录下的文件，返回工作区相对路径。 */
  write: (name: string, data: Uint8Array | string) => Promise<string>;
}

export interface ExportDef {
  id: string;
  label: L;
  description: string;
  run: (ctx: ExportCtx) => Promise<string[] | { files: string[]; note?: string }>;
  /** 不包含在“全部导出”里，只有点名时才运行（例如撤销）。 */
  manual?: boolean;
}

export interface AppDef {
  name: string;
  version: string;
  /** 工具名前缀，例如 "invoice" → invoice_open。 */
  prefix: string;
  title: L;
  /** invoice_open 的说明（给 Agent 看）。 */
  openDescription: string;
  inputs: { exts: string[]; min: number; max: number; label: L; folders?: boolean };
  settings: Field[];
  columns: (project: Project) => Column[];
  load: (ctx: AppCtx & { files: string[]; settings: Record<string, unknown>; previous?: Row[] }) => Promise<{ rows: Row[]; meta?: Record<string, unknown> }>;
  compute: (project: Project, ctx: AppCtx) => Promise<Computed> | Computed;
  exports: ExportDef[];
  /** 允许在面板 / 工具里新增行时的空白行。 */
  newRow?: (project: Project) => Row;
  /** 行描述（给 Agent 的文字列表），默认取前几列。 */
  describeRow?: (row: Row, index: number) => string;
  /** 单元格被用户/助手改过之后调用（例如把来源标成“手动”）。 */
  onCellEdit?: (row: Row, key: string) => void;
}

const MAX_ROWS_PANEL = 3000;

export function coerceSettings(fields: Field[], input: Record<string, unknown> | undefined, base: Record<string, unknown> = {}) {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    let value = input && field.key in input ? input[field.key] : field.key in base ? base[field.key] : field.default;
    if (value === undefined || value === null) {
      if (field.default !== undefined) out[field.key] = field.default;
      continue;
    }
    if (field.type === "number") {
      const n = typeof value === "number" ? value : Number(String(value).trim());
      if (!Number.isFinite(n)) throw new KitError("bad_setting", `${field.key} must be a number (got ${JSON.stringify(value)}).`);
      value = Math.min(field.max ?? Infinity, Math.max(field.min ?? -Infinity, n));
    } else if (field.type === "bool") value = value === true || value === "true" || value === 1 || value === "1" || value === "yes";
    else if (field.type === "select") {
      value = String(value);
      if (field.options && !field.options.some((o) => o.value === value)) throw new KitError("bad_setting", `${field.key} must be one of ${field.options.map((o) => o.value).join(", ")} (got ${value}).`);
    } else value = String(value);
    out[field.key] = value;
  }
  return out;
}

/**
 * 把 _edit 里的列名解析成列 key：先精确匹配 key，再精确匹配中/英文标题，
 * 最后忽略大小写和空白再比一次；行里已有的字段名也算。找不到返回 undefined。
 */
export function resolveColumnKey(cols: Column[], name: string, row?: Row): string | undefined {
  if (cols.some((c) => c.key === name)) return name;
  const exact = cols.find((c) => c.label[0] === name || c.label[1] === name);
  if (exact) return exact.key;
  const norm = (x: string) => x.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
  const n = norm(name);
  const loose = cols.find((c) => norm(c.key) === n || norm(c.label[0]) === n || norm(c.label[1]) === n);
  if (loose) return loose.key;
  if (row && Object.prototype.hasOwnProperty.call(row, name)) return name;
  return undefined;
}

export function coerceCell(column: Column | undefined, value: unknown): unknown {
  if (!column) return value;
  if (column.type === "number") {
    if (value === "" || value === null || value === undefined) return "";
    const n = typeof value === "number" ? value : Number(String(value).replace(/[,，\s]/g, ""));
    return Number.isFinite(n) ? n : String(value);
  }
  if (column.type === "bool") return value === true || value === "true" || value === 1 || value === "1" || value === "yes";
  return value === null || value === undefined ? "" : String(value);
}

const stem = (path: string) => (path.split("/").pop() ?? path).replace(/\.[^.]+$/, "");

export function createApp(def: AppDef, options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  const ws = new Workspace(options.workspaceRoot);
  const log = options.log ?? (() => undefined);
  const ctx: AppCtx = { ws, assetRoot: options.assetRoot, log };
  const PANEL_URI = `ui://${def.name}/panel.html`;
  const { server, tool } = createKitServer({
    name: def.name,
    version: def.version,
    panelUri: PANEL_URI,
    surface: "editor",
    panelHtml: () => readFile(join(options.assetRoot, "ui/panel.html"), "utf8"),
    log,
  });
  const P = def.prefix;
  const projectPath = (name: string) => `${def.name}/${safeFileName(name, "project")}.project.json`;
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const job = queue.catch(() => undefined).then(work);
    queue = job;
    return job;
  };

  async function loadProject(name: string): Promise<Project> {
    if (!name) throw new KitError("missing_project", "Pass `project` (from the open result).");
    const path = projectPath(name);
    if (!(await ws.exists(path))) throw new KitError("no_project", `No project named "${name}". Open input files first with ${P}_open.`);
    return JSON.parse(await ws.readText(path)) as Project;
  }
  async function saveProject(project: Project) {
    project.updated = new Date().toISOString();
    await ws.write(projectPath(project.name), JSON.stringify(project, null, 1) + "\n");
  }
  async function listProjects() {
    const files = await ws.list({ dir: def.name, exts: [".json"], recursive: false, limit: 500 }).catch(() => []);
    return files.map((f) => f.path).filter((p) => p.endsWith(".project.json")).map((p) => p.split("/").pop()!.replace(/\.project\.json$/, ""));
  }

  async function view(project: Project, extra: Record<string, unknown> = {}) {
    const computed = await def.compute(project, ctx);
    const columns = def.columns(project);
    const rows = computed.rows ?? project.rows;
    return {
      computed,
      structured: {
        kind: "project",
        app: def.name,
        project: project.name,
        inputs: project.inputs,
        settings: project.settings,
        columns,
        rows: rows.slice(0, MAX_ROWS_PANEL),
        totalRows: rows.length,
        canAdd: !!def.newRow,
        issues: (computed.issues ?? []).slice(0, 500),
        summary: computed.summary,
        stats: computed.stats ?? {},
        preview: computed.preview ?? "",
        exported: project.exported ?? [],
        ...extra,
      },
    };
  }
  function describe(project: Project, computed: Computed, limit = 25) {
    const rows = computed.rows ?? project.rows;
    const cols = def.columns(project);
    const line = def.describeRow ?? ((row: Row, i: number) => `#${i} ` + cols.slice(0, 5).map((c) => `${c.key}=${String(row[c.key] ?? "").slice(0, 40)}`).join(" · "));
    const issues = computed.issues ?? [];
    return [
      `Project "${project.name}" (${project.inputs.join(", ") || "no input files"}): ${computed.summary}`,
      issues.length ? `Issues (${issues.length}):\n` + issues.slice(0, 30).map((x) => `- [${x.level}]${x.row !== undefined ? ` row #${x.row}` : ""}${x.key ? ` ${x.key}` : ""}: ${x.message}`).join("\n") + (issues.length > 30 ? `\n… ${issues.length - 30} more in the panel.` : "") : "No issues found.",
      rows.length ? `Rows (${rows.length}):\n` + rows.slice(0, limit).map((r, i) => line(r, i)).join("\n") + (rows.length > limit ? `\n… ${rows.length - limit} more rows in the panel.` : "") : "",
      `Exports: ${def.exports.map((e) => `${e.id} (${e.description})`).join("; ")}. Edit with ${P}_edit, export with ${P}_export.`,
    ].filter(Boolean).join("\n\n");
  }

  const settingsDoc = def.settings.map((f) => `${f.key} (${f.type}${f.options ? `: ${f.options.map((o) => o.value).join("|")}` : ""}${f.default !== undefined ? `, default ${JSON.stringify(f.default)}` : ""})${f.help ? ` — ${f.help[1]}` : ""}`).join("; ");

  tool(
    `${P}_open`,
    {
      description: `${def.openDescription} Opens the editing panel. Settings: ${settingsDoc || "none"}. Re-opening the same project name replaces its rows with a fresh read of the inputs.`,
      input: {
        inputs: z.array(z.string()).describe(`Workspace-relative input paths (${def.inputs.exts.join(", ")}${def.inputs.folders ? " or folders" : ""}); ${def.inputs.min}–${def.inputs.max} item(s).`),
        settings: z.record(z.string(), z.unknown()).optional(),
        project: z.string().optional().describe("Project name (default: first input's file name)."),
      },
      openPanel: true,
      timeoutMs: 600_000,
    },
    (args) =>
      serial(async () => {
        const inputs: string[] = args.inputs ?? [];
        if (inputs.length < def.inputs.min) throw new KitError("missing_input", `Pass at least ${def.inputs.min} input file(s) (${def.inputs.exts.join(", ")}).`);
        if (inputs.length > def.inputs.max) throw new KitError("too_many_inputs", `At most ${def.inputs.max} input(s).`);
        for (const i of inputs) ws.resolve(i);
        const name = safeFileName(args.project || (inputs[0] ? stem(inputs[0]) : def.name), "project");
        const settings = coerceSettings(def.settings, args.settings);
        const loaded = await def.load({ ...ctx, files: inputs, settings });
        const now = new Date().toISOString();
        const project: Project = { name, inputs, settings, rows: loaded.rows, meta: loaded.meta ?? {}, created: now, updated: now };
        await saveProject(project);
        const v = await view(project);
        return { text: describe(project, v.computed), structured: v.structured };
      }),
  );

  tool(
    `${P}_edit`,
    {
      description: `Change a ${def.name} project: update settings, set cell values by row index (from ${P}_open / ${P}_status), add rows${def.newRow ? "" : " (not supported here)"} or remove rows. Changes are saved; returns the updated summary and issues.`,
      input: {
        project: z.string(),
        settings: z.record(z.string(), z.unknown()).optional(),
        set: z.array(z.object({ row: z.number().int().min(0), values: z.record(z.string(), z.unknown()) })).optional(),
        add: z.array(z.record(z.string(), z.unknown())).optional(),
        remove: z.array(z.number().int().min(0)).optional(),
      },
      timeoutMs: 600_000,
    },
    (args) =>
      serial(async () => {
        const project = await loadProject(args.project);
        const notes: string[] = [];
        if (args.settings) {
          const next = coerceSettings(def.settings, args.settings, project.settings);
          const reload = def.settings.some((f) => f.reload && JSON.stringify(next[f.key]) !== JSON.stringify(project.settings[f.key]));
          project.settings = next;
          if (reload) {
            const loaded = await def.load({ ...ctx, files: project.inputs, settings: next, previous: project.rows });
            project.rows = loaded.rows;
            project.meta = loaded.meta ?? project.meta;
            notes.push("Inputs re-read with the new settings (row edits were reset).");
          }
        }
        const cols = def.columns(project);
        const byKey = new Map(cols.map((c) => [c.key, c]));
        const unknown = new Set<string>();
        for (const s of args.set ?? []) {
          const row = project.rows[s.row];
          if (!row) { notes.push(`Row #${s.row} does not exist.`); continue; }
          for (const [name, v] of Object.entries(s.values)) {
            const k = resolveColumnKey(cols, name, row);
            if (k === undefined) { unknown.add(name); continue; }
            const c = byKey.get(k);
            if (c?.readOnly) { notes.push(`${k} is calculated and cannot be edited.`); continue; }
            row[k] = coerceCell(c, v);
            def.onCellEdit?.(row, k);
          }
        }
        if (args.add?.length) {
          if (!def.newRow) throw new KitError("no_add", "This tool does not support adding rows.");
          for (const a of args.add) {
            const row = def.newRow(project);
            for (const [name, v] of Object.entries(a)) {
              const k = resolveColumnKey(cols, name, row);
              if (k === undefined) { unknown.add(name); continue; }
              row[k] = coerceCell(byKey.get(k), v);
            }
            project.rows.push(row);
          }
        }
        if (unknown.size) notes.push(`Warning: ignored unknown column(s) ${[...unknown].map((u) => `“${u}”`).join(", ")}. Use a column key or its label: ${cols.map((c) => `${c.key} (${c.label[0]} / ${c.label[1]})`).join(", ")}.`);
        if (args.remove?.length) {
          const drop = new Set(args.remove);
          project.rows = project.rows.filter((_, i) => !drop.has(i));
        }
        await saveProject(project);
        const v = await view(project);
        return { text: [notes.join(" "), describe(project, v.computed, 10)].filter(Boolean).join("\n\n"), structured: v.structured };
      }),
  );

  tool(
    `${P}_status`,
    { description: `Show a ${def.name} project's rows, issues and summary (no changes).`, input: { project: z.string(), limit: z.number().int().min(1).max(500).optional() }, readOnly: true },
    async (args) => {
      const project = await loadProject(args.project);
      const v = await view(project);
      return { text: describe(project, v.computed, args.limit ?? 50), structured: v.structured };
    },
  );

  tool(
    `${P}_export`,
    {
      description: `Write the finished files for a ${def.name} project into ${def.name}/<project>/ in the workspace. Formats: ${def.exports.map((e) => `"${e.id}" — ${e.description}`).join("; ")}.`,
      input: { project: z.string(), formats: z.array(z.enum(def.exports.map((e) => e.id) as [string, ...string[]])).optional().describe("Default: all formats except manual ones (e.g. undo).") },
      timeoutMs: 900_000,
    },
    (args) =>
      serial(async () => {
        const project = await loadProject(args.project);
        const computed = await def.compute(project, ctx);
        if ((computed.issues ?? []).some((i) => i.level === "error") && !def.exports.length) throw new KitError("has_errors", "Fix the errors first.");
        const outDir = `${def.name}/${safeFileName(project.name, "project")}`;
        const ids = args.formats?.length ? args.formats : def.exports.filter((e) => !e.manual).map((e) => e.id);
        const files: string[] = [];
        const notes: string[] = [];
        for (const id of ids) {
          const ex = def.exports.find((e) => e.id === id)!;
          const result = await ex.run({ ...ctx, project, computed, outDir, write: (n, d) => ws.write(`${outDir}/${n}`, d) });
          if (Array.isArray(result)) files.push(...result);
          else { files.push(...result.files); if (result.note) notes.push(result.note); }
        }
        project.exported = files;
        await saveProject(project);
        const v = await view(project, { justExported: files });
        const errors = (computed.issues ?? []).filter((i) => i.level === "error").length;
        return {
          text: `Exported ${files.length} file(s):\n${files.map((f) => `- ${f}`).join("\n")}${notes.length ? `\n${notes.join("\n")}` : ""}${errors ? `\nNote: ${errors} error(s) are still open in the project.` : ""}`,
          structured: v.structured,
        };
      }),
  );

  tool(
    "app_info",
    { description: "Panel bootstrap: tool definition, workspace files and saved projects.", input: {}, visibility: ["app"], readOnly: true },
    async () => {
      const files = (await ws.list({ exts: def.inputs.exts, limit: 3000 })).map((f) => f.path).filter((p) => !p.startsWith(`${def.name}/`));
      const folders = def.inputs.folders ? [...new Set(files.map((f) => f.split("/").slice(0, -1).join("/") || "."))].sort() : [];
      return {
        text: "",
        structured: {
          kind: "info",
          app: def.name,
          prefix: P,
          title: def.title,
          inputs: def.inputs,
          settings: def.settings,
          exports: def.exports.map((e) => ({ id: e.id, label: e.label, description: e.description })),
          files,
          folders,
          projects: await listProjects(),
        },
      };
    },
  );

  return { server, ws, PANEL_URI };
}

/** HTML 转义。 */
export const esc = (value: unknown) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** 简单 HTML 表格（用于预览与报告）。 */
export function htmlTable(headers: string[], rows: unknown[][], cls = "data") {
  return `<table class="${cls}"><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

/** 独立 HTML 报告页。 */
export function htmlPage(title: string, body: string, extraCss = "") {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{font:14px/1.5 -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;max-width:1100px;margin:24px auto;padding:0 16px;color:#1d1f23}table{border-collapse:collapse;width:100%;margin:8px 0 16px}td,th{border:1px solid #ddd;padding:4px 8px;text-align:left;vertical-align:top}th{background:#f5f5f7}.num{text-align:right}h1{font-size:20px}h2{font-size:16px;margin-top:24px}.muted{color:#6b7280}${extraCss}</style></head><body>${body}</body></html>`;
}

/** CSV（带 BOM，Excel 打开中文不乱码）。 */
export function toCsv(headers: string[], rows: unknown[][]) {
  const cell = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "\uFEFF" + [headers, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
