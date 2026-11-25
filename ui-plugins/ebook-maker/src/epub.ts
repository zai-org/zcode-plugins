import { zipSync, strToU8 } from "fflate";
import { XMLValidator } from "fast-xml-parser";
import { posix } from "node:path";
import { decode, isExternal, resolveLink, runsText, safeDecode, type Block, type Chapter, type Run } from "./book.ts";
import { extOf, IMAGE_TYPES, type Book } from "./project.ts";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const isCjk = (lang: string) => /^(zh|ja|ko)/i.test(lang);

export const L10N = (lang: string) =>
  /^zh/i.test(lang)
    ? { toc: lang.toLowerCase().includes("hant") || /tw|hk/i.test(lang) ? "目錄" : "目录", notes: lang.toLowerCase().includes("hant") || /tw|hk/i.test(lang) ? "註釋" : "注释", cover: "封面", back: "返回" }
    : { toc: "Contents", notes: "Notes", cover: "Cover", back: "Back" };

export const CSS = (lang: string) => `@charset "utf-8";
body { margin: 0 5%; line-height: 1.7; font-family: serif; }
h1 { font-size: 1.6em; margin: 2em 0 1.2em; text-align: center; line-height: 1.3; }
h2 { font-size: 1.3em; margin: 1.6em 0 0.8em; line-height: 1.35; }
h3 { font-size: 1.12em; margin: 1.4em 0 0.6em; }
h4, h5, h6 { font-size: 1em; margin: 1.2em 0 0.5em; }
p { margin: ${isCjk(lang) ? "0 0 0.25em; text-indent: 2em" : "0 0 0.6em"}; text-align: justify; }
li p, blockquote p, td p, th p, aside p { text-indent: 0; }
blockquote { margin: 1em 1.5em; color: #444; border-left: 3px solid #ccc; padding-left: 0.8em; }
pre { white-space: pre-wrap; background: #f4f4f4; padding: 0.6em 0.8em; font-size: 0.85em; line-height: 1.45; border-radius: 4px; }
code { font-family: monospace; font-size: 0.92em; }
figure { margin: 1.2em 0; text-align: center; page-break-inside: avoid; }
figure img { max-width: 100%; max-height: 90vh; }
figcaption { font-size: 0.85em; color: #555; margin-top: 0.4em; text-indent: 0; }
table { border-collapse: collapse; margin: 1em auto; font-size: 0.9em; }
th, td { border: 1px solid #999; padding: 0.3em 0.6em; }
th { background: #eee; }
hr { border: none; border-top: 1px solid #999; width: 30%; margin: 1.5em auto; }
a { color: #1a4f9c; }
sup a.noteref { text-decoration: none; font-size: 0.75em; }
section.footnotes { margin-top: 2.5em; border-top: 1px solid #bbb; padding-top: 0.6em; font-size: 0.85em; }
section.footnotes h2 { font-size: 1em; margin: 0 0 0.5em; }
aside.footnote { margin: 0 0 0.4em; }
aside.footnote p { text-indent: 0; margin: 0; }
.titlepage { text-align: center; margin-top: 25%; }
.titlepage h1 { font-size: 2em; margin: 0 0 0.4em; }
.titlepage .subtitle { font-size: 1.2em; color: #444; }
.titlepage .author { font-size: 1.2em; margin-top: 3em; }
.titlepage .publisher { margin-top: 6em; color: #555; }
nav ol { list-style: none; padding-left: 1em; }
.cover { margin: 0; padding: 0; text-align: center; }
.cover img { max-width: 100%; max-height: 100vh; }
`;

/** 把可能不规范的 HTML 片段转成 XHTML；转不了就当文字。 */
export function xhtmlFragment(html: string): string {
  let x = html.replace(/<(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)\b([^>]*?)\s*\/?>/gi, "<$1$2/>");
  x = x.replace(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)([a-z]+);/gi, (m, _a, name) => {
    const d = decode(m);
    return d === m ? `&amp;${name};` : `&#${d.codePointAt(0)};`;
  });
  return XMLValidator.validate(`<div>${x}</div>`) === true ? x : `<p>${esc(html)}</p>`;
}

