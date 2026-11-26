import { createApp, esc, type AppDef, type ExportCtx, type Issue, type Project } from "./kit/app.ts";
import { KitError, safeFileName, type Workspace } from "./kit/workspace.ts";
import { DocBuilder, imageSize, type DocOpts, type Image } from "./docx.ts";
import { Lexer, type Token, type Tokens } from "marked";

export const NAME = "markdown-to-docx";
export const VERSION = "0.1.0";

export function decodeText(b: Uint8Array): string {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(b).replace(/^\uFEFF/, ""); } catch { return new TextDecoder("gb18030").decode(b); }
}

export function splitFrontMatter(md: string): { body: string; meta: Record<string, string> } {
  const m = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
  if (!m) return { body: md.replace(/^\uFEFF/, ""), meta: {} };
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) { const kv = /^([\w-]+):\s*(.*)$/.exec(line); if (kv) meta[kv[1].toLowerCase()] = kv[2].replace(/^["']|["']$/g, ""); }
  return { body: md.slice(m[0].length), meta };
}
const dirOf = (f: string) => (f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : "");
const baseOf = (f: string) => f.split("/").pop()!.replace(/\.(md|markdown|txt)$/i, "");
function walk(tokens: Token[], fn: (t: Token) => void) {
  for (const t of tokens) { fn(t); const any = t as unknown as { tokens?: Token[]; items?: Token[]; header?: { tokens: Token[] }[]; rows?: { tokens: Token[] }[][] }; if (any.tokens) walk(any.tokens, fn); if (any.items) walk(any.items, fn); if (any.header) any.header.forEach((h) => walk(h.tokens, fn)); if (any.rows) any.rows.forEach((r) => r.forEach((c) => walk(c.tokens, fn))); }
}
export function imageRefs(md: string): string[] {
  const out: string[] = [];
  walk(new Lexer({ gfm: true }).lex(md), (t) => { if (t.type === "image") out.push((t as Tokens.Image).href); });
  return out;
}
export function resolvePath(file: string, src: string) {
  const parts = (dirOf(file) ? dirOf(file).split("/") : []).concat(decodeURI(src.split(/[?#]/)[0]).split("/"));
  const out: string[] = [];
  for (const s of parts) { if (s === "..") out.pop(); else if (s && s !== ".") out.push(s); }
  return out.join("/");
}

interface Doc { file: string; md: string; meta: Record<string, string> }
const docsOf = (p: Project) => (p.meta.docs as Doc[]) ?? [];
const optsOf = (p: Project, title: string): DocOpts => ({ latin: String(p.settings.latin || "Calibri"), cjk: String(p.settings.cjk || "Microsoft YaHei"), size: Number(p.settings.size ?? 11), page: p.settings.page === "Letter" ? "Letter" : "A4", margin: Number(p.settings.margin ?? 25), toc: Boolean(p.settings.toc), title, author: String(p.settings.author ?? ""), breakH1: p.settings.breakH1 !== false });

async function loadImages(ws: Workspace, docs: Doc[]) {
  const map = new Map<string, Image>();
  for (const d of docs) for (const src of imageRefs(d.md)) {
    if (/^(https?:|data:)/i.test(src)) continue;
    const path = resolvePath(d.file, src);
    try { const data = new Uint8Array(await ws.read(path, 30 * 1024 * 1024)); const s = imageSize(data); if (s) map.set(`${d.file}|${src}`, { data, ...s }); } catch { /* missing */ }
  }
  return map;
}
function build(p: Project, docs: Doc[], titles: string[], images: Map<string, Image>) {
  const b = new DocBuilder(optsOf(p, titles[0] ?? ""), (src) => images.get(`${cur}|${src}`));
  let cur = "";
  docs.forEach((d, i) => { cur = d.file; b.add(d.md, i === 0); });
  return b;
}
const included = (p: Project) => p.rows.map((r, i) => ({ r, d: docsOf(p)[i] })).filter((x) => x.r.include !== false && x.d);

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "md2docx",
  title: ["Markdown 转 Word", "Markdown to Word"],
  openDescription:
    "Convert Markdown (.md) files in the workspace into real, editable Word documents (.docx) with proper Word styles: headings (Heading 1–4, so the navigation pane and TOC work), bold/italic/strikethrough/inline code, links, bullet/numbered/nested/task lists, GFM tables with header shading and column alignment, code blocks, block quotes, horizontal rules, local images (PNG/JPEG, resized to the page width, alt text as caption) and <!-- pagebreak -->. Chinese and Latin fonts are set separately (e.g. 微软雅黑 + Calibri). Optional table of contents, page numbers in the footer, A4/Letter. Convert each file separately or merge them into one document. YAML front matter title/author is used for document properties.",
  inputs: { exts: [".md", ".markdown"], min: 1, max: 30, label: ["选择 Markdown 文件（可多选）", "Pick Markdown files"] },
  settings: [
    { key: "merge", label: ["合并成一个 Word 文档", "Merge into one document"], type: "bool", default: false },
    { key: "mergedName", label: ["合并后的文件名", "Merged file name"], type: "text", default: "合并文档" },
    { key: "toc", label: ["开头加目录", "Table of contents"], type: "bool", default: false },
    { key: "breakH1", label: ["一级标题前分页（合并时）", "Page break before each H1 (merged)"], type: "bool", default: true },
    { key: "cjk", label: ["中文字体", "Chinese font"], type: "select", default: "Microsoft YaHei", options: [{ value: "Microsoft YaHei", label: ["微软雅黑", "Microsoft YaHei"] }, { value: "SimSun", label: ["宋体", "SimSun"] }, { value: "SimHei", label: ["黑体", "SimHei"] }, { value: "KaiTi", label: ["楷体", "KaiTi"] }, { value: "PingFang SC", label: ["苹方", "PingFang SC"] }, { value: "Noto Sans CJK SC", label: ["思源黑体", "Noto Sans CJK SC"] }] },
    { key: "latin", label: ["英文字体", "Latin font"], type: "select", default: "Calibri", options: ["Calibri", "Arial", "Times New Roman", "Georgia", "Helvetica"].map((f) => ({ value: f, label: [f, f] as [string, string] })) },
    { key: "size", label: ["正文字号（磅）", "Body size (pt)"], type: "number", default: 11, min: 8, max: 20 },
    { key: "page", label: ["纸张", "Page size"], type: "select", default: "A4", options: [{ value: "A4", label: ["A4", "A4"] }, { value: "Letter", label: ["Letter", "Letter"] }] },
    { key: "margin", label: ["页边距（毫米）", "Margins (mm)"], type: "number", default: 25, min: 5, max: 60 },
    { key: "author", label: ["作者（文档属性）", "Author (document property)"], type: "text", default: "" },
  ],
  columns: () => [
    { key: "include", label: ["转换", "Convert"], type: "bool" },
    { key: "file", label: ["文件", "File"], readOnly: true },
    { key: "title", label: ["文档标题", "Title"] },
    { key: "out", label: ["输出文件名", "Output name"] },
    { key: "_info", label: ["内容", "Contents"], readOnly: true, wide: true },
  ],
  async load({ ws, files }) {
    const docs: Doc[] = [];
    for (const f of files) {
      const { body, meta } = splitFrontMatter(decodeText(await ws.read(f, 20 * 1024 * 1024)));
      docs.push({ file: f, md: body, meta });
    }
    const rows = docs.map((d) => {
      const h1 = new Lexer({ gfm: true }).lex(d.md).find((t) => t.type === "heading") as Tokens.Heading | undefined;
      return { include: true, file: d.file, title: d.meta.title || h1?.text.replace(/[*_`]/g, "") || baseOf(d.file), out: baseOf(d.file) };
    });
    return { rows, meta: { docs } };
  },
  compute(p) {
    const docs = docsOf(p);
    const issues: Issue[] = [];
    const rows = p.rows.map((r, i) => {
      const d = docs[i];
      if (!d) return r;
      const b = build(p, [d], [String(r.title)], new Map());
      const refs = imageRefs(d.md);
      const remote = refs.filter((s) => /^https?:/i.test(s)).length;
      if (remote) issues.push({ level: "warn", row: i, message: `${d.file}: ${remote} web image(s) can't be embedded offline — download them next to the .md file and use a relative path.` });
      if (!String(r.out ?? "").trim() && r.include !== false && !p.settings.merge) issues.push({ level: "error", row: i, key: "out", message: "Output name is empty." });
      const s = b.stats;
      return { ...r, _info: `${s.headings} headings · ${s.tables} tables · ${refs.length} images · ${s.lists} lists · ${s.code} code blocks` };
    });
    const outs = included(p).map((x) => String(x.r.out).trim().toLowerCase());
    if (!p.settings.merge && new Set(outs).size < outs.length) issues.push({ level: "error", key: "out", message: "Two files would be written with the same output name." });
    const first = included(p)[0];
    let preview = "<p>Nothing selected.</p>";
    if (first) {
      const b = build(p, p.settings.merge ? included(p).map((x) => x.d) : [first.d], [String(first.r.title)], new Map());
      preview = `<p><b>${esc(p.settings.merge ? String(p.settings.mergedName || "合并文档") : String(first.r.out))}.docx</b> · ${esc(String(p.settings.cjk))} / ${esc(String(p.settings.latin))} ${esc(String(p.settings.size))}pt · ${esc(String(p.settings.page))}${p.settings.toc ? " · TOC" : ""}</p><div style="font-size:13px;line-height:1.7">${b.outline.map((o) => `<div style="padding-left:${(o.level - 1) * 18}px;${o.level === 1 ? "font-weight:600" : ""}">${esc(o.text)}</div>`).join("") || "<i>(no headings)</i>"}</div>`;
    }
    const n = included(p).length;
    return { rows, issues, preview, summary: `${n} Markdown file(s) → ${p.settings.merge ? "1 merged" : n} Word document(s)`, stats: { files: n, documents: p.settings.merge ? (n ? 1 : 0) : n } };
  },
  exports: [
    {
      id: "docx", label: ["Word 文档", "Word documents"], description: "<name>.docx for each Markdown file (or one merged .docx)",
      async run({ project, ws, write, computed }: ExportCtx) {
        const errs = (computed.issues ?? []).filter((i) => i.level === "error");
        if (errs.length) throw new KitError("has_errors", `Fix first: ${errs[0].message}`);
        const sel = included(project);
        if (!sel.length) throw new KitError("nothing_selected", "No files are selected.");
        const images = await loadImages(ws, sel.map((x) => x.d));
        const out: string[] = [];
        const missing: string[] = [];
        const jobs = project.settings.merge ? [{ name: String(project.settings.mergedName || "合并文档"), docs: sel.map((x) => x.d), title: String(project.settings.mergedName || sel[0].r.title) }] : sel.map((x) => ({ name: String(x.r.out), docs: [x.d], title: String(x.r.title) }));
        for (const j of jobs) {
          const b = build(project, j.docs, [j.title], images);
          missing.push(...b.stats.missing);
          out.push(await write(`${safeFileName(j.name, "document")}.docx`, b.build()));
        }
        return { files: out, note: missing.length ? `Missing images (placeholder text inserted): ${[...new Set(missing)].join(", ")}` : undefined };
      },
    },
  ],
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
