import { marked } from "marked";
import YAML from "yaml";

export interface Post { file: string; title: string; date: string; slug: string; summary: string; tags: string[]; author: string; draft: boolean; body: string; dateSource: string }

export const x = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const cdata = (s: string) => `<![CDATA[${s.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;

export function parsePost(file: string, text: string): Post {
  const src = text.replace(/^\uFEFF/, "");
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
  let fm: Record<string, unknown> = {};
  if (m) { try { fm = (YAML.parse(m[1]) as Record<string, unknown>) ?? {}; } catch { fm = {}; } }
  const body = m ? src.slice(m[0].length) : src;
  const base = file.split("/").pop()!.replace(/\.(md|markdown)$/i, "");
  const fileDate = /^(\d{4}-\d{2}-\d{2})[-_]/.exec(base)?.[1] ?? "";
  const h1 = /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ?? "";
  const tags = Array.isArray(fm.tags) ? fm.tags.map(String) : typeof fm.tags === "string" ? fm.tags.split(/[,，]\s*/) : Array.isArray(fm.categories) ? fm.categories.map(String) : [];
  const dateRaw = fm.date instanceof Date ? fm.date.toISOString() : String(fm.date ?? fm.published ?? "");
  return {
    file, body,
    title: String(fm.title ?? h1 ?? base).trim() || base,
    date: dateRaw || fileDate, dateSource: dateRaw ? "front matter" : fileDate ? "file name" : "",
    slug: String(fm.slug ?? base.replace(/^\d{4}-\d{2}-\d{2}[-_]/, "")).trim(),
    summary: String(fm.description ?? fm.summary ?? fm.excerpt ?? "").trim(),
    tags: tags.map((t) => t.trim()).filter(Boolean), author: String(fm.author ?? "").trim(), draft: fm.draft === true || fm.draft === "true" || fm.published === false,
  };
}

/** “2026-11-02 09:30” + 时区 → Date；无法解析返回 undefined。 */
export function toDate(s: string, tz: string): Date | undefined {
  const t = s.trim();
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(t);
  if (!m) { const d = new Date(t); return t && !isNaN(d.getTime()) ? d : undefined; }
  const off = m[7] ?? (tz || "Z");
  const iso = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}T${(m[4] ?? "00").padStart(2, "0")}:${m[5] ?? "00"}:${m[6] ?? "00"}${off === "Z" ? "Z" : off.includes(":") ? off : `${off.slice(0, 3)}:${off.slice(3)}`}`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? undefined : d;
}

export function absolutize(html: string, baseUrl: string) {
  return html.replace(/(\s(?:src|href)=")([^"]+)"/g, (all, pre: string, url: string) => {
    if (/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(url)) return all;
    try { return `${pre}${new URL(url, baseUrl).href}"`; } catch { return all; }
  });
}

export function renderPost(p: Post, link: string, full: boolean) {
  let md = p.body.replace(new RegExp(`^#\\s+${p.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m"), "");
  const more = md.search(/<!--\s*more\s*-->/i);
  const excerptMd = more >= 0 ? md.slice(0, more) : md.split(/\n\s*\n/).filter((b) => b.trim() && !/^\s*!\[/.test(b)).slice(0, 1).join("\n\n");
  if (!full) md = excerptMd;
  const html = absolutize(String(marked.parse(md.replace(/<!--\s*more\s*-->/gi, ""), { async: false, gfm: true })).trim(), link);
  const text = String(marked.parse(excerptMd, { async: false })).replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
  return { html, excerpt: text.length > 200 ? `${text.slice(0, 197)}…` : text };
}

export interface Item { title: string; link: string; date: Date; summary: string; html: string; tags: string[]; author: string; id: string }
export interface Channel { title: string; site: string; description: string; language: string; author: string; feedBase: string }

export function rss(c: Channel, items: Item[]) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
  <title>${x(c.title)}</title>
  <link>${x(c.site)}</link>
  <description>${x(c.description || c.title)}</description>
  <language>${x(c.language)}</language>
  <atom:link href="${x(`${c.feedBase}/feed.xml`)}" rel="self" type="application/rss+xml"/>
  <lastBuildDate>${(items[0]?.date ?? new Date(0)).toUTCString()}</lastBuildDate>
${items.map((i) => `  <item>
    <title>${x(i.title)}</title>
    <link>${x(i.link)}</link>
    <guid isPermaLink="true">${x(i.id)}</guid>
    <pubDate>${i.date.toUTCString()}</pubDate>${i.author || c.author ? `\n    <dc:creator>${x(i.author || c.author)}</dc:creator>` : ""}
${i.tags.map((t) => `    <category>${x(t)}</category>\n`).join("")}    <description>${x(i.summary)}</description>
    <content:encoded>${cdata(i.html)}</content:encoded>
  </item>`).join("\n")}
</channel>
</rss>
`;
}

export function atom(c: Channel, items: Item[]) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${x(c.language)}">
  <title>${x(c.title)}</title>
  ${c.description ? `<subtitle>${x(c.description)}</subtitle>\n  ` : ""}<link href="${x(c.site)}"/>
  <link rel="self" href="${x(`${c.feedBase}/atom.xml`)}"/>
  <id>${x(c.site.endsWith("/") ? c.site : `${c.site}/`)}</id>
  <updated>${(items[0]?.date ?? new Date(0)).toISOString()}</updated>
  <author><name>${x(c.author || c.title)}</name></author>
${items.map((i) => `  <entry>
    <title>${x(i.title)}</title>
    <link href="${x(i.link)}"/>
    <id>${x(i.id)}</id>
    <published>${i.date.toISOString()}</published>
    <updated>${i.date.toISOString()}</updated>${i.author ? `\n    <author><name>${x(i.author)}</name></author>` : ""}
${i.tags.map((t) => `    <category term="${x(t)}"/>\n`).join("")}    <summary>${x(i.summary)}</summary>
    <content type="html">${x(i.html)}</content>
  </entry>`).join("\n")}
</feed>
`;
}

export function jsonFeed(c: Channel, items: Item[]) {
  return JSON.stringify({
    version: "https://jsonfeed.org/version/1.1", title: c.title, home_page_url: c.site, feed_url: `${c.feedBase}/feed.json`, description: c.description || undefined, language: c.language, authors: c.author ? [{ name: c.author }] : undefined,
    items: items.map((i) => ({ id: i.id, url: i.link, title: i.title, summary: i.summary, content_html: i.html, date_published: i.date.toISOString(), tags: i.tags.length ? i.tags : undefined, authors: i.author ? [{ name: i.author }] : undefined })),
  }, null, 2) + "\n";
}