export interface ImageRef { path: string; href: string; id: string; type: string }

export function buildEpub(book: Book, read: (p: string) => Uint8Array | undefined, modified = new Date()) {
  const { config, chapters } = book;
  const lang = config.language;
  const t = L10N(lang);
  const files: Record<string, Uint8Array> = {};
  const byFile = new Map(chapters.map((c) => [c.file, c]));
  const imageRefs = new Map<string, ImageRef>();
  const imageFor = (path: string) => {
    if (!imageRefs.has(path)) {
      const data = read(path);
      if (!data || !IMAGE_TYPES[extOf(path)]) return undefined;
      const n = imageRefs.size + 1;
      const name = `${String(n).padStart(3, "0")}-${posix.basename(path).replace(/[^\w.-]+/g, "_")}`;
      imageRefs.set(path, { path, href: `images/${name}`, id: `img${n}`, type: IMAGE_TYPES[extOf(path)] });
      files[`OEBPS/images/${name}`] = data;
    }
    return imageRefs.get(path);
  };
  const xhtml = (title: string, body: string) =>
    `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${esc(lang)}" lang="${esc(lang)}">\n<head>\n<meta charset="utf-8"/>\n<title>${esc(title)}</title>\n<link rel="stylesheet" type="text/css" href="../style.css"/>\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
  const chapterHref = (c: Chapter) => `${c.id}.xhtml`;

  function renderRuns(runs: Run[], c: Chapter): string {
    let out = "";
    for (const r of runs) {
      if (r.br) { out += "<br/>"; continue; }
      if (r.fn) { out += `<sup><a class="noteref" epub:type="noteref" id="${c.id}-fnref-${r.fn}" href="#${c.id}-fn-${r.fn}">${r.fn}</a></sup>`; continue; }
      let s = esc(r.text);
      if (r.code) s = `<code>${s}</code>`;
      if (r.bold) s = `<strong>${s}</strong>`;
      if (r.italic) s = `<em>${s}</em>`;
      if (r.del) s = `<del>${s}</del>`;
      if (r.href) {
        const href = linkHref(r.href, c);
        if (href) s = `<a href="${esc(href)}">${s}</a>`;
      }
      out += s;
    }
    return out;
  }
  function linkHref(href: string, c: Chapter): string | undefined {
    if (isExternal(href)) return href;
    const r = resolveLink(href, c.file, byFile, () => false);
    if (r.kind === "anchor") return `#${r.anchor ?? ""}`;
    if (r.kind === "chapter") return `${chapterHref(byFile.get(r.chapter!)!)}${r.anchor ? `#${r.anchor}` : ""}`;
    return undefined;
  }
  function renderBlocks(blocks: Block[], c: Chapter): string {
    return blocks
      .map((b) => {
        switch (b.t) {
          case "h": return `<h${b.level} id="${esc(b.slug)}">${renderRuns(b.runs, c)}</h${b.level}>`;
          case "p": return `<p>${renderRuns(b.runs, c)}</p>`;
          case "list": {
            const tag = b.ordered ? "ol" : "ul";
            return `<${tag}${b.ordered && b.start !== 1 ? ` start="${b.start}"` : ""}>${b.items.map((it) => `<li>${it.length === 1 && it[0].t === "p" ? renderRuns(it[0].runs, c) : renderBlocks(it, c)}</li>`).join("")}</${tag}>`;
          }
          case "quote": return `<blockquote>${renderBlocks(b.blocks, c)}</blockquote>`;
          case "code": return `<pre><code>${esc(b.text)}</code></pre>`;
          case "img": {
            const path = posix.normalize(posix.join(posix.dirname(c.file), safeDecode(b.src.split(/[?#]/)[0])));
            const ref = isExternal(b.src) ? undefined : imageFor(path);
            if (!ref) return b.alt ? `<p class="missing">[${esc(b.alt)}]</p>` : "";
            return `<figure><img src="../${ref.href}" alt="${esc(b.alt)}"/>${b.alt ? `<figcaption>${esc(b.alt)}</figcaption>` : ""}</figure>`;
          }
          case "table": {
            const al = (i: number) => (b.align[i] ? ` style="text-align:${b.align[i]}"` : "");
            return `<table><thead><tr>${b.header.map((h, i) => `<th${al(i)}>${renderRuns(h, c)}</th>`).join("")}</tr></thead><tbody>${b.rows.map((r) => `<tr>${r.map((cell, i) => `<td${al(i)}>${renderRuns(cell, c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
          }
          case "hr": return "<hr/>";
          case "html": return xhtmlFragment(b.html);
        }
      })
      .join("\n");
  }

  /** 一章的 XHTML（正文 + 章末脚注）。 */
  const chapterBody = (c: Chapter) => {
    let body = renderBlocks(c.blocks, c);
    if (!c.blocks.some((b) => b.t === "h" && b.level === 1)) body = `<h1>${esc(c.title)}</h1>\n${body}`;
    if (c.footnotes.length)
      body += `\n<section class="footnotes" epub:type="footnotes"><h2>${t.notes}</h2>\n${c.footnotes
        .map((f) => `<aside class="footnote" epub:type="footnote" id="${c.id}-fn-${f.n}"><p><a href="#${c.id}-fnref-${f.n}">${f.n}.</a> ${renderRuns(f.runs, c)}</p></aside>`)
        .join("\n")}</section>`;
    return body;
  };

  for (const c of chapters) files[`OEBPS/text/${chapterHref(c)}`] = strToU8(xhtml(c.title, chapterBody(c)));

  const cover = config.cover ? imageFor(config.cover) : undefined;
  const titleBody = `<section class="titlepage" epub:type="titlepage"><h1>${esc(config.title)}</h1>${config.subtitle ? `<p class="subtitle">${esc(config.subtitle)}</p>` : ""}${config.author ? `<p class="author">${esc(config.author)}</p>` : ""}${config.publisher ? `<p class="publisher">${esc(config.publisher)}${config.date ? ` · ${esc(config.date)}` : ""}</p>` : ""}</section>`;
  files["OEBPS/text/title.xhtml"] = strToU8(xhtml(config.title, titleBody));
  if (cover) files["OEBPS/text/cover.xhtml"] = strToU8(xhtml(t.cover, `<div class="cover"><img src="../${cover.href}" alt="${esc(config.title)}"/></div>`));

  // 目录：章节（tocDepth=2 时含二级标题）
  const tocItems = chapters.map((c) => {
    const subs = config.tocDepth === 2 ? c.headings.filter((h) => h.level === 2) : [];
    return `<li><a href="text/${chapterHref(c)}">${esc(c.title)}</a>${subs.length ? `<ol>${subs.map((h) => `<li><a href="text/${chapterHref(c)}#${esc(h.slug)}">${esc(h.text)}</a></li>`).join("")}</ol>` : ""}</li>`;
  });
  const nav = `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${esc(lang)}" lang="${esc(lang)}">\n<head><meta charset="utf-8"/><title>${t.toc}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>\n<body>\n<nav epub:type="toc" id="toc"><h1>${t.toc}</h1><ol>${tocItems.join("")}</ol></nav>\n<nav epub:type="landmarks" hidden="hidden"><ol>${cover ? `<li><a epub:type="cover" href="text/cover.xhtml">${t.cover}</a></li>` : ""}<li><a epub:type="toc" href="nav.xhtml">${t.toc}</a></li>${chapters[0] ? `<li><a epub:type="bodymatter" href="text/${chapterHref(chapters[0])}">${esc(chapters[0].title)}</a></li>` : ""}</ol></nav>\n</body>\n</html>\n`;
  files["OEBPS/nav.xhtml"] = strToU8(nav);
  let play = 0;
  const ncxPoints = chapters
    .map((c) => {
      const subs = config.tocDepth === 2 ? c.headings.filter((h) => h.level === 2) : [];
      return `<navPoint id="np${++play}" playOrder="${play}"><navLabel><text>${esc(c.title)}</text></navLabel><content src="text/${chapterHref(c)}"/>${subs.map((h) => `<navPoint id="np${++play}" playOrder="${play}"><navLabel><text>${esc(h.text)}</text></navLabel><content src="text/${chapterHref(c)}#${esc(h.slug)}"/></navPoint>`).join("")}</navPoint>`;
    })
    .join("\n");
  files["OEBPS/toc.ncx"] = strToU8(`<?xml version="1.0" encoding="utf-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="${esc(config.identifier)}"/></head><docTitle><text>${esc(config.title)}</text></docTitle><navMap>${ncxPoints}</navMap></ncx>\n`);
  files["OEBPS/style.css"] = strToU8(CSS(lang));

  const modifiedIso = modified.toISOString().replace(/\.\d+Z$/, "Z");
  const manifest = [
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
    `<item id="css" href="style.css" media-type="text/css"/>`,
    cover ? `<item id="cover-page" href="text/cover.xhtml" media-type="application/xhtml+xml"/>` : "",
    `<item id="title-page" href="text/title.xhtml" media-type="application/xhtml+xml"/>`,
    ...chapters.map((c) => `<item id="${c.id}" href="text/${chapterHref(c)}" media-type="application/xhtml+xml"/>`),
    ...[...imageRefs.values()].map((r) => `<item id="${r.id}" href="${r.href}" media-type="${r.type}"${r === cover ? ' properties="cover-image"' : ""}/>`),
  ].filter(Boolean);
  const spine = [cover ? `<itemref idref="cover-page" linear="yes"/>` : "", `<itemref idref="title-page"/>`, `<itemref idref="nav"/>`, ...chapters.map((c) => `<itemref idref="${c.id}"/>`)].filter(Boolean);
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${esc(lang)}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">${esc(config.identifier)}</dc:identifier>
<dc:title>${esc(config.title)}</dc:title>
<dc:language>${esc(lang)}</dc:language>
${config.author ? `<dc:creator id="author">${esc(config.author)}</dc:creator>` : ""}
${config.publisher ? `<dc:publisher>${esc(config.publisher)}</dc:publisher>` : ""}
${config.date ? `<dc:date>${esc(config.date)}</dc:date>` : ""}
${config.description ? `<dc:description>${esc(config.description)}</dc:description>` : ""}
${config.rights ? `<dc:rights>${esc(config.rights)}</dc:rights>` : ""}
<meta property="dcterms:modified">${modifiedIso}</meta>
${cover ? `<meta name="cover" content="${cover.id}"/>` : ""}
</metadata>
<manifest>
${manifest.join("\n")}
</manifest>
<spine toc="ncx">
${spine.join("\n")}
</spine>
</package>
`.replace(/\n{2,}/g, "\n");
  files["OEBPS/content.opf"] = strToU8(opf);
  files["META-INF/container.xml"] = strToU8(`<?xml version="1.0" encoding="utf-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>\n`);

  // mimetype 必须是第一个、不压缩
  const zip = zipSync({ mimetype: [strToU8("application/epub+zip"), { level: 0 }], ...Object.fromEntries(Object.entries(files).map(([k, v]) => [k, [v, { level: /\.(png|jpe?g|gif|webp)$/i.test(k) ? 0 : 9 }]])) } as any);
  return { data: zip, files, images: imageRefs.size };
}

/** 面板预览：一章的 HTML，图片用 data: URL。 */
export function previewHtml(book: Book, chapterFile: string, read: (p: string) => Uint8Array | undefined) {
  const c = book.chapters.find((x) => x.file === chapterFile);
  if (!c) return "";
  const { files } = buildEpub({ ...book, chapters: [c] }, read);
  let html = new TextDecoder().decode(files[`OEBPS/text/${c.id}.xhtml`]);
  html = html.slice(html.indexOf("<body>") + 6, html.lastIndexOf("</body>"));
  return html.replace(/src="\.\.\/(images\/[^"]+)"/g, (m, href: string) => {
    const data = files[`OEBPS/${href}`];
    return data ? `src="data:${IMAGE_TYPES[extOf(href)]};base64,${Buffer.from(data).toString("base64")}"` : m;
  });
}

export const epubStats = (files: Record<string, Uint8Array>) => Object.keys(files).length;
export { runsText };
