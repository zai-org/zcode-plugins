// 中文排版清洗规则（纯函数）。Markdown 的代码、链接地址、HTML 标签受保护不改。
export type RuleId = "fullwidthAlnum" | "punct" | "ellipsis" | "quotes" | "spaceCjkLatin" | "punctSpace" | "collapseSpaces" | "repeatPunct" | "trailing" | "blankLines";
export const RULES: { id: RuleId; zh: string; en: string; on: boolean }[] = [
  { id: "fullwidthAlnum", zh: "全角字母数字转半角", en: "Full-width letters/digits → half-width", on: true },
  { id: "punct", zh: "中文里的半角标点转全角", en: "Half-width punctuation in Chinese → full-width", on: true },
  { id: "ellipsis", zh: "省略号、破折号规范（……、——）", en: "Ellipsis and dash (……, ——)", on: true },
  { id: "quotes", zh: "中文里的直引号转弯引号", en: "Straight quotes in Chinese → “ ”", on: true },
  { id: "spaceCjkLatin", zh: "中英文、中文与数字之间加空格", en: "Space between Chinese and Latin/digits", on: true },
  { id: "punctSpace", zh: "删除全角标点前后的空格", en: "No spaces around full-width punctuation", on: true },
  { id: "collapseSpaces", zh: "连续空格合并", en: "Collapse repeated spaces", on: true },
  { id: "repeatPunct", zh: "重复标点合并（！！！→！）", en: "Repeated punctuation (！！！ → ！)", on: false },
  { id: "trailing", zh: "删除行尾空格", en: "Trim trailing spaces", on: true },
  { id: "blankLines", zh: "多个空行合并为一个", en: "Collapse blank lines", on: true },
];

const HAN = "\\u2E80-\\u2EFF\\u2F00-\\u2FDF\\u3040-\\u309F\\u30A0-\\u30FF\\u3100-\\u312F\\u3200-\\u32FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF";
const H = `[${HAN}]`;
const FULLP = "，。！？；：、（）《》【】「」『』“”‘’…—";
const re = (s: string, f = "gu") => new RegExp(s, f);

/** 把一行切成可改的文字片段和受保护的片段（行内代码、URL、Markdown 链接地址、HTML 标签、图片）。 */
export function segments(line: string, markdown: boolean): { t: string; keep: boolean }[] {
  const prot = markdown ? /(`[^`]*`|!\[[^\]]*\]\([^)]*\)|\]\([^)]*\)|<[^>\n]+>|https?:\/\/[^\s)）\]]+|\{\{[^}]*\}\}|\$[^$\n]+\$)/g : /(https?:\/\/[^\s)）\]]+|[\w.+-]+@[\w-]+\.[\w.]+)/g;
  const out: { t: string; keep: boolean }[] = [];
  let last = 0;
  for (const m of line.matchAll(prot)) { if (m.index! > last) out.push({ t: line.slice(last, m.index), keep: false }); out.push({ t: m[0], keep: true }); last = m.index! + m[0].length; }
  if (last < line.length) out.push({ t: line.slice(last), keep: false });
  return out;
}

const PMAP: Record<string, string> = { ",": "，", "!": "！", "?": "？", ";": "；", ":": "：" };

export function applyRule(id: RuleId, t: string): string {
  switch (id) {
    case "fullwidthAlnum": return t.replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/\u3000(?=\S)/g, (m, i) => (i === 0 ? m : " "));
    case "punct": {
      // 前面是汉字（或汉字后的右括号/引号）的半角标点 → 全角（后面跟数字也改，如“地点:3楼”；跟字母、/ 不改）；句号只在汉字后且后面不是字母数字时改
      let s = t.replace(re(`(${H}[”’）》]?)\\s*([,!?;:])(?![A-Za-z_/])\\s*`), (_, a: string, p: string) => a + PMAP[p]);
      s = s.replace(re(`(${H}[”’）》]?)\\.(?![\\w.])\\s*`), "$1。");
      // 英文词后面紧跟中文时，中间的半角标点也属于中文句子
      s = s.replace(re(`([A-Za-z0-9%)])\\s*([,!?;:])\\s*(?=${H})`), (_, a: string, p: string) => a + PMAP[p]);
      s = s.replace(re(`\\(([^()]*${H}[^()]*)\\)`), "（$1）");
      return s;
    }
    case "ellipsis": return t.replace(re(`(${H}|^)\\s*(\\.{3,}|。{3,}|…(?!…))\\s*`), (_, a: string) => `${a}……`).replace(re(`(${H})\\s*(-{2,}|—(?!—)|－{2,})\\s*(?=${H})`), "$1——");
    case "quotes": {
      let open = true;
      const s1 = t.replace(/"/g, () => { const q = open ? "“" : "”"; open = !open; return q; });
      if (!re(H, "u").test(t) || !open) return t; // 引号不成对或不是中文行，不动
      return s1.replace(/“([^“”]*)”/g, (m, inner: string) => (re(H, "u").test(inner) ? m : `"${inner}"`));
    }
    case "spaceCjkLatin":
      return t.replace(re(`(${H})([A-Za-z0-9@#&$]|\\*\\*?[A-Za-z0-9])`), "$1 $2").replace(re(`([A-Za-z0-9%)\\]!?.;:]|[A-Za-z0-9]\\*\\*?)(${H})`), (m, a: string, h: string) => (/[!?.;:]$/.test(a) ? m : `${a} ${h}`));
    case "punctSpace": return t.replace(re(`[ \\t]+([${FULLP}])`), "$1").replace(re(`([${FULLP}])[ \\t]+`), "$1");
    case "collapseSpaces": return t.replace(/(\S) {2,}(?=\S)/g, "$1 ");
    case "repeatPunct": return t.replace(/([！？。，、；：])\1+/g, "$1").replace(/([!?])\1{2,}/g, "$1");
    case "trailing": return t.replace(/[ \t\u3000]+$/, "");
    default: return t;
  }
}

