import { rgb } from "pdf-lib";
import { createApp, type AppDef, type Column, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { hexRgb, newPdf, PAGE, type PdfKit } from "./kit/pdf.ts";
import { KitError } from "./kit/workspace.ts";
import { DocBuilder } from "./docx.ts";
import { bullets, fmtYM, isWork, parseRange, parseResume, tooLong, WEAK } from "./resume.ts";
import { s, yes } from "./util.ts";

export const NAME = "resume-builder";
export const VERSION = "0.1.0";
const nowYM = () => { const d = new Date(); return d.getFullYear() * 12 + d.getMonth(); };
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function header(p: Project) {
  const m = p.meta as { name?: string; contact?: string };
  return { name: s(p.settings.name) || s(m.name), contact: s(p.settings.contact) || s(m.contact) };
}
/** 行首不放句末标点（挪回上一行）。 */
function noLeadPunct(lines: string[]) {
  const out: string[] = [];
  for (const l of lines) {
    const m = /^([，。、；：！？）」』”’,.;:!?)]+)(.*)$/.exec(l);
    if (m && out.length) { out[out.length - 1] += m[1]; if (m[2]) out.push(m[2]); } else out.push(l);
  }
  return out;
}
const used = (p: Project) => p.rows.filter((r) => yes(r.include));
const sections = (p: Project) => { const out: { name: string; rows: Row[] }[] = []; for (const r of used(p)) { const sec = s(r.section); let g = out.find((x) => x.name === sec); if (!g) out.push((g = { name: sec, rows: [] })); g.rows.push(r); } return out; };

function toMarkdown(p: Project) {
  const h = header(p), md = [`# ${h.name}`, h.contact, ""];
  for (const g of sections(p)) {
    md.push(`## ${g.name}`, "");
    for (const r of g.rows) {
      if (s(r.title)) md.push(`### ${s(r.title)}${s(r.dates) ? ` | ${s(r.dates)}` : ""}`);
      for (const b of s(r.details).split("\n").filter(Boolean)) md.push(b.startsWith("•") ? `- ${b.slice(1).trim()}` : b);
      md.push("");
    }
  }
  return md.join("\n");
}

/** PDF：classic（黑白）、accent（彩色抬头）、compact（紧凑）。返回页数。 */
async function renderPdf(p: Project) {
  const kit: PdfKit = await newPdf(), tpl = s(p.settings.template) || "accent", compact = tpl === "compact";
  const [PW, PH] = PAGE[(s(p.settings.page) as "A4" | "Letter")] ?? PAGE.A4, M = compact ? 36 : 46, CW = PW - 2 * M;
  const color = /^#[0-9a-f]{6}$/i.test(s(p.settings.color)) ? s(p.settings.color) : "#1f6feb";
  const fs = compact ? 9.5 : 10.5, lh = fs * 1.5;
  let page = kit.doc.addPage([PW, PH]), y = PH - M;
  const h = header(p);
  if (tpl === "accent") {
    page.drawRectangle({ x: 0, y: PH - 92, width: PW, height: 92, color: hexRgb(color) });
    kit.text(page, h.name, M, PH - 48, { size: 24, bold: true, color: "#ffffff" });
    for (const [i, l] of kit.wrap(h.contact, 10, CW).slice(0, 2).entries()) kit.text(page, l, M, PH - 70 - i * 13, { size: 10, color: "#ffffff" });
    y = PH - 92 - 22;
  } else {
    kit.text(page, h.name, M, y - 20, { size: compact ? 18 : 22, bold: true });
    y -= compact ? 34 : 40;
    for (const l of kit.wrap(h.contact, 9.5, CW)) { kit.text(page, l, M, y, { size: 9.5, color: "#4b5563" }); y -= 13; }
    y -= 6;
  }
  const need = (hh: number) => { if (y - hh < M) { page = kit.doc.addPage([PW, PH]); y = PH - M; } };
  const hc = tpl === "classic" || compact ? "#111827" : color;
  for (const g of sections(p)) {
    need(40);
    kit.text(page, g.name, M, y - 12, { size: compact ? 11.5 : 13, bold: true, color: hc });
    y -= compact ? 17 : 20;
    page.drawLine({ start: { x: M, y: y + 3 }, end: { x: PW - M, y: y + 3 }, thickness: 0.7, color: tpl === "accent" ? hexRgb(color) : rgb(0.8, 0.82, 0.85) });
    y -= compact ? 6 : 9;
    for (const r of g.rows) {
      const det = s(r.details).split("\n").filter(Boolean);
      need((s(r.title) ? lh + 2 : 0) + Math.min(2, det.length) * lh);
      if (s(r.title)) {
        const dw = s(r.dates) ? kit.width(s(r.dates), fs - 0.5) : 0;
        kit.text(page, s(r.title), M, y - fs, { size: fs + 0.5, bold: true, maxWidth: CW - dw - 12 });
        if (dw) kit.text(page, s(r.dates), PW - M, y - fs, { size: fs - 0.5, color: "#4b5563", align: "right" });
        y -= lh + 2;
      }
      for (const d of det) {
        const bullet = d.startsWith("•"), text = bullet ? d.slice(1).trim() : d, ind = bullet ? 11 : 0;
        const ls = noLeadPunct(kit.wrap(text, fs, CW - ind));
        need(ls.length * lh);
        if (bullet) kit.text(page, "•", M + 2, y - fs, { size: fs, color: hc });
        for (const l of ls) { kit.text(page, l, M + ind, y - fs, { size: fs, color: "#1f2937" }); y -= lh; }
      }
      y -= compact ? 3 : 6;
    }
    y -= compact ? 4 : 8;
  }
  return { bytes: await kit.doc.save(), pages: kit.doc.getPageCount() };
}



