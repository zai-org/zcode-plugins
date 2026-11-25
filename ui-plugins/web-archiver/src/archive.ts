import { createHash } from "node:crypto";
import { posix } from "node:path";
import { diffArrays, diffChars, diffWordsWithSpace } from "diff";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { KitError, safeFileName, type Workspace } from "./kit/workspace.ts";
import { parseHTML } from "linkedom";
import { extract, type Article } from "./extract.ts";
import { checkUrl, decodeHtml, fetchBytes } from "./fetch.ts";

export const ROOT = "web-archive";
const INDEX = `${ROOT}/index.json`;
const IMG_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg", "image/avif": "avif", "image/x-icon": "ico" };

export interface Capture { at: string; dir: string; title: string; status: number; finalUrl: string; textHash: string; paragraphs: number; chars: number; images: number; imagesFailed: number; screenshot: boolean; change?: Change }
export interface Change { from: string; added: number; removed: number; changed: number; unchanged: boolean }
export interface Entry { url: string; title: string; site: string; captures: Capture[] }
export interface Index { version: 1; entries: Entry[] }

export async function readIndex(ws: Workspace): Promise<Index> {
  if (!(await ws.exists(INDEX))) return { version: 1, entries: [] };
  try {
    const v = JSON.parse(await ws.readText(INDEX));
    return { version: 1, entries: Array.isArray(v.entries) ? v.entries : [] };
  } catch {
    return { version: 1, entries: [] };
  }
}
async function writeIndex(ws: Workspace, index: Index) {
  index.entries.sort((a, b) => (b.captures.at(-1)?.at ?? "").localeCompare(a.captures.at(-1)?.at ?? ""));
  await ws.write(INDEX, JSON.stringify(index, null, 2) + "\n");
  const rows = index.entries.flatMap((e) => e.captures.slice().reverse().map((c, i) => `| ${i === 0 ? `[${e.title.replace(/\|/g, "\\|")}](${e.url})` : ""} | ${c.at.replace("T", " ").slice(0, 16)} | [${c.dir.split("/").pop()}](${posix.relative(ROOT, c.dir)}/article.md) | ${c.change ? (c.change.unchanged ? "unchanged" : `+${c.change.added} −${c.change.removed} ~${c.change.changed}`) : "first"} |`));
  await ws.write(`${ROOT}/index.md`, `# Web archive\n\n| Page | Captured (UTC) | Copy | Change |\n|---|---|---|---|\n${rows.join("\n")}\n`);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z").replace("T", "-");

export function slugFor(url: URL, title: string) {
  const last = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "").replace(/\.(html?|php|aspx?)$/i, "");
  return safeFileName((last || title || "index").slice(0, 60), "page");
}

const CSS = `body{max-width:46em;margin:2em auto;padding:0 1.2em;font:17px/1.75 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",serif;color:#1d1d1f}
img{max-width:100%;height:auto}pre{white-space:pre-wrap;background:#f5f5f5;padding:.8em;border-radius:6px;font-size:.88em}
table{border-collapse:collapse;max-width:100%;display:block;overflow:auto}td,th{border:1px solid #ccc;padding:.2em .5em}
blockquote{border-left:3px solid #ccc;margin:1em 0;padding-left:1em;color:#444}
.archive-meta{font:13px/1.5 system-ui,sans-serif;color:#555;border:1px solid #ddd;background:#fafafa;border-radius:8px;padding:.7em 1em;margin-bottom:2em}
.archive-meta a{color:#1a4f9c;word-break:break-all}h1.archive-title{line-height:1.3}`;

export function articleHtml(a: Article, url: string, at: string, body: string) {
  return `<!doctype html>
<html lang="${esc(a.lang || "und")}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(a.title)}</title><meta name="archive-source" content="${esc(url)}"><meta name="archive-captured" content="${at}">
<style>${CSS}</style></head><body>
<div class="archive-meta">Source: <a href="${esc(url)}">${esc(url)}</a><br>Captured: ${at.replace("T", " ").replace(/\.\d+Z$/, " UTC").replace(/Z$/, " UTC")}${a.byline ? `<br>Author: ${esc(a.byline)}` : ""}${a.published ? `<br>Published: ${esc(a.published)}` : ""}${a.siteName ? `<br>Site: ${esc(a.siteName)}` : ""}</div>
<h1 class="archive-title">${esc(a.title)}</h1>
${body}
</body></html>
`;
}

