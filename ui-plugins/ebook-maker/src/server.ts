import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createKitServer } from "./kit/server-kit.ts";
import { KitError, Workspace } from "./kit/workspace.ts";
import { findPdfFonts } from "./kit/pdf-fonts.ts";
import { pdfFontkit } from "./kit/pdf-fontkit.ts";
import { CONFIG, OUTPUT, configToSave, loadBook, normalizeConfig, type Book } from "./project.ts";
import { buildEpub, previewHtml } from "./epub.ts";
import { buildPdf, type PdfFonts } from "./pdf.ts";

export const NAME = "ebook-maker";
export const VERSION = "0.1.0";
export const PANEL_URI = `ui://${NAME}/panel.html`;
const PDFJS_URI = `ui://${NAME}/pdfjs/{kind}/{file}`;

export interface ServerOptions {
  workspaceRoot: string;
  assetRoot: string;
  log?: (line: string) => void;
  /** 测试用：指定 PDF 字体文件 */
  fontPath?: string;
}

const metaSchema = z
  .object({
    title: z.string(), subtitle: z.string(), author: z.string(), language: z.string().describe('BCP 47, e.g. "zh-CN", "zh-Hant", "en"'),
    publisher: z.string(), date: z.string(), description: z.string(), rights: z.string(), identifier: z.string(),
    cover: z.string().describe("JPEG/PNG path relative to the book folder"),
    tocDepth: z.union([z.literal(1), z.literal(2)]).describe("1 = chapters only, 2 = also ## headings"),
    pdf: z.object({ pageSize: z.enum(["A5", "A4", "B6"]), fontSize: z.number() }).partial(),
  })
  .partial();

