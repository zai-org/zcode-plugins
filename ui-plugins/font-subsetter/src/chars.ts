/** 从网页、文档、代码里收集真正会显示出来的字符（默认去掉注释），并记下第一次出现的位置。 */

export const FONT_EXTS = [".ttf", ".otf", ".ttc", ".otc", ".woff", ".woff2"];
const HTML = [".html", ".htm", ".vue", ".svelte", ".xml", ".svg", ".ejs", ".njk", ".hbs", ".liquid", ".astro"];
const CODE = [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".css", ".scss", ".less", ".strings", ".swift", ".kt", ".java", ".dart"];
const HASH = [".yaml", ".yml", ".toml", ".properties", ".po", ".py", ".sh", ".ini"];
const PLAIN = [".md", ".markdown", ".mdx", ".txt", ".json", ".csv", ".tsv", ".srt", ".vtt", ".ass", ".lrc", ".ftl", ".arb"];
export const TEXT_EXTS = [...HTML, ...CODE, ...HASH, ...PLAIN];
const ext = (f: string) => (f.match(/\.[^./]+$/)?.[0] ?? "").toLowerCase();

const blank = (s: string) => s.replace(/[^\n]/g, " ");

/** 去掉 JS/CSS 风格注释（字符串里的 // 不算），长度和换行保持不变。 */
export function stripCodeComments(src: string): string {
  let out = "", i = 0, q = "";
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (q) {
      out += c;
      if (c === "\\") { out += d ?? ""; i += 2; continue; }
      if (c === q || (c === "\n" && q !== "`")) q = "";
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { q = c; out += c; i++; continue; }
    if (c === "/" && d === "/" && !/[:\\]$/.test(src.slice(Math.max(0, i - 1), i))) {
      const e = src.indexOf("\n", i); const end = e < 0 ? src.length : e;
      out += blank(src.slice(i, end)); i = end; continue;
    }
    if (c === "/" && d === "*") {
      const e = src.indexOf("*/", i + 2); const end = e < 0 ? src.length : e + 2;
      out += blank(src.slice(i, end)); i = end; continue;
    }
    out += c; i++;
  }
  return out;
}

const VISIBLE_ATTR = /\b(alt|title|placeholder|aria-label|content|value|label)\s*=\s*("[^"]*"|'[^']*')/gi;

