/** 轻量语法高亮：按语言的注释 / 字符串 / 关键字规则逐行切分记号。 */
export type Kind = "plain" | "comment" | "string" | "number" | "keyword" | "type" | "func" | "punct" | "tag" | "attr" | "prop";
export interface Tok { t: string; k: Kind }

interface Lang { line?: string[]; block?: [string, string][]; quotes: string[]; kw: Set<string>; types?: Set<string>; tags?: boolean; caseInsensitive?: boolean; hashComment?: boolean }
const W = (s: string) => new Set(s.split(/\s+/).filter(Boolean));
const JS_KW = W("const let var function return if else for while do switch case break continue new delete typeof instanceof in of class extends super this import export from default async await try catch finally throw yield void null undefined true false interface type enum implements public private protected readonly static as satisfies declare namespace keyof infer is abstract get set");
const LANGS: Record<string, Lang> = {
  ts: { line: ["//"], block: [["/*", "*/"]], quotes: ['"', "'", "`"], kw: JS_KW, types: W("string number boolean any unknown never object Promise Array Record Map Set Date Error") },
  py: { line: ["#"], block: [['"""', '"""'], ["'''", "'''"]], quotes: ['"', "'"], kw: W("def return if elif else for while in not and or is class import from as with try except finally raise pass break continue lambda yield None True False global nonlocal async await assert del match case self"), types: W("int str float bool list dict set tuple bytes object Exception") },
  go: { line: ["//"], block: [["/*", "*/"]], quotes: ['"', "'", "`"], kw: W("package import func return if else for range switch case default break continue go defer select chan map struct interface type var const nil true false make new len cap append"), types: W("string int int64 int32 float64 bool byte rune error any") },
  rs: { line: ["//"], block: [["/*", "*/"]], quotes: ['"'], kw: W("fn let mut pub use mod struct enum impl trait for in while loop if else match return break continue as ref move self Self crate super where async await dyn const static unsafe true false Some None Ok Err"), types: W("i32 i64 u8 u32 u64 usize f32 f64 bool str String Vec Option Result Box") },
  java: { line: ["//"], block: [["/*", "*/"]], quotes: ['"', "'"], kw: W("public private protected class interface extends implements static final void return if else for while do switch case break continue new this super try catch finally throw throws import package null true false var record enum abstract synchronized"), types: W("int long double float boolean char byte short String List Map Object Integer") },
  c: { line: ["//"], block: [["/*", "*/"]], quotes: ['"', "'"], kw: W("int char float double void long short unsigned signed struct union enum typedef static const return if else for while do switch case break continue sizeof include define ifdef ifndef endif class public private namespace using template typename auto nullptr true false new delete"), types: W("size_t uint8_t uint32_t int64_t bool string vector") },
  sql: { line: ["--"], block: [["/*", "*/"]], quotes: ["'", '"'], kw: W("select from where and or not insert into values update set delete create table index view primary key foreign references join left right inner outer on group by order having limit offset as distinct union all case when then else end null is in like between exists default unique alter add drop with returning"), types: W("int integer bigint varchar text date datetime timestamp decimal numeric boolean serial"), caseInsensitive: true },
  sh: { line: ["#"], quotes: ['"', "'"], kw: W("if then else elif fi for in do done while case esac function return export local echo cd exit set source") },
  css: { block: [["/*", "*/"]], quotes: ['"', "'"], kw: W("important media import supports keyframes from to") },
  html: { block: [["<!--", "-->"]], quotes: ['"', "'"], kw: new Set(), tags: true },
  json: { quotes: ['"'], kw: W("true false null") },
  yaml: { line: ["#"], quotes: ['"', "'"], kw: W("true false null yes no on off") },
  plain: { quotes: [], kw: new Set() },
};
const EXT: Record<string, string> = { ts: "ts", tsx: "ts", js: "ts", jsx: "ts", mjs: "ts", cjs: "ts", vue: "html", py: "py", go: "go", rs: "rs", java: "java", kt: "java", swift: "java", c: "c", h: "c", cpp: "c", cc: "c", hpp: "c", cs: "java", sql: "sql", sh: "sh", bash: "sh", zsh: "sh", css: "css", scss: "css", html: "html", xml: "html", svg: "html", json: "json", yaml: "yaml", yml: "yaml", toml: "yaml", md: "plain", txt: "plain" };
export const LANG_NAMES = Object.keys(LANGS);
export const langFor = (file: string) => EXT[file.split(".").pop()!.toLowerCase()] ?? "plain";

