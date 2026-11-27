import { parseColor, type RGBA } from "./wcag.ts";

/** 一个颜色变量的声明位置（用于写回） */
export type Decl = { file: string; scope: string; name: string; raw: string; start: number; end: number };
export type RulePair = { file: string; scope: string; selector: string; fg: string; bg: string };
export type Parsed = { decls: Decl[]; rules: RulePair[] };

const stripComments = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length));

/** CSS / SCSS / LESS：最内层的 { } 块；自定义属性 --x、SCSS $x、LESS @x 都算变量 */
export function parseCss(file: string, text: string): Parsed {
  const src = stripComments(text);
  const decls: Decl[] = [], rules: RulePair[] = [];
  // 顶层 SCSS/LESS 变量
  for (const m of src.matchAll(/(^|[;\n])\s*([$@][\w-]+)\s*:\s*([^;{}\n]+);/g)) {
    if (m[2].startsWith("@") && /^@(media|import|use|forward|include|mixin|supports|font-face|keyframes|layer)$/.test(m[2])) continue;
    const vStart = m.index! + m[0].indexOf(":", m[0].indexOf(m[2])) + 1;
    const lead = m[3].match(/^\s*/)![0].length;
    decls.push({ file, scope: ":root", name: m[2], raw: m[3].trim(), start: vStart + lead, end: vStart + lead + m[3].trim().length });
  }
  for (const b of src.matchAll(/([^{};]+)\{([^{}]*)\}/g)) {
    const selector = b[1].trim().replace(/\s+/g, " ");
    const bodyStart = b.index! + b[0].indexOf("{") + 1;
    const scope = /^(:root|html)$/i.test(selector) ? ":root" : selector;
    let fg = "", bg = "";
    for (const d of b[2].matchAll(/([\w-]+|--[\w-]+)\s*:\s*([^;]+)(;|$)/g)) {
      const prop = d[1], value = d[2].trim();
      const vStart = bodyStart + d.index! + d[0].indexOf(d[2], d[0].indexOf(":") + 1);
      if (prop.startsWith("--")) decls.push({ file, scope, name: prop, raw: value, start: vStart, end: vStart + value.length });
      else if (prop === "color") fg = value;
      else if (prop === "background-color" || prop === "background") bg = value;
    }
    if (fg && bg && !/^:root|html$/.test(selector)) rules.push({ file, scope: ":root", selector, fg, bg });
  }
  return { decls, rules };
}

/** JSON 设计令牌：普通嵌套对象、W3C {"$value"} 或 {"value"}；名字用点连接 */
export function parseJson(file: string, text: string): Parsed {
  const decls: Decl[] = [];
  let data: unknown;
  try { data = JSON.parse(text); } catch (e) { throw new Error(`${file}: not valid JSON (${(e as Error).message})`); }
  const walk = (v: unknown, path: string[]) => {
    if (typeof v === "string") {
      if (!parseColor(v) && !/^\{[^}]+\}$/.test(v.trim())) return;
      // 在原文里找这个值的位置（按路径最后一个键 + 值）
      const key = path[path.length - 1] === "$value" || path[path.length - 1] === "value" ? path[path.length - 1] : path[path.length - 1];
      const re = new RegExp(`"${key.replace(/[$.*+?^()[\]{}|\\]/g, "\\$&")}"\\s*:\\s*"(${v.replace(/[$.*+?^()[\]{}|\\]/g, "\\$&")})"`, "g");
      const used = new Set(decls.filter((d) => d.file === file).map((d) => d.start));
      let start = -1;
      for (const m of text.matchAll(re)) { const st = m.index! + m[0].lastIndexOf(`"${v}"`) + 1; if (!used.has(st)) { start = st; break; } }
      const name = path.filter((p) => p !== "$value" && p !== "value").join(".");
      decls.push({ file, scope: "tokens", name, raw: v, start, end: start < 0 ? -1 : start + v.length });
      return;
    }
    if (v && typeof v === "object" && !Array.isArray(v)) for (const [k, x] of Object.entries(v)) if (k !== "$type" && k !== "$description" && k !== "type" && k !== "description") walk(x, [...path, k]);
  };
  walk(data, []);
  return { decls, rules: [] };
}

export type Token = { key: string; scope: string; name: string; color: RGBA | null; origin: Decl | null; raw: string; via: string[] };

