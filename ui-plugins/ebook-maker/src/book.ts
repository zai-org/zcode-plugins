import { posix } from "node:path";
import { Lexer, type Token, type Tokens } from "marked";

/** 行内片段。fn = 脚注编号（章内从 1 开始）。 */
export interface Run { text: string; bold?: boolean; italic?: boolean; code?: boolean; del?: boolean; href?: string; fn?: number; br?: boolean }
export type Block =
  | { t: "h"; level: number; runs: Run[]; slug: string }
  | { t: "p"; runs: Run[] }
  | { t: "list"; ordered: boolean; start: number; items: Block[][] }
  | { t: "quote"; blocks: Block[] }
  | { t: "code"; text: string; lang: string }
  | { t: "img"; src: string; alt: string; title: string }
  | { t: "table"; header: Run[][]; rows: Run[][][]; align: ("left" | "center" | "right" | null)[] }
  | { t: "hr" }
  | { t: "html"; html: string };

export interface Footnote { id: string; n: number; runs: Run[] }
export interface Heading { level: number; text: string; slug: string }
export interface Chapter {
  /** 相对书目录的路径 */
  file: string;
  id: string;
  title: string;
  blocks: Block[];
  headings: Heading[];
  footnotes: Footnote[];
  chars: number;
  images: { src: string; line: number }[];
  links: { href: string; text: string; line: number }[];
}

export interface Issue { level: "error" | "warning"; kind: string; file?: string; line?: number; message: string; target?: string }

const FN_OPEN = "\uE000", FN_CLOSE = "\uE001";

/** GitHub 风格的标题锚点：小写，去掉标点，空格变连字符；同名追加 -1、-2。 */
export function slugger() {
  const seen = new Map<string, number>();
  return (text: string) => {
    let base = text.toLowerCase().trim().replace(/[\u2000-\u206F\u2E00-\u2E7F\\'!"#$%&()*+,./:;<=>?@[\]^`{|}~\u3000-\u303F\uFF01-\uFF0F\uFF1A-\uFF20\uFF3B-\uFF40\uFF5B-\uFF65]/g, "").replace(/\s/g, "-");
    if (!base) base = "section";
    const n = seen.get(base);
    seen.set(base, (n ?? -1) + 1);
    return n === undefined ? base : `${base}-${n + 1}`;
  };
}

export const runsText = (runs: Run[]) => runs.map((r) => (r.fn ? "" : r.br ? " " : r.text)).join("");

/** 去掉脚注定义，把脚注引用换成占位符；代码块里的不动。 */
export function extractFootnotes(source: string) {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const defs = new Map<string, { text: string; line: number }>();
  const out: string[] = [];
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (f) fence = fence ? (line.trim().startsWith(fence[0]) ? null : fence) : f[1];
    if (fence || f) { out.push(line); continue; }
    const d = /^\s{0,3}\[\^([^\]\s]+)\]:\s?(.*)$/.exec(line);
    if (d) {
      let text = d[2];
      while (i + 1 < lines.length && /^( {2,}|\t)\S/.test(lines[i + 1])) text += " " + lines[++i].trim();
      defs.set(d[1], { text, line: i + 1 });
      out.push("");
      continue;
    }
    out.push(line.replace(/\[\^([^\]\s]+)\](?!:)/g, (_, id) => `${FN_OPEN}${id}${FN_CLOSE}`));
  }
  return { text: out.join("\n"), defs };
}

export interface ParseResult { chapter: Chapter; issues: Issue[] }