/** 返回每行的记号；跨行注释保持状态。 */
export function highlight(code: string, lang: string): Tok[][] {
  const L = LANGS[lang] ?? LANGS.plain;
  const lines = code.replace(/\r/g, "").split("\n");
  let inBlock: string | undefined;
  return lines.map((line) => {
    const out: Tok[] = [];
    const push = (t: string, k: Kind) => { if (!t) return; const last = out[out.length - 1]; if (last && last.k === k) last.t += t; else out.push({ t, k }); };
    let i = 0;
    while (i < line.length) {
      if (inBlock) { const e = line.indexOf(inBlock, i); if (e < 0) { push(line.slice(i), "comment"); i = line.length; break; } push(line.slice(i, e + inBlock.length), "comment"); i = e + inBlock.length; inBlock = undefined; continue; }
      const rest = line.slice(i);
      const lc = L.line?.find((m) => rest.startsWith(m) && (m !== "#" || lang !== "css"));
      if (lc) { push(rest, "comment"); break; }
      const bc = L.block?.find(([a]) => rest.startsWith(a));
      if (bc) { const e = line.indexOf(bc[1], i + bc[0].length); if (e < 0) { push(rest, "comment"); inBlock = bc[1]; break; } push(line.slice(i, e + bc[1].length), "comment"); i = e + bc[1].length; continue; }
      const q = L.quotes.find((x) => rest[0] === x);
      if (q) { let j = 1; while (j < rest.length && rest[j] !== q) j += rest[j] === "\\" ? 2 : 1; push(rest.slice(0, j + 1), "string"); i += j + 1; continue; }
      if (L.tags) {
        const tg = /^<\/?[A-Za-z][\w:-]*|^\/?>/.exec(rest);
        if (tg) { push(tg[0], "tag"); i += tg[0].length; continue; }
        const at = /^[A-Za-z_:][\w:.-]*(?==)/.exec(rest);
        if (at) { push(at[0], "attr"); i += at[0].length; continue; }
      }
      const num = /^(0x[\da-fA-F_]+|\d[\d_]*(\.\d+)?([eE][+-]?\d+)?)\b/.exec(rest);
      if (num && !/[\w$]/.test(line[i - 1] ?? "")) { push(num[0], "number"); i += num[0].length; continue; }
      const id = /^[A-Za-z_$][\w$]*/.exec(rest);
      if (id) {
        const w = id[0], key = L.caseInsensitive ? w.toLowerCase() : w, after = rest.slice(w.length);
        let k: Kind = "plain";
        if (L.kw.has(key)) k = "keyword";
        else if (L.types?.has(key) || (/^[A-Z][a-z]/.test(w) && lang !== "sql" && lang !== "plain")) k = "type";
        else if (/^\s*\(/.test(after) && lang !== "plain") k = "func";
        else if (lang === "css" && /^\s*:/.test(after)) k = "prop";
        else if ((lang === "yaml" && /^\s*:/.test(after)) || (out.length && out[out.length - 1].t.endsWith(".") && lang !== "plain")) k = lang === "yaml" ? "attr" : "prop";
        push(w, k); i += w.length; continue;
      }
      push(rest[0], /[{}()[\];,.<>=+\-*/%!&|^~?:]/.test(rest[0]) ? "punct" : "plain"); i += 1;
    }
    return out;
  });
}

export interface Theme { bg: string; fg: string; gutter: string; hl: string; frame: string; c: Record<Kind, string> }
export const THEMES: Record<string, Theme> = {
  "github-light": { bg: "#ffffff", fg: "#24292f", gutter: "#8c959f", hl: "#fff8c5", frame: "#f6f8fa", c: { plain: "#24292f", comment: "#6e7781", string: "#0a3069", number: "#0550ae", keyword: "#cf222e", type: "#953800", func: "#8250df", punct: "#24292f", tag: "#116329", attr: "#0550ae", prop: "#0550ae" } },
  "github-dark": { bg: "#0d1117", fg: "#c9d1d9", gutter: "#6e7681", hl: "#3a3212", frame: "#161b22", c: { plain: "#c9d1d9", comment: "#8b949e", string: "#a5d6ff", number: "#79c0ff", keyword: "#ff7b72", type: "#ffa657", func: "#d2a8ff", punct: "#c9d1d9", tag: "#7ee787", attr: "#79c0ff", prop: "#79c0ff" } },
  dracula: { bg: "#282a36", fg: "#f8f8f2", gutter: "#6272a4", hl: "#44475a", frame: "#21222c", c: { plain: "#f8f8f2", comment: "#6272a4", string: "#f1fa8c", number: "#bd93f9", keyword: "#ff79c6", type: "#8be9fd", func: "#50fa7b", punct: "#f8f8f2", tag: "#ff79c6", attr: "#50fa7b", prop: "#66d9ef" } },
  monokai: { bg: "#272822", fg: "#f8f8f2", gutter: "#75715e", hl: "#3e3d32", frame: "#1e1f1c", c: { plain: "#f8f8f2", comment: "#75715e", string: "#e6db74", number: "#ae81ff", keyword: "#f92672", type: "#66d9ef", func: "#a6e22e", punct: "#f8f8f2", tag: "#f92672", attr: "#a6e22e", prop: "#66d9ef" } },
  nord: { bg: "#2e3440", fg: "#d8dee9", gutter: "#616e88", hl: "#3b4252", frame: "#272c36", c: { plain: "#d8dee9", comment: "#616e88", string: "#a3be8c", number: "#b48ead", keyword: "#81a1c1", type: "#8fbcbb", func: "#88c0d0", punct: "#eceff4", tag: "#81a1c1", attr: "#8fbcbb", prop: "#88c0d0" } },
  "solarized-light": { bg: "#fdf6e3", fg: "#586e75", gutter: "#93a1a1", hl: "#eee8d5", frame: "#eee8d5", c: { plain: "#586e75", comment: "#93a1a1", string: "#2aa198", number: "#d33682", keyword: "#859900", type: "#b58900", func: "#268bd2", punct: "#586e75", tag: "#268bd2", attr: "#b58900", prop: "#268bd2" } },
};

/** "3,5-7" → {3,5,6,7}；返回 undefined 表示格式不对。 */
export function parseRanges(spec: string): Set<number> | undefined {
  const out = new Set<number>();
  for (const part of spec.split(/[,，\s]+/).filter(Boolean)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!m) return undefined;
    const a = Number(m[1]), b = Number(m[2] ?? m[1]);
    if (b < a || b - a > 1000) return undefined;
    for (let i = a; i <= b; i++) out.add(i);
  }
  return out;
}

/** 可能泄露的密钥 / 密码。 */
const SECRETS: [RegExp, string][] = [
  [/\bsk-[A-Za-z0-9_-]{16,}/, "an API key (sk-…)"],
  [/\bAKIA[0-9A-Z]{16}\b/, "an AWS access key"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/, "a GitHub token"],
  [/\bxox[abpr]-[A-Za-z0-9-]{10,}/, "a Slack token"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "a private key"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/, "a JWT"],
  [/(password|passwd|secret|api[_-]?key|token)\s*[:=]\s*["'][^"']{6,}["']/i, "a hard-coded password / secret"],
  [/:\/\/[^/\s:@]+:[^/\s@]{3,}@/, "a URL with a username and password"],
];
export function findSecrets(line: string) {
  const hits = SECRETS.filter(([re]) => re.test(line)).map(([, what]) => what);
  // 已认出具体类型时不再重复报“写死的密码”。
  return hits.length > 1 ? hits.filter((h) => h !== "a hard-coded password / secret") : hits;
}
