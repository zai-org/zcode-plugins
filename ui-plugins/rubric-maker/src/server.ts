import type { PDFPage } from "pdf-lib";
import { createApp, type AppDef, type Column, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { mapHeaders } from "./kit/columns.ts";
import { hexRgb, newPdf, PAGE } from "./kit/pdf.ts";
import { writeXlsx } from "./kit/sheet.ts";
import { readTable } from "./kit/table.ts";
import { KitError } from "./kit/workspace.ts";
import { levelOf, maxOf, parseRubric, r1, type Rubric } from "./rubric.ts";
import { s, yes } from "./util.ts";

export const NAME = "rubric-maker";
export const VERSION = "0.1.0";
const base = (f: string) => f.split("/").pop()!;
const ck = (i: number) => `c${i}`;
interface Meta { rubric: Rubric; rubricFile: string; roster: string }

const rubricOf = (p: Project) => (p.meta as unknown as Meta).rubric;
const totalOf = (p: Project) => Number(p.settings.total) || rubricOf(p).total;

interface Graded { row: Row; i: number; levels: (string | undefined)[]; raw: number; score: number; done: number; feedback: { strong: string[]; next: string[] } }

function grade(p: Project): Graded[] {
  const R = rubricOf(p), max = maxOf(R), total = totalOf(p);
  return p.rows.map((row, i) => {
    const levels = R.criteria.map((_, c) => levelOf(row[ck(c)], R));
    let raw = 0, done = 0;
    const strong: string[] = [], gaps: { li: number; t: string }[] = [];
    levels.forEach((l, c) => {
      const li = R.levels.findIndex((x) => x.name === l);
      if (li < 0) return;
      done++; raw += R.levels[li].points * R.criteria[c].mult;
      const cr = R.criteria[c], up = R.levels[li - 1]?.name;
      if (li === 0) strong.push(`${cr.name}：${cr.desc[R.levels[0].name] ?? R.levels[0].name}`);
      else gaps.push({ li, t: `${cr.name}：${cr.desc[up] ? `争取做到“${cr.desc[up]}”` : `争取达到${up}`}` });
    });
    const next = gaps.sort((a, b) => b.li - a.li).slice(0, 2).map((x) => x.t);
    return { row, i, levels, raw, score: max ? (raw / max) * total : 0, done, feedback: { strong, next } };
  });
}

function makeDef(): AppDef {
  return {
    name: NAME,
    version: VERSION,
    prefix: "rubric",
    title: ["评分量规", "Rubric Maker"],
    openDescription:
      "Build a grading rubric (criteria × levels) and score a class against it. Pick a folder (or files) with a rubric Markdown file — “# title”, “满分：20 分”, “等级：优秀 4 | 良好 3 | 合格 2 | 待改进 1”, then one “## criterion” per criterion, optionally weighted “## 论点 ×2” or “## 论据（8 分）”, with “- 优秀：descriptor” lines — and optionally a roster (.csv/.xlsx with 学号/姓名, and level columns named after the criteria, plus 评语). Rows: one per student: include, id, name, c0…cN (chosen level per criterion: level name, its first character, A/B/C/D or the points), _score (scaled to 满分), comment, _feedback (auto: strengths from top-level descriptors, next steps from the descriptor one level up). Settings: total (满分 override), title. Checks: level values that aren't in the rubric (e.g. 5 on a 4-point scale), students only partly scored or not scored, duplicate students, criteria missing a descriptor for a level, criterion points not adding up to 满分 (scores are then scaled), criteria where everyone got the same level. Exports rubric.pdf (the rubric table to hand out), scores.xlsx (scores, levels, rank, distribution per criterion) and feedback.pdf (one feedback slip per student, three per page).",
    inputs: { exts: [".md", ".txt", ".csv", ".xlsx"], min: 1, max: 20, folders: true, label: ["选择量规和学生名单", "Pick the rubric and roster"] },
    settings: [
      { key: "title", label: ["标题（留空=按量规）", "Title (blank = rubric)"], type: "text", default: "" },
      { key: "total", label: ["满分（0=按量规）", "Total marks (0 = rubric)"], type: "number", default: 0, min: 0, max: 1000 },
    ],
    columns: (p) => [
      { key: "include", label: ["纳入", "Include"], type: "bool" },
      { key: "id", label: ["学号", "ID"] },
      { key: "name", label: ["姓名", "Name"] },
      ...((p.meta as unknown as Meta)?.rubric?.criteria ?? []).map((c, i) => ({ key: ck(i), label: [c.mult !== 1 ? `${c.name}×${r1(c.mult)}` : c.name, c.name] as [string, string], type: "select" as const, options: ["", ...(p.meta as unknown as Meta).rubric.levels.map((l) => l.name)] })),
      { key: "_score", label: ["得分", "Score"], readOnly: true },
      { key: "comment", label: ["评语", "Comment"], wide: true },
      { key: "_feedback", label: ["反馈（自动）", "Feedback"], readOnly: true, wide: true },
    ] as Column[],
    async load({ ws, files }) {
      const list: string[] = [];
      for (const f of files) {
        if (/\.(md|txt|csv|xlsx)$/i.test(f)) list.push(f);
        else for (const x of await ws.list({ dir: f, exts: [".md", ".txt", ".csv", ".xlsx"], limit: 200 })) list.push(x.path);
      }
      const all = [...new Set(list)].filter((f) => !f.startsWith(NAME + "/"));
      const rubricFile = all.find((f) => /\.(md|txt)$/i.test(f) && /量规|评分|标准|rubric/i.test(base(f))) ?? all.find((f) => /\.(md|txt)$/i.test(f));
      if (!rubricFile) throw new KitError("no_rubric", "No rubric file found. Add a Markdown file with “## criterion” headings and “- 优秀：…” descriptors.");
      const rubric = parseRubric(await ws.readText(rubricFile));
      if (!rubric.criteria.length) throw new KitError("no_rubric", `${base(rubricFile)} has no “## criterion” headings.`);
      const roster = all.find((f) => /\.(csv|xlsx)$/i.test(f));
      const rows: Row[] = [];
      if (roster) {
        const t = await readTable(ws, roster);
        const h = mapHeaders(t.columns, { id: ["学号", "编号", "座号", "id", "student id", "no"], name: ["姓名", "学生", "name", "student"], comment: ["评语", "备注", "comment", "comments", "note"] });
        const crit = new Map<string, number>();
        for (const c of t.columns) { const i = rubric.criteria.findIndex((x) => x.name === c.trim() || c.includes(x.name)); if (i >= 0 && !crit.has(c)) crit.set(c, i); }
        for (const r of t.rows) {
          const name = s(h.name && r[h.name]), id = s(h.id && r[h.id]);
          if (!name && !id) continue;
          const row: Row = { include: true, id, name, comment: s(h.comment && r[h.comment]) };
          rubric.criteria.forEach((_, i) => { row[ck(i)] = ""; });
          for (const [c, i] of crit) row[ck(i)] = s(r[c]);
          rows.push(row);
        }
      }
      if (!rows.length) rows.push({ include: true, id: "", name: "", comment: "", ...Object.fromEntries(rubric.criteria.map((_, i) => [ck(i), ""])) });
      return { rows, meta: { rubric, rubricFile, roster: roster ?? "" } satisfies Meta as unknown as Record<string, unknown> };
    },
    compute(p): Computed {
      const R = rubricOf(p), m = p.meta as unknown as Meta, issues: Issue[] = [], max = maxOf(R), total = totalOf(p);
      if (Math.abs(max - total) > 0.01) issues.push({ level: "warn", message: `The criteria add up to ${r1(max)} points (top level ${R.levels[0].points} × weights) but 满分 is ${total}. Scores are scaled to ${total}; change the weights in the rubric if that's not intended.` });
      for (const c of R.criteria) { const miss = R.levels.filter((l) => !c.desc[l.name]).map((l) => l.name); if (miss.length) issues.push({ level: "warn", message: `Criterion “${c.name}” has no descriptor for ${miss.join("、")}. Students who get that level won't see what it means — add “- ${miss[0]}：…” to ${base(m.rubricFile)}.` }); }
      if (!m.roster) issues.push({ level: "info", message: "No roster found — add rows for students (id, name) or a .csv with 学号/姓名." });
      const g = grade(p), seen = new Map<string, number>();
      for (const x of g) {
        if (!yes(x.row.include)) continue;
        const who = s(x.row.name) || s(x.row.id) || `row ${x.i}`;
        const k = s(x.row.id) || s(x.row.name);
        if (k && seen.has(k)) issues.push({ level: "warn", row: x.i, key: "include", message: `${who} (${s(x.row.id)}) appears twice: rows ${seen.get(k)} and ${x.i}. Switch one off.` });
        if (k) seen.set(k, x.i);
        x.levels.forEach((l, c) => { if (l === undefined) issues.push({ level: "error", row: x.i, key: ck(c), message: `${who}: “${s(x.row[ck(c)])}” for ${R.criteria[c].name} is not a level (${R.levels.map((v) => `${v.name} ${v.points}`).join(" / ")}).` }); });
        const empty = x.levels.filter((l) => l === "").length;
        if (empty === R.criteria.length) issues.push({ level: "info", row: x.i, key: ck(0), message: `${who} is not scored yet${s(x.row.comment) ? ` (${s(x.row.comment)})` : ""} — left out of the statistics.` });
        else if (empty) issues.push({ level: "warn", row: x.i, key: ck(x.levels.findIndex((l) => l === "")), message: `${who}: ${x.levels.map((l, c) => (l === "" ? R.criteria[c].name : "")).filter(Boolean).join("、")} not scored — the score counts it as 0.` });
      }
      const scored = g.filter((x) => yes(x.row.include) && x.done === R.criteria.length);
      R.criteria.forEach((c, j) => { const lv = new Set(scored.map((x) => x.levels[j])); if (scored.length >= 5 && lv.size === 1) issues.push({ level: "info", message: `Everyone got ${[...lv][0]} on ${c.name} — the criterion may not be telling students apart.` }); });
      const rows = p.rows.map((r, i) => { const x = g[i]; return { ...r, _score: x.done ? r1(x.score) : "", _feedback: x.done ? [x.feedback.strong.length ? `优点：${x.feedback.strong.join("；")}` : "", x.feedback.next.length ? `下一步：${x.feedback.next.join("；")}` : ""].filter(Boolean).join("\n") : "" }; });
      const avg = scored.length ? scored.reduce((a, x) => a + x.score, 0) / scored.length : NaN;
      return {
        rows,
        issues,
        summary: `${R.title || "Rubric"}: ${R.criteria.length} criteria (${R.criteria.map((c) => `${c.name} ${r1(c.mult * R.levels[0].points)}`).join(", ")}) × ${R.levels.length} levels (${R.levels.map((l) => l.name).join("/")}), 满分 ${total}. ${scored.length} of ${p.rows.filter((r) => yes(r.include)).length} student(s) fully scored${scored.length ? `, average ${r1(avg)}, range ${r1(Math.min(...scored.map((x) => x.score)))}–${r1(Math.max(...scored.map((x) => x.score)))}` : ""}.`,
        stats: { students: p.rows.length, scored: scored.length, average: isNaN(avg) ? 0 : r1(avg) },
      };
    },
    exports: [
      { id: "rubric", label: ["量规表 PDF", "Rubric (PDF)"], description: "rubric.pdf", async run(ctx: ExportCtx) {
        const R = rubricOf(ctx.project), k = await newPdf(), [H, W] = PAGE.A4, pg = k.doc.addPage([W, H]), X = 36;
        let y = H - 46;
        k.text(pg, s(ctx.project.settings.title) || R.title || "评分量规", W / 2, y, { size: 16, bold: true, align: "center" }); y -= 18;
        k.text(pg, `满分 ${totalOf(ctx.project)} 分`, W / 2, y, { size: 9, align: "center", color: "#6B7280" }); y -= 16;
        const firstW = 100, lw = (W - 2 * X - firstW) / R.levels.length, scale = totalOf(ctx.project) / (maxOf(R) || 1);
        const cell = (x: number, w: number, h: number, lines: string[], fill?: string, bold = false) => { pg.drawRectangle({ x, y: y - h, width: w, height: h, borderColor: hexRgb("#9CA3AF"), borderWidth: 0.6, color: fill ? hexRgb(fill) : undefined }); lines.forEach((l, i) => k.text(pg, l, x + 5, y - 13 - i * 12, { size: 9, bold: bold || (i === 0 && !!fill) })); };
        const head = ["维度", ...R.levels.map((l) => l.name)];
        cell(X, firstW, 22, [head[0]], "#E0E7FF", true); R.levels.forEach((l, i) => cell(X + firstW + i * lw, lw, 22, [`${l.name}`], "#E0E7FF", true)); y -= 22;
        for (const c of R.criteria) {
          const texts = R.levels.map((l) => [`${r1(l.points * c.mult * scale)} 分`, ...k.wrap(c.desc[l.name] ?? "—", 9, lw - 10)]);
          const h = Math.max(2, ...texts.map((t) => t.length)) * 12 + 10;
          cell(X, firstW, h, [c.name, `（${r1(R.levels[0].points * c.mult * scale)} 分）`], "#F3F4F6", true);
          texts.forEach((t, i) => cell(X + firstW + i * lw, lw, h, t));
          y -= h;
        }
        return [await ctx.write("rubric.pdf", await k.doc.save())];
      } },
      { id: "xlsx", label: ["成绩表 Excel", "Scores (Excel)"], description: "scores.xlsx", async run(ctx: ExportCtx) {
        const p = ctx.project, R = rubricOf(p), g = grade(p).filter((x) => yes(x.row.include)), scale = totalOf(p) / (maxOf(R) || 1);
        const order = [...g].sort((a, b) => b.score - a.score), rank = new Map(order.map((x, i) => [x.i, x.done ? order.findIndex((y) => y.score === x.score) + 1 : ""]));
        const rows = g.map((x) => [s(x.row.id), s(x.row.name), ...x.levels.flatMap((l, c) => { const lv = R.levels.find((v) => v.name === l); return [l ?? s(x.row[ck(c)]), lv ? r1(lv.points * R.criteria[c].mult * scale) : ""]; }), x.done ? r1(x.score) : "", rank.get(x.i) ?? "", s(x.row.comment)]);
        const marks = g.flatMap((x, k) => x.levels.flatMap((l, c) => (l === undefined || l === "" ? [{ row: k, col: 2 + c * 2, color: l === undefined ? "#FECACA" : "#FDE68A" }] : [])));
        const dist = R.criteria.map((c, j) => [c.name, ...R.levels.map((l) => g.filter((x) => x.levels[j] === l.name).length)]);
        return [await ctx.write("scores.xlsx", await writeXlsx([
          { name: "成绩 Scores", headers: ["学号", "姓名", ...R.criteria.flatMap((c) => [c.name, `${c.name}得分`]), `总分（${totalOf(p)}）`, "名次", "评语"], rows, marks },
          { name: "分布 Distribution", headers: ["维度", ...R.levels.map((l) => l.name)], rows: dist },
        ]))];
      } },
      { id: "feedback", label: ["反馈单 PDF", "Feedback slips (PDF)"], description: "feedback.pdf, three slips per page", async run(ctx: ExportCtx) {
        const p = ctx.project, R = rubricOf(p), k = await newPdf(), [W, H] = PAGE.A4, slipH = (H - 40) / 3, scale = totalOf(p) / (maxOf(R) || 1);
        const g = grade(p).filter((x) => yes(x.row.include) && x.done);
        let pg: PDFPage | undefined;
        g.forEach((x, n) => {
          if (n % 3 === 0) pg = k.doc.addPage([W, H]);
          const top = H - 20 - (n % 3) * slipH; let y = top - 26;
          if (n % 3) pg!.drawLine({ start: { x: 30, y: top }, end: { x: W - 30, y: top }, thickness: 0.6, dashArray: [4, 3], color: hexRgb("#9CA3AF") });
          k.text(pg!, `${s(x.row.name)}${s(x.row.id) ? `（${s(x.row.id)}）` : ""}`, 44, y, { size: 13, bold: true });
          k.text(pg!, `${r1(x.score)} / ${totalOf(p)}`, W - 44, y, { size: 14, bold: true, align: "right", color: "#1D4ED8" });
          k.text(pg!, s(p.settings.title) || R.title, 44, y - 14, { size: 8.5, color: "#6B7280" }); y -= 34;
          x.levels.forEach((l, c) => {
            const cr = R.criteria[c], lv = R.levels.find((v) => v.name === l);
            k.text(pg!, `${cr.name}`, 44, y, { size: 9.5, bold: true });
            k.text(pg!, lv ? `${l} · ${r1(lv.points * cr.mult * scale)}/${r1(R.levels[0].points * cr.mult * scale)}` : `未评 · 0/${r1(R.levels[0].points * cr.mult * scale)}`, 110, y, { size: 9.5, color: !lv ? "#9CA3AF" : lv === R.levels[0] ? "#15803D" : lv === R.levels.at(-1) ? "#B91C1C" : "#111827" });
            if (lv) k.text(pg!, k.wrap(cr.desc[lv.name] ?? "", 8.5, W - 300)[0] ?? "", 200, y, { size: 8.5, color: "#4B5563" }); y -= 14;
          });
          y -= 4;
          for (const [label, list] of [["优点", x.feedback.strong], ["下一步", x.feedback.next]] as const) {
            if (!list.length) continue;
            for (const [li, line] of k.wrap(`${label}：${list.join("；")}`, 9, W - 100).entries()) { if (y < top - slipH + 16) break; k.text(pg!, line, 44 + (li ? 12 : 0), y, { size: 9, bold: li === 0 && false }); y -= 12; }
          }
          if (s(x.row.comment) && y > top - slipH + 16) k.text(pg!, `老师评语：${s(x.row.comment)}`, 44, y, { size: 9, color: "#7C2D12", maxWidth: W - 88 });
        });
        if (!g.length) { const pg2 = k.doc.addPage([W, H]); k.text(pg2, "没有已评分的学生", W / 2, H / 2, { size: 14, align: "center" }); }
        return [await ctx.write("feedback.pdf", await k.doc.save())];
      } },
    ],
    newRow: (p) => ({ include: true, id: "", name: "", comment: "", ...Object.fromEntries(rubricOf(p).criteria.map((_, i) => [ck(i), ""])) }),
    describeRow: (r, i) => `#${i} ${yes(r.include) ? "" : "(off) "}${s(r.id)} ${s(r.name)}: ${Object.keys(r).filter((k) => /^c\d+$/.test(k)).map((k) => s(r[k]) || "·").join(" ")} → ${s(r._score) || "—"}`,
  };
}

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(makeDef(), options).server;
}
