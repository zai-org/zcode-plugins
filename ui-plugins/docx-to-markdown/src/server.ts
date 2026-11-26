import { createApp, esc, type AppDef, type ExportCtx, type Issue, type Project } from "./kit/app.ts";
import { KitError, safeFileName } from "./kit/workspace.ts";
import { convertDocx, type Converted } from "./convert.ts";

export const NAME = "docx-to-markdown";
export const VERSION = "0.1.0";

const baseOf = (f: string) => f.split("/").pop()!.replace(/\.docx$/i, "");
const mediaDirOf = (p: Project, out: string) => safeFileName(String(p.settings.mediaFolder || "{name}_images").replace(/\{name\}/g, out), "images");
const offsetOf = (p: Project) => (p.settings.headings === "keep" ? 0 : p.settings.headings === "shift" ? 1 : -1);

async function convertRow(ctx: { ws: { read: (p: string, max?: number) => Promise<Buffer> } }, p: Project, file: string, out: string): Promise<Converted> {
  try {
    return convertDocx(new Uint8Array(await ctx.ws.read(file, 100 * 1024 * 1024)), { mediaDir: mediaDirOf(p, out), headingOffset: offsetOf(p), underline: Boolean(p.settings.underline) });
  } catch (e) {
    throw new KitError("bad_docx", `${file}: ${(e as Error).message}`);
  }
}
const included = (p: Project) => p.rows.map((r, i) => ({ r, i })).filter((x) => x.r.include !== false);

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "docx2md",
  title: ["Word 转 Markdown", "Word to Markdown"],
  openDescription:
    "Convert Word documents (.docx) in the workspace into clean Markdown for notes apps, wikis, static sites or Git: headings (from Heading styles or outline levels; a Title can become the single H1), bold/italic/strikethrough, inline code and code blocks (from monospace fonts or Code styles), links, bullet and numbered lists including nested levels, tables as GFM tables (merged cells flattened, | escaped), block quotes, and embedded images extracted into an images folder next to the .md with relative links. Skips the TOC field and hidden text. Each file gets a title/output name the user can change; warnings list anything that couldn't be carried over.",
  inputs: { exts: [".docx"], min: 1, max: 30, label: ["选择 Word 文件（可多选）", "Pick Word (.docx) files"] },
  settings: [
    { key: "headings", label: ["标题层级", "Heading levels"], type: "select", default: "auto", options: [{ value: "auto", label: ["自动（有文档标题时其余标题降一级）", "Auto (shift down when a Title exists)"] }, { value: "keep", label: ["保持 Word 的层级", "Keep Word levels"] }, { value: "shift", label: ["全部降一级", "Shift all down one level"] }] },
    { key: "mediaFolder", label: ["图片文件夹名（{name} = 文件名）", "Images folder ({name} = file name)"], type: "text", default: "{name}_images" },
    { key: "underline", label: ["保留下划线（<u>）", "Keep underline as <u>"], type: "bool", default: false },
    { key: "frontMatter", label: ["加 YAML 头（title）", "Add YAML front matter (title)"], type: "bool", default: false },
  ],
  columns: () => [
    { key: "include", label: ["转换", "Convert"], type: "bool" },
    { key: "file", label: ["文件", "File"], readOnly: true },
    { key: "out", label: ["输出文件名", "Output name"] },
    { key: "_info", label: ["内容", "Contents"], readOnly: true, wide: true },
  ],
  async load({ files }) {
    return { rows: files.map((f) => ({ include: true, file: f, out: baseOf(f) })), meta: {} };
  },
  async compute(p, ctx) {
    const issues: Issue[] = [];
    let preview = "<p>Nothing selected.</p>";
    let firstDone = false;
    let totalImages = 0;
    const rows = [];
    for (const [i, r] of p.rows.entries()) {
      let info = "";
      try {
        const c = await convertRow(ctx, p, String(r.file), String(r.out || baseOf(String(r.file))));
        const s = c.stats;
        info = `${s.headings} headings · ${s.tables} tables · ${s.images} images · ${s.lists} lists · ${s.links} links`;
        c.warnings.forEach((w) => issues.push({ level: "warn", row: i, message: `${r.file}: ${w}` }));
        if (s.comments) issues.push({ level: "info", row: i, message: `${r.file}: ${s.comments} comment(s) are not carried over.` });
        if (r.include !== false) totalImages += s.images;
        if (!firstDone && r.include !== false) {
          firstDone = true;
          preview = `<p><b>${esc(String(r.out))}.md</b>${s.images ? ` + ${esc(mediaDirOf(p, String(r.out)))}/ (${s.images})` : ""}</p><pre style="white-space:pre-wrap;font-size:12px;max-height:520px;overflow:auto">${esc(c.markdown.slice(0, 6000))}</pre>`;
        }
      } catch (e) {
        info = "—";
        issues.push({ level: "error", row: i, message: (e as Error).message });
      }
      if (r.include !== false && !String(r.out ?? "").trim()) issues.push({ level: "error", row: i, key: "out", message: "Output name is empty." });
      rows.push({ ...r, _info: info });
    }
    const outs = included(p).map((x) => String(x.r.out).trim().toLowerCase());
    if (new Set(outs).size < outs.length) issues.push({ level: "error", key: "out", message: "Two files would be written with the same output name." });
    const n = included(p).length;
    return { rows, issues, preview, summary: `${n} Word file(s) → Markdown${totalImages ? `, ${totalImages} image(s)` : ""}`, stats: { files: n, images: totalImages } };
  },
  exports: [
    {
      id: "markdown", label: ["Markdown 文件", "Markdown files"], description: "<name>.md for each Word file, plus its images folder",
      async run(ctx: ExportCtx) {
        const { project, write, computed } = ctx;
        const errs = (computed.issues ?? []).filter((i) => i.level === "error" && (i.row === undefined || project.rows[i.row]?.include !== false));
        if (errs.length) throw new KitError("has_errors", `Fix first: ${errs[0].message}`);
        const sel = included(project);
        if (!sel.length) throw new KitError("nothing_selected", "No files are selected.");
        const out: string[] = [];
        for (const { r } of sel) {
          const name = safeFileName(String(r.out), "document");
          const c = await convertRow(ctx, project, String(r.file), name);
          const fm = project.settings.frontMatter ? `---\ntitle: ${JSON.stringify(c.title || name)}\nsource: ${JSON.stringify(String(r.file).split("/").pop())}\n---\n\n` : "";
          out.push(await write(`${name}.md`, fm + c.markdown));
          for (const m of c.media) out.push(await write(`${mediaDirOf(project, name)}/${m.name}`, m.data));
        }
        return out;
      },
    },
  ],
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
