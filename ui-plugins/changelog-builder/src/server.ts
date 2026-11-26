import { createApp, esc, type AppDef, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { KitError } from "./kit/workspace.ts";
import { readRepo } from "./git.ts";
import { group, heading, HIDDEN, linkify, markdown, parseCommit, TYPES, type CType, type Entry, type Release } from "./changelog.ts";

export const NAME = "changelog-builder";
export const VERSION = "0.1.0";

const lang = (p: Project): "zh" | "en" => (p.settings.lang === "en" ? "en" : "zh");
const unreleased = (p: Project) => String(p.settings.next || "").trim() || (lang(p) === "zh" ? "未发布" : "Unreleased");
const relName = (p: Project, r: Row) => (r.tag ? String(r.tag) : unreleased(p));
const repoOf = (p: Project) => String(p.settings.repoUrl || p.meta.remote || "").replace(/\/+$/, "");
const hidden = (p: Project): CType[] => (p.settings.chores ? [] : HIDDEN);

function entries(p: Project): Entry[] {
  return p.rows.filter((r) => r.include !== false).map((r) => ({ release: relName(p, r), date: String(r.date ?? ""), type: (TYPES as readonly string[]).includes(String(r.type)) ? (r.type as CType) : "other", scope: String(r.scope ?? ""), summary: String(r.summary ?? ""), breaking: Boolean(r.breaking), hash: String(r.hash), short: String(r.short), author: String(r.author ?? "") }));
}
function releases(p: Project): Release[] {
  const order: string[] = [];
  for (const r of p.rows) { const n = relName(p, r); if (!order.includes(n)) order.push(n); }
  const all = group(entries(p), order);
  const range = String(p.settings.range ?? "all");
  if (range === "unreleased") return all.filter((r) => r.name === unreleased(p));
  if (range === "latest") return all.slice(0, 1);
  if (range === "two") return all.slice(0, 2);
  return all;
}
const mdOpts = (p: Project, title: boolean) => ({ lang: lang(p), repo: repoOf(p), authors: Boolean(p.settings.authors), hidden: hidden(p), title });

function html(p: Project, r: Release): string {
  const L = lang(p);
  const shown = r.entries.filter((e) => !hidden(p).includes(e.type) || e.breaking);
  const md = (s: string) => esc(s).replace(/\[(#\d+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  const item = (e: Entry) => `<li>${e.scope ? `<b>${esc(e.scope)}:</b> ` : ""}${md(linkify(e.summary, repoOf(p)))} <a class="sha" href="${repoOf(p) ? esc(`${repoOf(p)}/commit/${e.hash}`) : "#"}">${esc(e.short)}</a>${p.settings.authors ? ` <span class="by">${esc(e.author)}</span>` : ""}</li>`;
  const sec = (title: string, es: Entry[], cls = "") => (es.length ? `<section class="${cls}"><h2>${esc(title)}</h2><ul>${es.map(item).join("")}</ul></section>` : "");
  const brk = shown.filter((e) => e.breaking);
  const body = sec(L === "zh" ? "⚠ 不兼容变更" : "⚠ Breaking changes", brk, "breaking") + TYPES.map((t) => sec(heading(t, L), shown.filter((e) => e.type === t && !e.breaking))).join("");
  const counts = TYPES.map((t) => ({ t, n: shown.filter((e) => e.type === t).length })).filter((x) => x.n);
  return `<!doctype html><html lang="${L === "zh" ? "zh-CN" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(r.name)}</title><style>
body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",Segoe UI,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#111827;line-height:1.6}
h1{font-size:28px;margin:0}.date{color:#6b7280;margin:4px 0 16px}.chips span{display:inline-block;background:#eef2ff;color:#3730a3;border-radius:999px;padding:2px 10px;margin:0 6px 6px 0;font-size:13px}
h2{font-size:18px;border-bottom:1px solid #e5e7eb;padding-bottom:4px;margin-top:28px}ul{padding-left:20px}li{margin:4px 0}.sha{font-family:ui-monospace,Consolas,monospace;font-size:12px;color:#6b7280;text-decoration:none}.by{color:#9ca3af;font-size:12px}
.breaking{background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:4px 16px}.breaking h2{border:0;color:#b91c1c}a{color:#2563eb}
</style></head><body><h1>${esc(r.name)}</h1><div class="date">${esc(r.date.slice(0, 10))} · ${shown.length} ${L === "zh" ? "项改动" : "changes"}</div><div class="chips">${counts.map((c) => `<span>${esc(heading(c.t, L))} ${c.n}</span>`).join("")}</div>${body}</body></html>\n`;
}

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "changelog",
  title: ["更新日志生成", "Changelog Builder"],
  openDescription:
    "Build a CHANGELOG.md and release notes from the git history of a workspace folder (needs git installed; read-only). Commits are split into releases by tags (newest first; commits after the last tag go under “Unreleased” or the next version you name) and grouped by type from Conventional Commits (feat, fix, perf, refactor, docs, deps…, scope, `!`/BREAKING CHANGE) — Chinese prefixes like 新增/修复/优化 and plain “Add…/Fix…” subjects are recognised too. Merge commits are skipped; chore/ci/test/build/style are hidden unless asked. Every entry is a row: re-type it, reword the summary, mark it breaking or leave it out. Headings in Chinese or English; commit and #issue links for GitHub/GitLab remotes.",
  inputs: { exts: [], min: 1, max: 1, folders: true, label: ["选择 git 仓库文件夹", "Pick the git repository folder"] },
  settings: [
    { key: "range", label: ["包含哪些版本", "Releases to include"], type: "select", default: "all", options: [{ value: "all", label: ["全部", "All"] }, { value: "unreleased", label: ["只要未发布的改动", "Unreleased only"] }, { value: "latest", label: ["最新一个版本", "Latest release"] }, { value: "two", label: ["最近两个版本", "Latest two"] }] },
    { key: "next", label: ["未发布部分的版本号（如 v1.2.0）", "Name for unreleased changes (e.g. v1.2.0)"], type: "text", default: "" },
    { key: "lang", label: ["标题语言", "Heading language"], type: "select", default: "zh", options: [{ value: "zh", label: ["中文", "Chinese"] }, { value: "en", label: ["英文", "English"] }] },
    { key: "chores", label: ["显示 chore/ci/test 等", "Show chore/ci/test/build"], type: "bool", default: false },
    { key: "authors", label: ["显示作者", "Show authors"], type: "bool", default: false },
    { key: "repoUrl", label: ["仓库网址（留空读 origin）", "Repository URL (blank = origin)"], type: "text", default: "" },
    { key: "limit", label: ["最多读取的提交数", "Max commits to read"], type: "number", default: 2000, min: 10, max: 20000, reload: true },
  ],
  columns: () => [
    { key: "include", label: ["收录", "Include"], type: "bool" },
    { key: "_release", label: ["版本", "Release"], readOnly: true },
    { key: "type", label: ["类型", "Type"], type: "select", options: [...TYPES] },
    { key: "scope", label: ["范围", "Scope"] },
    { key: "summary", label: ["说明", "Summary"], wide: true },
    { key: "breaking", label: ["不兼容", "Breaking"], type: "bool" },
    { key: "short", label: ["提交", "Commit"], readOnly: true },
    { key: "author", label: ["作者", "Author"], readOnly: true },
    { key: "date", label: ["日期", "Date"], readOnly: true },
  ],
  async load({ ws, files, settings }) {
    let repo;
    try { repo = await readRepo(ws.resolve(files[0] || "."), Number(settings.limit ?? 2000)); } catch (e) { throw new KitError("git_failed", (e as Error).message); }
    if (!repo.commits.length) throw new KitError("no_commits", "No commits found in this folder.");
    let tag = "";
    const rows = repo.commits.map((c) => {
      const t = c.tags.find((x) => /\d/.test(x)) ?? c.tags[0];
      if (t) tag = t;
      const parsed = parseCommit(c.subject, c.body);
      return { include: !/^Merge (branch|pull request|remote-tracking)/.test(c.subject), tag, ...parsed, hash: c.hash, short: c.short, author: c.author, date: c.date.slice(0, 10) };
    });
    return { rows, meta: { remote: repo.remote, tags: [...new Set(rows.map((r) => r.tag).filter(Boolean))] } };
  },
  compute(p) {
    const rel = releases(p);
    const issues: Issue[] = [];
    const rows = p.rows.map((r, i) => {
      if (r.include !== false && !String(r.summary ?? "").trim()) issues.push({ level: "error", row: i, key: "summary", message: "Empty summary." });
      return { ...r, _release: relName(p, r) };
    });
    const other = p.rows.filter((r) => r.include !== false && r.type === "other").length;
    if (other) issues.push({ level: "info", message: `${other} commit(s) don't follow Conventional Commits and are under “${heading("other", lang(p))}” — re-type them if you like.` });
    if (!(p.meta.tags as string[])?.length) issues.push({ level: "info", message: "No tags found: everything is in one unreleased section. Set “Name for unreleased changes” to your next version." });
    const md = markdown(rel, mdOpts(p, true));
    const preview = `<pre style="white-space:pre-wrap;font-size:12px;max-height:560px;overflow:auto">${esc(md)}</pre>`;
    const shown = rel.reduce((n, r) => n + r.entries.filter((e) => !hidden(p).includes(e.type) || e.breaking).length, 0);
    return { rows, issues, preview, summary: `${rel.length} release(s) · ${shown} entries${repoOf(p) ? ` · ${repoOf(p)}` : ""}`, stats: { releases: rel.length, entries: shown, commits: p.rows.length } };
  },
  exports: [
    {
      id: "changelog", label: ["CHANGELOG.md", "CHANGELOG.md"], description: "CHANGELOG.md with every selected release",
      async run({ project, write, computed }: ExportCtx) {
        const errs = (computed.issues ?? []).filter((i) => i.level === "error");
        if (errs.length) throw new KitError("has_errors", `Fix first: ${errs[0].message}`);
        return [await write("CHANGELOG.md", markdown(releases(project), mdOpts(project, true)))];
      },
    },
    {
      id: "notes", label: ["发布说明", "Release notes"], description: "release-notes.html and .md for the newest selected release (ready to paste into a GitHub/GitLab release)",
      async run({ project, write }: ExportCtx) {
        const r = releases(project)[0];
        if (!r) throw new KitError("nothing_selected", "No release to write.");
        return [await write("release-notes.html", html(project, r)), await write("release-notes.md", markdown([r], mdOpts(project, false)).replace(/^## .*\n+/, ""))];
      },
    },
  ],
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
