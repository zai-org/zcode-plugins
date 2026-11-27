import { createApp, esc, htmlPage, type AppDef, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { mapHeaders, num, parseDate } from "./kit/columns.ts";
import { writeXlsx } from "./kit/sheet.ts";
import { readTable } from "./kit/table.ts";
import { KitError } from "./kit/workspace.ts";
import { cal, schedule, type Task } from "./plan.ts";
import { svgToPng } from "./png.ts";
import { s } from "./util.ts";

export const NAME = "gantt-planner";
export const VERSION = "0.1.0";
const ALIAS = { id: ["编号", "序号", "任务编号", "id", "no", "#", "wbs"], name: ["任务", "任务名称", "名称", "工作", "task", "name", "activity"], owner: ["负责人", "责任人", "owner", "assignee", "who"], start: ["开始", "开始日期", "start", "start date"], end: ["结束", "结束日期", "完成日期", "end", "finish", "end date"], dur: ["工期", "天数", "工作日", "duration", "days"], deps: ["前置", "前置任务", "依赖", "depends", "dependencies", "predecessors", "after"], progress: ["进度", "完成度", "完成%", "progress", "% done", "done"] };
const depsOf = (v: unknown) => s(v).split(/[,，、;；\s]+/).map((x) => x.trim()).filter(Boolean);

function tasksOf(p: Project): Task[] {
  return p.rows.map((r, i) => ({ i, id: s(r.id) || String(i + 1), name: s(r.task), start: parseDate(r.start), dur: Math.max(0, Math.round(Number(r.duration) || 0)), deps: depsOf(r.depends), progress: Math.max(0, Math.min(100, num(r.progress) || 0)), owner: s(r.owner) })).filter((t) => t.name);
}
function plan(p: Project) {
  const hol = new Set(s(p.settings.holidays).split(/[,，;；\s]+/).map(parseDate).filter(Boolean));
  const tasks = tasksOf(p);
  const first = tasks.map((t) => t.start).filter(Boolean).sort()[0] || new Date().toISOString().slice(0, 10);
  return { tasks, ...schedule(tasks, { projectStart: parseDate(p.settings.projectStart) || first, holidays: hol, weekends: p.settings.weekends === true }), hol };
}

export function ganttSvg(p: Project, family?: string) {
  const r = plan(p);
  const days: string[] = [];
  if (!r.end) return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="60"><text x="10" y="30">No tasks</text></svg>`;
  for (let d = new Date(`${r.start}T00:00:00Z`); d.toISOString().slice(0, 10) <= r.end; d.setUTCDate(d.getUTCDate() + 1)) days.push(d.toISOString().slice(0, 10));
  const c = cal(r.hol, p.settings.weekends === true);
  const dw = Math.max(6, Math.min(28, 900 / days.length)), L = 280, top = 64, rh = 26, W = L + days.length * dw + 96, H = top + r.tasks.length * rh + 30;
  const x = (d: string) => L + days.indexOf(d) * dw;
  const parts: string[] = [];
  const color = s(p.settings.color) || "#2563eb";
  parts.push(`<text x="16" y="28" font-size="18" font-weight="700" fill="#111827">${esc(s(p.settings.title) || p.name)}</text><text x="16" y="48" font-size="11" fill="#6b7280">${r.start} – ${r.end} · ${r.workdays} workdays</text>`);
  days.forEach((d, k) => {
    if (!c.work(d)) parts.push(`<rect x="${L + k * dw}" y="${top - 6}" width="${dw}" height="${H - top - 18}" fill="#f1f5f9"/>`);
    const first = k === 0 || d.slice(8) === "01";
    if (first) parts.push(`<text x="${L + k * dw + 2}" y="${top - 26}" font-size="11" font-weight="700" fill="#374151">${d.slice(0, 7)}</text>`);
    if (dw >= 14 || new Date(`${d}T00:00:00Z`).getUTCDay() === 1) parts.push(`<text x="${L + k * dw + dw / 2}" y="${top - 10}" font-size="9" text-anchor="middle" fill="#6b7280">${+d.slice(8)}</text>`);
  });
  r.tasks.forEach((t, k) => {
    const y = top + k * rh, sc = r.s.get(t.id);
    if (k % 2) parts.push(`<rect x="0" y="${y}" width="${L}" height="${rh}" fill="#f8fafc"/>`);
    parts.push(`<text x="16" y="${y + 17}" font-size="12" fill="#111827"><tspan fill="#9ca3af">${esc(t.id)}</tspan>  ${esc(t.name.length > 22 ? t.name.slice(0, 21) + "…" : t.name)}</text>${t.owner ? `<text x="${L - 8}" y="${y + 17}" font-size="10" text-anchor="end" fill="#6b7280">${esc(t.owner)}</text>` : ""}`);
    if (!sc) return;
    const bx = x(sc.start), bw = (days.indexOf(sc.end) - days.indexOf(sc.start) + 1) * dw, fill = sc.critical && p.settings.critical !== false ? "#dc2626" : color;
    if (t.dur === 0) parts.push(`<path d="M${bx + dw / 2} ${y + 5}l8 8-8 8-8-8z" fill="#7c3aed"/><text x="${bx + dw / 2 + 12}" y="${y + 17}" font-size="10" fill="#7c3aed">${sc.start.slice(5)}</text>`);
    else parts.push(`<rect x="${bx + 1}" y="${y + 6}" width="${Math.max(2, bw - 2)}" height="${rh - 12}" rx="3" fill="${fill}" opacity="0.35"/><rect x="${bx + 1}" y="${y + 6}" width="${Math.max(0, (bw - 2) * t.progress / 100)}" height="${rh - 12}" rx="3" fill="${fill}"/>${t.progress ? `<text x="${bx + bw + 4}" y="${y + 17}" font-size="9" fill="#6b7280">${t.progress}%</text>` : ""}`);
  });
  r.tasks.forEach((t, k) => t.deps.forEach((d) => {
    const a = r.s.get(d), b = r.s.get(t.id), j = r.tasks.findIndex((u) => u.id === d);
    if (!a || !b || j < 0) return;
    const x1 = x(a.end) + dw, y1 = top + j * rh + rh / 2, x2 = x(b.start), y2 = top + k * rh + rh / 2;
    parts.push(`<path d="M${x1} ${y1}h4V${y2}H${x2 - 1}" fill="none" stroke="#64748b" stroke-width="1"/><path d="M${x2 - 1} ${y2}l-5 -3v6z" fill="#64748b"/>`);
  }));
  const font = family ? ` font-family="${esc(family)}"` : ` font-family="sans-serif"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"${font}><rect width="${W}" height="${H}" fill="#fff"/>${parts.join("")}</svg>`;
}

function makeDef(assetRoot: string): AppDef {
  return {
    name: NAME,
    version: VERSION,
    prefix: "gantt",
    title: ["甘特图计划", "Gantt Planner"],
    openDescription:
      "Turn a task sheet (CSV/XLSX with columns like 编号/id, 任务/task, 负责人/owner, 开始/start, 工期/duration in workdays or 结束/end, 前置/depends (ids, comma-separated), 进度/progress %) into a Gantt chart. Dates are scheduled in workdays (weekends and listed holidays skipped); a task starts the workday after its predecessors finish; duration 0 = milestone. The critical path (zero slack) is highlighted. Edit any cell or start from an empty project and add tasks; export SVG/PNG charts, an Excel schedule and an HTML page.",
    inputs: { exts: [".csv", ".xlsx", ".tsv"], min: 0, max: 1, label: ["选择任务表（也可以空白开始）", "Pick the task sheet (or start empty)"] },
    settings: [
      { key: "title", label: ["项目名称", "Project title"], type: "text", default: "" },
      { key: "projectStart", label: ["项目开始日期", "Project start"], type: "date", default: "" },
      { key: "holidays", label: ["节假日（逗号分隔的日期）", "Holidays (comma-separated dates)"], type: "textarea", default: "" },
      { key: "weekends", label: ["周末也算工作日", "Weekends are workdays"], type: "bool", default: false },
      { key: "critical", label: ["标出关键路径", "Highlight the critical path"], type: "bool", default: true },
      { key: "color", label: ["任务条颜色", "Bar colour"], type: "color", default: "#2563eb" },
    ],
    columns: () => [
      { key: "id", label: ["编号", "ID"] },
      { key: "task", label: ["任务", "Task"], wide: true },
      { key: "owner", label: ["负责人", "Owner"] },
      { key: "start", label: ["指定开始", "Fixed start"], type: "date" },
      { key: "duration", label: ["工期", "Workdays"], type: "number" },
      { key: "depends", label: ["前置任务", "Depends on"] },
      { key: "progress", label: ["进度%", "Progress %"], type: "number" },
      { key: "_start", label: ["开始", "Starts"], readOnly: true },
      { key: "_end", label: ["结束", "Ends"], readOnly: true },
      { key: "_slack", label: ["浮动天数", "Slack"], type: "number", readOnly: true },
    ],
    newRow: (p) => ({ id: String(p.rows.length + 1), task: "", owner: "", start: "", duration: 1, depends: "", progress: 0 }),
    async load({ ws, files }) {
      if (!files.length) return { rows: [] };
      const t = await readTable(ws, files[0]);
      const m = mapHeaders(t.columns, ALIAS);
      if (!m.name) throw new KitError("no_task", `Need a task column (任务/task). Columns: ${t.columns.join(", ")}`);
      const holidays = new Set<string>();
      const c = cal(holidays, false);
      return { rows: t.rows.filter((r) => s(r[m.name!])).map((r, i) => {
        const start = m.start ? parseDate(r[m.start]) : "", end = m.end ? parseDate(r[m.end]) : "";
        let dur = m.dur ? num(r[m.dur]) : NaN;
        if (!Number.isFinite(dur)) dur = start && end ? c.between(start, end) : 1;
        return { id: m.id ? s(r[m.id]) || String(i + 1) : String(i + 1), task: s(r[m.name!]), owner: m.owner ? s(r[m.owner]) : "", start, duration: dur, depends: m.deps ? s(r[m.deps]) : "", progress: m.progress ? num(r[m.progress]) || 0 : 0 };
      }) };
    },
    compute(p): Computed {
      const r = plan(p);
      const issues: Issue[] = r.errors.map((e) => ({ level: "error", row: e.i, key: "depends", message: e.msg }));
      const ids = new Map<string, number>();
      p.rows.forEach((row, i) => { const id = s(row.id); if (id && ids.has(id)) issues.push({ level: "error", row: i, key: "id", message: `Task id “${id}” is used twice.` }); ids.set(id, i); });
      for (const x of r.s.values()) if (x.moved) issues.push({ level: "info", row: x.i, key: "start", message: `${s(p.rows[x.i].task)}: its predecessors finish later than the fixed start, so it starts ${x.start}.` });
      const rows = p.rows.map((row, i) => { const t = r.tasks.find((u) => u.i === i); const sc = t && r.s.get(t.id); return { ...row, _start: sc?.start ?? "", _end: sc?.end ?? "", _slack: sc ? sc.slack : "" }; });
      const crit = r.tasks.filter((t) => r.s.get(t.id)?.critical).map((t) => t.id);
      const done = r.tasks.length ? Math.round(r.tasks.reduce((a, t) => a + t.progress * Math.max(t.dur, 0), 0) / Math.max(1, r.tasks.reduce((a, t) => a + Math.max(t.dur, 0), 0))) : 0;
      return { rows, issues, summary: r.end ? `${r.tasks.length} task(s), ${r.start} – ${r.end} (${r.workdays} workdays); critical path ${crit.join(" → ")}; ${done}% done.` : "No tasks yet — add some.", stats: { tasks: r.tasks.length, workdays: r.workdays, critical: crit.length, done: `${done}%` }, preview: ganttSvg(p).replace(/^<svg /, `<svg style="max-width:100%;height:auto" `) };
    },
    exports: [
      { id: "svg", label: ["甘特图 SVG", "Chart (SVG)"], description: "gantt.svg", async run({ project, write }: ExportCtx) { return [await write("gantt.svg", ganttSvg(project))]; } },
      {
        id: "png", label: ["甘特图 PNG", "Chart (PNG)"], description: "gantt.png (2× resolution)",
        async run({ project, write }: ExportCtx) {
          const { fontsFor } = await import("./png.ts");
          const fonts = await fontsFor(assetRoot, "GANTT_PLANNER_FONT");
          const svg = ganttSvg(project, fonts.family);
          return [await write("gantt.png", await svgToPng(assetRoot, svg, Math.min(8000, Number(/width="(\d+)/.exec(svg)![1]) * 2), "GANTT_PLANNER_FONT"))];
        },
      },
      {
        id: "xlsx", label: ["排期 Excel", "Schedule (XLSX)"], description: "schedule.xlsx — tasks with calculated dates, slack and critical flag",
        async run({ project, write }: ExportCtx) {
          const r = plan(project);
          const rows = r.tasks.map((t) => { const x = r.s.get(t.id); return [t.id, t.name, t.owner, x?.start ?? "", x?.end ?? "", t.dur, t.deps.join(", "), t.progress, x?.slack ?? "", x?.critical ? "YES" : ""]; });
          return [await write("schedule.xlsx", await writeXlsx([{ name: "Schedule 排期", headers: ["id", "task", "owner", "start", "end", "workdays", "depends", "progress %", "slack", "critical"], rows, marks: rows.flatMap((x, k) => (x[9] ? [{ row: k, col: 1, color: "#FECACA" }] : [])) }]))];
        },
      },
      { id: "html", label: ["网页", "HTML page"], description: "gantt.html — chart plus task table", async run({ project, write }: ExportCtx) { const t = s(project.settings.title) || project.name; return [await write("gantt.html", htmlPage(t, `<h1>${esc(t)}</h1>${ganttSvg(project)}`))]; } },
    ],
    describeRow: (r, i) => `#${i} [${s(r.id)}] ${s(r.task)} ${s(r._start)}→${s(r._end)} (${s(r.duration)}d)${s(r.depends) ? ` after ${s(r.depends)}` : ""}${s(r.owner) ? ` @${s(r.owner)}` : ""} ${s(r.progress) || 0}%${r._slack === 0 ? " CRITICAL" : ""}`,
  };
}

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(makeDef(options.assetRoot), options).server;
}
