import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { z } from "zod";
import { createKitServer } from "./kit/server-kit.ts";
import { KitError, Workspace } from "./kit/workspace.ts";
import { findPdfFonts } from "./kit/pdf-fonts.ts";
import { pdfFontkit } from "./kit/pdf-fontkit.ts";
import { QTYPES, checkBank, parseMarkdown, parseXlsx, type BankIssue, type Question } from "./bank.ts";
import { latexError } from "./math.ts";
import { buildPapers, swapQuestion, type Paper, type Rules } from "./paper.ts";
import { buildHtml, buildPdf, L10N } from "./render.ts";

export const NAME = "exam-builder";
export const VERSION = "0.1.0";
export const PANEL_URI = `ui://${NAME}/panel.html`;
const PROJECT = ".exam-builder/project.json";

export interface ServerOptions { workspaceRoot: string; assetRoot: string; log?: (line: string) => void; fontPath?: string }
interface Meta { title: string; subtitle?: string; duration?: string; lang: "zh" | "en" }
interface Project { version: 1; files: string[]; rules?: Rules; meta?: Meta; papers?: Paper[]; warnings?: string[]; exported?: string[] }
const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp" };
const slug = (s: string) => s.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "exam";

export function createServer(options: ServerOptions) {
  const ws = new Workspace(options.workspaceRoot);
  const { server, tool } = createKitServer({ name: NAME, version: VERSION, panelUri: PANEL_URI, surface: "editor", panelHtml: () => readFile(join(options.assetRoot, "ui/panel.html"), "utf8"), log: options.log });

  const loadProject = async (): Promise<Project | undefined> => ((await ws.exists(PROJECT)) ? JSON.parse(await ws.readText(PROJECT)) : undefined);
  const save = (p: Project) => ws.write(PROJECT, JSON.stringify(p, null, 1) + "\n");
  async function must() {
    const p = await loadProject();
    if (!p) throw new KitError("no_bank", "No question bank loaded yet; call exam_bank first.");
    return p;
  }

  async function loadBank(files: string[]) {
    const qs: Question[] = [];
    for (const f of files) {
      if (/\.(md|markdown|txt)$/i.test(f)) qs.push(...parseMarkdown(f, await ws.readText(f)));
      else if (/\.xlsx$/i.test(f)) qs.push(...(await parseXlsx(ws, f)));
      else if (/\.csv$/i.test(f)) qs.push(...(await parseXlsx(ws, f)));
      else throw new KitError("unsupported", `${f}: use a Markdown (.md) or Excel (.xlsx/.csv) question bank.`);
    }
    const issues = await checkBank(qs, ws, latexError);
    const bad = new Set(issues.map((i) => i.id));
    return { qs, issues, bad, byId: new Map(qs.map((q) => [q.id, q])) };
  }
  type Bank = Awaited<ReturnType<typeof loadBank>>;
  function stats(b: Bank) {
    const ok = b.qs.filter((q) => !b.bad.has(q.id));
    const chapters = [...new Set(b.qs.map((q) => q.chapter))];
    const grid = chapters.map((ch) => ({ chapter: ch, ...Object.fromEntries(QTYPES.map((t) => [t, ok.filter((q) => q.chapter === ch && q.type === t).length])) }));
    const levels = { easy: ok.filter((q) => q.level === 1).length, medium: ok.filter((q) => q.level === 2).length, hard: ok.filter((q) => q.level === 3).length };
    return { total: b.qs.length, usable: ok.length, chapters, grid, levels, byType: Object.fromEntries(QTYPES.map((t) => [t, ok.filter((q) => q.type === t).length])) };
  }
  const issueLine = (i: BankIssue) => `! ${i.id} (${i.file}:${i.line}) ${i.kind}: ${i.message}`;
  const qBrief = (q: Question) => ({ id: q.id, type: q.type, chapter: q.chapter, level: q.level, score: q.score, stem: q.stem, options: q.options, answer: q.answer, explanation: q.explanation, file: q.file, line: q.line });
  function view(p: Project, b: Bank) {
    const used = new Set(p.papers?.flatMap((x) => x.sections.flatMap((s) => s.ids)) ?? []);
    return { kind: "exam", project: p, stats: stats(b), issues: b.issues, questions: b.qs.filter((q) => used.has(q.id)).map(qBrief) };
  }
  const paperBrief = (p: Project, b: Bank) => (p.papers ?? []).map((x) => `${L10N[p.meta?.lang ?? "zh"].setName(x.set)}: ${x.total} points, ${x.sections.map((s) => `${s.type} ${s.ids.join(",") || "-"}`).join(" | ")}; easy/medium/hard ${x.levels[1]}/${x.levels[2]}/${x.levels[3]}${x.sections.some((s) => s.ids.some((id) => !b.byId.has(id))) ? " (some questions no longer exist in the bank — rebuild)" : ""}`).join("\n");

  tool(
    "exam_bank",
    {
      description: "Load question banks (Markdown: `# chapter`, then per question `## 单选|多选|判断|填空|解答 | 易|中|难 | 5分 | id: F-01`, stem, options `A. …`, `答案：`, `解析：`; LaTeX in $…$/$$…$$; images as ![](img/x.png). Or XLSX/CSV with columns ID, Type, Chapter, Difficulty, Score, Question, A–D, Answer, Explanation, Image). Checks every question (missing/invalid answers, missing options or images, LaTeX errors, duplicates) and reports counts by chapter, type and difficulty. Flagged questions are left out of papers until fixed. Opens the panel.",
      input: { files: z.array(z.string()).min(1).optional().describe("Workspace paths; omit to reload the current banks.") },
      openPanel: true,
      timeoutMs: 300_000,
    },
    async ({ files }) => {
      const prev = await loadProject();
      const list = files ?? prev?.files;
      if (!list?.length) throw new KitError("no_files", "Pass `files`: one or more question banks (.md or .xlsx).");
      for (const f of list) if (!(await ws.exists(f))) throw new KitError("not_found", `${f} not found in the workspace.`);
      const b = await loadBank(list);
      if (!b.qs.length) throw new KitError("empty_bank", "No questions found. Each question starts with a `## 单选 | 易 | 5分` heading (Markdown) or is a row with Type and Question columns (Excel).");
      const p: Project = { ...(prev ?? {}), version: 1, files: list };
      await save(p);
      const s = stats(b);
      const lines = [`${s.total} questions loaded, ${s.usable} usable. By type: ${QTYPES.map((t) => `${t} ${s.byType[t]}`).join(", ")}. Difficulty: easy ${s.levels.easy}, medium ${s.levels.medium}, hard ${s.levels.hard}. Chapters: ${s.chapters.join(", ")}.`, ...b.issues.map(issueLine)];
      if (b.issues.length) lines.push(`${b.issues.length} problem(s): those questions are skipped when building papers. Tell the user where they are (file:line) so they can fix the bank.`);
      return { text: lines.join("\n"), structured: view(p, b) };
    },
  );

  tool(
    "exam_build",
    {
      description: "Build one or more paper sets (A, B, …) from the loaded bank. Sections are filled in the order given; questions are drawn at random (fixed by `seed`) from the chosen chapters with the requested easy/medium/hard ratio, never repeated within or across sets. Scores: the section `score` per question, else the question's own score, else defaults (single 5, multi 6, tf 2, fill 5, short 12). Shortfalls are reported. Opens the panel for review; then exam_swap / exam_export.",
      input: {
        title: z.string().min(1).describe("Paper title, e.g. 高一数学期中测试"),
        subtitle: z.string().optional(),
        duration: z.string().optional().describe("e.g. 90 分钟"),
        sections: z.array(z.object({ type: z.enum(QTYPES as [string, ...string[]]), count: z.number().int().min(1).max(100), score: z.number().positive().optional(), title: z.string().optional() })).min(1),
        chapters: z.array(z.string()).optional(),
        difficulty: z.object({ easy: z.number().min(0), medium: z.number().min(0), hard: z.number().min(0) }).optional().describe("Ratio, e.g. {easy:5, medium:3, hard:2}."),
        sets: z.number().int().min(1).max(10).optional(),
        seed: z.string().optional().describe("Same seed + same bank = same papers. Default: the title."),
        exclude: z.array(z.string()).optional().describe("Question ids not to use (e.g. used in an earlier exam)."),
        lang: z.enum(["zh", "en"]).optional().describe("Paper language for headings (default: zh if the bank contains Chinese)."),
      },
      openPanel: true,
    },
    async ({ title, subtitle, duration, sections, chapters, difficulty, sets, seed, exclude, lang }) => {
      const p = await must();
      const b = await loadBank(p.files);
      const known = new Set(b.qs.map((q) => q.chapter));
      const unknown = (chapters ?? []).filter((c: string) => !known.has(c));
      if (unknown.length) throw new KitError("unknown_chapter", `Unknown chapter(s): ${unknown.join(", ")}. Chapters: ${[...known].join(", ")}`);
      const rules: Rules = { title, ...(subtitle ? { subtitle } : {}), sections: sections as Rules["sections"], ...(chapters?.length ? { chapters } : {}), ...(difficulty ? { difficulty } : {}), sets: sets ?? 1, seed: seed ?? title, ...(exclude?.length ? { exclude } : {}) };
      const { papers, warnings } = buildPapers(b.qs, rules, b.bad);
      const zh = lang ? lang === "zh" : b.qs.some((q) => /[\u4e00-\u9fff]/.test(q.stem));
      p.rules = rules; p.papers = papers; p.warnings = warnings; p.meta = { title, ...(subtitle ? { subtitle } : {}), ...(duration ? { duration } : {}), lang: zh ? "zh" : "en" };
      await save(p);
      return { text: [paperBrief(p, b), ...warnings.map((w) => `⚠ ${w}`), b.issues.length ? `${b.issues.length} flagged question(s) were skipped.` : "", "Review in the panel; swap questions with exam_swap, then exam_export."].filter(Boolean).join("\n"), structured: view(p, b) };
    },
  );

  tool(
    "exam_swap",
    { description: "Replace one question in a built paper with another unused question of the same type (same difficulty when possible).", input: { set: z.string().length(1).describe("A, B, …"), id: z.string() }, openPanel: true },
    async ({ set, id }) => {
      const p = await must();
      if (!p.papers?.length || !p.rules) throw new KitError("no_paper", "No paper built yet; call exam_build first.");
      const b = await loadBank(p.files);
      const next = swapQuestion(b.qs, p.papers, set.toUpperCase(), id, b.bad, p.rules.seed ?? p.rules.title, p.rules.chapters);
      if (!next) throw new KitError("no_swap", `Can't swap ${id} in set ${set}: it isn't in that paper or no unused question of the same type is left.`);
      await save(p);
      return { text: `Set ${set.toUpperCase()}: ${id} → ${next.id} (${next.chapter}, level ${next.level}).\n${paperBrief(p, b)}`, structured: view(p, b) };
    },
  );

  tool(
    "exam_export",
    {
      description: "Write each set as a print-ready A4 PDF (vector formulas, embedded images, CJK font) plus a separate answer-key PDF with explanations, and optional HTML versions, into `exams/<title>/`. Also writes paper.json (question ids per set).",
      input: { formats: z.array(z.enum(["pdf", "html"])).optional().describe("Default both."), output: z.string().optional().describe("Folder (default exams/<title>).") },
      timeoutMs: 600_000,
    },
    async ({ formats, output }) => {
      const p = await must();
      if (!p.papers?.length || !p.meta) throw new KitError("no_paper", "No paper built yet; call exam_build first.");
      const b = await loadBank(p.files);
      const missing = p.papers.flatMap((x) => x.sections.flatMap((s) => s.ids)).filter((id) => !b.byId.has(id));
      if (missing.length) throw new KitError("stale_paper", `The bank changed: ${missing.join(", ")} no longer exist. Rebuild with exam_build.`);
      const dir = (output ?? `exams/${slug(p.meta.title)}`).replace(/^\/+|\/+$/g, "");
      const fm = formats?.length ? formats : ["pdf", "html"];
      const l = L10N[p.meta.lang];
      const readImage = async (q: Question, src: string) => { try { return /^(https?:|data:)/.test(src) ? undefined : await ws.read(posix.join(q.dir, src)); } catch { return undefined; } };
      let fonts: { regular: Uint8Array; bold?: Uint8Array } | undefined;
      try { fonts = await findPdfFonts(options.fontPath); } catch { fonts = undefined; }
      const written: string[] = [];
      const warnings = new Set<string>();
      const pages: Record<string, number> = {};
      for (const paper of p.papers) {
        const base = `${slug(p.meta.title)}-${p.meta.lang === "zh" ? `${paper.set}卷` : paper.set}`;
        for (const mode of ["paper", "key"] as const) {
          const name = mode === "paper" ? base : `${base}-${p.meta.lang === "zh" ? "答案" : "key"}`;
          if (fm.includes("pdf")) {
            const r = await buildPdf(b.byId, paper, mode, { ...(fonts ? { fonts, fontkit: pdfFontkit } : {}), readImage, lang: p.meta.lang, title: p.meta.title, ...(p.meta.subtitle ? { subtitle: p.meta.subtitle } : {}), ...(p.meta.duration ? { duration: p.meta.duration } : {}) });
            r.warnings.forEach((w) => warnings.add(w));
            pages[`${name}.pdf`] = r.pages;
            written.push(await ws.write(posix.join(dir, `${name}.pdf`), r.pdf));
          }
          if (fm.includes("html")) {
            const cache = new Map<string, string | undefined>();
            const imgs = new Map<string, Uint8Array | undefined>();
            for (const id of paper.sections.flatMap((s) => s.ids)) { const q = b.byId.get(id)!; for (const m of `${q.stem}\n${q.options.map((o) => o.text).join("\n")}\n${q.explanation}`.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) imgs.set(posix.join(q.dir, m[1]), await readImage(q, m[1])); }
            const img = (q: Question, src: string) => {
              if (/^(https?:|data:)/.test(src)) return src;
              const key = posix.join(q.dir, src);
              if (!cache.has(key)) { const bytes = imgs.get(key); cache.set(key, bytes ? `data:${MIME[posix.extname(src).toLowerCase()] ?? "image/png"};base64,${Buffer.from(bytes).toString("base64")}` : undefined); }
              return cache.get(key);
            };
            written.push(await ws.write(posix.join(dir, `${name}.html`), buildHtml(b.byId, paper, mode, { lang: p.meta.lang, title: p.meta.title, ...(p.meta.subtitle ? { subtitle: p.meta.subtitle } : {}), ...(p.meta.duration ? { duration: p.meta.duration } : {}), img })));
          }
        }
      }
      written.push(await ws.write(posix.join(dir, "paper.json"), JSON.stringify({ title: p.meta.title, rules: p.rules, banks: p.files, sets: p.papers.map((x) => ({ set: x.set, total: x.total, sections: x.sections })) }, null, 1) + "\n"));
      p.exported = written;
      await save(p);
      const pg = Object.entries(pages).map(([f, n]) => `${f} ${n}p`).join(", ");
      return { text: `Wrote ${written.length} files to ${dir}/ (${pg || fm.join("+")}).${[...warnings].map((w) => `\n⚠ ${w}`).join("")}\nThe PDFs are A4 and print as-is; ${l.key} PDFs are separate.`, structured: { kind: "exported", files: written, pages, warnings: [...warnings] } };
    },
  );

  tool("exam_state", { description: "Current project for the panel.", input: {}, visibility: ["app"], readOnly: true }, async () => {
    const p = await loadProject();
    if (!p) return { text: "", structured: { kind: "empty" } };
    try { return { text: "", structured: view(p, await loadBank(p.files)) }; } catch (e) { return { text: "", structured: { kind: "error", project: p, error: (e as Error).message } }; }
  });
  tool("exam_preview", { description: "HTML preview of a set for the panel.", input: { set: z.string(), mode: z.enum(["paper", "key"]) }, visibility: ["app"], readOnly: true }, async ({ set, mode }) => {
    const p = await must();
    const paper = p.papers?.find((x) => x.set === set);
    if (!paper || !p.meta) throw new KitError("no_paper", "No such set.");
    const b = await loadBank(p.files);
    const imgs = new Map<string, string | undefined>();
    for (const id of paper.sections.flatMap((s) => s.ids)) {
      const q = b.byId.get(id); if (!q) continue;
      for (const m of `${q.stem}\n${q.options.map((o) => o.text).join("\n")}\n${q.explanation}`.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
        const key = posix.join(q.dir, m[1]);
        try { imgs.set(key, `data:${MIME[posix.extname(m[1]).toLowerCase()] ?? "image/png"};base64,${Buffer.from(await ws.read(key)).toString("base64")}`); } catch { imgs.set(key, undefined); }
      }
    }
    const html = buildHtml(new Map([...b.byId].filter(([, q]) => q)), { ...paper, sections: paper.sections.map((s) => ({ ...s, ids: s.ids.filter((id) => b.byId.has(id)) })) }, mode, { lang: p.meta.lang, title: p.meta.title, ...(p.meta.duration ? { duration: p.meta.duration } : {}), img: (q, src) => imgs.get(posix.join(q.dir, src)), css: false });
    return { text: "", structured: { html } };
  });
  tool("workspace_files", { description: "Question banks for the panel.", input: {}, visibility: ["app"], readOnly: true }, async () => ({
    text: "", structured: { files: (await ws.list({ exts: [".md", ".xlsx", ".csv"], limit: 3000 })).map((f) => f.path).filter((f) => !/^(\.exam-builder|exams|node_modules)\//.test(f) && !/(^|\/)(README|CHANGELOG|LICENSE)[^/]*$/i.test(f)) },
  }));
  return server;
}