/** HTML/Vue：去掉 <!-- -->、标签本身（保留 alt/title/placeholder 等会显示的属性值），<script>/<style> 里去注释。 */
export function stripHtml(src: string, comments = true): string {
  let s = comments ? src.replace(/<!--[\s\S]*?-->/g, blank) : src;
  s = s.replace(/(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi, (_m, a: string, _t, body: string, b: string) => a + (comments ? stripCodeComments(body) : body) + b);
  // 标签：只留可见属性值
  s = s.replace(/<\/?[A-Za-z][^>]*>/g, (tag) => {
    const keep = blank(tag).split("");
    for (const m of tag.matchAll(VISIBLE_ATTR)) {
      const v = m[2].slice(1, -1), at = m.index! + m[0].length - 1 - v.length;
      for (let k = 0; k < v.length; k++) keep[at + k] = v[k];
    }
    return keep.join("");
  });
  return s.replace(/&(nbsp|amp|lt|gt|quot|#39|copy|middot|mdash|hellip);/g, (m, n) => ({ nbsp: "\u00a0", amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", copy: "©", middot: "·", mdash: "—", hellip: "…" } as Record<string, string>)[n].padEnd(m.length, " "));
}

const stripHash = (src: string) => src.split("\n").map((l) => {
  let q = "";
  for (let i = 0; i < l.length; i++) {
    const c = l[i];
    if (q) { if (c === q) q = ""; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === "#" && (i === 0 || /\s/.test(l[i - 1]))) return l.slice(0, i) + blank(l.slice(i));
  }
  return l;
}).join("\n");

/** 正文（去掉注释和标记后真正会显示的文字），长度与原文一致以便算行号。 */
export function visibleText(file: string, src: string, skipComments = true): string {
  const e = ext(file);
  if (HTML.includes(e)) return stripHtml(src, skipComments);
  if (!skipComments) return src;
  if (CODE.includes(e)) return stripCodeComments(src);
  if (HASH.includes(e)) return stripHash(src);
  if (e === ".md" || e === ".markdown" || e === ".mdx") return src.replace(/<!--[\s\S]*?-->/g, blank);
  return src;
}

/** 标题文字：HTML 的 <title>/<h1>–<h6>，Markdown 的 # 行，JSON/YAML 里 title/heading 字段。 */
export function headingText(file: string, src: string): string[] {
  const e = ext(file), out: string[] = [];
  if (HTML.includes(e) || e === ".md" || e === ".mdx") {
    const s = src.replace(/<!--[\s\S]*?-->/g, "");
    for (const m of s.matchAll(/<(title|h[1-6])\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)) out.push(m[2].replace(/<[^>]+>/g, ""));
  }
  if (e === ".md" || e === ".markdown" || e === ".mdx") for (const m of src.matchAll(/^#{1,6}\s+(.+)$/gm)) out.push(m[1]);
  if ([".json", ".yaml", ".yml", ".toml"].includes(e)) for (const m of src.matchAll(/["']?(title|heading|headline)["']?\s*[:=]\s*["']([^"'\n]+)["']/gi)) out.push(m[2]);
  return out.map((t) => t.replace(/&nbsp;/g, " ").trim()).filter(Boolean);
}

export interface CharHit { n: number; at: string }
export type CharMap = Record<string, CharHit>;

export const isControl = (cp: number) => cp < 0x20 || (cp >= 0x7f && cp < 0xa0) || cp === 0xfeff || (cp >= 0xfe00 && cp <= 0xfe0f) || cp === 0x200b;

/** 收集字符：键是字符本身，记次数和第一次出现的“文件:行”。 */
export function collect(sources: Record<string, string>, opts: { skipComments: boolean; headingsOnly?: boolean }): { chars: CharMap; commentOnly: number } {
  const chars: CharMap = {}, raw = new Set<string>();
  for (const [file, src] of Object.entries(sources)) {
    const short = file.split("/").slice(-2).join("/");
    if (opts.headingsOnly) {
      for (const h of headingText(file, src)) for (const ch of h) {
        const cp = ch.codePointAt(0)!; if (isControl(cp) || ch === " ") continue;
        const idx = src.indexOf(h), line = idx < 0 ? 1 : src.slice(0, idx).split("\n").length;
        (chars[ch] ??= { n: 0, at: `${short}:${line}` }).n++;
      }
      continue;
    }
    const vis = visibleText(file, src, opts.skipComments);
    for (const ch of src) if (ch.codePointAt(0)! > 0x7f) raw.add(ch);
    let line = 1;
    for (const ch of vis) {
      if (ch === "\n") { line++; continue; }
      const cp = ch.codePointAt(0)!;
      if (isControl(cp) || ch === " ") continue;
      (chars[ch] ??= { n: 0, at: `${short}:${line}` }).n++;
    }
  }
  let commentOnly = 0;
  for (const ch of raw) if (!chars[ch]) commentOnly++;
  return { chars, commentOnly };
}

export const ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join("");
export const CN_PUNCT = "，。、；：？！“”‘’（）《》〈〉【】「」『』—…·～￥％＋－／";

/** 码位列表 → CSS unicode-range（U+4E00-4E05,U+3002）。 */
export function unicodeRange(cps: number[]): string {
  const s = [...new Set(cps)].sort((a, b) => a - b), parts: string[] = [];
  for (let i = 0; i < s.length; i++) {
    let j = i; while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    const h = (n: number) => n.toString(16).toUpperCase();
    parts.push(j > i ? `U+${h(s[i])}-${h(s[j])}` : `U+${h(s[i])}`);
    i = j;
  }
  return parts.join(", ");
}