export interface LineChange { line: number; before: string; after: string | null; rules: RuleId[] }

const spaceable = (s: string) => s.startsWith("`") || /^https?:/.test(s);

function cleanLine(line: string, on: Set<RuleId>, markdown: boolean): { after: string; rules: RuleId[] } {
  const lead = /^\s*/.exec(line)![0];
  const prefix = markdown ? (/^(\s*(?:[-*+]|\d+[.)]|#{1,6}|>+)\s+)/.exec(line)?.[0] ?? lead) : lead;
  const used: RuleId[] = [];
  let segs = segments(line.slice(prefix.length), markdown);
  for (const r of RULES) {
    if (!on.has(r.id) || r.id === "blankLines" || r.id === "trailing") continue;
    // 拼回整行再跑规则；受保护片段换成占位符（行内代码/网址用可加空格的占位符）
    const ph: string[] = [];
    const joined = segs.map((s) => { if (!s.keep) return s.t; const n = ph.push(s.t) - 1; return spaceable(s.t) ? `\uE002${n}\uE003` : `\uE000${n}\uE001`; }).join("");
    let next = applyRule(r.id, joined);
    if (r.id === "spaceCjkLatin") next = next.replace(new RegExp(`(${H})(\\uE002)`, "gu"), "$1 $2").replace(new RegExp(`(\\uE003)(${H})`, "gu"), "$1 $2");
    if (next === joined) continue;
    used.push(r.id);
    const parts: { t: string; keep: boolean }[] = [];
    let last = 0;
    for (const m of next.matchAll(/[\uE000\uE002](\d+)[\uE001\uE003]/g)) { if (m.index! > last) parts.push({ t: next.slice(last, m.index), keep: false }); parts.push({ t: ph[Number(m[1])], keep: true }); last = m.index! + m[0].length; }
    if (last < next.length) parts.push({ t: next.slice(last), keep: false });
    segs = parts;
  }
  let after = prefix + segs.map((s) => s.t).join("");
  if (on.has("trailing")) { const t2 = after.replace(/[ \t\u3000]+$/, ""); if (t2 !== after) { after = t2; used.push("trailing"); } }
  return { after, rules: used };
}

/** 逐行清洗，返回有变化的行（after 为 null 表示删除该空行）。代码块、front matter 不动。 */
export function cleanText(text: string, on: Set<RuleId>, markdown: boolean): LineChange[] {
  const src = text.replace(/\r\n?/g, "\n").split("\n");
  if (src.length > 1 && src[src.length - 1] === "") src.pop();
  const changes: LineChange[] = [];
  let fence = false, front = markdown && src[0]?.trim() === "---", blankRun = 0;
  src.forEach((line, i) => {
    if (front) { if (i > 0 && line.trim() === "---") front = false; return; }
    if (markdown && /^\s*(```|~~~)/.test(line)) { fence = !fence; blankRun = 0; return; }
    if (fence) return;
    if (markdown && /^( {4}|\t)/.test(line) && !/^\s*([-*+]|\d+[.)])\s/.test(line)) { blankRun = 0; return; }
    if (!line.trim()) {
      blankRun++;
      const atEnd = src.slice(i).every((l) => !l.trim());
      if (on.has("blankLines") && (blankRun > 1 || atEnd)) changes.push({ line: i + 1, before: line, after: null, rules: ["blankLines"] });
      else if (on.has("trailing") && line !== "") changes.push({ line: i + 1, before: line, after: "", rules: ["trailing"] });
      return;
    }
    blankRun = 0;
    const r = cleanLine(line, on, markdown);
    if (r.after !== line) changes.push({ line: i + 1, before: line, after: r.after, rules: r.rules });
  });
  return changes;
}

/** 按接受的修改重新拼出文件；保留原来的换行符风格。 */
export function assemble(text: string, accepted: Map<number, string | null>): string {
  const eol = /\r\n/.test(text) ? "\r\n" : "\n";
  const src = text.replace(/\r\n?/g, "\n").split("\n");
  const endsNl = src.length > 1 && src[src.length - 1] === "";
  if (endsNl) src.pop();
  const out: string[] = [];
  src.forEach((l, i) => { const a = accepted.get(i + 1); if (a === undefined) out.push(l); else if (a !== null) out.push(a); });
  return out.join(eol) + (endsNl ? eol : "");
}
