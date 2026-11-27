import { createApp, esc, htmlTable, type AppDef, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { writeXlsx } from "./kit/sheet.ts";
import { KitError } from "./kit/workspace.ts";
import { HEAD_H, layout, parseDdl, ROW_H, type Col, type Table } from "./ddl.ts";
import { svgToPng } from "./png.ts";
import { s } from "./util.ts";

export const NAME = "sql-er-diagram";
export const VERSION = "0.1.0";

/** 近似文字宽度（12px 字号）：中文 12，其它 7。 */
const tw = (t: string, size = 12) => [...t].reduce((a, ch) => a + (/[\u2e80-\uffff]/.test(ch) ? size : size * 0.6), 0);

function tablesOf(p: Project): Table[] {
  const map = new Map<string, Table>();
  const tc = (p.meta.tableComments ?? {}) as Record<string, string>;
  for (const r of p.rows) {
    if (r.include === false) continue;
    const name = s(r.table);
    if (!map.has(name)) map.set(name, { name, comment: tc[name] ?? "", cols: [] });
    map.get(name)!.cols.push({ table: name, name: s(r.column), type: s(r.type), pk: r.pk === true, nullable: r.nullable !== false, unique: r.unique === true, fk: s(r.fk), comment: s(r.comment), def: s(r.def) });
  }
  return [...map.values()];
}

function issuesOf(tables: Table[], p: Project): Issue[] {
  const out: Issue[] = [];
  const names = new Map(tables.map((t) => [t.name, t]));
  for (const w of (p.meta.warnings ?? []) as string[]) out.push({ level: "warn", message: w });
  p.rows.forEach((r, i) => {
    const fk = s(r.fk);
    if (!fk || r.include === false) return;
    const [t, c] = fk.split(".");
    const target = names.get(t);
    if (!target) out.push({ level: "warn", row: i, key: "fk", message: `${s(r.table)}.${s(r.column)} references ${t}, which is not in the schema.` });
    else if (c && !target.cols.some((x) => x.name === c)) out.push({ level: "warn", row: i, key: "fk", message: `${s(r.table)}.${s(r.column)} references ${fk}, but ${t} has no column ${c}.` });
  });
  for (const t of tables) if (!t.cols.some((c) => c.pk)) out.push({ level: "info", message: `Table ${t.name} has no primary key.` });
  return out;
}

export function erSvg(tables: Table[], o: { title: string; perRow: number; types: boolean; color: string; family?: string }) {
  const widthOf = (t: Table) => Math.max(tw(t.name, 13) + 24 + (t.comment ? tw(t.comment) + 10 : 0), ...t.cols.map((c) => 46 + tw(c.name) + (o.types ? tw(c.type) + 24 : 0))) + 16;
  const g = layout(tables, Math.max(1, o.perRow), widthOf);
  const boxes = g.boxes;
  const at = new Map(boxes.map((b) => [b.name, b]));
  const W = Math.max(400, ...boxes.map((b) => b.x + b.w + 50)), H = Math.max(200, ...boxes.map((b) => b.y + b.h + 50));
  const parts: string[] = [];
  const font = o.family ? ` font-family="${esc(o.family)}"` : ` font-family="sans-serif"`;
  if (o.title) parts.push(`<text x="30" y="40" font-size="20" font-weight="700" fill="#111827">${esc(o.title)}</text>`);
  // 正交走线：只走表格之间的空隙（列间竖通道、行间横通道），同一通道里的线错开
  const lane = new Map<string, number>();
  const slot = (k: string) => { const n = lane.get(k) ?? 0; lane.set(k, n + 1); return (n % 2 ? 1 : -1) * Math.ceil(n / 2) * 7; };
  const vx = (col: number, side: 1 | -1) => (side === 1 ? g.colX[col] + g.colW[col] + g.gapX / 2 : g.colX[col] - g.gapX / 2);
  const hy = (row: number, below: boolean) => (below ? g.rowY[row] + g.rowH[row] + g.gapY / 2 : g.rowY[row] - g.gapY / 2);
  const colors = ["#64748b", "#2563eb", "#16a34a", "#ea580c", "#9333ea", "#0891b2", "#db2777"];
  let ei = 0;
  for (const t of tables) for (const [i, c] of t.cols.entries()) {
    if (!c.fk) continue;
    const a = at.get(t.name)!, b = at.get(c.fk.split(".")[0]);
    if (!b) continue;
    const ti = tables.find((x) => x.name === b.name)!.cols.findIndex((x) => x.name === c.fk.split(".")[1]);
    const y1 = a.y + HEAD_H + i * ROW_H + ROW_H / 2, y2 = b.y + (ti >= 0 ? HEAD_H + ti * ROW_H + ROW_H / 2 : HEAD_H / 2);
    const col = colors[ei++ % colors.length];
    let pts: [number, number][];
    if (b === a) { const x = a.x + a.w, k = slot(`v${a.col}+`); pts = [[x, y1], [x + 18 + k, y1], [x + 18 + k, y2], [x, y2]]; }
    else if (a.col === b.col) { const x = a.x + a.w, cx = vx(a.col, 1) + slot(`v${a.col}+`); pts = [[x, y1], [cx, y1], [cx, y2], [b.x + b.w, y2]]; }
    else {
      const side: 1 | -1 = b.col > a.col ? 1 : -1;
      const x1 = side === 1 ? a.x + a.w : a.x, x2 = side === 1 ? b.x : b.x + b.w;
      const c1 = vx(a.col, side) + slot(`v${a.col}${side}`), c2 = vx(b.col, side === 1 ? -1 : 1) + slot(`v${b.col}${-side}`);
      if (a.row === b.row && Math.abs(a.col - b.col) === 1) { const cx = (c1 + c2) / 2; pts = [[x1, y1], [cx, y1], [cx, y2], [x2, y2]]; }
      else {
        const hyv = a.row === b.row ? hy(a.row, true) : b.row > a.row ? hy(b.row, false) : hy(b.row, true);
        const yy = hyv + slot(`h${hyv}`);
        pts = [[x1, y1], [c1, y1], [c1, yy], [c2, yy], [c2, y2], [x2, y2]];
      }
    }
    const d = pts.map(([x, y], k) => `${k ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("");
    const [ex, ey] = pts[pts.length - 1], [sx, sy] = pts[0];
    parts.push(`<path d="${d}" fill="none" stroke="${col}" stroke-width="1.6" stroke-linejoin="round" opacity="0.85"/><circle cx="${ex}" cy="${ey}" r="3.5" fill="${col}"/><path d="M${sx} ${sy - 5}v10" stroke="${col}" stroke-width="2"/>`);
  }
  for (const t of tables) {
    const b = at.get(t.name)!;
    parts.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="6" fill="#fff" stroke="#cbd5e1"/><path d="M${b.x} ${b.y + HEAD_H}V${b.y + 6}a6 6 0 0 1 6 -6H${b.x + b.w - 6}a6 6 0 0 1 6 6V${b.y + HEAD_H}Z" fill="${o.color}"/>`);
    parts.push(`<text x="${b.x + 10}" y="${b.y + 20}" font-size="13" font-weight="700" fill="#fff">${esc(t.name)}${t.comment ? `<tspan font-weight="400" font-size="12" fill="#e5e7eb"> ${esc(t.comment)}</tspan>` : ""}</text>`);
    t.cols.forEach((c, i) => {
      const y = b.y + HEAD_H + i * ROW_H;
      if (i % 2) parts.push(`<rect x="${b.x + 1}" y="${y}" width="${b.w - 2}" height="${ROW_H}" fill="#f8fafc"/>`);
      const tag = c.pk ? "PK" : c.fk ? "FK" : "";
      if (tag) parts.push(`<text x="${b.x + 10}" y="${y + 15}" font-size="10" font-weight="700" fill="${c.pk ? "#b45309" : "#2563eb"}">${tag}</text>`);
      parts.push(`<text x="${b.x + 36}" y="${y + 15}" font-size="12" fill="#111827"${c.pk ? ` font-weight="700"` : ""}>${esc(c.name)}${c.nullable || c.pk ? "" : "<tspan fill=\"#dc2626\">*</tspan>"}</text>`);
      if (o.types) parts.push(`<text x="${b.x + b.w - 10}" y="${y + 15}" font-size="11" text-anchor="end" fill="#6b7280">${esc(c.type)}</text>`);
    });
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"${font}><rect width="${W}" height="${H}" fill="#f1f5f9"/>${parts.join("")}</svg>`;
}

const opts = (p: Project, family?: string) => ({ title: s(p.settings.title), perRow: Number(p.settings.perRow) || 3, types: p.settings.types !== false, color: s(p.settings.color) || "#1e40af", family });
const flags = (c: Col) => [c.pk ? "PK" : "", c.fk ? `FK → ${c.fk}` : "", c.unique && !c.pk ? "UNIQUE" : "", c.nullable ? "" : "NOT NULL"].filter(Boolean).join(", ");

function makeDef(assetRoot: string): AppDef {
  return {
    name: NAME,
    version: VERSION,
    prefix: "erd",
    title: ["数据库结构图", "SQL ER Diagram"],
    openDescription:
      "Draw an entity-relationship diagram and a data dictionary from SQL DDL files (CREATE TABLE / ALTER TABLE … FOREIGN KEY / COMMENT ON, in MySQL, PostgreSQL or SQLite syntax). Each row of the project is one column: table, column, type, PK, FK target (table.column), nullable, comment. Edit comments or add missing foreign keys (fk = \"orders.id\"), untick tables' columns to hide them, then export SVG/PNG diagrams, an Excel data dictionary and a Markdown data dictionary.",
    inputs: { exts: [".sql", ".ddl"], min: 1, max: 20, label: ["选择 SQL 建表脚本", "Pick SQL schema (DDL) files"] },
    settings: [
      { key: "title", label: ["图标题", "Diagram title"], type: "text", default: "" },
      { key: "perRow", label: ["每行几张表", "Tables per row"], type: "number", default: 3, min: 1, max: 8 },
      { key: "types", label: ["显示字段类型", "Show column types"], type: "bool", default: true },
      { key: "color", label: ["表头颜色", "Header colour"], type: "color", default: "#1e40af" },
    ],
    columns: () => [
      { key: "include", label: ["显示", "Show"], type: "bool" },
      { key: "table", label: ["表", "Table"], readOnly: true },
      { key: "column", label: ["字段", "Column"], readOnly: true },
      { key: "type", label: ["类型", "Type"] },
      { key: "pk", label: ["主键", "PK"], type: "bool" },
      { key: "fk", label: ["外键 → 表.字段", "FK → table.column"] },
      { key: "nullable", label: ["可空", "Nullable"], type: "bool" },
      { key: "comment", label: ["说明", "Comment"], wide: true },
    ],
    async load({ ws, files }) {
      const rows: Row[] = [];
      const warnings: string[] = [];
      const tableComments: Record<string, string> = {};
      for (const f of files) {
        const r = parseDdl(await ws.readText(f));
        warnings.push(...r.warnings.map((w) => `${f}: ${w}`));
        for (const t of r.tables) {
          if (t.comment) tableComments[t.name] = t.comment;
          for (const c of t.cols) rows.push({ include: true, table: t.name, column: c.name, type: c.type, pk: c.pk, fk: c.fk, nullable: c.nullable, unique: c.unique, comment: c.comment, def: c.def });
        }
      }
      if (!rows.length) throw new KitError("no_tables", "No CREATE TABLE statements found.");
      return { rows, meta: { warnings, tableComments } };
    },
    compute(p): Computed {
      const tables = tablesOf(p);
      const fks = tables.reduce((a, t) => a + t.cols.filter((c) => c.fk).length, 0);
      const noComment = p.rows.filter((r) => r.include !== false && !s(r.comment)).length;
      return {
        summary: `${tables.length} table(s), ${p.rows.filter((r) => r.include !== false).length} column(s), ${fks} relationship(s); ${noComment} column(s) without a comment.`,
        stats: { tables: tables.length, columns: p.rows.length, relationships: fks, noComment },
        issues: issuesOf(tables, p),
        preview: erSvg(tables, opts(p)).replace(/^<svg /, `<svg style="max-width:100%;height:auto" `),
      };
    },
    exports: [
      {
        id: "svg", label: ["结构图 SVG", "Diagram (SVG)"], description: "er-diagram.svg",
        async run({ project, write }: ExportCtx) { return [await write("er-diagram.svg", erSvg(tablesOf(project), opts(project)))]; },
      },
      {
        id: "png", label: ["结构图 PNG", "Diagram (PNG)"], description: "er-diagram.png (2× resolution)",
        async run({ project, write }: ExportCtx) {
          const { fontsFor } = await import("./png.ts");
          const fonts = await fontsFor(assetRoot, "SQL_ER_DIAGRAM_FONT");
          const svg = erSvg(tablesOf(project), opts(project, fonts.family));
          const w = Number(/width="(\d+)/.exec(svg)?.[1] ?? 1200);
          return [await write("er-diagram.png", await svgToPng(assetRoot, svg, Math.min(8000, w * 2), "SQL_ER_DIAGRAM_FONT"))];
        },
      },
      {
        id: "xlsx", label: ["数据字典 Excel", "Data dictionary (XLSX)"], description: "data-dictionary.xlsx — Tables sheet + one row per column",
        async run({ project, write }: ExportCtx) {
          const tables = tablesOf(project);
          return [await write("data-dictionary.xlsx", await writeXlsx([
            { name: "Tables 表", headers: ["table", "comment", "columns", "primary key", "references"], rows: tables.map((t) => [t.name, t.comment, t.cols.length, t.cols.filter((c) => c.pk).map((c) => c.name).join(", "), [...new Set(t.cols.filter((c) => c.fk).map((c) => c.fk.split(".")[0]))].join(", ")]) },
            { name: "Columns 字段", headers: ["table", "column", "type", "key", "nullable", "default", "comment"], rows: tables.flatMap((t) => t.cols.map((c) => [t.name, c.name, c.type, flags(c), c.nullable ? "YES" : "NO", c.def, c.comment])) },
          ]))];
        },
      },
      {
        id: "md", label: ["数据字典 Markdown", "Data dictionary (Markdown)"], description: "data-dictionary.md",
        async run({ project, write }: ExportCtx) {
          const cell = (x: string) => x.replace(/\|/g, "\\|");
          const md = [`# ${s(project.settings.title) || "Data dictionary 数据字典"}`, "", ...tablesOf(project).flatMap((t) => [`## ${t.name}${t.comment ? ` — ${t.comment}` : ""}`, "", "| Column 字段 | Type 类型 | Key | Null | Default | Comment 说明 |", "|---|---|---|---|---|---|", ...t.cols.map((c) => `| ${cell(c.name)} | ${cell(c.type)} | ${cell(flags(c).replace(/, NOT NULL|NOT NULL/, ""))} | ${c.nullable ? "YES" : "NO"} | ${cell(c.def)} | ${cell(c.comment)} |`), ""])].join("\n");
          return [await write("data-dictionary.md", md)];
        },
      },
    ],
    describeRow: (r, i) => `#${i}${r.include === false ? " [hidden]" : ""} ${s(r.table)}.${s(r.column)} ${s(r.type)}${r.pk ? " PK" : ""}${s(r.fk) ? ` FK→${s(r.fk)}` : ""}${s(r.comment) ? ` “${s(r.comment)}”` : ""}`,
  };
}

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(makeDef(options.assetRoot), options).server;
}