/** 解析 var(--x, fallback)、$x、@x、{a.b} 引用，得到最终颜色和真正需要修改的那条声明 */
export function resolveAll(decls: Decl[]) {
  const byScope = new Map<string, Map<string, Decl>>();
  for (const d of decls) { const m = byScope.get(d.scope) ?? new Map(); m.set(d.name, d); byScope.set(d.scope, m); }
  const lookup = (scope: string, name: string) => byScope.get(scope)?.get(name) ?? byScope.get(":root")?.get(name) ?? byScope.get("tokens")?.get(name);
  const resolveExpr = (scope: string, expr: string, seen: string[] = []): { color: RGBA | null; origin: Decl | null; via: string[] } => {
    const e = expr.trim().replace(/\s*!important$/, "");
    const direct = parseColor(e);
    if (direct) return { color: direct, origin: null, via: seen };
    let m = e.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/);
    const ref = m ? m[1] : /^[$@][\w-]+$/.test(e) ? e : (m = e.match(/^\{([^}]+)\}$/)) ? m[1] : null;
    if (!ref) {
      // background 简写：取第一个颜色
      for (const part of e.split(/\s+(?![^(]*\))/)) { const c = parseColor(part); if (c) return { color: c, origin: null, via: seen }; const r2 = part.match(/^var\(--[\w-]+.*\)$/) ? resolveExpr(scope, part, seen) : null; if (r2?.color) return r2; }
      return { color: null, origin: null, via: seen };
    }
    if (seen.includes(ref)) return { color: null, origin: null, via: [...seen, ref] };
    const d = lookup(scope, ref);
    if (!d) return m && m[2] ? resolveExpr(scope, m[2], [...seen, ref]) : { color: null, origin: null, via: [...seen, ref] };
    const r = resolveExpr(d.scope, d.raw, [...seen, ref]);
    return { color: r.color, origin: r.origin ?? (r.color ? d : null), via: r.via };
  };
  return { lookup, resolveExpr };
}

const FG = /(^|[-._])(text|fg|foreground|on|ink|label|link|heading|title|muted|placeholder|icon|border|outline|caption|body)([-._]|$)/i;
const BG = /(^|[-._])(bg|background|surface|canvas|paper|card|page|base|fill|backdrop|banner|button|btn|badge|chip|tag)([-._]|$)/i;
/** 默认背景：名字就是 bg / background / surface / page 的那个 */
const BASE_BG = /^(--|\$|@)?(color[-._])?(bg|background|surface|page|canvas)([-._](default|base|primary|1))?$/i;

/** 按名字猜要检查的组合：同名前缀的 text/bg，on-X 配 X，以及所有文字色配默认背景 */
export function guessPairs(names: string[]): [string, string][] {
  const out: [string, string][] = [];
  const set = new Set(names);
  const isFg = (n: string) => FG.test(n) && !/(^|[-._])(bg|background|surface)([-._]|$)/i.test(n);
  const base = names.find((n) => BASE_BG.test(n));
  for (const f of names.filter(isFg)) {
    let paired = false;
    for (const word of ["text", "fg", "foreground", "ink", "label", "icon"]) {
      const re = new RegExp(`([-._])${word}$|^((--|\\$|@)?)${word}([-._])`, "i");
      if (!re.test(f)) continue;
      for (const bw of ["bg", "background", "surface", ""]) {
        const cand = f.replace(new RegExp(`([-._])${word}$`, "i"), bw ? `$1${bw}` : "").replace(new RegExp(`^((--|\\$|@)?)${word}([-._])`, "i"), bw ? `$1${bw}$3` : "$1");
        if (cand !== f && set.has(cand) && !isFg(cand)) { out.push([f, cand]); paired = true; break; }
      }
    }
    const on = f.match(/^((--|\$|@)?(color[-._])?)on[-._](.+)$/i);
    if (on) for (const c of [`${on[1]}${on[4]}`, `${on[1]}${on[4]}-bg`, `${on[1]}bg-${on[4]}`]) if (set.has(c)) { out.push([f, c]); paired = true; break; }
    if (base && base !== f && !paired && !/border|outline/i.test(f)) out.push([f, base]);
  }
  return [...new Map(out.map((p) => [p.join("|"), p])).values()];
}
