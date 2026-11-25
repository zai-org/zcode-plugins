import { createHash, randomUUID } from "node:crypto";
import { posix } from "node:path";
import { KitError, type Workspace } from "./kit/workspace.ts";
import { isExternal, parseChapter, resolveLink, safeDecode, type Chapter, type Issue } from "./book.ts";

export interface BookMeta {
  title: string;
  subtitle: string;
  author: string;
  language: string;
  identifier: string;
  publisher: string;
  date: string;
  description: string;
  rights: string;
  cover: string;
}
export interface BookConfig extends BookMeta {
  /** 章节顺序（相对书目录）；为空时按文件名排序 */
  chapters: string[];
  tocDepth: 1 | 2;
  pdf: { pageSize: "A5" | "A4" | "B6"; fontSize: number };
}
export interface Book {
  dir: string;
  config: BookConfig;
  /** book.json 是否已存在 */
  saved: boolean;
  chapters: Chapter[];
  issues: Issue[];
  external: { url: string; file: string; line: number; text: string }[];
  /** 所有引用到的图片：书内路径 → 是否存在 */
  images: Map<string, boolean>;
}

export const CONFIG = "book.json";
export const OUTPUT = "export";
export const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", webp: "image/webp" };
const PDF_IMAGES = new Set(["png", "jpg", "jpeg"]);
export const extOf = (p: string) => p.toLowerCase().split(".").pop() ?? "";
const natural = new Intl.Collator("zh", { numeric: true, sensitivity: "base" });
const isChapterFile = (p: string) => /\.(md|markdown)$/i.test(p) && !/(^|\/)(readme|license|changelog)\.md$/i.test(p);

