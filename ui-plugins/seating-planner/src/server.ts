import { createApp, esc, type AppDef, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { mapHeaders } from "./kit/columns.ts";
import { hexRgb, newPdf, PAGE } from "./kit/pdf.ts";
import { writeXlsx } from "./kit/sheet.ts";
import { readTable } from "./kit/table.ts";
import { KitError } from "./kit/workspace.ts";
import { assign, normSeat, seatsOf, type Layout, type Person } from "./seat.ts";
import { s, yes } from "./util.ts";

export const NAME = "seating-planner";
export const VERSION = "0.1.0";
const list = (v: unknown) => s(v).split(/[,，、;；/]+/).map((x) => x.trim()).filter(Boolean);
const ALIAS = { name: ["姓名", "名字", "学生", "宾客", "name", "guest", "student"], group: ["班级", "分组", "组别", "部门", "单位", "桌别", "group", "class", "team", "department", "party"], front: ["前排", "靠前", "front", "near front"], apart: ["分开", "不同桌", "避开", "keep apart", "apart", "not with"], together: ["一起", "同桌", "挨着", "together", "with", "sit with"], fixed: ["座位", "固定座位", "seat", "fixed seat"] };

function layoutOf(p: Pick<Project, "settings">): Layout {
  const st = p.settings;
  return s(st.layout) === "tables" ? { kind: "tables", tables: Number(st.tables) || 6, size: Number(st.tableSize) || 10 } : { kind: "grid", rows: Number(st.rows) || 6, cols: Number(st.cols) || 8 };
}
const peopleOf = (p: Project): Person[] => p.rows.map((r, i) => ({ i, name: s(r.name), group: s(r.group), front: r.front === true, apart: list(r.apart), together: list(r.together), fixed: r.locked === true ? s(r.seat) : "" })).filter((x) => x.name);
function plan(p: Project) {
  const l = layoutOf(p);
  return { l, ...assign(peopleOf(p), l, { seed: s(p.settings.seed), separateGroups: p.settings.separate !== false, groupTables: p.settings.groupTables === true }) };
}

function gridHtml(p: Project) {
  const r = plan(p), who = new Map([...r.seat.entries()].map(([i, id]) => [id, p.rows[i]]));
  const cell = (id: string) => { const x = who.get(id); return `<td style="border:1px solid #cbd5e1;padding:4px 6px;min-width:64px;text-align:center;background:${x ? "#fff" : "#f1f5f9"}"><div style="font-size:10px;color:#94a3b8">${id}</div>${x ? `<b>${esc(x.name)}</b><div style="font-size:10px;color:#64748b">${esc(x.group)}</div>` : ""}</td>`; };
  if (r.l.kind === "grid") {
    const rows = Array.from({ length: r.l.rows }, (_, i) => `<tr>${Array.from({ length: (r.l as { cols: number }).cols }, (_, j) => cell(`R${i + 1}C${j + 1}`)).join("")}</tr>`).join("");
    return `<div style="text-align:center;background:#1e3a8a;color:#fff;padding:4px;border-radius:4px;margin-bottom:6px">讲台 / Front</div><table style="border-collapse:collapse;margin:auto">${rows}</table>`;
  }
  const l = r.l;
  return Array.from({ length: l.tables }, (_, t) => `<div style="display:inline-block;vertical-align:top;margin:4px"><div style="font-weight:700">第 ${t + 1} 桌 Table ${t + 1}</div><table style="border-collapse:collapse">${Array.from({ length: Math.ceil(l.size / 2) }, (_, k) => `<tr>${cell(`T${t + 1}-${k * 2 + 1}`)}${k * 2 + 2 <= l.size ? cell(`T${t + 1}-${k * 2 + 2}`) : ""}</tr>`).join("")}</table></div>`).join("");
}

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "seats",
  title: ["座位编排", "Seating Planner"],
  openDescription:
    "Assign seats for an exam room, classroom or banquet from a people list (CSV/XLSX with columns like 姓名/name, 班级/group, 前排/front, 分开/apart, 一起/together, 座位/seat). Layouts: a grid of rows × columns (seat ids R1C1…, row 1 is the front) or round tables (T1-1…). Rules: keep people of the same group from sitting next to each other (exams), keep named people apart, seat named people together, put “front” people in the first rows, or fill banquet tables by group. Typing a seat in a row locks it; change the seed to reshuffle the rest. Exports a printable seating chart PDF and a workbook.",
  inputs: { exts: [".csv", ".xlsx", ".tsv"], min: 1, max: 1, label: ["选择名单", "Pick the people list"] },
  settings: [
    { key: "title", label: ["标题", "Title"], type: "text", default: "座位表 Seating chart" },
    { key: "layout", label: ["布局", "Layout"], type: "select", default: "grid", options: [{ value: "grid", label: ["行列（考场/教室）", "Rows × columns (exam/classroom)"] }, { value: "tables", label: ["圆桌（宴会）", "Round tables (banquet)"] }] },
    { key: "rows", label: ["排数", "Rows"], type: "number", default: 6, min: 1, max: 40 },
    { key: "cols", label: ["每排座位", "Seats per row"], type: "number", default: 8, min: 1, max: 40 },
    { key: "tables", label: ["桌数", "Tables"], type: "number", default: 6, min: 1, max: 100 },
    { key: "tableSize", label: ["每桌人数", "Seats per table"], type: "number", default: 10, min: 2, max: 20 },
    { key: "separate", label: ["同组不相邻（考场）", "Keep the same group apart (exam)"], type: "bool", default: true },
    { key: "groupTables", label: ["同组尽量同桌（宴会）", "Seat each group together (banquet)"], type: "bool", default: false },
    { key: "seed", label: ["随机种子（改一下重新排）", "Seed (change to reshuffle)"], type: "text", default: "" },
    { key: "color", label: ["主色", "Accent colour"], type: "color", default: "#1e3a8a" },
  ],
  columns: () => [
    { key: "name", label: ["姓名", "Name"] },
    { key: "group", label: ["分组", "Group"] },
    { key: "front", label: ["前排", "Front"], type: "bool" },
    { key: "apart", label: ["与谁分开", "Keep apart from"] },
    { key: "together", label: ["与谁一起", "Sit with"] },
    { key: "seat", label: ["座位", "Seat"] },
    { key: "locked", label: ["固定", "Locked"], type: "bool" },
  ],
  newRow: () => ({ name: "", group: "", front: false, apart: "", together: "", seat: "", locked: false }),
  onCellEdit: (row, key) => { if (key === "seat") row.locked = !!s(row.seat); },
  async load({ ws, files }) {
    const t = await readTable(ws, files[0]);
    const m = mapHeaders(t.columns, ALIAS);
    if (!m.name) throw new KitError("no_name", `Need a name column (姓名/name). Columns: ${t.columns.join(", ")}`);
    const rows: Row[] = t.rows.filter((r) => s(r[m.name!])).map((r) => ({ name: s(r[m.name!]), group: m.group ? s(r[m.group]) : "", front: m.front ? yes(r[m.front]) : false, apart: m.apart ? s(r[m.apart]) : "", together: m.together ? s(r[m.together]) : "", seat: m.fixed ? s(r[m.fixed]) : "", locked: m.fixed ? !!s(r[m.fixed]) : false }));
    return { rows };
  },
  compute(p): Computed {
    const r = plan(p);
    const rows = p.rows.map((row, i) => ({ ...row, seat: r.seat.get(i) ?? (row.locked ? row.seat : "") }));
    const issues: Issue[] = [];
    const cap = seatsOf(r.l).length, people = peopleOf(p);
    if (people.length > cap) issues.push({ level: "error", message: `${people.length} people but only ${cap} seats — add rows/tables.` });
    for (const b of r.badFixed) issues.push({ level: "warn", row: b.i, key: "seat", message: `${s(p.rows[b.i].name)}: seat “${b.seat}” ${b.why}; a free seat was chosen instead.` });
    for (const c of r.conflicts) issues.push({ level: "warn", message: `${c.a} ↔ ${c.b}: ${c.why}.` });
    const names = new Map<string, number>();
    p.rows.forEach((row, i) => { const n = s(row.name); if (names.has(n)) issues.push({ level: "warn", row: i, key: "name", message: `“${n}” appears twice.` }); names.set(n, i); });
    for (const x of people) for (const n of [...x.apart, ...x.together]) if (!names.has(n)) issues.push({ level: "warn", row: x.i, message: `${x.name}: “${n}” is not in the list.` });
    return { rows, issues, summary: `${r.seat.size} of ${people.length} seated (${cap} seats); ${r.conflicts.length} rule conflict(s).`, stats: { people: people.length, seats: cap, seated: r.seat.size, conflicts: r.conflicts.length }, preview: gridHtml(p) };
  },
  exports: [
    {
      id: "pdf", label: ["座位表 PDF", "Seating chart (PDF)"], description: "seating-chart.pdf — printable chart (A4 landscape) plus an alphabetical seat list",
      async run({ project, write }: ExportCtx) {
        const r = plan(project), k = await newPdf(process.env.SEATING_PLANNER_FONT), color = s(project.settings.color) || "#1e3a8a";
        const [W, H] = [PAGE.A4[1], PAGE.A4[0]];
        const page = k.doc.addPage([W, H]);
        k.text(page, s(project.settings.title), 40, H - 46, { size: 18, bold: true });
        const who = new Map([...r.seat.entries()].map(([i, id]) => [id, project.rows[i]]));
        const box = (x: number, y: number, w: number, h: number, id: string) => {
          const p = who.get(id);
          page.drawRectangle({ x, y, width: w, height: h, borderColor: hexRgb("#94a3b8"), borderWidth: 0.8, color: hexRgb(p ? "#ffffff" : "#f1f5f9") });
          k.text(page, id, x + 3, y + h - 9, { size: 6.5, color: "#94a3b8" });
          if (p) { k.text(page, s(p.name), x + w / 2, y + h / 2 - 2, { size: Math.min(11, w / 5), bold: true, align: "center", maxWidth: w - 4 }); if (s(p.group)) k.text(page, s(p.group), x + w / 2, y + 5, { size: 7, color: "#64748b", align: "center", maxWidth: w - 4 }); }
        };
        if (r.l.kind === "grid") {
          const { rows, cols } = r.l, top = H - 90, gw = W - 80, gh = top - 40;
          const w = Math.min(90, gw / cols - 6), h = Math.min(48, gh / rows - 6), x0 = (W - cols * (w + 6)) / 2;
          page.drawRectangle({ x: W / 2 - 100, y: top + 6, width: 200, height: 18, color: hexRgb(color) });
          k.text(page, "讲台 / Front", W / 2, top + 11, { size: 10, color: "#ffffff", align: "center" });
          for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) box(x0 + j * (w + 6), top - 10 - (i + 1) * (h + 6), w, h, `R${i + 1}C${j + 1}`);
        } else {
          const { tables, size } = r.l, per = Math.min(4, tables), cw = (W - 80) / per, ch = 150;
          for (let t = 0; t < tables; t++) {
            let pg = page;
            const slot = t % 12;
            if (t && slot === 0) { pg = k.doc.addPage([W, H]); }
            const cx = 40 + (slot % per) * cw + cw / 2, cy = H - 120 - Math.floor(slot / per) * (ch + 20) - ch / 2;
            pg.drawCircle({ x: cx, y: cy, size: 30, color: hexRgb(color) });
            k.text(pg, `第${t + 1}桌`, cx, cy - 4, { size: 11, color: "#ffffff", align: "center", bold: true });
            for (let q = 0; q < size; q++) {
              const a = (q / size) * Math.PI * 2 - Math.PI / 2, x = cx + Math.cos(a) * 62, y = cy - Math.sin(a) * 55;
              const p = who.get(`T${t + 1}-${q + 1}`);
              k.text(pg, p ? s(p.name) : `${q + 1}`, x, y - 3, { size: 8, align: "center", color: p ? "#111827" : "#cbd5e1", maxWidth: 70 });
            }
          }
        }
        const lp = k.doc.addPage([PAGE.A4[0], PAGE.A4[1]]);
        k.text(lp, "座位查询 Seat list", 40, PAGE.A4[1] - 50, { size: 14, bold: true });
        const sorted = [...r.seat.entries()].map(([i, id]) => [s(project.rows[i].name), id, s(project.rows[i].group)]).sort((a, b) => a[0].localeCompare(b[0], "zh-Hans-CN"));
        sorted.forEach((x, n) => { const col = Math.floor(n / 45), y = PAGE.A4[1] - 80 - (n % 45) * 16; k.text(lp, `${x[0]}  ${x[1]}  ${x[2]}`, 40 + col * 180, y, { size: 9, maxWidth: 170 }); });
        return [await write("seating-chart.pdf", await k.doc.save())];
      },
    },
    {
      id: "xlsx", label: ["座位 Excel", "Workbook"], description: "seating.xlsx — seat list and a chart sheet",
      async run({ project, write }: ExportCtx) {
        const r = plan(project);
        const who = new Map([...r.seat.entries()].map(([i, id]) => [id, s(project.rows[i].name)]));
        const chart = r.l.kind === "grid" ? Array.from({ length: r.l.rows }, (_, i) => [`第${i + 1}排`, ...Array.from({ length: (r.l as { cols: number }).cols }, (_, j) => who.get(`R${i + 1}C${j + 1}`) ?? "")]) : Array.from({ length: r.l.tables }, (_, t) => [`第${t + 1}桌`, ...Array.from({ length: (r.l as { size: number }).size }, (_, q) => who.get(`T${t + 1}-${q + 1}`) ?? "")]);
        const n = r.l.kind === "grid" ? r.l.cols : r.l.size;
        return [await write("seating.xlsx", await writeXlsx([
          { name: "Seats 座位", headers: ["name", "group", "seat"], rows: project.rows.map((x, i) => [s(x.name), s(x.group), r.seat.get(i) ?? ""]) },
          { name: "Chart 座位图", headers: ["", ...Array.from({ length: n }, (_, j) => String(j + 1))], rows: chart },
        ]))];
      },
    },
  ],
  describeRow: (r, i) => `#${i} ${s(r.name)} [${s(r.group)}] seat=${s(r.seat)}${r.locked ? " (locked)" : ""}${r.front ? " front" : ""}${s(r.apart) ? ` apart:${s(r.apart)}` : ""}${s(r.together) ? ` with:${s(r.together)}` : ""}`,
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
