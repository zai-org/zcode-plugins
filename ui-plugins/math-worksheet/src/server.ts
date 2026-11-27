import type { PDFPage } from "pdf-lib";
import { createApp, esc, toCsv, type AppDef, type Column, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { hexRgb, MM, newPdf, PAGE, type PdfKit } from "./kit/pdf.ts";
import { KitError } from "./kit/workspace.ts";
import { display, generate, parseExpr, parseOps, parseRange, PRESETS, solve, type Op, type Params, type Problem } from "./gen.ts";

export const NAME = "math-worksheet";
export const VERSION = "0.1.0";
const s = (v: unknown) => String(v ?? "").trim();
const OPS: Op[] = ["+", "-", "×", "÷"];

function paramsOf(settings: Record<string, unknown>): Params {
  const preset = PRESETS[s(settings.preset)];
  if (preset) return preset.p;
  const ops = parseOps(s(settings.ops));
  const a = parseRange(s(settings.rangeA), [1, 99]), b = parseRange(s(settings.rangeB), [1, 99]);
  const max = Number(settings.maxResult) > 0 ? Number(settings.maxResult) : 100000;
  return { ops: ops.length ? ops : ["+"], addA: a, addB: b, sumMax: max, subA: a, subB: b, mulA: a, mulB: b, divisor: [Math.max(1, b[0]), b[1]], quotient: a, remainder: settings.remainder === true, carry: (["yes", "no"].includes(s(settings.carry)) ? s(settings.carry) : "any") as Params["carry"] };
}

const toRow = (p: Problem): Row => ({ locked: false, a: p.a, op: p.op, b: p.b, blank: p.blank });
const fromRow = (r: Row): Problem => ({ a: Number(r.a), op: (OPS.includes(s(r.op) as Op) ? s(r.op) : "+") as Op, b: Number(r.b), blank: (["a", "b"].includes(s(r.blank)) ? s(r.blank) : "answer") as Problem["blank"] });

function drawSheet(k: PdfKit, p: Pick<Project, "rows" | "settings">, answers: boolean) {
  const [W, H] = PAGE.A4, m = 16 * MM;
  const cols = Math.max(1, Math.min(5, Number(p.settings.columns ?? 4)));
  const vertical = s(p.settings.layout) === "vertical";
  const size = Number(p.settings.fontSize ?? 15);
  const probs = p.rows.map(fromRow);
  const rowH = vertical ? size * 6.2 : size * 2.3;
  const head = 62;
  const perPage = Math.max(1, Math.floor((H - 2 * m - head) / rowH)) * cols;
  const cw = (W - 2 * m) / cols;
  for (let start = 0; start < Math.max(1, probs.length); start += perPage) {
    const page: PDFPage = k.doc.addPage(PAGE.A4);
    let y = H - m;
    k.text(page, (s(p.settings.title) || "口算练习") + (answers ? "（答案）Answers" : ""), W / 2, y - 14, { size: 17, bold: true, align: "center" });
    y -= 34;
    if (p.settings.nameLine !== false && !answers) k.text(page, "姓名 ________    班级 ________    日期 ________    用时 ________    得分 ________", W / 2, y, { size: 10, align: "center", color: "#374151" });
    else k.text(page, `${probs.length} 题 problems`, W / 2, y, { size: 9.5, align: "center", color: "#6b7280" });
    y -= 26;
    probs.slice(start, start + perPage).forEach((pr, j) => {
      const i = start + j, c = j % cols, r = Math.floor(j / cols);
      const x = m + c * cw, yy = y - r * rowH;
      k.text(page, `${i + 1}.`, x, yy - size, { size: size * 0.6, color: "#9ca3af" });
      const d = display(pr, answers);
      if (!vertical || pr.blank !== "answer" || pr.op === "÷") {
        // 横式；答案用红色写在等号后
        // 只填得数时去掉等号后面；挖空运算数（□ + 15 = 40）时得数要留着，不然没法算
        const q = display(pr, false).text;
        const left = pr.blank === "answer" ? q.replace(/=.*$/, "= ") : q;
        const lx = x + size * 1.3;
        if (answers) {
          const parts = left;
          k.text(page, parts, lx, yy - size, { size });
          const blankText = pr.blank === "answer" ? d.answer : "";
          if (blankText) k.text(page, blankText, lx + k.width(parts, size), yy - size, { size, color: "#dc2626", bold: true });
          if (pr.blank !== "answer") { k.text(page, display(pr, false).text.replace("□", ` ${d.answer} `), lx, yy - size - size * 1.0, { size: size * 0.7, color: "#dc2626" }); }
        } else k.text(page, left, lx, yy - size, { size });
        return;
      }
      // 竖式
      const right = x + cw - size * 2.2, lw = Math.max(k.width(String(pr.a), size), k.width(`${pr.op} ${pr.b}`, size)) + size * 0.6;
      k.text(page, String(pr.a), right, yy - size, { size, align: "right" });
      k.text(page, `${pr.op}  ${pr.b}`, right, yy - size * 2.3, { size, align: "right" });
      page.drawLine({ start: { x: right - lw, y: yy - size * 2.75 }, end: { x: right + 2, y: yy - size * 2.75 }, thickness: 0.9, color: hexRgb("#111827") });
      if (answers) k.text(page, d.answer, right, yy - size * 4, { size, color: "#dc2626", bold: true, align: "right" });
    });
  }
}

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "math",
  title: ["口算练习生成", "Math Worksheet"],
  openDescription:
    "Generate arithmetic drills with an answer key — no file needed (inputs: []). Pick a preset by grade (settings.preset: g1a within 20, g1b within 100 no carrying, g2a with carrying/borrowing, g2b times tables, g2c division with remainders, g3a 3-digit, g3b 2-digit × 1-digit, g4a 2-digit × 2-digit) or preset \"custom\" with ops (“+-×÷”), rangeA / rangeB (“10-99”), maxResult, carry (any/yes/no) and remainder. count, seed (change it for a new set; same seed = same sheet), blank (answer, or mixed for □ + 5 = 12), layout (horizontal / vertical 竖式), columns. Lock rows to keep them when regenerating. A .txt/.csv with one expression per line (“37+48”, “□-5=12”) can be used instead. Exports worksheet.pdf, answers.pdf and problems.csv.",
  inputs: { exts: [".txt", ".csv"], min: 0, max: 1, label: ["可选：自带题目列表（每行一题）", "Optional: your own problem list (one per line)"] },
  settings: [
    { key: "title", label: ["标题", "Title"], type: "text", default: "口算练习" },
    { key: "preset", label: ["年级题型", "Preset"], type: "select", default: "g2a", reload: true, options: [...Object.entries(PRESETS).map(([v, x]) => ({ value: v, label: x.label })), { value: "custom", label: ["自定义（用下面的设置）", "Custom (use the fields below)"] }] },
    { key: "count", label: ["题数", "Problems"], type: "number", default: 60, min: 1, max: 500, reload: true },
    { key: "seed", label: ["题组编号（换一个数就换一套题）", "Set number (change for new problems)"], type: "number", default: 1, min: 1, reload: true },
    { key: "blank", label: ["挖空", "Blanks"], type: "select", default: "answer", reload: true, options: [{ value: "answer", label: ["只填得数", "Answer only"] }, { value: "mixed", label: ["混合（□ + 5 = 12）", "Mixed (□ + 5 = 12)"] }] },
    { key: "layout", label: ["版式", "Layout"], type: "select", default: "horizontal", options: [{ value: "horizontal", label: ["横式", "Horizontal"] }, { value: "vertical", label: ["竖式", "Vertical (column)"] }] },
    { key: "columns", label: ["每行几题", "Columns"], type: "number", default: 4, min: 1, max: 5 },
    { key: "fontSize", label: ["字号", "Font size"], type: "number", default: 15, min: 9, max: 28 },
    { key: "nameLine", label: ["姓名/用时/得分栏", "Name / time / score line"], type: "bool", default: true },
    { key: "ops", label: ["自定义：运算", "Custom: operations"], type: "text", default: "+-", reload: true, help: ["如 +-×÷", "e.g. +-×÷"] },
    { key: "rangeA", label: ["自定义：第一个数", "Custom: first number"], type: "text", default: "10-99", reload: true },
    { key: "rangeB", label: ["自定义：第二个数（除法为除数）", "Custom: second number (divisor)"], type: "text", default: "1-9", reload: true },
    { key: "maxResult", label: ["自定义：和不超过", "Custom: sums up to"], type: "number", default: 100, min: 0, reload: true },
    { key: "carry", label: ["自定义：进位/退位", "Custom: carrying"], type: "select", default: "any", reload: true, options: [{ value: "any", label: ["不限", "Any"] }, { value: "yes", label: ["必须进位/退位", "Must carry"] }, { value: "no", label: ["不进位/不退位", "No carrying"] }] },
    { key: "remainder", label: ["自定义：除法有余数", "Custom: remainders"], type: "bool", default: false, reload: true },
  ],
  columns: () => [
    { key: "locked", label: ["锁定", "Lock"], type: "bool" },
    { key: "a", label: ["第一个数", "First"], type: "number" },
    { key: "op", label: ["运算", "Op"], type: "select", options: OPS },
    { key: "b", label: ["第二个数", "Second"], type: "number" },
    { key: "blank", label: ["挖空", "Blank"], type: "select", options: ["answer", "a", "b"] },
    { key: "problem", label: ["题目", "Problem"], readOnly: true, wide: true },
    { key: "answer", label: ["答案", "Answer"], readOnly: true },
  ] as Column[],
  async load({ ws, files, settings, previous }) {
    let rows: Row[];
    if (files.length) {
      const text = (await ws.read(files[0], 5 * 1024 * 1024)).toString("utf8").replace(/^\uFEFF/, "");
      const lines = text.split(/\r?\n/).map((l) => l.split(/[,\t]/)[0].trim()).filter(Boolean);
      const probs = lines.map(parseExpr);
      const bad = lines.filter((_, i) => !probs[i]);
      if (!probs.some(Boolean)) throw new KitError("no_problems", `No problems found. Write one per line, e.g. “37+48” or “□-5=12”.`);
      rows = probs.filter((x): x is Problem => !!x).map(toRow);
      return { rows, meta: { from: files[0], skipped: bad.slice(0, 20) } };
    }
    const count = Math.max(1, Math.min(500, Number(settings.count ?? 60)));
    const gen = generate(paramsOf(settings), count, Number(settings.seed ?? 1), s(settings.blank) === "mixed" ? "mixed" : "answer");
    rows = gen.map(toRow);
    (previous ?? []).forEach((r, i) => { if (r.locked === true && i < rows.length) rows[i] = { ...r }; });
    return { rows, meta: { from: "", skipped: [] } };
  },
  compute(p): Computed {
    const issues: Issue[] = [];
    const meta = p.meta as { skipped?: string[] };
    if (meta.skipped?.length) issues.push({ level: "warn", message: `Skipped lines that aren't problems: ${meta.skipped.join(" | ")} / 跳过无法识别的行` });
    const wanted = Number(p.settings.count ?? 60);
    if (!s((p.meta as { from?: string }).from) && p.rows.length < wanted) issues.push({ level: "warn", message: `Only ${p.rows.length} different problems fit these ranges (asked for ${wanted}) — widen the ranges / 范围太窄，题目不够` });
    const seen = new Map<string, number>();
    const rows = p.rows.map((r, i) => {
      const pr = fromRow(r), sol = solve(pr);
      if (sol.error) issues.push({ level: "error", row: i, key: sol.error === "division by zero" ? "b" : "a", message: `Problem ${i + 1}: ${sol.error} / 第 ${i + 1} 题无效` });
      else {
        if (sol.value! < 0) issues.push({ level: "warn", row: i, message: `Problem ${i + 1} has a negative answer (${sol.value}) / 得数为负` });
        if (pr.op === "÷" && !Number.isInteger(sol.value!)) issues.push({ level: "warn", row: i, message: `Problem ${i + 1} has a decimal answer / 得数是小数` });
        if (pr.blank !== "answer" && pr.op === "÷" && sol.rem) issues.push({ level: "error", row: i, key: "blank", message: `Problem ${i + 1}: a □ blank needs an exact division / 有余数的除法不能挖空运算数` });
      }
      const key = `${pr.a}${pr.op}${pr.b}${pr.blank}`;
      if (seen.has(key)) issues.push({ level: "info", row: i, message: `Problem ${i + 1} repeats problem ${seen.get(key)! + 1} / 与第 ${seen.get(key)! + 1} 题重复` });
      else seen.set(key, i);
      const d = display(pr, false);
      return { ...r, problem: d.text, answer: sol.error ? "" : d.answer };
    });
    const ops = OPS.map((o) => [o, p.rows.filter((r) => s(r.op) === o).length] as const).filter(([, n]) => n);
    const locked = p.rows.filter((r) => r.locked === true).length;
    return {
      rows,
      issues,
      summary: `${p.rows.length} problems (${ops.map(([o, n]) => `${o} ${n}`).join(", ")})${locked ? `, ${locked} locked` : ""}. ${p.rows.length} 道题。`,
      stats: { problems: p.rows.length, locked, ...Object.fromEntries(ops.map(([o, n]) => [{ "+": "add", "-": "sub", "×": "mul", "÷": "div" }[o], n])) },
      preview: `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:4px 12px;font-size:14px;font-family:ui-monospace,monospace">${rows.slice(0, 40).map((r, i) => `<div><span class="muted" style="font-size:10px">${i + 1}.</span> ${esc(s(r.problem).replace(/=\s*$/, "= ___"))}</div>`).join("")}</div>${rows.length > 40 ? `<p class="muted">… ${rows.length - 40} more</p>` : ""}`,
    };
  },
  exports: [
    {
      id: "pdf", label: ["练习卷 PDF", "Worksheet (PDF)"], description: "worksheet.pdf — the problems on A4 with a name/time/score line",
      async run({ project, write, computed }: ExportCtx) {
        if ((computed.issues ?? []).some((i) => i.level === "error")) throw new KitError("has_errors", "Fix the errors first (see the issue list).");
        const k = await newPdf(); drawSheet(k, project, false);
        return [await write("worksheet.pdf", await k.doc.save())];
      },
    },
    {
      id: "answers", label: ["答案 PDF", "Answer key (PDF)"], description: "answers.pdf — the same layout with answers in red",
      async run({ project, write, computed }: ExportCtx) {
        if ((computed.issues ?? []).some((i) => i.level === "error")) throw new KitError("has_errors", "Fix the errors first (see the issue list).");
        const k = await newPdf(); drawSheet(k, project, true);
        return [await write("answers.pdf", await k.doc.save())];
      },
    },
    {
      id: "csv", label: ["题目 CSV", "Problems (CSV)"], description: "problems.csv — number, problem, answer",
      async run({ project, write }: ExportCtx) {
        return [await write("problems.csv", toCsv(["no", "problem", "answer"], project.rows.map((r, i) => { const d = display(fromRow(r), false); return [i + 1, d.text, d.answer]; })))];
      },
    },
  ],
  // 手动改过的题自动锁定，换题组时保留
  onCellEdit: (row, key) => { if (["a", "op", "b", "blank"].includes(key)) row.locked = true; },
  describeRow: (r, i) => `#${i}${r.locked ? " [locked]" : ""} ${display(fromRow(r), true).text}`,
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
