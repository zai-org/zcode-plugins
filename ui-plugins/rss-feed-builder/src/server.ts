import { createApp, esc, type AppDef, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { KitError } from "./kit/workspace.ts";
import { atom, jsonFeed, parsePost, renderPost, rss, toDate, type Channel, type Item } from "./feed.ts";

export const NAME = "rss-feed-builder";
export const VERSION = "0.1.0";

const site = (p: Project) => String(p.settings.siteUrl ?? "").trim().replace(/\/+$/, "");
const linkOf = (p: Project, r: Row) => String(p.settings.pattern || "{site}/posts/{slug}/").replace(/\{site\}/g, site(p)).replace(/\{slug\}/g, String(r.slug).split("/").map(encodeURIComponent).join("/")).replace(/\{yyyy\}/g, String(r.date).slice(0, 4)).replace(/\{mm\}/g, String(r.date).slice(5, 7));
const bodies = (p: Project) => (p.meta.bodies as Record<string, string>) ?? {};

function items(p: Project): Item[] {
  const full = p.settings.content === "full";
  const out: Item[] = [];
  for (const r of p.rows) {
    if (r.include === false) continue;
    const d = toDate(String(r.date ?? ""), String(p.settings.tz ?? ""));
    if (!d) continue;
    const link = linkOf(p, r);
    const { html, excerpt } = renderPost({ file: String(r.file), title: String(r.title), date: "", slug: "", summary: "", tags: [], author: "", draft: false, body: bodies(p)[String(r.file)] ?? "", dateSource: "" }, link, full);
    out.push({ title: String(r.title), link, date: d, summary: String(r.summary || excerpt), html, tags: String(r.tags ?? "").split(/[,，]\s*/).filter(Boolean), author: String(r.author ?? ""), id: link });
  }
  out.sort((a, b) => b.date.getTime() - a.date.getTime());
  return out.slice(0, Number(p.settings.limit ?? 20));
}
const channel = (p: Project): Channel => ({ title: String(p.settings.title || "My blog"), site: site(p), description: String(p.settings.description ?? ""), language: String(p.settings.language || "zh-CN"), author: String(p.settings.author ?? ""), feedBase: String(p.settings.feedUrl || site(p)).replace(/\/+$/, "") });

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "feed",
  title: ["RSS 订阅源生成", "Feed Builder"],
  openDescription:
    "Generate RSS 2.0 (feed.xml), Atom (atom.xml) and JSON Feed 1.1 (feed.json) from a folder of Markdown posts. Reads YAML front matter (title, date, description/summary, tags/categories, slug, author, draft) and falls back to the first # heading, a date in the file name (2026-11-02-name.md) or the file date. Drafts are left out. Each post is a row (title, date, slug, summary, tags, include) and the link comes from a pattern like {site}/posts/{slug}/. Content is an excerpt (up to <!-- more --> or the first paragraph) or the full post rendered to HTML with relative image/link URLs made absolute. Validates dates, duplicate links and the site URL.",
  inputs: { exts: [".md", ".markdown"], min: 1, max: 1, folders: true, label: ["选择文章文件夹", "Pick the posts folder"] },
  settings: [
    { key: "title", label: ["订阅源标题", "Feed title"], type: "text", default: "" },
    { key: "siteUrl", label: ["网站地址", "Site URL"], type: "text", default: "" },
    { key: "pattern", label: ["文章链接格式", "Post link pattern"], type: "text", default: "{site}/posts/{slug}/" },
    { key: "description", label: ["订阅源简介", "Feed description"], type: "textarea", default: "" },
    { key: "author", label: ["作者", "Author"], type: "text", default: "" },
    { key: "language", label: ["语言", "Language"], type: "text", default: "zh-CN" },
    { key: "content", label: ["内容", "Content"], type: "select", default: "excerpt", options: [{ value: "excerpt", label: ["摘要", "Excerpt"] }, { value: "full", label: ["全文", "Full post"] }] },
    { key: "limit", label: ["最多条数", "Max items"], type: "number", default: 20, min: 1, max: 500 },
    { key: "tz", label: ["没写时区的日期按", "Time zone for dates without one"], type: "text", default: "+08:00" },
    { key: "feedUrl", label: ["订阅文件所在地址（留空=网站根）", "Where the feed files live (blank = site root)"], type: "text", default: "" },
  ],
  columns: () => [
    { key: "include", label: ["收录", "Include"], type: "bool" },
    { key: "title", label: ["标题", "Title"], wide: true },
    { key: "date", label: ["日期", "Date"] },
    { key: "slug", label: ["网址名", "Slug"] },
    { key: "summary", label: ["摘要（留空自动）", "Summary (blank = auto)"], wide: true },
    { key: "tags", label: ["标签", "Tags"] },
    { key: "file", label: ["文件", "File"], readOnly: true },
  ],
  async load({ ws, files, settings }) {
    const list = await ws.list({ dir: files[0], exts: [".md", ".markdown"], limit: 5000 });
    const posts = list.filter((f) => !/(^|\/)(readme|license|changelog)\.md$/i.test(f.path));
    if (!posts.length) throw new KitError("no_posts", "No Markdown posts in this folder.");
    const rows: Row[] = [];
    const bodiesMap: Record<string, string> = {};
    for (const f of posts) {
      const p = parsePost(f.path, (await ws.read(f.path, 10 * 1024 * 1024)).toString("utf8"));
      bodiesMap[f.path] = p.body;
      let date = p.date, src = p.dateSource;
      if (!date) { date = (await ws.mtime(f.path)).toISOString().slice(0, 16).replace("T", " ") + "Z"; src = "file date" /* file time is UTC: keep the Z so the tz setting does not shift it */ }
      rows.push({ include: !p.draft, title: p.title, date, slug: p.slug, summary: p.summary, tags: p.tags.join(", "), author: p.author, file: f.path, draft: p.draft, dateSource: src });
    }
    rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    if (!settings.title) settings.title = files[0] === "." ? "Blog" : files[0].split("/").pop();
    return { rows, meta: { bodies: bodiesMap } };
  },
  compute(p) {
    const issues: Issue[] = [];
    if (!site(p)) issues.push({ level: "error", key: "siteUrl", message: "Set the site URL (e.g. https://example.com) — feed links must be absolute." });
    else if (!/^https?:\/\/[^/\s]+/.test(site(p))) issues.push({ level: "error", key: "siteUrl", message: `“${site(p)}” is not a full URL.` });
    const links = new Map<string, number>();
    const rows = p.rows.map((r, i) => {
      if (r.include === false) return r;
      if (!toDate(String(r.date ?? ""), String(p.settings.tz ?? ""))) issues.push({ level: "error", row: i, key: "date", message: `${r.file}: date “${r.date}” can't be read — use YYYY-MM-DD or YYYY-MM-DD HH:mm.` });
      if (r.dateSource === "file date") issues.push({ level: "info", row: i, key: "date", message: `${r.file}: no date in front matter or file name — using the file's modified time.` });
      if (!String(r.title ?? "").trim()) issues.push({ level: "error", row: i, key: "title", message: `${r.file}: empty title.` });
      if (!String(r.slug ?? "").trim()) issues.push({ level: "error", row: i, key: "slug", message: `${r.file}: empty slug.` });
      const l = linkOf(p, r);
      if (links.has(l)) issues.push({ level: "error", row: i, key: "slug", message: `${r.file}: same link as ${p.rows[links.get(l)!].file} (${l}).` });
      links.set(l, i);
      return r;
    });
    const drafts = p.rows.filter((r) => r.draft).length;
    if (drafts) issues.push({ level: "info", message: `${drafts} draft(s) left out.` });
    const its = site(p) ? items(p) : [];
    const preview = `<p><b>${esc(String(p.settings.title))}</b> · ${its.length} item(s) · ${p.settings.content === "full" ? "full posts" : "excerpts"}</p>${its.slice(0, 5).map((i) => `<div style="border-bottom:1px solid #e5e7eb;padding:8px 0"><div style="font-weight:600">${esc(i.title)}</div><div style="font-size:12px;color:#6b7280">${esc(i.date.toISOString().slice(0, 10))} · ${esc(i.link)}</div><div style="font-size:13px">${esc(i.summary)}</div></div>`).join("")}`;
    return { rows, issues, preview, summary: `${p.rows.filter((r) => r.include !== false).length} post(s) → RSS / Atom / JSON Feed`, stats: { posts: p.rows.filter((r) => r.include !== false).length, items: its.length } };
  },
  exports: [
    {
      id: "feeds", label: ["订阅源文件", "Feed files"], description: "feed.xml (RSS 2.0), atom.xml (Atom 1.0) and feed.json (JSON Feed 1.1)",
      async run({ project, write, computed }: ExportCtx) {
        const errs = (computed.issues ?? []).filter((i) => i.level === "error");
        if (errs.length) throw new KitError("has_errors", `Fix first: ${errs[0].message}`);
        const its = items(project), c = channel(project);
        return [await write("feed.xml", rss(c, its)), await write("atom.xml", atom(c, its)), await write("feed.json", jsonFeed(c, its))];
      },
    },
  ],
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
