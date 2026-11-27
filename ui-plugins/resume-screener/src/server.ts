import { createApp, type AppDef, type Column, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { writeXlsx } from "./kit/sheet.ts";
import { KitError } from "./kit/workspace.ts";
import { fromDocx, fromMarkdown, fromPdf, fromText } from "./extract.ts";
import { DEGREES, degreeOf, emailOf, groupHit, groupsOf, parseJd, phoneOf, workYears, type Group, type Jd } from "./screen.ts";
import { s, yes } from "./util.ts";

export const NAME = "resume-screener";
export const VERSION = "0.1.0";
const EXTS = [".docx", ".pdf", ".md", ".txt"];
const base = (f: string) => f.split("/").pop()!;
const STATUS = ["待定", "面试", "备选", "不合适"];

interface Meta { jd?: Jd; jdFile?: string; texts?: Record<string, string> }

function criteria(p: Project) {
  const jd = (p.meta as Meta).jd ?? { title: "", minYears: 0, degree: "", must: [], nice: [], flagged: [] };
  const list = (v: string, d: Group[]) => (s(v) ? s(v).split(/[;；\n]/).map((x) => x.trim()).filter(Boolean).flatMap((x) => groupsOf(x.replace(/\s*\|\s*/g, " 或 "))) : d);
  return { must: list(s(p.settings.must), jd.must), nice: list(s(p.settings.nice), jd.nice), minYears: Number(p.settings.minYears) || jd.minYears, degree: s(p.settings.degree) || jd.degree, jd };
}

function evaluate(p: Project, file: string) {
  const text = (p.meta as Meta).texts?.[file] ?? "", c = criteria(p), now = new Date().getFullYear() * 12 + new Date().getMonth();
  const mustHit = c.must.map((g) => ({ g, hit: groupHit(text, g) })), niceHit = c.nice.map((g) => ({ g, hit: groupHit(text, g) }));
  const years = workYears(text, now), degree = degreeOf(text);
  const yOk = !c.minYears || years >= c.minYears, dOk = !c.degree || DEGREES.indexOf(degree) >= DEGREES.indexOf(c.degree);
  const max = c.must.length * 2 + c.nice.length + (c.minYears ? 2 : 0) + (c.degree ? 1 : 0);
  const got = mustHit.filter((x) => x.hit).length * 2 + niceHit.filter((x) => x.hit).length + (c.minYears && yOk ? 2 : 0) + (c.degree && dOk ? 1 : 0);
  return {
    score: max ? Math.round((got / max) * 100) : 0, years, degree, yOk, dOk,
    matched: [...mustHit, ...niceHit].filter((x) => x.hit).map((x) => x.hit!),
    missingMust: mustHit.filter((x) => !x.hit).map((x) => x.g.alts.join("/")),
    missingNice: niceHit.filter((x) => !x.hit).map((x) => x.g.alts.join("/")),
  };
}

function ranked(p: Project) {
  return p.rows.map((r, i) => ({ r, i, e: evaluate(p, s(r.file)) })).filter((x) => yes(x.r.include)).sort((a, b) => b.e.score - a.e.score || b.e.matched.length - a.e.matched.length || b.e.years - a.e.years);
}

function makeDef(): AppDef {
  return {
    name: NAME,
    version: VERSION,
    prefix: "screen",
    title: ["简历初筛", "Resume Screener"],
    openDescription:
      "Screen a batch of resumes against a job description, locally. Pick the folder with the JD (.md/.txt whose name contains 岗位/JD/职位/job, or the first .md at the top) and the resumes (.docx, .pdf with text, .md, .txt; Chinese or English). From the JD it reads must-have requirements (任职要求 / Requirements), nice-to-haves (加分项 / Preferred), minimum years and degree; within a requirement “A 或 B” means either. Each row is one candidate: include, file, name, score (0–100), years (merged work date ranges), degree, matched, missing (must-haves not found), email, phone, status (待定/面试/备选/不合适), note. Settings override the JD: must, nice (requirements separated by ; — alternatives with |), minYears, degree. Age, gender, marital status and similar JD requirements are ignored and flagged. Checks: duplicate candidates (same email/phone), unreadable resumes, missing contact info, candidates below the minimum years. Exports shortlist.xlsx (ranked) and shortlist.md. Keyword matching only — a person must make the decision.",
    inputs: { exts: EXTS, min: 1, max: 300, folders: true, label: ["选择岗位说明和简历文件夹", "Pick the JD and resumes folder"] },
    settings: [
      { key: "must", label: ["必须项（留空=取岗位说明；; 分隔，| 表示任一）", "Must-haves (blank = from JD)"], type: "text", default: "" },
      { key: "nice", label: ["加分项（留空=取岗位说明）", "Nice-to-haves (blank = from JD)"], type: "text", default: "" },
      { key: "minYears", label: ["最低工作年限（0=取岗位说明）", "Minimum years (0 = from JD)"], type: "number", default: 0, min: 0, max: 40 },
      { key: "degree", label: ["最低学历（留空=取岗位说明）", "Minimum degree"], type: "select", default: "", options: [{ value: "", label: ["按岗位说明", "From JD"] }, ...DEGREES.map((d) => ({ value: d, label: [d, d] as [string, string] }))] },
    ],
    columns: () => [
      { key: "include", label: ["纳入", "Include"], type: "bool" },
      { key: "file", label: ["简历", "Resume"], readOnly: true },
      { key: "name", label: ["姓名", "Name"] },
      { key: "_score", label: ["匹配分", "Score"], readOnly: true },
      { key: "_years", label: ["年限", "Years"], readOnly: true },
      { key: "_degree", label: ["学历", "Degree"], readOnly: true },
      { key: "_matched", label: ["命中", "Matched"], readOnly: true },
      { key: "_missing", label: ["缺少（必须项）", "Missing must-haves"], readOnly: true },
      { key: "email", label: ["邮箱", "Email"] },
      { key: "phone", label: ["电话", "Phone"] },
      { key: "status", label: ["状态", "Status"], type: "select", options: STATUS },
      { key: "note", label: ["备注", "Note"] },
    ] as Column[],
    async load({ ws, files, previous }) {
      const list: string[] = [];
      for (const f of files) {
        if (EXTS.some((e) => f.toLowerCase().endsWith(e))) list.push(f);
        else for (const x of await ws.list({ dir: f, exts: EXTS, limit: 1000 })) list.push(x.path);
      }
      const all = [...new Set(list)].filter((f) => !f.startsWith(NAME + "/"));
      const depth = (f: string) => f.split("/").length, deepest = Math.max(...all.map(depth));
      const jdFile = all.find((f) => /岗位|职位|招聘需求|jd|job|position/i.test(base(f)) && /\.(md|txt)$/i.test(f)) ?? all.find((f) => /\.(md|txt)$/i.test(f) && depth(f) < deepest);
      const resumes = all.filter((f) => f !== jdFile);
      if (!resumes.length) throw new KitError("no_resumes", "No resumes found (.docx, .pdf, .md, .txt).");
      const texts: Record<string, string> = {}, rows: Row[] = [];
      for (const f of resumes) {
        const low = f.toLowerCase(), bytes = new Uint8Array(await ws.read(f));
        let paras: { t: string }[] = [];
        try { paras = low.endsWith(".docx") ? fromDocx(bytes) : low.endsWith(".pdf") ? await fromPdf(bytes) : low.endsWith(".md") ? fromMarkdown(new TextDecoder().decode(bytes)) : fromText(new TextDecoder().decode(bytes)); } catch { paras = []; }
        const text = paras.map((x) => x.t).join("\n");
        texts[f] = text;
        const prev = previous?.find((r) => s(r.file) === f);
        if (prev) { rows.push(prev); continue; }
        const first = text.split("\n").map((x) => x.replace(/^#+\s*/, "").trim()).find(Boolean) ?? "";
        rows.push({ include: true, file: f, name: first.length <= 30 ? first : base(f).replace(/\.[^.]+$/, ""), email: emailOf(text), phone: phoneOf(text), status: "待定", note: "" });
      }
      const jd = jdFile ? parseJd(await ws.readText(jdFile)) : undefined;
      return { rows, meta: { jd, jdFile: jdFile ?? "", texts } satisfies Meta as unknown as Record<string, unknown> };
    },
    compute(p): Computed {
      const m = p.meta as Meta, c = criteria(p), issues: Issue[] = [];
      if (!m.jdFile && !s(p.settings.must)) issues.push({ level: "error", message: "No job description found (a .md/.txt named 岗位/JD/job) and no must-haves set. Add the JD or set must." });
      if (m.jdFile && !c.must.length && !c.nice.length) issues.push({ level: "warn", message: `No requirements found in ${base(m.jdFile)}. Put them as bullets under a “任职要求 / Requirements” heading, or set must.` });
      if (c.jd.flagged.length) issues.push({ level: "warn", message: `The JD asks for ${c.jd.flagged.map((x) => `“${x}”`).join(", ")}. These are ignored in scoring. Gender requirements in job ads are prohibited in China (Employment Promotion Law) and many other places, and age limits are widely seen as discriminatory — consider removing them.` });
      const seen = new Map<string, number>();
      let full = 0;
      const rows = p.rows.map((r, i) => {
        const f = s(r.file), text = m.texts?.[f] ?? "";
        if (text.replace(/\s/g, "").length < 30) { issues.push({ level: "error", row: i, key: "file", message: `${base(f)} has no readable text${f.toLowerCase().endsWith(".pdf") ? " (a scanned PDF? run OCR first)" : ""}.` }); return { ...r, _score: "", _years: "", _degree: "", _matched: "", _missing: "" }; }
        const e = evaluate(p, f);
        if (yes(r.include)) {
          for (const k of [s(r.email).toLowerCase(), s(r.phone)].filter(Boolean)) {
            if (seen.has(k)) { const j = seen.get(k)!; issues.push({ level: "warn", row: i, key: "include", message: `${s(r.name)} (${base(f)}) looks like the same person as row ${j} (${base(s(p.rows[j].file))}) — same ${k.includes("@") ? "email" : "phone"}. Keep the newer resume and switch the other off.` }); break; }
            seen.set(k, i);
          }
          if (!s(r.email) && !s(r.phone)) issues.push({ level: "warn", row: i, key: "email", message: `${s(r.name)}: no email or phone found.` });
          if (c.minYears && !e.yOk) issues.push({ level: "info", row: i, key: "name", message: `${s(r.name)}: about ${e.years} year(s) of work dates found, below the ${c.minYears} asked for.` });
          if (!e.missingMust.length && e.yOk && e.dOk) full++;
        }
        return { ...r, _score: e.score, _years: e.years, _degree: e.degree, _matched: e.matched.join(", "), _missing: e.missingMust.join(", ") };
      });
      const top = ranked(p).slice(0, 3).map((x) => `${s(x.r.name)} ${x.e.score}`).join(", ");
      return {
        rows,
        issues,
        summary: `${p.rows.filter((r) => yes(r.include)).length} candidate(s) vs ${c.jd.title || "the requirements"} — must: ${c.must.map((g) => g.alts.join("/")).join(", ") || "—"}; nice: ${c.nice.map((g) => g.alts.join("/")).join(", ") || "—"}${c.minYears ? `; ≥${c.minYears} yrs` : ""}${c.degree ? `; ${c.degree}+` : ""}. ${full} meet all must-haves. Top: ${top}.`,
        stats: { candidates: p.rows.filter((r) => yes(r.include)).length, meetAll: full, must: c.must.length, nice: c.nice.length },
      };
    },
    exports: [
      { id: "xlsx", label: ["筛选表 Excel", "Shortlist (Excel)"], description: "shortlist.xlsx ranked by score", async run(ctx: ExportCtx) {
        const p = ctx.project, c = criteria(p), list = ranked(p);
        const rows = list.map((x, k) => [k + 1, s(x.r.name), x.e.score, x.e.years, x.e.degree, x.e.matched.join(", "), x.e.missingMust.join(", "), x.e.missingNice.join(", "), s(x.r.email), s(x.r.phone), s(x.r.status), s(x.r.note), base(s(x.r.file))]);
        const marks = list.flatMap((x, k) => (x.e.missingMust.length ? [{ row: k, col: 6, color: "#FECACA" }] : []).concat(x.e.yOk ? [] : [{ row: k, col: 3, color: "#FDE68A" }]));
        return [await ctx.write("shortlist.xlsx", await writeXlsx([
          { name: "排名 Ranking", headers: ["#", "姓名 Name", "匹配分 Score", "年限 Years", "学历 Degree", "命中 Matched", "缺少必须项 Missing must", "缺少加分项 Missing nice", "邮箱 Email", "电话 Phone", "状态 Status", "备注 Note", "文件 File"], rows, marks, widths: [4, 12, 8, 8, 8, 36, 24, 24, 26, 14, 8, 20, 22] },
          { name: "要求 Criteria", headers: ["类型 Type", "要求 Requirement"], rows: [...c.must.map((g) => ["必须 must", g.alts.join(" / ")]), ...c.nice.map((g) => ["加分 nice", g.alts.join(" / ")]), ...(c.minYears ? [["年限 years", `≥ ${c.minYears}`]] : []), ...(c.degree ? [["学历 degree", `${c.degree}+`]] : [])] },
        ]))];
      } },
      { id: "md", label: ["Markdown", "Markdown"], description: "shortlist.md", async run(ctx: ExportCtx) {
        const p = ctx.project, c = criteria(p), md = [`# 简历初筛：${c.jd.title || p.name}`, "", `必须：${c.must.map((g) => g.alts.join("/")).join("、") || "—"}；加分：${c.nice.map((g) => g.alts.join("/")).join("、") || "—"}${c.minYears ? `；${c.minYears} 年以上` : ""}${c.degree ? `；${c.degree}及以上` : ""}`, "", "> 关键词匹配，仅供初筛参考，请人工复核。年龄、性别等要求不参与打分。", "", "| # | 姓名 | 分数 | 年限 | 学历 | 缺少必须项 | 状态 |", "|---|---|---|---|---|---|---|"];
        ranked(p).forEach((x, k) => md.push(`| ${k + 1} | ${s(x.r.name)} | ${x.e.score} | ${x.e.years} | ${x.e.degree || "—"} | ${x.e.missingMust.join("、") || "—"} | ${s(x.r.status)} |`));
        return [await ctx.write("shortlist.md", md.join("\n") + "\n")];
      } },
    ],
    describeRow: (r, i) => `#${i} ${yes(r.include) ? "" : "(off) "}${s(r.name)} (${base(s(r.file))})${s(r._score) !== "" ? ` score ${s(r._score)}` : ""}${s(r._missing) ? ` missing ${s(r._missing)}` : ""} ${s(r.status)}`,
  };
}

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(makeDef(), options).server;
}