export function normalizeConfig(raw: any, defaults: Partial<BookConfig> = {}): BookConfig {
  const r = { ...defaults, ...(raw ?? {}) };
  const str = (k: keyof BookMeta) => String(r[k] ?? "").trim();
  const size = ["A5", "A4", "B6"].includes(r.pdf?.pageSize) ? r.pdf.pageSize : "A5";
  return {
    title: str("title"),
    subtitle: str("subtitle"),
    author: str("author"),
    language: str("language") || "en",
    identifier: str("identifier") || `urn:uuid:${randomUUID()}`,
    publisher: str("publisher"),
    date: str("date"),
    description: str("description"),
    rights: str("rights"),
    cover: str("cover").replace(/^\.\//, ""),
    chapters: (Array.isArray(r.chapters) ? r.chapters : []).map((c: unknown) => String(c).replace(/^\.\//, "")).filter(Boolean),
    tocDepth: Number(r.tocDepth) === 2 ? 2 : 1,
    pdf: { pageSize: size, fontSize: Math.max(8, Math.min(14, Number(r.pdf?.fontSize) || 10.5)) },
  };
}

/** 读书目录：book.json（可没有）+ 章节 + 全部检查。 */
export async function loadBook(ws: Workspace, dirRaw: string): Promise<Book> {
  const dir = posix.normalize(String(dirRaw || ".").replace(/\\/g, "/")).replace(/\/+$/, "") || ".";
  const rel = (p: string) => (dir === "." ? p : posix.join(dir, p));
  if (!(await ws.exists(dir))) throw new KitError("not_found", `Folder not found: ${dir}`);
  const all = (await ws.list({ dir, limit: 5000 })).map((f) => (dir === "." ? f.path : posix.relative(dir, f.path)));
  const existing = new Set(all);
  const mdFiles = all.filter((p) => isChapterFile(p) && !p.startsWith(`${OUTPUT}/`)).sort(natural.compare);
  const saved = existing.has(CONFIG);
  let raw: any = {};
  if (saved) {
    try {
      raw = JSON.parse(await ws.readText(rel(CONFIG)));
    } catch (error) {
      throw new KitError("bad_config", `${rel(CONFIG)} is not valid JSON: ${(error as Error).message}`);
    }
  }
  const issues: Issue[] = [];
  const order = (Array.isArray(raw.chapters) && raw.chapters.length ? raw.chapters.map(String) : mdFiles) as string[];
  const chapters: Chapter[] = [];
  const sources: string[] = [];
  for (const [i, file] of order.entries()) {
    const f = file.replace(/^\.\//, "");
    if (!existing.has(f)) { issues.push({ level: "error", kind: "missing-chapter", file: CONFIG, message: `Chapter ${f} listed in ${CONFIG} does not exist` }); continue; }
    const src = await ws.readText(rel(f));
    sources.push(src);
    const r = parseChapter(f, src, `c${String(i + 1).padStart(2, "0")}`);
    chapters.push(r.chapter);
    issues.push(...r.issues);
  }
  if (saved) for (const f of mdFiles) if (!order.includes(f)) issues.push({ level: "warning", kind: "unlisted-chapter", file: f, message: `${f} is not in the chapter list` });
  if (!chapters.length) issues.push({ level: "error", kind: "no-chapters", message: `No Markdown chapters in ${dir}` });

  // 默认值：标题取文件夹名，语言按文字判断，封面找 cover.*
  const sample = sources.join("").slice(0, 20000);
  const cjk = (sample.match(/[\u3400-\u9fff]/g) ?? []).length;
  const latin = (sample.match(/[a-z]/gi) ?? []).length;
  const coverGuess = all.find((p) => /^(images\/|img\/)?cover\.(jpe?g|png)$/i.test(p)) ?? "";
  const config = normalizeConfig(raw, {
    title: posix.basename(dir === "." ? "book" : dir),
    language: cjk > latin / 3 ? (/[們這個說話將]/.test(sample) ? "zh-Hant" : "zh-CN") : "en",
    cover: coverGuess,
    identifier: `urn:uuid:${uuidFrom(dir)}`,
  });
  config.chapters = chapters.map((c) => c.file);

  const byFile = new Map(chapters.map((c) => [c.file, c]));
  const images = new Map<string, boolean>();
  const external: Book["external"] = [];
  for (const c of chapters) {
    for (const im of c.images) {
      if (isExternal(im.src)) { issues.push({ level: "warning", kind: "remote-image", file: c.file, line: im.line, target: im.src, message: `Remote image ${im.src} is not downloaded; it is left out` }); continue; }
      const p = posix.normalize(posix.join(posix.dirname(c.file), safeDecode(im.src.split(/[?#]/)[0])));
      const ok = existing.has(p);
      images.set(p, ok);
      if (!ok) issues.push({ level: "error", kind: "missing-image", file: c.file, line: im.line, target: im.src, message: `Image not found: ${im.src}` });
      else if (!IMAGE_TYPES[extOf(p)]) issues.push({ level: "error", kind: "unsupported-image", file: c.file, line: im.line, target: im.src, message: `Unsupported image type: ${im.src} (use PNG, JPEG, GIF, SVG or WebP)` });
      else if (!PDF_IMAGES.has(extOf(p))) issues.push({ level: "warning", kind: "pdf-image", file: c.file, line: im.line, target: im.src, message: `${im.src}: ${extOf(p).toUpperCase()} goes into the EPUB; the PDF shows its description instead (use PNG or JPEG)` });
    }
    for (const l of c.links) {
      const r = resolveLink(l.href, c.file, byFile, (p) => existing.has(p));
      if (r.kind === "external") { if (/^https?:/i.test(l.href)) external.push({ url: l.href, file: c.file, line: l.line, text: l.text }); continue; }
      if (r.kind === "broken") { issues.push({ level: "error", kind: "broken-link", file: c.file, line: l.line, target: l.href, message: `Link target not found: ${l.href}` }); continue; }
      if (r.kind === "file") { issues.push({ level: "warning", kind: "file-link", file: c.file, line: l.line, target: l.href, message: `${l.href} is not a chapter; the link is kept as plain text` }); continue; }
      if (r.anchor) {
        const target = byFile.get(r.chapter!)!;
        if (!target.headings.some((h) => h.slug === r.anchor)) issues.push({ level: "error", kind: "broken-anchor", file: c.file, line: l.line, target: l.href, message: `No heading #${r.anchor} in ${target.file}` });
      }
    }
  }
  if (config.cover) {
    if (!existing.has(config.cover)) issues.push({ level: "error", kind: "missing-cover", file: CONFIG, message: `Cover image not found: ${config.cover}` });
    else if (!PDF_IMAGES.has(extOf(config.cover))) issues.push({ level: "error", kind: "unsupported-cover", file: CONFIG, message: "The cover must be a JPEG or PNG" });
  } else issues.push({ level: "warning", kind: "metadata", message: "No cover image (set cover in the book settings)" });
  if (!raw.title) issues.push({ level: "warning", kind: "metadata", message: `No title set; using "${config.title}"` });
  if (!config.author) issues.push({ level: "warning", kind: "metadata", message: "No author set" });
  issues.sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1));
  return { dir, config, saved, chapters, issues, external, images };
}

function uuidFrom(text: string) {
  const h = createHash("sha256").update(`ebook-maker:${text}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** book.json 里保存的字段（chapters 只在用户改过顺序时写）。 */
export function configToSave(config: BookConfig) {
  const { chapters, ...rest } = config;
  return { ...rest, chapters };
}
