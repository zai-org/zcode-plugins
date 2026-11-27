import { createApp, esc, toCsv, type AppDef, type Column, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { writeXlsx } from "./kit/sheet.ts";
import { KitError } from "./kit/workspace.ts";
import { EMAIL, looksDate, looksEmail, looksPhone, normDate, PHONE, readForm, type FieldInfo } from "./forms.ts";

export const NAME = "pdf-form-collector";
export const VERSION = "0.1.0";
const s = (v: unknown) => String(v ?? "").trim();
type Meta = { fields: FieldInfo[]; files: { path: string; fields: string[]; error?: string; encrypted?: boolean }[] };
const key = (i: number) => `f${i}`;

function requiredSet(p: Pick<Project, "settings" | "meta">) {
  const meta = p.meta as Meta;
  const extra = s(p.settings.required).split(/[,，、;\n]/).map((x) => x.trim()).filter(Boolean);
  const set = new Set<string>();
  for (const f of meta.fields) if ((p.settings.useFormRequired !== false && f.required) || extra.includes(f.name) || extra.includes(f.label)) set.add(f.name);
  return set;
}

type Problem = { row: number; col: number; kind: "missing" | "invalid" | "absent"; msg: string };
function check(p: Pick<Project, "rows" | "settings" | "meta">) {
  const meta = p.meta as Meta;
  const req = requiredSet(p);
  const probs: Problem[] = [];
  const issues: Issue[] = [];
  const keyField = s(p.settings.keyField) || meta.fields.find(looksEmail)?.name || meta.fields.find((f) => f.type === "text")?.name || "";
  const kIdx = meta.fields.findIndex((f) => f.name === keyField || f.label === keyField);
  const seen = new Map<string, number>();
  p.rows.forEach((r, i) => {
    if (r.include === false) return;
    const file = meta.files.find((f) => f.path === s(r.file));
    if (file?.error) { issues.push({ level: "error", row: i, message: `${s(r.file)}: can't open (${file.error}) / 无法打开` }); return; }
    if (file && !file.fields.length) { issues.push({ level: "warn", row: i, message: `${s(r.file)} has no fillable fields — scanned or flattened? / 没有可填写的表单字段` }); return; }
    meta.fields.forEach((f, c) => {
      const v = r[key(c)];
      const present = !file || file.fields.includes(f.name) || r._manual === true;
      if (!present) { probs.push({ row: i, col: c, kind: "absent", msg: `${f.label}: not in this version of the form` }); return; }
      const empty = f.type === "checkbox" ? v !== true : f.type === "signature" ? v !== true : !s(v);
      if (req.has(f.name) && empty) { probs.push({ row: i, col: c, kind: "missing", msg: `${f.label}: ${f.type === "checkbox" ? "not ticked" : f.type === "signature" ? "not signed" : "missing"}` }); return; }
      if (f.type === "text" && s(v)) {
        if (looksEmail(f) && !EMAIL.test(s(v))) probs.push({ row: i, col: c, kind: "invalid", msg: `${f.label}: “${s(v)}” isn't an email address` });
        else if (looksPhone(f) && !PHONE.test(s(v))) probs.push({ row: i, col: c, kind: "invalid", msg: `${f.label}: “${s(v)}” doesn't look like a phone number` });
        else if (looksDate(f) && !normDate(s(v))) probs.push({ row: i, col: c, kind: "invalid", msg: `${f.label}: “${s(v)}” isn't a date` });
      }
      if ((f.type === "radio" || f.type === "dropdown") && s(v) && f.options.length && !f.options.includes(s(v))) probs.push({ row: i, col: c, kind: "invalid", msg: `${f.label}: “${s(v)}” isn't one of ${f.options.join(" / ")}` });
    });
    if (kIdx >= 0) {
      const kv = s(r[key(kIdx)]).toLowerCase();
      if (kv) { if (seen.has(kv)) issues.push({ level: "warn", row: i, message: `${s(r.file)} has the same ${meta.fields[kIdx].label} as ${s(p.rows[seen.get(kv)!].file)} — resubmitted? Untick include on the old one / 疑似重复提交` }); else seen.set(kv, i); }
    }
  });
  const byRow = new Map<number, Problem[]>();
  for (const pr of probs) byRow.set(pr.row, [...(byRow.get(pr.row) ?? []), pr]);
  for (const [row, ps] of byRow) {
    const miss = ps.filter((x) => x.kind === "missing"), bad = ps.filter((x) => x.kind === "invalid");
    if (miss.length) issues.push({ level: "warn", row, key: key(miss[0].col), message: `${s(p.rows[row].file)}: ${miss.map((x) => x.msg).join("; ")} / 必填项缺失` });
    if (bad.length) issues.push({ level: "warn", row, key: key(bad[0].col), message: `${s(p.rows[row].file)}: ${bad.map((x) => x.msg).join("; ")} / 内容格式不对` });
  }
  return { issues, probs, keyField: kIdx >= 0 ? meta.fields[kIdx].label : "" };
}

function cellOut(f: FieldInfo, v: unknown, p: Pick<Project, "settings">) {
  if (f.type === "checkbox" || f.type === "signature") { const yes = v === true; const st = s(p.settings.boolStyle) || "zh"; return st === "tf" ? yes : st === "en" ? (yes ? "Yes" : "No") : yes ? "是" : "否"; }
  const t = String(v ?? "");
  if (p.settings.normalizeDates !== false && f.type === "text" && looksDate(f)) return normDate(t) ?? t;
  if (f.type === "text" && looksEmail(f)) return t.trim().toLowerCase();
  return t;
}

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "formcollect",
  title: ["PDF 表单汇总", "PDF Form Collector"],
  openDescription:
    "Collect the answers from many filled-in PDF forms (AcroForm: text boxes, checkboxes, radio buttons, dropdowns, list boxes, signature fields) into one table. Columns are the form's fields in order, labelled with each field's tooltip when it has one; forms from different versions are merged and fields a file doesn't have are marked. One row per PDF: include, file, then one column per field (editable, so you can fix typos), status. Flags required fields left empty (the form's own required flags plus settings.required), unticked required checkboxes, unsigned signatures, malformed emails/phones/dates, values not among a dropdown's options, duplicate submissions (same keyField, default the email field) and PDFs with no fillable fields (scanned or flattened) or that can't be opened. Settings: required (extra field names), useFormRequired, keyField, boolStyle (是/否, Yes/No, TRUE/FALSE), normalizeDates (→ YYYY-MM-DD), includeFile (file name column in the export). Exports responses.xlsx (missing cells yellow, invalid cells red, with notes; plus a Fields sheet with fill rates) and responses.csv.",
  inputs: { exts: [".pdf"], min: 1, max: 2000, folders: true, label: ["选择填好的 PDF 表单或文件夹", "Pick filled PDF forms or a folder"] },
  settings: [
    { key: "required", label: ["额外的必填字段（字段名，逗号分隔）", "Extra required fields (comma-separated)"], type: "text", default: "" },
    { key: "useFormRequired", label: ["使用表单自带的必填标记", "Use the form's own required flags"], type: "bool", default: true },
    { key: "keyField", label: ["判断重复提交的字段（留空=邮箱）", "Duplicate check field (empty = email)"], type: "text", default: "" },
    { key: "boolStyle", label: ["复选框写成", "Checkboxes as"], type: "select", default: "zh", options: [{ value: "zh", label: ["是 / 否", "是 / 否"] }, { value: "en", label: ["Yes / No", "Yes / No"] }, { value: "tf", label: ["TRUE / FALSE", "TRUE / FALSE"] }] },
    { key: "normalizeDates", label: ["日期统一为 YYYY-MM-DD", "Dates as YYYY-MM-DD"], type: "bool", default: true },
    { key: "includeFile", label: ["导出时包含文件名列", "File name column in export"], type: "bool", default: true },
  ],
  columns: (p) => {
    const meta = (p.meta ?? { fields: [] }) as Meta;
    return [
      { key: "include", label: ["包含", "Include"], type: "bool" },
      { key: "file", label: ["文件", "File"], readOnly: true },
      ...meta.fields.map((f, i): Column => ({ key: key(i), label: [f.label, f.label], ...(f.type === "checkbox" ? { type: "bool" as const } : f.type === "signature" ? { type: "bool" as const, readOnly: true } : (f.type === "radio" || f.type === "dropdown") && f.options.length ? { type: "select" as const, options: ["", ...f.options] } : {}), wide: f.type === "text" && /notes?|备注|comment|说明|地址|address/i.test(`${f.name} ${f.label}`) })),
      { key: "status", label: ["状态", "Status"], readOnly: true },
    ] as Column[];
  },
  onCellEdit: (row, k) => { if (/^f\d+$/.test(k)) row._edits = [...new Set([...((row._edits as string[]) ?? []), k])]; },
  async load({ ws, files, previous }) {
    const list: string[] = [];
    for (const f of files) {
      if (f.toLowerCase().endsWith(".pdf")) list.push(f);
      else for (const x of await ws.list({ dir: f, exts: [".pdf"], limit: 5000 })) list.push(x.path);
    }
    const uniq = [...new Set(list)].filter((f) => f.replace(/^\.?\/+/, "").split("/")[0] !== NAME).sort((a, b) => a.localeCompare(b, "en"));
    if (!uniq.length) throw new KitError("no_files", "No PDF files found.");
    const meta: Meta = { fields: [], files: [] };
    const reads: { path: string; values: Record<string, string | boolean> }[] = [];
    for (const f of uniq) {
      const r = await readForm(new Uint8Array(await ws.read(f, 100 * 1024 * 1024)));
      for (const fi of r.fields) { const ex = meta.fields.find((x) => x.name === fi.name); if (!ex) meta.fields.push(fi); else { ex.required ||= fi.required; for (const o of fi.options) if (!ex.options.includes(o)) ex.options.push(o); if (ex.label === ex.name && fi.label !== fi.name) ex.label = fi.label; } }
      meta.files.push({ path: f, fields: r.fields.map((x) => x.name), error: r.error, encrypted: r.encrypted });
      reads.push({ path: f, values: r.values });
    }
    if (!meta.fields.length) throw new KitError("no_fields", "None of these PDFs has fillable form fields (they may be scanned or flattened).");
    // 同名标签加字段名区分
    const labels = new Map<string, number>(); for (const f of meta.fields) labels.set(f.label, (labels.get(f.label) ?? 0) + 1);
    for (const f of meta.fields) if ((labels.get(f.label) ?? 0) > 1) f.label = `${f.label} (${f.name})`;
    const prev = new Map((previous ?? []).map((r) => [s(r.file), r]));
    const rows: Row[] = reads.map((rd) => {
      const row: Row = { include: true, file: rd.path };
      meta.fields.forEach((f, i) => { const v = rd.values[f.name]; row[key(i)] = f.type === "checkbox" || f.type === "signature" ? v === true : typeof v === "string" ? v : ""; });
      const filled = meta.fields.some((f, i) => (f.type === "checkbox" ? row[key(i)] === true : s(row[key(i)]) !== ""));
      if (!filled) { row.include = false; row._blank = true; }
      const o = prev.get(rd.path);
      if (o) { row.include = o.include; for (const k of (o._edits as string[]) ?? []) row[k] = o[k]; row._edits = o._edits; }
      return row;
    });
    return { rows, meta };
  },
  compute(p): Computed {
    const meta = p.meta as Meta;
    const { issues, probs, keyField } = check(p);
    const inc = p.rows.filter((r) => r.include !== false);
    const blanks = p.rows.filter((r) => r._blank === true).length;
    if (blanks) issues.push({ level: "info", message: `${blanks} PDF(s) with nothing filled in (blank template?) left out — tick include to keep them / 空白表单未计入` });
    const rows = p.rows.map((r, i) => {
      const ps = probs.filter((x) => x.row === i);
      const st = r.include === false ? (r._blank ? "blank 空白" : "excluded") : ps.some((x) => x.kind === "missing") ? `missing ${ps.filter((x) => x.kind === "missing").length} 缺 ${ps.filter((x) => x.kind === "missing").length} 项` : ps.some((x) => x.kind === "invalid") ? "check 待核对" : "complete 完整";
      return { ...r, status: st };
    });
    const complete = (rows as Row[]).filter((r) => r.include !== false && String(r.status).startsWith("complete")).length;
    const fill = meta.fields.map((f, c) => { const n = inc.filter((r) => (f.type === "checkbox" || f.type === "signature" ? r[key(c)] === true : s(r[key(c)]) !== "")).length; return { f, n }; });
    const preview = `<table class="data"><tr><th>字段 Field</th><th>类型 Type</th><th>必填 Req.</th><th>已填 Filled</th></tr>${fill.map(({ f, n }) => `<tr><td>${esc(f.label)}</td><td class="muted">${f.type}</td><td>${requiredSet(p).has(f.name) ? "✓" : ""}</td><td><div style="display:flex;align-items:center;gap:6px"><div style="width:80px;height:8px;background:#e5e7eb;border-radius:4px"><div style="width:${inc.length ? Math.round((n / inc.length) * 80) : 0}px;height:8px;background:${n === inc.length ? "#16a34a" : "#f59e0b"};border-radius:4px"></div></div>${n}/${inc.length}</div></td></tr>`).join("")}</table>${keyField ? `<p class="muted">Duplicate check: ${esc(keyField)}</p>` : ""}`;
    return {
      rows,
      issues,
      summary: `${inc.length} form(s), ${meta.fields.length} field(s): ${complete} complete, ${inc.length - complete} need a look. 共 ${inc.length} 份表单，${complete} 份完整。`,
      stats: { forms: inc.length, fields: meta.fields.length, complete, missing: new Set(probs.filter((x) => x.kind === "missing" && p.rows[x.row].include !== false).map((x) => x.row)).size, invalid: probs.filter((x) => x.kind === "invalid" && p.rows[x.row].include !== false).length, blank: blanks },
      preview,
    };
  },
  exports: [
    {
      id: "xlsx", label: ["Excel 汇总", "Excel workbook"], description: "responses.xlsx — one row per form; missing required cells yellow, invalid cells red, each with a note; plus a Fields sheet",
      async run({ project, write }: ExportCtx) {
        const meta = project.meta as Meta;
        const { probs } = check(project);
        const withFile = project.settings.includeFile !== false;
        const idx = project.rows.map((r, i) => ({ r, i })).filter(({ r }) => r.include !== false);
        const off = withFile ? 1 : 0;
        const marks = probs.filter((x) => x.kind !== "absent").map((x) => ({ row: idx.findIndex((y) => y.i === x.row), col: x.col + off, color: x.kind === "missing" ? "#FDE68A" : "#FECACA", note: x.msg })).filter((m) => m.row >= 0);
        const inc = idx.map(({ r }) => r);
        const buf = await writeXlsx([
          { name: "Responses", headers: [...(withFile ? ["File"] : []), ...meta.fields.map((f) => f.label)], rows: inc.map((r) => [...(withFile ? [s(r.file).split("/").pop()] : []), ...meta.fields.map((f, c) => cellOut(f, r[key(c)], project))]), marks },
          { name: "Fields", headers: ["Field name", "Label", "Type", "Required", "Options", "Filled", "Of"], rows: meta.fields.map((f, c) => [f.name, f.label, f.type, requiredSet(project).has(f.name) ? "yes" : "", f.options.join(" / "), inc.filter((r) => (f.type === "checkbox" || f.type === "signature" ? r[key(c)] === true : s(r[key(c)]) !== "")).length, inc.length]) },
        ]);
        return [await write("responses.xlsx", buf)];
      },
    },
    {
      id: "csv", label: ["CSV", "CSV"], description: "responses.csv — same columns as the Responses sheet",
      async run({ project, write }: ExportCtx) {
        const meta = project.meta as Meta;
        const withFile = project.settings.includeFile !== false;
        const inc = project.rows.filter((r) => r.include !== false);
        return [await write("responses.csv", toCsv([...(withFile ? ["File"] : []), ...meta.fields.map((f) => f.label)], inc.map((r) => [...(withFile ? [s(r.file).split("/").pop()] : []), ...meta.fields.map((f, c) => { const v = cellOut(f, r[key(c)], project); return typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : v; })])))];
      },
    },
  ],
  describeRow: (r, i) => `#${i}${r.include === false ? " [excluded]" : ""} ${s(r.file)} ${Object.entries(r).filter(([k]) => /^f\d+$/.test(k)).map(([k, v]) => `${k}=${typeof v === "boolean" ? (v ? "✓" : "✗") : JSON.stringify(v)}`).join(" ")} [${s(r.status)}]`,
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