export function toMarkdown(a: Article, url: string, at: string, html: string) {
  const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", emDelimiter: "*" });
  td.use(gfm);
  td.remove(["script", "style"]);
  const body = td.turndown(html || "<p></p>");
  const fm = [["title", a.title], ["source", url], ["captured", at], ["author", a.byline], ["published", a.published], ["site", a.siteName]].filter(([, v]) => v).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return `---\n${fm.join("\n")}\n---\n\n# ${a.title}\n\n${body}\n`;
}

/** 段落级差异；相邻的删/增配对后再做字词级差异。 */
export function diffParagraphs(before: string[], after: string[]) {
  const parts = diffArrays(before, after);
  const rows: { type: "same" | "add" | "del" | "mod"; text: string; old?: string; html?: string }[] = [];
  let added = 0, removed = 0, changed = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p.added && !p.removed) { for (const t of p.value) rows.push({ type: "same", text: t }); continue; }
    const next = parts[i + 1];
    if (p.removed && next?.added) {
      const n = Math.min(p.value.length, next.value.length);
      for (let k = 0; k < n; k++) {
        const o = p.value[k], nw = next.value[k];
        const cjk = /[\u3400-\u9fff]/.test(o + nw);
        const d = cjk ? diffChars(o, nw) : diffWordsWithSpace(o, nw);
        const html = d.map((x) => (x.added ? `<ins>${esc(x.value)}</ins>` : x.removed ? `<del>${esc(x.value)}</del>` : esc(x.value))).join("");
        rows.push({ type: "mod", text: nw, old: o, html });
        changed++;
      }
      for (const t of p.value.slice(n)) { rows.push({ type: "del", text: t }); removed++; }
      for (const t of next.value.slice(n)) { rows.push({ type: "add", text: t }); added++; }
      i++;
      continue;
    }
    for (const t of p.value) { rows.push({ type: p.added ? "add" : "del", text: t }); if (p.added) added++; else removed++; }
  }
  return { rows, added, removed, changed };
}