/** 把一章 Markdown 解析成排版块。file 相对书目录。 */
export function parseChapter(file: string, source: string, id: string): ParseResult {
  const issues: Issue[] = [];
  const { text, defs } = extractFootnotes(source);
  const srcLines = source.split(/\r?\n/);
  const lineOf = (needle: string, from = 0) => {
    for (let i = from; i < srcLines.length; i++) if (srcLines[i].includes(needle)) return i + 1;
    return undefined;
  };
  const slug = slugger();
  const footnotes: Footnote[] = [];
  const fnIndex = new Map<string, number>();
  const images: Chapter["images"] = [];
  const links: Chapter["links"] = [];
  const headings: Heading[] = [];
  const missingFn = new Set<string>();

  const splitFn = (str: string, style: Omit<Run, "text">): Run[] => {
    if (!str.includes(FN_OPEN)) return [{ ...style, text: str }];
    const out: Run[] = [];
    const re = new RegExp(`${FN_OPEN}([^${FN_CLOSE}]+)${FN_CLOSE}`, "g");
    let last = 0;
    for (const m of str.matchAll(re)) {
      if (m.index! > last) out.push({ ...style, text: str.slice(last, m.index) });
      const fid = m[1];
      if (!defs.has(fid)) {
        missingFn.add(fid);
        out.push({ ...style, text: `[^${fid}]` });
      } else {
        let n = fnIndex.get(fid);
        if (n === undefined) {
          n = fnIndex.size + 1;
          fnIndex.set(fid, n);
          footnotes.push({ id: fid, n, runs: inline(new Lexer({ gfm: true }).inlineTokens(defs.get(fid)!.text.replace(/\[\^([^\]\s]+)\]/g, "")), {}) });
        }
        out.push({ text: String(n), fn: n });
      }
      last = m.index! + m[0].length;
    }
    if (last < str.length) out.push({ ...style, text: str.slice(last) });
    return out;
  };

  function inline(tokens: Token[] | undefined, style: Omit<Run, "text">): Run[] {
    const out: Run[] = [];
    for (const t of tokens ?? []) {
      switch (t.type) {
        case "strong": out.push(...inline((t as Tokens.Strong).tokens, { ...style, bold: true })); break;
        case "em": out.push(...inline((t as Tokens.Em).tokens, { ...style, italic: true })); break;
        case "del": out.push(...inline((t as Tokens.Del).tokens, { ...style, del: true })); break;
        case "codespan": out.push({ ...style, code: true, text: decode((t as Tokens.Codespan).text) }); break;
        case "br": out.push({ text: "\n", br: true }); break;
        case "link": {
          const l = t as Tokens.Link;
          links.push({ href: l.href, text: l.text, line: lineOf(`(${l.href}`) ?? lineOf(l.href) ?? 0 });
          out.push(...inline(l.tokens, { ...style, href: l.href }));
          break;
        }
        case "image": {
          const im = t as Tokens.Image;
          images.push({ src: im.href, line: lineOf(`(${im.href}`) ?? 0 });
          out.push({ ...style, text: `\uE002${im.href}\uE003${im.text}\uE004` });
          break;
        }
        case "html": out.push({ ...style, text: (t as Tokens.HTML).text.replace(/<[^>]*>/g, "") }); break;
        case "text": case "escape": {
          const tt = t as Tokens.Text;
          if (tt.tokens?.length) out.push(...inline(tt.tokens, style));
          else out.push(...splitFn(decode(tt.text), style));
          break;
        }
        default: if ("text" in t && typeof t.text === "string") out.push(...splitFn(decode(t.text), style));
      }
    }
    return out.filter((r) => r.text !== "");
  }

  /** 段落里的图片单独成块。 */
  const paragraph = (runs: Run[]): Block[] => {
    const blocks: Block[] = [];
    let cur: Run[] = [];
    const flush = () => {
      while (cur.length && (cur[0].br || !cur[0].text.trim())) cur.shift();
      while (cur.length && (cur[cur.length - 1].br || !cur[cur.length - 1].text.trim())) cur.pop();
      if (cur.length) blocks.push({ t: "p", runs: cur });
      cur = [];
    };
    for (const r of runs) {
      const m = /^\uE002([^\uE003]*)\uE003([^\uE004]*)\uE004$/.exec(r.text);
      if (m) { flush(); blocks.push({ t: "img", src: m[1], alt: m[2], title: "" }); continue; }
      cur.push(r);
    }
    flush();
    return blocks;
  };

  function blocks(tokens: Token[]): Block[] {
    const out: Block[] = [];
    for (const t of tokens) {
      switch (t.type) {
        case "heading": {
          const h = t as Tokens.Heading;
          const runs = inline(h.tokens, {});
          const text = runsText(runs).trim();
          const s = slug(text);
          headings.push({ level: h.depth, text, slug: s });
          out.push({ t: "h", level: h.depth, runs, slug: s });
          break;
        }
        case "paragraph": out.push(...paragraph(inline((t as Tokens.Paragraph).tokens, {}))); break;
        case "text": out.push(...paragraph(inline((t as Tokens.Text).tokens ?? [{ type: "text", raw: t.raw, text: (t as Tokens.Text).text } as Token], {}))); break;
        case "list": {
          const l = t as Tokens.List;
          out.push({ t: "list", ordered: l.ordered, start: typeof l.start === "number" ? l.start : 1, items: l.items.map((it) => blocks(it.tokens)) });
          break;
        }
        case "blockquote": out.push({ t: "quote", blocks: blocks((t as Tokens.Blockquote).tokens) }); break;
        case "code": out.push({ t: "code", text: (t as Tokens.Code).text, lang: (t as Tokens.Code).lang ?? "" }); break;
        case "table": {
          const tb = t as Tokens.Table;
          out.push({ t: "table", header: tb.header.map((c) => inline(c.tokens, { bold: true })), rows: tb.rows.map((r) => r.map((c) => inline(c.tokens, {}))), align: tb.align });
          break;
        }
        case "hr": out.push({ t: "hr" }); break;
        case "html": {
          const html = (t as Tokens.HTML).text.trim();
          if (html && !/^<!--[\s\S]*-->$/.test(html)) out.push({ t: "html", html });
          break;
        }
        default: break;
      }
    }
    return out;
  }

  const parsed = blocks(new Lexer({ gfm: true }).lex(text));
  for (const fid of missingFn) issues.push({ level: "error", kind: "missing-footnote", file, line: lineOf(`[^${fid}]`), message: `Footnote [^${fid}] is used but not defined` });
  for (const [fid, d] of defs) if (!fnIndex.has(fid)) issues.push({ level: "warning", kind: "unused-footnote", file, line: d.line, message: `Footnote [^${fid}] is defined but never used` });
  const h1 = parsed.find((b): b is Extract<Block, { t: "h" }> => b.t === "h" && b.level === 1);
  const fallback = posix.basename(file).replace(/\.(md|markdown)$/i, "").replace(/^\d+[-_. ]*/, "") || file;
  if (!h1) issues.push({ level: "warning", kind: "no-title", file, message: `No "# " heading; the chapter is titled "${fallback}"` });
  const chars = runsText(parsed.flatMap((b) => (b.t === "p" || b.t === "h" ? b.runs : []))).replace(/\s/g, "").length;
  if (!parsed.length) issues.push({ level: "warning", kind: "empty-chapter", file, message: "The chapter is empty" });
  return { chapter: { file, id, title: h1 ? runsText(h1.runs).trim() : fallback, blocks: parsed, headings, footnotes, chars, images, links }, issues };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", copy: "©", reg: "®", trade: "™", mdash: "—", ndash: "–", hellip: "…", laquo: "«", raquo: "»", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", middot: "·", times: "×", deg: "°", shy: "\u00ad" };
/** marked 会把文字转义成实体，这里还原。 */
export function decode(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export const isExternal = (href: string) => /^[a-z][a-z0-9+.-]*:/i.test(href);

export interface ResolvedLink { kind: "external" | "chapter" | "anchor" | "file" | "broken"; chapter?: string; anchor?: string; path?: string }

/** 解析章内链接：外链、本章锚点、其他章节（可带锚点）、书里的其他文件。 */
export function resolveLink(href: string, from: string, chapters: Map<string, Chapter>, exists: (p: string) => boolean): ResolvedLink {
  if (isExternal(href)) return { kind: "external" };
  const [pathPart, anchorRaw] = href.split("#", 2);
  const anchor = anchorRaw !== undefined ? safeDecode(anchorRaw) : undefined;
  if (!pathPart) return { kind: "anchor", chapter: from, anchor };
  const path = posix.normalize(posix.join(posix.dirname(from), safeDecode(pathPart)));
  if (chapters.has(path)) return { kind: "chapter", chapter: path, anchor };
  return exists(path) ? { kind: "file", path } : { kind: "broken", path };
}
export const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
