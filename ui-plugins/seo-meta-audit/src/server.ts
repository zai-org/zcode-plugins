import { createApp, esc, type AppDef, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { KitError } from "./kit/workspace.ts";
import { applyMeta, readMeta, width } from "./meta.ts";

export const NAME = "seo-meta-audit";
export const VERSION = "0.1.0";

const csvCell = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const T = { min: 20, max: 60 }, D = { min: 70, max: 160 };

function audit(p: Project) {
  const issues: Issue[] = [];
  const notes: string[][] = p.rows.map(() => []);
  const titles = new Map<string, number[]>(), descs = new Map<string, number[]>();
  p.rows.forEach((r, i) => {
    const t = String(r.title ?? "").trim(), d = String(r.description ?? "").trim();
    if (t) titles.set(t, [...(titles.get(t) ?? []), i]);
    if (d) descs.set(d, [...(descs.get(d) ?? []), i]);
  });
  p.rows.forEach((r, i) => {
    const t = String(r.title ?? "").trim(), d = String(r.description ?? "").trim();
    const add = (level: Issue["level"], key: string | undefined, short: string, msg: string) => { notes[i].push(short); issues.push({ level, row: i, key, message: `${r.path}: ${msg}` }); };
    const tw = width(t), dw = width(d);
    if (!t) add("error", "title", "no title", "missing <title>.");
    else if (tw < T.min) add("warn", "title", "title short", `title is short (${tw} — aim for ${T.min}–${T.max}; Chinese characters count 2).`);
    else if (tw > T.max) add("warn", "title", "title long", `title is long (${tw}, over ${T.max}) and will be cut off in search results.`);
    if (t && titles.get(t)!.length > 1) add("warn", "title", "dup title", `same title as ${titles.get(t)!.filter((j) => j !== i).map((j) => p.rows[j].path).join(", ")}.`);
    if (!d) add("warn", "description", "no description", "missing meta description.");
    else if (dw < D.min) add("warn", "description", "desc short", `description is short (${dw} — aim for ${D.min}–${D.max}).`);
    else if (dw > D.max) add("info", "description", "desc long", `description is long (${dw}, over ${D.max}) and may be cut off.`);
    if (d && descs.get(d)!.length > 1) add("warn", "description", "dup desc", `same description as ${descs.get(d)!.filter((j) => j !== i).map((j) => p.rows[j].path).join(", ")}.`);
    const h1 = Number(r.h1count ?? 0);
    if (h1 === 0) add("warn", undefined, "no h1", "no <h1> heading.");
    else if (h1 > 1) add("info", undefined, `${h1} h1`, `${h1} <h1> headings — usually one is best.`);
    if (Number(r.noAlt ?? 0)) add("warn", undefined, `${r.noAlt} img no alt`, `${r.noAlt} image(s) without alt: ${String(r.noAltList ?? "")}.`);
    if (!r.lang && !p.settings.lang) add("info", undefined, "no lang", "<html> has no lang attribute (set “Page language” to add one).");
    if (!r.viewport) add("info", undefined, "no viewport", "no viewport meta tag — the page may not be mobile-friendly.");
    if (!r.ogTitle && !p.settings.og) add("info", undefined, "no og", "no Open Graph tags (turn on “Add Open Graph tags” for nicer link previews).");
  });
  return { issues, notes };
}
const changed = (r: Row) => r.title !== r.origTitle || r.description !== r.origDescription;

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "seo",
  title: ["网页 SEO 检查", "SEO Meta Audit"],
  openDescription:
    "Audit the HTML pages of a local website folder for search basics and fix titles and descriptions in a table. Checks per page: <title> missing/too short/too long (display width; Chinese characters count double, target 20–60), meta description missing/short/long (70–160), duplicate titles and descriptions across pages, number of <h1>, images without alt text, <html lang>, viewport meta and Open Graph tags. Edit title and description per page; export writes fixed copies of the changed pages (only those tags are touched, optionally adding og:title/og:description and a lang attribute) into the output folder, “apply” overwrites the originals after saving backups (undo restores them), and audit.csv lists every finding.",
  inputs: { exts: [".html", ".htm"], min: 1, max: 1, folders: true, label: ["选择网站文件夹", "Pick the site folder"] },
  settings: [
    { key: "og", label: ["同时写入 Open Graph 标签", "Add Open Graph tags"], type: "bool", default: false },
    { key: "lang", label: ["给缺少 lang 的页面加语言（如 zh-CN）", "Page language for pages without lang (e.g. zh-CN)"], type: "text", default: "" },
  ],
  columns: () => [
    { key: "path", label: ["页面", "Page"], readOnly: true },
    { key: "title", label: ["标题", "Title"], wide: true },
    { key: "_tw", label: ["标题长度", "Title width"], readOnly: true },
    { key: "description", label: ["描述", "Description"], wide: true },
    { key: "_dw", label: ["描述长度", "Desc width"], readOnly: true },
    { key: "h1", label: ["H1", "H1"], readOnly: true },
    { key: "_notes", label: ["问题", "Findings"], readOnly: true, wide: true },
  ],
  async load({ ws, files }) {
    const folder = files[0].replace(/\/+$/, "");
    const pages = await ws.list({ dir: folder, exts: [".html", ".htm"], limit: 5000 });
    if (!pages.length) throw new KitError("no_pages", "No .html files in this folder.");
    const rows: Row[] = [];
    for (const f of pages) {
      const m = readMeta((await ws.read(f.path, 20 * 1024 * 1024)).toString("utf8"));
      rows.push({ path: f.path, title: m.title, description: m.description, origTitle: m.title, origDescription: m.description, h1: m.h1.join(" | "), h1count: m.h1.length, noAlt: m.noAlt.length, noAltList: m.noAlt.slice(0, 5).join(", "), lang: m.lang, viewport: m.viewport, ogTitle: m.og.title ?? "", images: m.images });
    }
    return { rows, meta: { folder } };
  },
  compute(p) {
    const { issues, notes } = audit(p);
    const rows = p.rows.map((r, i) => ({ ...r, _tw: width(String(r.title ?? "")), _dw: width(String(r.description ?? "")), _notes: notes[i].join(", ") || "ok" }));
    const ch = p.rows.filter(changed).length;
    const errors = issues.filter((x) => x.level === "error").length, warns = issues.filter((x) => x.level === "warn").length;
    const score = p.rows.length ? Math.max(0, Math.round(100 - ((errors * 10 + warns * 4) / p.rows.length))) : 100;
    const first = p.rows[0];
    const preview = `<p>${p.rows.length} pages · ${errors} errors · ${warns} warnings · <b>${ch}</b> page(s) edited · score <b>${score}</b></p>${first ? `<div style="font-family:Arial,sans-serif;max-width:600px;border:1px solid #e5e7eb;border-radius:8px;padding:12px"><div style="color:#1a0dab;font-size:18px">${esc(String(first.title || "(no title)"))}</div><div style="color:#006621;font-size:13px">${esc(String(first.path))}</div><div style="color:#545454;font-size:13px">${esc(String(first.description || "(no description)"))}</div></div>` : ""}`;
    return { rows, issues, preview, summary: `${p.rows.length} pages · ${errors} errors · ${warns} warnings · ${ch} edited`, stats: { pages: p.rows.length, errors, warnings: warns, edited: ch, score } };
  },
  exports: [
    {
      id: "fixed", label: ["修改后的页面（副本）", "Fixed copies"], description: "Copies of the edited pages (same paths) with the new title/description, in the output folder",
      async run({ project, ws, write }: ExportCtx) {
        const out: string[] = [];
        for (const r of project.rows) {
          if (!changed(r) && !project.settings.og && !(project.settings.lang && !r.lang)) continue;
          const html = (await ws.read(String(r.path))).toString("utf8");
          const next = applyMeta(html, { title: String(r.title ?? ""), description: String(r.description ?? ""), og: Boolean(project.settings.og), lang: String(project.settings.lang ?? "") });
          if (next !== html) out.push(await write(`pages/${r.path}`, next));
        }
        if (!out.length) return { files: [], note: "No page needed changes." };
        return out;
      },
    },
    {
      id: "audit", label: ["检查报告 CSV", "Audit CSV"], description: "audit.csv — every page with title, description, widths, h1 and findings",
      async run({ project, write }: ExportCtx) {
        const { notes } = audit(project);
        const lines = project.rows.map((r, i) => [r.path, r.title, width(String(r.title ?? "")), r.description, width(String(r.description ?? "")), r.h1count, r.images, r.noAlt, notes[i].join("; ") || "ok"].map(csvCell).join(","));
        return [await write("audit.csv", "\uFEFF" + ["page,title,title_width,description,description_width,h1_count,images,images_without_alt,findings", ...lines].join("\r\n") + "\r\n")];
      },
    },
    {
      id: "apply", manual: true, label: ["直接改原网页", "Apply to original pages"], description: "Overwrite the original pages with the fixes (backups saved in the output folder; “undo” restores them)",
      async run({ project, ws, write, outDir }: ExportCtx) {
        const done: string[] = [];
        for (const r of project.rows) {
          const html = (await ws.read(String(r.path))).toString("utf8");
          const next = applyMeta(html, { title: String(r.title ?? ""), description: String(r.description ?? ""), og: Boolean(project.settings.og), lang: String(project.settings.lang ?? "") });
          if (next === html) continue;
          await write(`backup/${r.path}`, html);
          await ws.write(String(r.path), next);
          r.origTitle = r.title; r.origDescription = r.description;
          if (project.settings.lang && !r.lang) r.lang = project.settings.lang;
          if (project.settings.og) r.ogTitle = r.title;
          done.push(String(r.path));
        }
        project.meta.applied = done;
        return { files: done, note: done.length ? `Changed ${done.length} page(s); backups in ${outDir}/backup/.` : "Nothing to change." };
      },
    },
    {
      id: "undo", manual: true, label: ["撤销直接修改", "Undo apply"], description: "Restore the pages changed by “apply” from the backups",
      async run({ project, ws, outDir }: ExportCtx) {
        const applied = (project.meta.applied as string[]) ?? [];
        if (!applied.length) throw new KitError("nothing_to_undo", "Nothing was applied yet.");
        for (const path of applied) {
          const old = await ws.read(`${outDir}/backup/${path}`);
          await ws.write(path, old);
          const m = readMeta(old.toString("utf8"));
          const r = project.rows.find((x) => x.path === path);
          if (r) Object.assign(r, { origTitle: m.title, origDescription: m.description, lang: m.lang, ogTitle: m.og.title ?? "" });
        }
        project.meta.applied = [];
        return { files: applied, note: `Restored ${applied.length} page(s).` };
      },
    },
  ],
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
