import { PDFDocument } from "pdf-lib";
import { createApp, esc, type AppDef, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { mapHeaders } from "./kit/columns.ts";
import { readTable } from "./kit/table.ts";
import { KitError } from "./kit/workspace.ts";
import { svgToPng } from "./png.ts";
import { buildTree, layout, type Person } from "./tree.ts";
import { s } from "./util.ts";

export const NAME = "org-chart-maker";
export const VERSION = "0.1.0";
const ALIAS = { name: ["姓名", "名字", "员工", "name", "employee", "full name"], title: ["职位", "职务", "岗位", "头衔", "title", "position", "role", "job title"], dept: ["部门", "团队", "department", "team", "dept"], manager: ["上级", "直属上级", "汇报对象", "经理", "manager", "reports to", "supervisor", "boss"] };
const PALETTE = ["#1d4ed8", "#0f766e", "#b45309", "#7c3aed", "#be123c", "#15803d", "#0369a1", "#a21caf"];
const peopleOf = (p: Project): Person[] => p.rows.map((r, i) => ({ i, name: s(r.name), title: s(r.title), dept: s(r.dept), manager: s(r.manager), collapsed: r.collapsed === true })).filter((x) => x.name);

export function chartSvg(p: Project, family?: string) {
  const t = buildTree(peopleOf(p));
  const st = p.settings, boxW = 168, boxH = 58;
  const boxes = layout(t.roots, { boxW, boxH, gapX: 22, gapY: 46, maxDepth: Number(st.depth) || 99, stackOver: Number(st.stackOver) || 4 });
  const depts = [...new Set(peopleOf(p).map((x) => x.dept).filter(Boolean))];
  const colorOf = (d: string) => (st.colorBy === "level" ? "" : PALETTE[depts.indexOf(d) % PALETTE.length] ?? "#475569");
  const top = s(st.title) ? 60 : 20, pad = 24;
  const W = Math.max(400, ...boxes.map((b) => b.x + boxW)) + pad * 2, H = Math.max(120, ...boxes.map((b) => b.y + boxH)) + top + pad + 10;
  const parts: string[] = [];
  if (s(st.title)) parts.push(`<text x="${pad}" y="36" font-size="20" font-weight="700" fill="#111827">${esc(s(st.title))}</text>`);
  const at = new Map(boxes.map((b) => [b.n, b]));
  for (const b of boxes) {
    const kids = b.n.kids.filter((k) => at.has(k));
    if (!kids.length) continue;
    const x1 = pad + b.x + boxW / 2, y1 = top + b.y + boxH;
    if (b.n.stack) { const last = at.get(kids.at(-1)!)!; parts.push(`<path d="M${pad + b.x + 14} ${y1}V${top + last.y + boxH / 2}" stroke="#94a3b8" fill="none"/>`); for (const k of kids) { const c = at.get(k)!; parts.push(`<path d="M${pad + b.x + 14} ${top + c.y + boxH / 2}H${pad + c.x}" stroke="#94a3b8" fill="none"/>`); } continue; }
    const mid = y1 + 23;
    parts.push(`<path d="M${x1} ${y1}V${mid}" stroke="#94a3b8" fill="none"/>`);
    const xs = kids.map((k) => pad + at.get(k)!.x + boxW / 2);
    parts.push(`<path d="M${Math.min(...xs)} ${mid}H${Math.max(...xs)}" stroke="#94a3b8" fill="none"/>`);
    for (const x of xs) parts.push(`<path d="M${x} ${mid}V${mid + 23}" stroke="#94a3b8" fill="none"/>`);
  }
  for (const b of boxes) {
    const x = pad + b.x, y = top + b.y, c = colorOf(b.n.p.dept) || ["#1e3a8a", "#2563eb", "#3b82f6", "#60a5fa", "#93c5fd"][Math.min(4, b.level)];
    const cut = (t: string, n: number) => ([...t].length > n ? [...t].slice(0, n - 1).join("") + "…" : t);
    parts.push(`<rect x="${x}" y="${y}" width="${boxW}" height="${boxH}" rx="8" fill="#fff" stroke="${c}" stroke-width="1.5"/><rect x="${x}" y="${y}" width="6" height="${boxH}" rx="3" fill="${c}"/>`);
    parts.push(`<text x="${x + 16}" y="${y + 22}" font-size="14" font-weight="700" fill="#111827">${esc(cut(b.n.p.name, 12))}</text><text x="${x + 16}" y="${y + 39}" font-size="11" fill="#374151">${esc(cut(b.n.p.title, 16))}</text>${b.n.p.dept && st.showDept !== false ? `<text x="${x + 16}" y="${y + 52}" font-size="9.5" fill="${c}">${esc(cut(b.n.p.dept, 18))}</text>` : ""}`);
    if (b.n.hidden) parts.push(`<rect x="${x + boxW / 2 - 18}" y="${y + boxH - 8}" width="36" height="16" rx="8" fill="${c}"/><text x="${x + boxW / 2}" y="${y + boxH + 4}" font-size="10" text-anchor="middle" fill="#fff">+${b.n.hidden}</text>`);
  }
  const font = family ? ` font-family="${esc(family)}"` : ` font-family="sans-serif"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"${font}><rect width="${W}" height="${H}" fill="#f8fafc"/>${parts.join("")}</svg>`;
}

function makeDef(assetRoot: string): AppDef {
  const png = async (p: Project) => {
    const { fontsFor } = await import("./png.ts");
    const fonts = await fontsFor(assetRoot, "ORG_CHART_MAKER_FONT");
    const svg = chartSvg(p, fonts.family);
    return svgToPng(assetRoot, svg, Math.min(9000, Number(/width="(\d+)/.exec(svg)![1]) * 2), "ORG_CHART_MAKER_FONT");
  };
  return {
    name: NAME,
    version: VERSION,
    prefix: "orgchart",
    title: ["组织架构图", "Org Chart Maker"],
    openDescription:
      "Turn a staff list (CSV/XLSX with 姓名/name, 职位/title, 部门/department and 上级/manager — the manager's name) into an org chart. People whose manager is missing become top-level boxes; cycles and duplicate names are reported. Collapse a branch (collapsed=true shows “+N”), limit the number of levels, stack large teams of individual contributors vertically, colour boxes by department or level. Edit names, titles or managers to restructure, add people, then export SVG, PNG and a one-page PDF.",
    inputs: { exts: [".csv", ".xlsx", ".tsv"], min: 0, max: 1, label: ["选择员工名单", "Pick the staff list"] },
    settings: [
      { key: "title", label: ["标题", "Title"], type: "text", default: "" },
      { key: "depth", label: ["显示几层", "Levels to show"], type: "number", default: 10, min: 1, max: 20 },
      { key: "stackOver", label: ["下属超过几人时竖排", "Stack teams larger than"], type: "number", default: 4, min: 1, max: 50 },
      { key: "colorBy", label: ["颜色", "Colour by"], type: "select", default: "dept", options: [{ value: "dept", label: ["按部门", "Department"] }, { value: "level", label: ["按层级", "Level"] }] },
      { key: "showDept", label: ["显示部门", "Show department"], type: "bool", default: true },
    ],
    columns: () => [
      { key: "name", label: ["姓名", "Name"] },
      { key: "title", label: ["职位", "Title"] },
      { key: "dept", label: ["部门", "Department"] },
      { key: "manager", label: ["上级", "Manager"] },
      { key: "collapsed", label: ["折叠下属", "Collapse team"], type: "bool" },
      { key: "_team", label: ["下属总数", "Team size"], type: "number", readOnly: true },
    ],
    newRow: () => ({ name: "", title: "", dept: "", manager: "", collapsed: false }),
    async load({ ws, files }) {
      if (!files.length) return { rows: [] };
      const t = await readTable(ws, files[0]);
      const m = mapHeaders(t.columns, ALIAS);
      if (!m.name) throw new KitError("no_name", `Need a name column (姓名/name). Columns: ${t.columns.join(", ")}`);
      return { rows: t.rows.filter((r) => s(r[m.name!])).map((r) => ({ name: s(r[m.name!]), title: m.title ? s(r[m.title]) : "", dept: m.dept ? s(r[m.dept]) : "", manager: m.manager ? s(r[m.manager]) : "", collapsed: false })) };
    },
    compute(p): Computed {
      const t = buildTree(peopleOf(p));
      const issues: Issue[] = [];
      for (const i of t.unknown) issues.push({ level: "warn", row: i, key: "manager", message: `${s(p.rows[i].name)}: manager “${s(p.rows[i].manager)}” is not in the list — shown at the top level.` });
      for (const i of t.cycles) issues.push({ level: "error", row: i, key: "manager", message: `${s(p.rows[i].name)} is in a reporting loop — the loop was cut here.` });
      for (const i of t.dup) issues.push({ level: "error", row: i, key: "name", message: `“${s(p.rows[i].name)}” appears twice; rename one (e.g. add the department).` });
      if (t.roots.length > 1) issues.push({ level: "info", message: `${t.roots.length} top-level people: ${t.roots.map((r) => r.p.name).join(", ")}.` });
      const team = new Map<number, number>();
      const walk = (n: (typeof t.roots)[number]): number => { const c = n.kids.reduce((a, k) => a + 1 + walk(k), 0); team.set(n.p.i, c); return c; };
      t.roots.forEach(walk);
      const depth = (n: (typeof t.roots)[number]): number => 1 + Math.max(0, ...n.kids.map(depth));
      const levels = Math.max(0, ...t.roots.map(depth));
      return { rows: p.rows.map((r, i) => ({ ...r, _team: team.get(i) ?? 0 })), issues, summary: `${t.count} people in ${levels} level(s), ${new Set(peopleOf(p).map((x) => x.dept).filter(Boolean)).size} department(s).`, stats: { people: t.count, levels, tops: t.roots.length }, preview: chartSvg(p).replace(/^<svg /, `<svg style="max-width:100%;height:auto" `) };
    },
    exports: [
      { id: "svg", label: ["架构图 SVG", "Chart (SVG)"], description: "org-chart.svg", async run({ project, write }: ExportCtx) { return [await write("org-chart.svg", chartSvg(project))]; } },
      { id: "png", label: ["架构图 PNG", "Chart (PNG)"], description: "org-chart.png (2× resolution)", async run({ project, write }: ExportCtx) { return [await write("org-chart.png", await png(project))]; } },
      {
        id: "pdf", label: ["架构图 PDF", "Chart (PDF)"], description: "org-chart.pdf — the chart fitted on one A4/A3 landscape page",
        async run({ project, write }: ExportCtx) {
          const doc = await PDFDocument.create();
          const img = await doc.embedPng(await png(project));
          const big = img.width > 3200;
          const [W, H] = big ? [1190.55, 841.89] : [841.89, 595.28];
          const page = doc.addPage([W, H]);
          const k = Math.min((W - 40) / img.width, (H - 40) / img.height);
          page.drawImage(img, { x: (W - img.width * k) / 2, y: (H - img.height * k) / 2, width: img.width * k, height: img.height * k });
          return [await write("org-chart.pdf", await doc.save())];
        },
      },
    ],
    describeRow: (r, i) => `#${i} ${s(r.name)} — ${s(r.title)} [${s(r.dept)}] reports to ${s(r.manager) || "(top)"}${r.collapsed ? " [collapsed]" : ""} team=${r._team ?? 0}`,
  };
}

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(makeDef(options.assetRoot), options).server;
}
