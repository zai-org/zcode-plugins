import type { PDFPage } from "pdf-lib";
import { createApp, type AppDef, type Column, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { mapHeaders } from "./kit/columns.ts";
import { hexRgb, newPdf, PAGE } from "./kit/pdf.ts";
import { writeXlsx } from "./kit/sheet.ts";
import { readTable } from "./kit/table.ts";
import { KitError } from "./kit/workspace.ts";
import { cleanName, matchHeader, mean, parseRubric, parseScore, parseVerdict, r2, VERDICTS, weighted, type Rubric } from "./score.ts";
import { s, yes } from "./util.ts";

export const NAME = "interview-scorecard";
export const VERSION = "0.1.0";
const base = (f: string) => f.split("/").pop()!;
const ck = (i: number) => `c${i}`;
interface Meta { rubric: Rubric; rubricFile: string; ignored: string[] }

function rubricOf(p: Project): Rubric {
  const r = structuredClone((p.meta as unknown as Meta).rubric);
  const w = s(p.settings.weights);
  if (w) for (const part of w.split(/[;；,，\n]/)) {
    const m = /^(.+?)\s*[:：=]?\s*(\d+(?:\.\d+)?)\s*%?$/.exec(part.trim());
    const c = m && r.criteria.find((x) => x.name === m[1].trim() || x.aliases.includes(m[1].trim()));
    if (c) c.weight = +m![2];
  }
  if (Number(p.settings.threshold) > 0) r.threshold = Number(p.settings.threshold);
  return r;
}

const scoresOf = (r: Row, n: number) => Array.from({ length: n }, (_, i) => parseScore(r[ck(i)]));

interface Cand { name: string; entries: { i: number; row: Row; sc: (number | undefined)[]; avg: number }[]; perCrit: number[]; spread: number[]; score: number; verdicts: Record<string, number>; suggestion: string }

function analyse(p: Project) {
  const rb = rubricOf(p), n = rb.criteria.length, spreadMax = Number(p.settings.spread) || 2;
  const valid = (v: number | undefined): v is number => v !== undefined && !isNaN(v) && v >= rb.min && v <= rb.max;
  const rows = p.rows.map((row, i) => ({ i, row, sc: scoresOf(row, n) })).filter((x) => yes(x.row.include) && s(x.row.candidate));
  // 面试官偏松/偏严：与同一候选人其他面试官的平均比较
  const byCand = new Map<string, typeof rows>();
  for (const x of rows) { const k = cleanName(s(x.row.candidate)); byCand.set(k, [...(byCand.get(k) ?? []), x]); }
  const entryAvg = (sc: (number | undefined)[]) => weighted(sc.map((v) => (valid(v) ? v : undefined)), rb.criteria);
  const dev = new Map<string, number[]>();
  for (const list of byCand.values()) for (const x of list) {
    const others = list.filter((y) => y !== x && s(y.row.interviewer) !== s(x.row.interviewer)).map((y) => entryAvg(y.sc)).filter((v) => !isNaN(v));
    const me = entryAvg(x.sc);
    if (others.length && !isNaN(me)) dev.set(s(x.row.interviewer), [...(dev.get(s(x.row.interviewer)) ?? []), me - mean(others)]);
  }
  const lean = new Map([...dev].map(([k, v]) => [k, { n: v.length, d: mean(v) }]));
  const calibrate = yes(p.settings.calibrate);
  const cands: Cand[] = [];
  for (const [name, list] of byCand) {
    // 同一面试官同一轮次重复的，只取最后一条
    const keyed = new Map<string, (typeof list)[number]>();
    for (const x of list) keyed.set(`${s(x.row.interviewer)}|${s(x.row.round)}`, x);
    const use = [...keyed.values()];
    const adj = (x: (typeof use)[number]) => x.sc.map((v) => (valid(v) ? (calibrate && (lean.get(s(x.row.interviewer))?.n ?? 0) >= 2 ? Math.min(rb.max, Math.max(rb.min, v - lean.get(s(x.row.interviewer))!.d)) : v) : undefined));
    const entries = use.map((x) => ({ ...x, avg: entryAvg(x.sc) }));
    const perCrit = rb.criteria.map((_, c) => mean(use.map((x) => adj(x)[c]).filter((v): v is number => v !== undefined)));
    const spread = rb.criteria.map((_, c) => { const v = use.map((x) => adj(x)[c]).filter((y): y is number => y !== undefined); return v.length > 1 ? Math.max(...v) - Math.min(...v) : 0; });
    const score = weighted(perCrit.map((v) => (isNaN(v) ? undefined : v)), rb.criteria);
    const verdicts: Record<string, number> = {};
    for (const x of use) { const v = parseVerdict(x.row.verdict); if (v) verdicts[v] = (verdicts[v] ?? 0) + 1; }
    const split = spread.some((d) => d >= spreadMax) || (verdicts["不推荐"] && (verdicts["推荐"] || verdicts["强烈推荐"]));
    const suggestion = isNaN(score) ? "—" : split ? "需讨论" : score >= rb.threshold ? "建议录用" : score >= rb.threshold - 0.5 ? "待定" : "不建议";
    cands.push({ name, entries, perCrit, spread, score, verdicts, suggestion });
  }
  cands.sort((a, b) => (isNaN(b.score) ? -1 : b.score) - (isNaN(a.score) ? -1 : a.score));
  return { rb, cands, lean, valid, spreadMax };
}

const ff = (x: number) => (isNaN(x) ? "—" : r2(x).toFixed(2));

function makeDef(): AppDef {
  return {
    name: NAME,
    version: VERSION,
    prefix: "scorecard",
    title: ["面试评分表", "Interview Scorecard"],
    openDescription:
      "Combine interview scorecards from several interviewers into one weighted ranking. Pick a folder (or files) with: a criteria Markdown file (# title, a line like “评分：1–5 分，3.5 分以上建议录用”, then “## 维度 30%” headings, alias with “/”, and anchor lines “1 = …”, “3 = …”, “5 = …”), plus one or more score sheets (.xlsx/.csv): one row per candidate × interviewer with columns 候选人/candidate, 面试官/interviewer, 轮次/round, one column per criterion, 结论/verdict (强烈推荐/推荐/待定/不推荐 or strong yes/yes/maybe/no), 评语/comment. Rows: include, candidate, interviewer, round, c0…cN (criterion scores), verdict, comment, file. Settings: threshold (hire bar, default from the criteria file), weights (override, e.g. “数据分析 40; 沟通表达 10”), spread (max-min on one criterion that counts as disagreement, default 2), calibrate (adjust for lenient/strict interviewers). Checks: scores outside the scale (e.g. 45 typed for 4.5), missing scores, duplicate scorecards (same candidate, interviewer and round — the later one is used), interviewers who disagree by ≥ spread, verdicts that contradict the scores, extreme scores (1 or 5) without a comment, lenient or strict interviewers, candidates seen by only one interviewer. Exports ranking.xlsx (ranking, details, interviewer calibration, criteria), scorecards.pdf (one page per candidate) and blank-scorecard.pdf (printable form with anchors).",
    inputs: { exts: [".md", ".txt", ".xlsx", ".csv"], min: 1, max: 50, folders: true, label: ["选择评分维度和评分表", "Pick the criteria and score sheets"] },
    settings: [
      { key: "threshold", label: ["录用线（0=按评分维度文件）", "Hire bar (0 = from criteria file)"], type: "number", default: 0, min: 0, max: 100 },
      { key: "weights", label: ["改权重（如：数据分析 40; 沟通表达 10）", "Weight overrides"], type: "text", default: "" },
      { key: "spread", label: ["分歧阈值（同一维度最高最低分差）", "Disagreement spread"], type: "number", default: 2, min: 0.5, max: 10 },
      { key: "calibrate", label: ["校准面试官松紧", "Calibrate lenient/strict interviewers"], type: "bool", default: false },
    ],
    columns: (p) => [
      { key: "include", label: ["纳入", "Include"], type: "bool" },
      { key: "candidate", label: ["候选人", "Candidate"] },
      { key: "interviewer", label: ["面试官", "Interviewer"] },
      { key: "round", label: ["轮次", "Round"] },
      ...(((p.meta as unknown as Meta)?.rubric?.criteria) ?? []).map((c, i) => ({ key: ck(i), label: [`${c.name}`, `${c.name}`] as [string, string] })),
      { key: "_avg", label: ["加权分", "Weighted"], readOnly: true },
      { key: "verdict", label: ["结论", "Verdict"], type: "select", options: ["", ...VERDICTS] },
      { key: "comment", label: ["评语", "Comment"], wide: true },
      { key: "file", label: ["来源", "Source"], readOnly: true },
    ] as Column[],
    async load({ ws, files }) {
      const list: string[] = [];
      for (const f of files) {
        if (/\.(md|txt|xlsx|csv)$/i.test(f)) list.push(f);
        else for (const x of await ws.list({ dir: f, exts: [".md", ".txt", ".xlsx", ".csv"], limit: 500 })) list.push(x.path);
      }
      const all = [...new Set(list)].filter((f) => !f.startsWith(NAME + "/"));
      const rubricFile = all.find((f) => /\.(md|txt)$/i.test(f) && /维度|标准|criteria|rubric|评分/i.test(base(f))) ?? all.find((f) => /\.(md|txt)$/i.test(f));
      if (!rubricFile) throw new KitError("no_criteria", "No criteria file found. Add a Markdown file with “## 维度 30%” headings (see the tool description).");
      const rubric = parseRubric(await ws.readText(rubricFile));
      if (!rubric.criteria.length) throw new KitError("no_criteria", `${base(rubricFile)} has no “## criterion” headings.`);
      const rows: Row[] = [], ignored = new Set<string>();
      for (const f of all.filter((x) => /\.(xlsx|csv)$/i.test(x))) {
        const t = await readTable(ws, f);
        const h = mapHeaders(t.columns, { candidate: ["候选人", "姓名", "应聘者", "candidate", "name"], interviewer: ["面试官", "评委", "interviewer", "panelist"], round: ["轮次", "面试轮次", "round", "stage"], verdict: ["结论", "推荐意见", "建议", "verdict", "recommendation", "decision"], comment: ["评语", "备注", "依据", "comment", "comments", "notes", "note"] });
        const used = new Set(Object.values(h).filter(Boolean));
        const crit = new Map<string, number>();
        for (const c of t.columns) if (!used.has(c)) { const i = matchHeader(c, rubric.criteria); if (i >= 0) crit.set(c, i); else if (c.trim()) ignored.add(`${base(f)}: ${c}`); }
        for (const r of t.rows) {
          const cand = cleanName(s(h.candidate && r[h.candidate]));
          if (!cand) continue;
          const row: Row = { include: true, candidate: cand, interviewer: s(h.interviewer && r[h.interviewer]), round: s(h.round && r[h.round]), verdict: parseVerdict(h.verdict && r[h.verdict]), comment: s(h.comment && r[h.comment]), file: base(f) };
          for (const [c, i] of crit) row[ck(i)] = s(r[c]);
          rows.push(row);
        }
      }
      if (!rows.length) throw new KitError("no_scores", "No score rows found. Add an .xlsx/.csv with a 候选人/candidate column.");
      return { rows, meta: { rubric, rubricFile, ignored: [...ignored] } satisfies Meta as unknown as Record<string, unknown> };
    },
    compute(p): Computed {
      const m = p.meta as unknown as Meta, { rb, cands, lean, valid, spreadMax } = analyse(p), issues: Issue[] = [], n = rb.criteria.length;
      const totalW = rb.criteria.reduce((a, c) => a + c.weight, 0);
      if (Math.abs(totalW - 100) > 0.5) issues.push({ level: "info", message: `Weights add up to ${r2(totalW)}%, not 100% — scores are still averaged by relative weight.` });
      for (const x of m.ignored) issues.push({ level: "info", message: `Column “${x}” doesn't match a criterion and was ignored.` });
      const seen = new Map<string, number>();
      const rows = p.rows.map((r, i) => {
        const sc = scoresOf(r, n), on = yes(r.include);
        if (on) {
          sc.forEach((v, c) => {
            const crit = rb.criteria[c].name;
            if (v === undefined) issues.push({ level: "warn", row: i, key: ck(c), message: `${s(r.candidate)} / ${s(r.interviewer)}: no score for ${crit}.` });
            else if (!valid(v)) issues.push({ level: "error", row: i, key: ck(c), message: `${s(r.candidate)} / ${s(r.interviewer)}: ${crit} = “${s(r[ck(c)])}” is outside ${rb.min}–${rb.max}${/^\d{2}$/.test(s(r[ck(c)])) && +s(r[ck(c)])[0] <= rb.max ? ` (did they mean ${s(r[ck(c)])[0]}.${s(r[ck(c)])[1]}?)` : ""}.` });
          });
          const k = `${cleanName(s(r.candidate))}|${s(r.interviewer)}|${s(r.round)}`;
          if (seen.has(k)) issues.push({ level: "warn", row: seen.get(k)!, key: "include", message: `${s(r.candidate)} has two scorecards from ${s(r.interviewer)} (${s(r.round) || "same round"}): rows ${seen.get(k)} and ${i}. Only the later one (row ${i}) is used — switch the other off.` });
          seen.set(k, i);
          const avg = weighted(sc.map((v) => (valid(v) ? v : undefined)), rb.criteria), v = parseVerdict(r.verdict);
          if (!isNaN(avg) && ((["推荐", "强烈推荐"].includes(v) && avg < rb.threshold - 0.5) || (v === "不推荐" && avg >= rb.threshold + 0.3)))
            issues.push({ level: "warn", row: i, key: "verdict", message: `${s(r.interviewer)} says “${v}” for ${s(r.candidate)} but their scores average ${ff(avg)} (bar ${rb.threshold}). Ask them which is right.` });
          if (sc.some((x) => x === rb.min || x === rb.max) && !s(r.comment)) issues.push({ level: "info", row: i, key: "comment", message: `${s(r.candidate)} / ${s(r.interviewer)}: extreme score(s) without a comment — ask for the evidence.` });
        }
        return { ...r, _avg: on ? ff(weighted(sc.map((x) => (valid(x) ? x : undefined)), rb.criteria)) : "" };
      });
      for (const c of cands) {
        c.spread.forEach((d, j) => {
          if (d >= spreadMax) { const e = c.entries.filter((x) => valid(x.sc[j])).map((x) => `${s(x.row.interviewer)} ${x.sc[j]}`); issues.push({ level: "warn", message: `${c.name}: interviewers disagree on ${rb.criteria[j].name} (${e.join(" vs ")}). Calibrate before deciding.` }); }
        });
        const who = new Set(c.entries.map((x) => s(x.row.interviewer)));
        if (who.size < 2) issues.push({ level: "info", message: `${c.name} was scored by only one interviewer.` });
      }
      for (const [who, l] of lean) if (l.n >= 2 && Math.abs(l.d) >= (rb.max - rb.min) * 0.15) issues.push({ level: "info", message: `${who} scores ${l.d > 0 ? "higher" : "lower"} than the other interviewers by ${ff(Math.abs(l.d))} on average (${l.n} candidates)${yes(p.settings.calibrate) ? " — adjusted (calibrate on)" : " — turn on calibrate to adjust"}.` });
      return {
        rows,
        issues,
        summary: `${rb.title || "Interview"}: ${cands.length} candidate(s), ${p.rows.filter((r) => yes(r.include)).length} scorecard(s) from ${new Set(p.rows.filter((r) => yes(r.include)).map((r) => s(r.interviewer))).size} interviewer(s); ${n} criteria (${rb.criteria.map((c) => `${c.name} ${r2(c.weight)}%`).join(", ")}); scale ${rb.min}–${rb.max}, bar ${rb.threshold}. Ranking: ${cands.map((c) => `${c.name} ${ff(c.score)} ${c.suggestion}`).join("; ")}.`,
        stats: { candidates: cands.length, hire: cands.filter((c) => c.suggestion === "建议录用").length, discuss: cands.filter((c) => c.suggestion === "需讨论").length },
      };
    },
    exports: [
      { id: "xlsx", label: ["排名 Excel", "Ranking (Excel)"], description: "ranking.xlsx", async run(ctx: ExportCtx) {
        const { rb, cands, lean, valid } = analyse(ctx.project), n = rb.criteria.length;
        const rank = cands.map((c, k) => [k + 1, c.name, isNaN(c.score) ? "" : r2(c.score), c.suggestion, ...c.perCrit.map((v) => (isNaN(v) ? "" : r2(v))), c.entries.length, VERDICTS.filter((v) => c.verdicts[v]).map((v) => `${v}×${c.verdicts[v]}`).join(" ")]);
        const marks = cands.flatMap((c, k) => [{ row: k, col: 3, color: c.suggestion === "建议录用" ? "#BBF7D0" : c.suggestion === "需讨论" ? "#FDE68A" : c.suggestion === "不建议" ? "#FECACA" : "#E5E7EB" }, ...c.spread.flatMap((d, j) => (d >= (Number(ctx.project.settings.spread) || 2) ? [{ row: k, col: 4 + j, color: "#FDE68A", note: `分歧 ${d}` }] : []))]);
        const detail = cands.flatMap((c) => c.entries.map((x) => [c.name, s(x.row.interviewer), s(x.row.round), ...x.sc.map((v) => (valid(v) ? v : "")), isNaN(x.avg) ? "" : r2(x.avg), parseVerdict(x.row.verdict), s(x.row.comment)]));
        return [await ctx.write("ranking.xlsx", await writeXlsx([
          { name: "排名 Ranking", headers: ["#", "候选人", "加权分", "建议", ...rb.criteria.map((c) => `${c.name} ${r2(c.weight)}%`), "评分表数", "面试官结论"], rows: rank, marks, widths: [4, 10, 8, 10, ...rb.criteria.map(() => 11), 8, 24] },
          { name: "明细 Details", headers: ["候选人", "面试官", "轮次", ...rb.criteria.map((c) => c.name), "加权分", "结论", "评语"], rows: detail, widths: [10, 10, 8, ...rb.criteria.map(() => 10), 8, 10, 40] },
          { name: "面试官 Interviewers", headers: ["面试官", "共同面试的候选人数", "比其他面试官平均高/低"], rows: [...lean].map(([k, l]) => [k, l.n, r2(l.d)]) },
          { name: "维度 Criteria", headers: ["维度", "权重%", ...Array.from({ length: rb.max - rb.min + 1 }, (_, i) => `${rb.min + i} 分`)], rows: rb.criteria.map((c) => [c.name, r2(c.weight), ...Array.from({ length: rb.max - rb.min + 1 }, (_, i) => c.anchors[rb.min + i] ?? "")]) },
        ]))];
      } },
      { id: "pdf", label: ["候选人评分卡 PDF", "Scorecards (PDF)"], description: "scorecards.pdf, one page per candidate", async run(ctx: ExportCtx) {
        const { rb, cands, valid } = analyse(ctx.project), k = await newPdf(), [W, H] = PAGE.A4;
        for (const c of cands) {
          const pg = k.doc.addPage([W, H]); let y = H - 56;
          k.text(pg, rb.title || "面试评分", 48, y, { size: 10, color: "#6B7280" }); y -= 26;
          k.text(pg, c.name, 48, y, { size: 22, bold: true });
          k.text(pg, ff(c.score), W - 48, y, { size: 26, bold: true, align: "right", color: c.suggestion === "建议录用" ? "#15803D" : c.suggestion === "不建议" ? "#B91C1C" : "#B45309" });
          y -= 18; k.text(pg, `${c.suggestion} · 录用线 ${rb.threshold} · ${c.entries.length} 份评分表`, W - 48, y, { size: 9, align: "right", color: "#374151" }); y -= 26;
          const cols = c.entries.map((x) => `${s(x.row.interviewer)}${s(x.row.round) ? `·${s(x.row.round)}` : ""}`), x0 = 48, nameW = 120, barW = 120, colW = Math.min(70, (W - 96 - nameW - barW - 40) / Math.max(1, cols.length));
          k.text(pg, "维度（权重）", x0, y, { size: 9, bold: true }); cols.forEach((h, j) => k.text(pg, h, x0 + nameW + j * colW + colW / 2, y, { size: 8, bold: true, align: "center", maxWidth: colW - 4 }));
          k.text(pg, "平均", x0 + nameW + cols.length * colW + 20, y, { size: 9, bold: true, align: "center" }); y -= 6;
          pg.drawLine({ start: { x: x0, y }, end: { x: W - 48, y }, thickness: 0.6, color: hexRgb("#D1D5DB") }); y -= 16;
          rb.criteria.forEach((cr, j) => {
            k.text(pg, `${cr.name}（${r2(cr.weight)}%）`, x0, y, { size: 9.5, maxWidth: nameW - 6 });
            c.entries.forEach((x, e) => k.text(pg, valid(x.sc[j]) ? String(x.sc[j]) : "—", x0 + nameW + e * colW + colW / 2, y, { size: 10, align: "center", color: c.spread[j] >= 2 ? "#B45309" : "#111827" }));
            const ax = x0 + nameW + cols.length * colW + 20, v = c.perCrit[j];
            k.text(pg, ff(v), ax, y, { size: 10, bold: true, align: "center" });
            const bx = ax + 26; pg.drawRectangle({ x: bx, y: y - 1, width: barW, height: 8, color: hexRgb("#F3F4F6") });
            if (!isNaN(v)) pg.drawRectangle({ x: bx, y: y - 1, width: (barW * (v - rb.min)) / (rb.max - rb.min || 1), height: 8, color: hexRgb("#6366F1") });
            y -= 22;
          });
          y -= 6; k.text(pg, "面试官结论与评语", x0, y, { size: 11, bold: true }); y -= 18;
          for (const x of c.entries) {
            if (y < 80) break;
            k.text(pg, `${s(x.row.interviewer)}${s(x.row.round) ? `（${s(x.row.round)}）` : ""} · ${parseVerdict(x.row.verdict) || "未给结论"} · ${ff(x.avg)}`, x0, y, { size: 9.5, bold: true }); y -= 14;
            for (const line of k.wrap(s(x.row.comment) || "（无评语）", 9.5, W - 110)) { k.text(pg, line, x0 + 12, y, { size: 9.5, color: "#374151" }); y -= 13; }
            y -= 6;
          }
          k.text(pg, "加权平均为参考；最终决定请结合面试记录讨论。", x0, 40, { size: 8, color: "#9CA3AF" });
        }
        return [await ctx.write("scorecards.pdf", await k.doc.save())];
      } },
      { id: "blank", label: ["空白评分表 PDF", "Blank scorecard (PDF)"], description: "blank-scorecard.pdf for interviewers to fill in", async run(ctx: ExportCtx) {
        const rb = rubricOf(ctx.project), k = await newPdf(), [W, H] = PAGE.A4;
        let pg = k.doc.addPage([W, H]), y = H - 56;
        const head = (p: PDFPage) => { k.text(p, `${rb.title || "面试评分表"}`, 48, y, { size: 16, bold: true }); y -= 24; k.text(p, "候选人 ____________    面试官 ____________    轮次 ________    日期 ________", 48, y, { size: 10 }); y -= 26; };
        head(pg);
        for (const c of rb.criteria) {
          const anchors = Object.entries(c.anchors).sort((a, b) => +a[0] - +b[0]);
          const need = 40 + anchors.length * 13 + 30;
          if (y - need < 120) { pg = k.doc.addPage([W, H]); y = H - 56; head(pg); }
          k.text(pg, `${c.name}（${r2(c.weight)}%）`, 48, y, { size: 11, bold: true });
          for (let v = rb.min; v <= rb.max; v++) { const bx = W - 48 - (rb.max - v + 1) * 26; pg.drawRectangle({ x: bx, y: y - 4, width: 20, height: 16, borderColor: hexRgb("#9CA3AF"), borderWidth: 0.8 }); k.text(pg, String(v), bx + 10, y, { size: 9, align: "center", color: "#6B7280" }); }
          y -= 16;
          for (const [v, t] of anchors) for (const line of k.wrap(`${v} 分：${t}`, 8.5, W - 120)) { k.text(pg, line, 60, y, { size: 8.5, color: "#4B5563" }); y -= 12; }
          k.text(pg, "依据：", 60, y - 4, { size: 9 }); pg.drawLine({ start: { x: 90, y: y - 6 }, end: { x: W - 48, y: y - 6 }, thickness: 0.5, color: hexRgb("#D1D5DB") }); y -= 30;
        }
        if (y < 130) { pg = k.doc.addPage([W, H]); y = H - 56; }
        k.text(pg, `结论：  □ 强烈推荐   □ 推荐   □ 待定   □ 不推荐        （录用线：加权 ${rb.threshold} 分）`, 48, y, { size: 10.5, bold: true }); y -= 24;
        k.text(pg, "总体评语：", 48, y, { size: 10 }); for (let i = 0; i < 3; i++) { y -= 22; pg.drawLine({ start: { x: 48, y }, end: { x: W - 48, y }, thickness: 0.5, color: hexRgb("#D1D5DB") }); }
        return [await ctx.write("blank-scorecard.pdf", await k.doc.save())];
      } },
    ],
    describeRow: (r, i) => `#${i} ${yes(r.include) ? "" : "(off) "}${s(r.candidate)} / ${s(r.interviewer)} ${s(r.round)} avg ${s(r._avg)} ${s(r.verdict)}`,
  };
}

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(makeDef(), options).server;
}