export function createServer(options: ServerOptions) {
  const ws = new Workspace(options.workspaceRoot);
  const { server, tool } = createKitServer({
    name: NAME,
    version: VERSION,
    panelUri: PANEL_URI,
    surface: "editor",
    panelHtml: () => readFile(join(options.assetRoot, "ui/panel.html"), "utf8"),
    panelMeta: { "zcode/csp": { wasmUnsafeEval: true } },
    log: options.log,
  });

  const rel = (book: Book, p: string) => (book.dir === "." ? p : posix.join(book.dir, p));
  async function reader(book: Book) {
    const cache = new Map<string, Uint8Array | undefined>();
    const paths = [...book.images.keys(), ...(book.config.cover ? [book.config.cover] : [])];
    for (const p of paths) {
      if (cache.has(p)) continue;
      try {
        cache.set(p, await ws.read(rel(book, p), 50 * 1024 * 1024));
      } catch {
        cache.set(p, undefined);
      }
    }
    return (p: string) => cache.get(p);
  }

  const summary = (book: Book) => ({
    dir: book.dir,
    saved: book.saved,
    config: book.config,
    chapters: book.chapters.map((c) => ({ file: c.file, id: c.id, title: c.title, chars: c.chars, images: c.images.length, footnotes: c.footnotes.length, headings: c.headings.filter((h) => h.level === 2).length })),
    issues: book.issues,
    external: book.external,
  });
  const describe = (book: Book, limit = 40) => {
    const c = book.config;
    const errors = book.issues.filter((i) => i.level === "error").length;
    const lines = [
      `${c.title}${c.subtitle ? ` — ${c.subtitle}` : ""}${c.author ? ` / ${c.author}` : ""} (${c.language}; cover: ${c.cover || "none"}; TOC depth ${c.tocDepth}; PDF ${c.pdf.pageSize} ${c.pdf.fontSize}pt)${book.saved ? "" : ` — ${CONFIG} not saved yet; settings are inferred`}`,
      `${book.chapters.length} chapter(s):`,
      ...book.chapters.map((ch, i) => `  ${i + 1}. ${ch.file} — ${ch.title} (${ch.chars} chars${ch.images.length ? `, ${ch.images.length} image(s)` : ""}${ch.footnotes.length ? `, ${ch.footnotes.length} footnote(s)` : ""})`),
      book.issues.length ? `Checks: ${errors} error(s), ${book.issues.length - errors} warning(s):` : "Checks: no problems found.",
      ...book.issues.slice(0, limit).map((i) => `  ${i.level === "error" ? "✗" : "!"} ${i.file ? `${i.file}${i.line ? `:${i.line}` : ""}: ` : ""}${i.message}`),
      ...(book.issues.length > limit ? [`  … ${book.issues.length - limit} more`] : []),
      `${book.external.length} external link(s)${book.external.length ? " (ebook_check lists them)" : ""}.`,
    ];
    return lines.join("\n");
  };

  tool(
    "ebook_open",
    {
      description:
        "Open a book folder of Markdown chapters (one file per chapter, `# Title` first; images relative to the chapter; footnotes `[^1]` + `[^1]: text`). Settings come from book.json in the folder when present (title, author, language, cover, chapter order…), otherwise they are inferred. Lists the chapters and the checks (missing images, broken internal links/anchors, undefined footnotes, missing metadata) and opens the panel.",
      input: { dir: z.string().describe("Book folder relative to the workspace") },
      openPanel: true,
      readOnly: true,
    },
    async ({ dir }) => {
      const book = await loadBook(ws, dir);
      return { text: `${describe(book)}\nNext: ebook_save to set metadata/order, ebook_export to write the EPUB and PDF.`, structured: { kind: "book", ...summary(book) } };
    },
  );

  tool(
    "ebook_save",
    {
      description: "Save book settings to <dir>/book.json: metadata (title, subtitle, author, language, publisher, date, description, rights, cover), chapter order (paths relative to the book folder; omit to keep), TOC depth and PDF page size/font size. Only the given fields change.",
      input: { dir: z.string(), meta: metaSchema.optional(), chapters: z.array(z.string()).optional() },
    },
    async ({ dir, meta, chapters }) => {
      const before = await loadBook(ws, dir);
      const next = normalizeConfig({ ...before.config, ...(meta ?? {}), pdf: { ...before.config.pdf, ...(meta?.pdf ?? {}) }, chapters: chapters ?? before.config.chapters });
      if (chapters) {
        const known = new Set((await ws.list({ dir: before.dir, exts: [".md", ".markdown"], limit: 5000 })).map((f) => (before.dir === "." ? f.path : posix.relative(before.dir, f.path))));
        const bad = chapters.filter((c: string) => !known.has(c.replace(/^\.\//, "")));
        if (bad.length) throw new KitError("not_found", `Not in ${before.dir}: ${bad.join(", ")}`);
      }
      await ws.write(rel(before, CONFIG), JSON.stringify(configToSave(next), null, 2) + "\n");
      const book = await loadBook(ws, dir);
      return { text: `Saved ${rel(book, CONFIG)}.\n${describe(book)}`, structured: { kind: "book", ...summary(book) } };
    },
  );

  tool(
    "ebook_check",
    {
      description: "Check a book folder and list every problem with file:line, plus all external links (URL, chapter, line) so they can be reviewed before publishing.",
      input: { dir: z.string() },
      readOnly: true,
    },
    async ({ dir }) => {
      const book = await loadBook(ws, dir);
      const ext = book.external.map((e) => `  ${e.file}:${e.line} ${e.url}${e.text && e.text !== e.url ? ` (“${e.text}”)` : ""}`);
      return { text: `${describe(book, 500)}\n${ext.length ? `External links:\n${ext.join("\n")}` : ""}`, structured: { kind: "check", ...summary(book) } };
    },
  );

  let fontsPromise: Promise<PdfFonts | undefined> | undefined;
  const fonts = () => (fontsPromise ??= findPdfFonts(options.fontPath ?? process.env.EBOOK_FONT).catch(() => undefined));

  tool(
    "ebook_export",
    {
      description:
        "Write the book to <dir>/export/: an EPUB 3 (cover, title page, navigation, chapters as XHTML, footnotes as linked notes at the end of each chapter, images embedded) and/or a print-style PDF (A5 by default: cover, title page, contents with page numbers, running heads, page numbers, footnotes as chapter endnotes, bookmarks and clickable links; uses a system Chinese font). Missing images are left out and reported. Returns paths, sizes and page count.",
      input: { dir: z.string(), formats: z.array(z.enum(["epub", "pdf"])).optional().describe('Default ["epub","pdf"]') },
      openPanel: true,
      timeoutMs: 600_000,
    },
    async ({ dir, formats }) => {
      const book = await loadBook(ws, dir);
      if (!book.chapters.length) throw new KitError("no_chapters", `No Markdown chapters in ${book.dir}`);
      const want = formats?.length ? formats : ["epub", "pdf"];
      const read = await reader(book);
      const base = (book.config.title || "book").replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "book";
      const outputs: { format: string; path: string; bytes: number; pages?: number }[] = [];
      const warnings: string[] = [];
      if (want.includes("epub")) {
        const e = buildEpub(book, read);
        const path = await ws.write(rel(book, posix.join(OUTPUT, `${base}.epub`)), e.data);
        outputs.push({ format: "epub", path, bytes: e.data.length });
      }
      if (want.includes("pdf")) {
        const r = await buildPdf(book, read, await fonts(), { fontkit: pdfFontkit });
        const path = await ws.write(rel(book, posix.join(OUTPUT, `${base}.pdf`)), r.data);
        outputs.push({ format: "pdf", path, bytes: r.data.length, pages: r.pages });
        warnings.push(...r.warnings);
      }
      const errors = book.issues.filter((i) => i.level === "error");
      const text = [
        ...outputs.map((o) => `${o.path} (${Math.round(o.bytes / 1024)} KB${o.pages ? `, ${o.pages} pages` : ""})`),
        ...warnings.map((w) => `! ${w}`),
        errors.length ? `${errors.length} problem(s) still open (missing images are left out):\n${errors.map((i) => `  ✗ ${i.file ?? ""}${i.line ? `:${i.line}` : ""} ${i.message}`).join("\n")}` : "Checks passed.",
      ].join("\n");
      return { text, structured: { kind: "exported", ...summary(book), outputs, warnings } };
    },
  );

  tool(
    "chapter_preview",
    { description: "Chapter HTML for the panel preview.", input: { dir: z.string(), file: z.string() }, visibility: ["app"], readOnly: true },
    async ({ dir, file }) => {
      const book = await loadBook(ws, dir);
      if (!book.chapters.some((c) => c.file === file)) throw new KitError("not_found", file);
      return { text: file, structured: { html: previewHtml(book, file, await reader(book)) } };
    },
  );

  tool(
    "file_data",
    { description: "Bytes of an exported PDF or an image for the panel.", input: { path: z.string() }, visibility: ["app"], readOnly: true },
    async ({ path }) => {
      if (!/\.(pdf|png|jpe?g)$/i.test(path)) throw new KitError("bad_type", path);
      return { text: path, structured: { data: (await ws.read(path, 200 * 1024 * 1024)).toString("base64") } };
    },
  );

  tool(
    "book_dirs",
    { description: "Folders with Markdown files, and images, for the panel.", input: { dir: z.string().optional() }, visibility: ["app"], readOnly: true },
    async ({ dir }) => {
      const md = await ws.list({ exts: [".md", ".markdown"], limit: 5000 });
      const dirs = [...new Set(md.map((f) => posix.dirname(f.path)))].filter((d) => !d.split("/").includes(OUTPUT)).sort();
      const images = dir ? (await ws.list({ dir, exts: [".jpg", ".jpeg", ".png"], limit: 2000 })).map((f) => (dir === "." ? f.path : posix.relative(dir, f.path))) : [];
      return { text: "", structured: { dirs, images } };
    },
  );

  server.registerResource("pdfjs-data", new ResourceTemplate(PDFJS_URI, { list: undefined }), { mimeType: "application/octet-stream" }, async (uri, { kind, file }) => {
    const folder = ({ cMapUrl: "cmaps", standardFontDataUrl: "standard_fonts", wasmUrl: "wasm" } as Record<string, string>)[String(kind)];
    const name = String(file);
    if (!folder || !/^[\w.-]+$/.test(name)) throw new KitError("bad_resource", uri.href);
    const data = await readFile(join(options.assetRoot, "pdfjs", folder, name));
    return { contents: [{ uri: uri.href, mimeType: "application/octet-stream", blob: data.toString("base64") }] };
  });

  return server;
}