export function diffHtml(title: string, from: Capture, to: Capture, rows: ReturnType<typeof diffParagraphs>["rows"]) {
  const body = rows
    .map((r, i) => {
      if (r.type === "same") {
        const near = rows.slice(Math.max(0, i - 1), i + 2).some((x) => x.type !== "same");
        return near ? `<p class="same">${esc(r.text)}</p>` : "";
      }
      if (r.type === "mod") return `<p class="mod">${r.html}</p>`;
      return `<p class="${r.type}">${esc(r.text)}</p>`;
    })
    .join("\n")
    .replace(/\n{2,}/g, "\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Changes: ${esc(title)}</title><style>${CSS}
.same{color:#777}.add{background:#e6ffec;border-left:4px solid #2da44e;padding-left:.6em}.del{background:#ffebe9;border-left:4px solid #cf222e;padding-left:.6em;text-decoration:line-through}.mod{border-left:4px solid #bf8700;padding-left:.6em}ins{background:#abf2bc;text-decoration:none}del{background:#ffcecb}</style></head><body>
<div class="archive-meta">${esc(title)}<br>From ${from.at} (${esc(from.dir)})<br>To ${to.at} (${esc(to.dir)})</div>
${body || "<p>No text changes.</p>"}
</body></html>
`;
}

/** 按映射改写 <img src>（在 DOM 上改，避免转义不一致）。 */
export function rewriteImages(html: string, map: (src: string) => string | undefined) {
  const { document } = parseHTML(`<div id="__r">${html}</div>`);
  const root = document.getElementById("__r")!;
  for (const img of root.querySelectorAll("img")) {
    const to = map(img.getAttribute("src") ?? "");
    if (to) img.setAttribute("src", to);
  }
  return root.innerHTML;
}

export interface CaptureOptions { images: boolean; screenshot?: (url: string, outAbs: string) => Promise<boolean>; now?: Date; maxImages?: number }

/** 采集一个网址：正文、图片本地化、离线 HTML（单文件，图片内嵌）、Markdown、原始 HTML、元数据；与上一次采集对比。 */
export async function capture(ws: Workspace, rawUrl: string, opts: CaptureOptions) {
  const url = checkUrl(rawUrl);
  const page = await fetchBytes(url.href, { browserUa: true });
  if (page.status >= 400) throw new KitError("http_error", `${url.href}: HTTP ${page.status}`);
  if (!/html|xml/.test(page.type) && page.type) throw new KitError("not_html", `${url.href} is ${page.type.split(";")[0]}, not a web page`);
  const html = decodeHtml(page.body, page.type);
  const article = extract(html, page.url);
  const now = opts.now ?? new Date();
  const at = now.toISOString();
  const host = safeFileName(new URL(page.url).hostname, "site");
  let dir = posix.join(ROOT, host, slugFor(new URL(page.url), article.title), stamp(now));
  for (let n = 2; await ws.exists(dir); n++) dir = posix.join(ROOT, host, slugFor(new URL(page.url), article.title), `${stamp(now)}-${n}`);

  // 图片：存到 assets/，单文件 HTML 里内嵌
  let body = article.html;
  let mdBody = article.html;
  let saved = 0, failed = 0;
  const local = new Map<string, { inline: string; file: string }>();
  const failures: string[] = [];
  if (opts.images) {
    const list = article.images.slice(0, opts.maxImages ?? 150);
    let n = 0;
    const queue = [...list];
    const workers = Array.from({ length: 4 }, async () => {
      while (queue.length) {
        const img = queue.shift()!;
        const idx = ++n;
        try {
          if (img.src.startsWith("data:")) continue;
          const r = await fetchBytes(img.src, { maxBytes: 15 * 1024 * 1024, accept: "image/avif,image/webp,image/*,*/*;q=0.8", referer: page.url, timeoutMs: 20_000, browserUa: true });
          const type = r.type.split(";")[0].trim();
          const ext = IMG_EXT[type] ?? (/\.(png|jpe?g|gif|webp|svg)(\?|$)/i.exec(img.src)?.[1]?.toLowerCase().replace("jpeg", "jpg") ?? "");
          if (r.status >= 400 || !ext) throw new Error(r.status >= 400 ? `HTTP ${r.status}` : `not an image (${type || "unknown type"})`);
          const name = `assets/${String(idx).padStart(3, "0")}.${ext}`;
          await ws.write(posix.join(dir, name), r.body);
          const mime = Object.entries(IMG_EXT).find(([, e]) => e === ext)?.[0] ?? type;
          local.set(img.src, { inline: `data:${mime};base64,${Buffer.from(r.body).toString("base64")}`, file: name });
          saved++;
        } catch (error) {
          failed++;
          failures.push(`${img.src}: ${(error as Error).message}`);
        }
      }
    });
    await Promise.all(workers);
    body = rewriteImages(article.html, (src) => local.get(src)?.inline);
    mdBody = rewriteImages(article.html, (src) => local.get(src)?.file);
  }
  await ws.write(posix.join(dir, "article.html"), articleHtml(article, page.url, at, body));
  await ws.write(posix.join(dir, "article.md"), toMarkdown(article, page.url, at, mdBody));
  await ws.write(posix.join(dir, "source.html"), page.body);
  await ws.write(posix.join(dir, "text.json"), JSON.stringify(article.paragraphs, null, 1) + "\n");
  let shot = false;
  if (opts.screenshot) shot = await opts.screenshot(page.url, ws.resolve(posix.join(dir, "screenshot.png"))).catch(() => false);

  const textHash = createHash("sha256").update(article.paragraphs.join("\n")).digest("hex").slice(0, 16);
  const cap: Capture = { at, dir, title: article.title, status: page.status, finalUrl: page.url, textHash, paragraphs: article.paragraphs.length, chars: article.paragraphs.join("").length, images: saved, imagesFailed: failed, screenshot: shot };

  const index = await readIndex(ws);
  let entry = index.entries.find((e) => e.url === url.href || e.url === page.url || e.captures.some((c) => c.finalUrl === page.url));
  if (!entry) index.entries.push((entry = { url: url.href, title: article.title, site: article.siteName, captures: [] }));
  const prev = entry.captures.at(-1);
  let diff: ReturnType<typeof diffParagraphs> | undefined;
  if (prev) {
    const before = (await ws.exists(posix.join(prev.dir, "text.json"))) ? (JSON.parse(await ws.readText(posix.join(prev.dir, "text.json"))) as string[]) : [];
    diff = diffParagraphs(before, article.paragraphs);
    cap.change = { from: prev.dir, added: diff.added, removed: diff.removed, changed: diff.changed, unchanged: prev.textHash === textHash };
    await ws.write(posix.join(dir, "changes.html"), diffHtml(article.title, prev, cap, diff.rows));
  }
  entry.title = article.title;
  entry.captures.push(cap);
  await ws.write(posix.join(dir, "meta.json"), JSON.stringify({ url: url.href, finalUrl: page.url, capturedAt: at, status: page.status, title: article.title, byline: article.byline, site: article.siteName, published: article.published, lang: article.lang, excerpt: article.excerpt, textHash, paragraphs: cap.paragraphs, images: { saved, failed, failures }, screenshot: shot, change: cap.change ?? null }, null, 2) + "\n");
  await writeIndex(ws, index);
  return { capture: cap, article, failures, diff };
}