function makeDef(): AppDef {
  return {
    name: NAME,
    version: VERSION,
    prefix: "resume",
    title: ["简历排版", "Resume Builder"],
    openDescription:
      "Lay out a resume from a Markdown file and check it. Format: `# Name`, a contact line, `## Section` (工作经历 / 教育经历 / 技能 / Experience …), `### Org · Role | 2023.03 – 至今` entries and `-` bullets. Each row is one entry: include, section, title, dates, details (bullets one per line, starting with •). Reorder by editing, drop entries by include=false. Settings: name, contact (override the file), template (accent / classic / compact), color, page (A4/Letter), maxPages. Checks: missing email/phone, end date before start, gaps over 6 months between jobs, mixed date formats, weak openers (负责 / 参与 / Responsible for…), work bullets without numbers, very long bullets, ID numbers and age/marital status in the resume, PDF longer than maxPages. Exports resume.pdf, resume.docx, resume.html and resume.md.",
    inputs: { exts: [".md", ".markdown", ".txt"], min: 1, max: 1, label: ["选择简历 Markdown", "Pick the resume Markdown"] },
    settings: [
      { key: "template", label: ["模板", "Template"], type: "select", default: "accent", options: [{ value: "accent", label: ["彩色抬头", "Accent header"] }, { value: "classic", label: ["经典黑白", "Classic"] }, { value: "compact", label: ["紧凑（放进一页）", "Compact (fit one page)"] }] },
      { key: "color", label: ["主题色", "Accent colour"], type: "color", default: "#1f6feb" },
      { key: "name", label: ["姓名（留空=文件里的 #）", "Name (blank = from file)"], type: "text", default: "" },
      { key: "contact", label: ["联系方式行（留空=文件里的）", "Contact line (blank = from file)"], type: "text", default: "" },
      { key: "page", label: ["纸张", "Page"], type: "select", default: "A4", options: [{ value: "A4", label: ["A4", "A4"] }, { value: "Letter", label: ["Letter", "Letter"] }] },
      { key: "maxPages", label: ["最多几页", "Max pages"], type: "number", default: 1, min: 1, max: 5 },
    ],
    columns: () => [
      { key: "include", label: ["使用", "Use"], type: "bool" },
      { key: "section", label: ["板块", "Section"] },
      { key: "title", label: ["标题（单位 · 职位）", "Title (org · role)"] },
      { key: "dates", label: ["时间", "Dates"] },
      { key: "details", label: ["要点", "Details"], wide: true },
    ] as Column[],
    newRow: () => ({ include: true, section: "工作经历", title: "", dates: "", details: "" }),
    async load({ ws, files, previous }) {
      const md = await ws.readText(files[0]);
      const r = parseResume(md);
      if (!r.name && !r.entries.length) throw new KitError("empty", "No resume content found. Start with `# Name`, then `## Section` headings.");
      const rows: Row[] = previous?.length ? previous : r.entries.map((e) => ({ include: true, ...e }));
      return { rows, meta: { name: r.name, contact: r.contact } };
    },
    async compute(p): Promise<Computed> {
      const issues: Issue[] = [], h = header(p), now = nowYM();
      if (!h.name) issues.push({ level: "error", message: "No name: add `# Name` at the top or set name." });
      if (!/@/.test(h.contact)) issues.push({ level: "warn", message: "No email in the contact line." });
      if (!/\d{3}[\d\s-]{6,}/.test(h.contact)) issues.push({ level: "warn", message: "No phone number in the contact line." });
      const all = `${h.contact}\n${p.rows.map((r) => s(r.details)).join("\n")}`;
      if (/\b\d{17}[\dXx]\b/.test(all)) issues.push({ level: "warn", message: "The resume contains what looks like an ID card number (身份证号). Remove it — employers don't need it at this stage." });
      if (/年龄|出生|婚姻|已婚|未婚|民族|政治面貌|\bage\b|date of birth|marital/i.test(all)) issues.push({ level: "info", message: "Age / birth date / marital status is in the resume. Many employers (and most US/UK ones) prefer it left out." });
      const styles = new Set<string>(), jobs: { i: number; start: number; end: number; title: string }[] = [];
      let wb = 0, withNum = 0, weak = 0;
      for (const [i, r] of p.rows.entries()) {
        if (!yes(r.include)) continue;
        if (s(r.dates)) {
          const d = parseRange(s(r.dates), now);
          if (d.start === undefined || d.end === undefined) issues.push({ level: "warn", row: i, key: "dates", message: `Dates “${s(r.dates)}” not understood (use e.g. 2021.07 – 2023.02 or 2021.07 – 至今).` });
          else {
            styles.add(d.style);
            if (d.end < d.start) issues.push({ level: "error", row: i, key: "dates", message: `${s(r.title) || "Entry"}: end ${fmtYM(d.end)} is before start ${fmtYM(d.start)}.` });
            else if (isWork(s(r.section))) jobs.push({ i, start: d.start, end: d.end, title: s(r.title) });
          }
        }
        if (isWork(s(r.section))) for (const b of bullets({ section: "", title: "", dates: "", details: s(r.details) })) {
          wb++;
          if (/\d/.test(b)) withNum++;
          if (WEAK.test(b)) weak++;
          if (tooLong(b)) issues.push({ level: "warn", row: i, key: "details", message: `A bullet in “${s(r.title)}” is long (${b.slice(0, 16)}…); keep each to one or two lines.` });
        }
      }
      jobs.sort((a, b) => b.start - a.start);
      for (let k = 0; k + 1 < jobs.length; k++) {
        const gap = jobs[k].start - jobs[k + 1].end;
        if (gap > 6) issues.push({ level: "info", row: jobs[k].i, key: "dates", message: `${gap}-month gap between ${jobs[k + 1].title.split("·")[0].trim()} (to ${fmtYM(jobs[k + 1].end)}) and ${jobs[k].title.split("·")[0].trim()} (from ${fmtYM(jobs[k].start)}). Be ready to explain it, or mention what you did.` });
      }
      if (styles.size > 1) issues.push({ level: "info", key: "dates", message: `Dates use ${styles.size} different formats; pick one style.` });
      if (wb >= 3 && withNum / wb < 0.3) issues.push({ level: "warn", key: "details", message: `Only ${withNum} of ${wb} work bullets have a number. Add results (how much, how many, how fast) where you can.` });
      if (weak) issues.push({ level: "info", key: "details", message: `${weak} bullet(s) start with 负责 / 参与 / “Responsible for”. Lead with what you did and what changed instead.` });
      const pdf = await renderPdf(p);

      const max = Number(p.settings.maxPages) || 1;
      if (pdf.pages > max) issues.push({ level: "warn", message: `The PDF is ${pdf.pages} pages (max ${max}). Try the compact template, or cut older or weaker entries.` });
      const prev = `<div style="font:13px/1.55 -apple-system,'PingFang SC',sans-serif;max-width:640px"><div style="background:${s(p.settings.template) === "accent" || !s(p.settings.template) ? s(p.settings.color) || "#1f6feb" : "transparent"};color:${s(p.settings.template) === "accent" || !s(p.settings.template) ? "#fff" : "inherit"};padding:10px 14px;border-radius:6px"><b style="font-size:18px">${esc(h.name)}</b><br>${esc(h.contact)}</div>${sections(p).map((g) => `<h4 style="margin:12px 0 4px">${esc(g.name)}</h4>${g.rows.map((r) => `<div><b>${esc(s(r.title))}</b> <span style="float:right;opacity:.7">${esc(s(r.dates))}</span><div style="white-space:pre-line;opacity:.9">${esc(s(r.details))}</div></div>`).join("")}`).join("")}</div>`;
      return {
        rows: p.rows,
        issues,
        summary: `${h.name || "Resume"}: ${used(p).length} entries in ${sections(p).length} section(s); PDF ${pdf.pages} page(s), ${s(p.settings.template) || "accent"} template.`,
        stats: { entries: used(p).length, sections: sections(p).length, pages: pdf.pages, bulletsWithNumbers: `${withNum}/${wb}` },
        preview: prev,
      };
    },
    exports: [
      { id: "pdf", label: ["PDF", "PDF"], description: "resume.pdf", async run(ctx: ExportCtx) { const pdf = await renderPdf(ctx.project); return [await ctx.write("resume.pdf", pdf.bytes)]; } },
      { id: "docx", label: ["Word", "Word"], description: "resume.docx", async run(ctx: ExportCtx) {
        const p = ctx.project, b = new DocBuilder({ latin: "Calibri", cjk: "Microsoft YaHei", size: 10.5, page: (s(p.settings.page) as "A4" | "Letter") || "A4", margin: 18, toc: false, title: header(p).name, author: header(p).name, breakH1: false }, () => undefined);
        b.add(toMarkdown(p), true);
        return [await ctx.write("resume.docx", b.build())];
      } },
      { id: "html", label: ["网页", "HTML"], description: "resume.html", async run(ctx: ExportCtx) {
        const p = ctx.project, h = header(p), c = s(p.settings.color) || "#1f6feb";
        const body = sections(p).map((g) => `<h2>${esc(g.name)}</h2>${g.rows.map((r) => `<div class="e">${s(r.title) ? `<div class="t"><b>${esc(s(r.title))}</b><span>${esc(s(r.dates))}</span></div>` : ""}<ul>${s(r.details).split("\n").filter(Boolean).map((d) => (d.startsWith("•") ? `<li>${esc(d.slice(1).trim())}</li>` : `<p>${esc(d)}</p>`)).join("")}</ul></div>`).join("")}`).join("");
        return [await ctx.write("resume.html", `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(h.name)}</title><style>body{font:15px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;max-width:820px;margin:0 auto;color:#1f2937}header{background:${c};color:#fff;padding:24px 32px}header h1{margin:0;font-size:28px}main{padding:8px 32px 32px}h2{color:${c};border-bottom:1px solid ${c};padding-bottom:4px;font-size:18px}.t{display:flex;justify-content:space-between}.t span{color:#6b7280}ul{margin:4px 0 12px;padding-left:20px}ul p{margin:0 0 0 -20px}@media print{header{-webkit-print-color-adjust:exact}}</style></head><body><header><h1>${esc(h.name)}</h1><div>${esc(h.contact)}</div></header><main>${body}</main></body></html>`)];
      } },
      { id: "md", label: ["Markdown", "Markdown"], description: "resume.md (cleaned up)", async run(ctx: ExportCtx) { return [await ctx.write("resume.md", toMarkdown(ctx.project))]; } },
    ],
    describeRow: (r, i) => `#${i} ${yes(r.include) ? "" : "(off) "}[${s(r.section)}] ${s(r.title)}${s(r.dates) ? ` | ${s(r.dates)}` : ""} (${s(r.details).split("\n").filter(Boolean).length} line(s))`,
  };
}

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(makeDef(), options).server;
}
