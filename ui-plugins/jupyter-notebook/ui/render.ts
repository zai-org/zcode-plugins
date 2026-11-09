import DOMPurify from "dompurify";
import katex from "katex";
import { Marked, type TokenizerAndRendererExtension } from "marked";
import type { MimeBundle } from "#nb/contract.ts";

export const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---------------------------------------------------------------------------
// ANSI（SGR）→ HTML
// ---------------------------------------------------------------------------

const BASIC = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];

function color256(n: number): string {
  if (n < 16) return `var(--ansi-${n < 8 ? BASIC[n] : `bright-${BASIC[n - 8]}`})`;
  if (n < 232) {
    const v = n - 16;
    const level = (x: number) => (x === 0 ? 0 : 55 + x * 40);
    return `rgb(${level(Math.floor(v / 36))},${level(Math.floor(v / 6) % 6)},${level(v % 6)})`;
  }
  const gray = 8 + (n - 232) * 10;
  return `rgb(${gray},${gray},${gray})`;
}

interface SgrState {
  fg: string | null;
  bg: string | null;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

function applySgr(state: SgrState, codes: number[]) {
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i]!;
    if (code === 0) Object.assign(state, { fg: null, bg: null, bold: false, italic: false, underline: false });
    else if (code === 1) state.bold = true;
    else if (code === 3) state.italic = true;
    else if (code === 4) state.underline = true;
    else if (code === 22) state.bold = false;
    else if (code === 23) state.italic = false;
    else if (code === 24) state.underline = false;
    else if (code >= 30 && code <= 37) state.fg = `var(--ansi-${BASIC[code - 30]})`;
    else if (code === 39) state.fg = null;
    else if (code >= 40 && code <= 47) state.bg = `var(--ansi-${BASIC[code - 40]})`;
    else if (code === 49) state.bg = null;
    else if (code >= 90 && code <= 97) state.fg = `var(--ansi-bright-${BASIC[code - 90]})`;
    else if (code >= 100 && code <= 107) state.bg = `var(--ansi-bright-${BASIC[code - 100]})`;
    else if (code === 38 || code === 48) {
      const key = code === 38 ? "fg" : "bg";
      if (codes[i + 1] === 5 && codes[i + 2] !== undefined) {
        state[key] = color256(codes[i + 2]!);
        i += 2;
      } else if (codes[i + 1] === 2 && codes[i + 4] !== undefined) {
        state[key] = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`;
        i += 4;
      }
    }
  }
}

/** 把带 ANSI 转义的文本转成转义过的 HTML；只输出 span 与内联样式。 */
export function ansiToHtml(text: string): string {
  const state: SgrState = { fg: null, bg: null, bold: false, italic: false, underline: false };
  let html = "";
  let last = 0;
  // oxlint-disable-next-line no-control-regex -- ANSI / 终端控制字符是有意匹配的
  const pattern = /\x1b\[([0-9;]*)([A-Za-z])/g;
  const flush = (chunk: string) => {
    if (!chunk) return;
    const styles: string[] = [];
    if (state.fg) styles.push(`color:${state.fg}`);
    if (state.bg) styles.push(`background:${state.bg}`);
    if (state.bold) styles.push("font-weight:600");
    if (state.italic) styles.push("font-style:italic");
    if (state.underline) styles.push("text-decoration:underline");
    html += styles.length ? `<span style="${styles.join(";")}">${escapeHtml(chunk)}</span>` : escapeHtml(chunk);
  };
  for (const match of text.matchAll(pattern)) {
    flush(text.slice(last, match.index));
    last = match.index! + match[0].length;
    if (match[2] === "m") applySgr(state, (match[1] || "0").split(";").map((part) => Number(part) || 0));
  }
  flush(text.slice(last));
  // 未闭合的其他控制序列直接丢弃。
  // oxlint-disable-next-line no-control-regex -- ANSI / 终端控制字符是有意匹配的
  return html.replace(/\x1b[^a-zA-Z]*[a-zA-Z]?/g, "");
}

// ---------------------------------------------------------------------------
// 清洗
// ---------------------------------------------------------------------------

const FORBID_TAGS = ["style", "link", "meta", "base", "form", "input", "button", "textarea", "select", "iframe", "object", "embed"];

/** 输出与 Markdown 中的 HTML：不执行脚本、不加载外部样式，不允许表单。 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, { FORBID_TAGS, FORBID_ATTR: ["action", "formaction"] });
}

export function svgDataUrl(svg: string): string {
  let clean = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
  // 作为 <img> 加载的 SVG 必须声明命名空间，否则不显示；手写的 SVG 常常省略它。
  if (!/<svg[^>]*\sxmlns=/i.test(clean)) clean = clean.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(clean)}`;
}

// ---------------------------------------------------------------------------
// 数学与 Markdown
// ---------------------------------------------------------------------------

export function renderMath(tex: string, displayMode: boolean): string {
  return katex.renderToString(tex, { displayMode, throwOnError: false, output: "htmlAndMathml", strict: "ignore" });
}

/** text/latex 输出通常带 `$$…$$` 或 `$…$` 包裹。 */
export function renderLatexOutput(source: string): string {
  const text = source.trim();
  const block = text.match(/^\$\$([\s\S]*)\$\$$/) ?? text.match(/^\\\[([\s\S]*)\\\]$/);
  if (block) return renderMath(block[1]!, true);
  const inline = text.match(/^\$([\s\S]*)\$$/) ?? text.match(/^\\\(([\s\S]*)\\\)$/);
  if (inline) return renderMath(inline[1]!, false);
  // 可能是混排文本，按 Markdown 处理以支持其中的公式。
  return renderMarkdown(text);
}

const blockMath: TokenizerAndRendererExtension = {
  name: "blockMath",
  level: "block",
  start: (src) => src.match(/\$\$|\\\[/)?.index,
  tokenizer(src) {
    const match = src.match(/^\$\$([\s\S]+?)\$\$/) ?? src.match(/^\\\[([\s\S]+?)\\\]/);
    if (match) return { type: "blockMath", raw: match[0], text: match[1]!.trim() };
    return undefined;
  },
  renderer: (token) => `<div class="math-block">${renderMath(token.text as string, true)}</div>`,
};

const inlineMath: TokenizerAndRendererExtension = {
  name: "inlineMath",
  level: "inline",
  start: (src) => src.match(/\$|\\\(/)?.index,
  tokenizer(src) {
    const display = src.match(/^\$\$([\s\S]+?)\$\$/);
    if (display) return { type: "inlineMath", raw: display[0], text: display[1]!, display: true };
    // `$x$`：开头不接空格，结尾前不是空格，结尾后不是数字（避免把价格当公式）。
    const match = src.match(/^\$(?!\s)((?:\\.|[^\\$\n])+?)(?<!\s)\$(?!\d)/) ?? src.match(/^\\\(([\s\S]+?)\\\)/);
    if (match) return { type: "inlineMath", raw: match[0], text: match[1]!, display: false };
    return undefined;
  },
  renderer: (token) => renderMath(token.text as string, !!token.display),
};

const marked = new Marked({ gfm: true, breaks: false, extensions: [blockMath, inlineMath] });

/** Markdown cell / text/markdown 输出。attachments 中的图片按 `attachment:name` 引用解析。 */
export function renderMarkdown(source: string, attachments?: Record<string, MimeBundle>): string {
  let text = source;
  if (attachments) {
    text = text.replace(/attachment:([^\s)"'>]+)/g, (whole, name: string) => {
      const bundle = attachments[decodeURIComponent(name)];
      const mime = bundle && Object.keys(bundle).find((key) => key.startsWith("image/"));
      return mime ? `data:${mime};base64,${String(bundle![mime]).replace(/\s+/g, "")}` : whole;
    });
  }
  return sanitizeHtml(marked.parse(text, { async: false }) as string);
}

// ---------------------------------------------------------------------------
// mime 选择
// ---------------------------------------------------------------------------

export const MIME_ORDER = [
  "application/vnd.jupyter.widget-view+json",
  "text/html",
  "image/svg+xml",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "text/markdown",
  "text/latex",
  "application/json",
  "text/plain",
] as const;

/** 去掉脚本后是否还剩可见内容（文字、图片、表格、SVG 等）。 */
export function hasVisibleHtml(html: string): boolean {
  const clean = sanitizeHtml(html);
  return /<(img|svg|table|canvas|video|math)\b/i.test(clean) || clean.replace(/<[^>]*>/g, "").trim().length > 0;
}

export function pickMime(data: MimeBundle): string | null {
  for (const mime of MIME_ORDER) {
    if (data[mime] === undefined) continue;
    // 只靠 JS 渲染的 HTML（如 Plotly 的空 div + script）回退到其他表示。
    if (mime === "text/html" && /<script[\s>]/i.test(String(data[mime])) && !hasVisibleHtml(String(data[mime])) &&
      Object.keys(data).some((key) => key.startsWith("image/") || key === "text/plain"))
      continue;
    return mime;
  }
  return Object.keys(data)[0] ?? null;
}
