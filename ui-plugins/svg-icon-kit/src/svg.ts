/** 极简 SVG/XML 解析、清理与序列化（图标级别的文件，不依赖第三方库） */
export type El = { tag: string; attrs: [string, string][]; children: Node[] };
export type Node = El | { text: string; cdata?: boolean };
export const isEl = (n: Node): n is El => (n as El).tag !== undefined;

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => (e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e] ?? m));
const encAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const encText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function parseXml(src: string): El {
  const root: El = { tag: "#root", attrs: [], children: [] };
  const stack: El[] = [root];
  let i = 0;
  const s = src.replace(/^\uFEFF/, "");
  while (i < s.length) {
    const lt = s.indexOf("<", i);
    if (lt < 0) { stack.at(-1)!.children.push({ text: decode(s.slice(i)) }); break; }
    if (lt > i) stack.at(-1)!.children.push({ text: decode(s.slice(i, lt)) });
    if (s.startsWith("<!--", lt)) { const e = s.indexOf("-->", lt + 4); i = e < 0 ? s.length : e + 3; continue; }
    if (s.startsWith("<![CDATA[", lt)) { const e = s.indexOf("]]>", lt); const end = e < 0 ? s.length : e; stack.at(-1)!.children.push({ text: s.slice(lt + 9, end), cdata: true }); i = end + 3; continue; }
    if (s.startsWith("<?", lt)) { const e = s.indexOf("?>", lt); i = e < 0 ? s.length : e + 2; continue; }
    if (s.startsWith("<!", lt)) {
      // DOCTYPE，可能带 [内部子集]
      let j = lt + 2, depth = 0;
      for (; j < s.length; j++) { if (s[j] === "[") depth++; else if (s[j] === "]") depth--; else if (s[j] === ">" && depth <= 0) break; }
      i = j + 1; continue;
    }
    if (s[lt + 1] === "/") {
      const e = s.indexOf(">", lt);
      const name = s.slice(lt + 2, e).trim();
      while (stack.length > 1) { const top = stack.pop()!; if (top.tag === name) break; }
      i = e + 1; continue;
    }
    // 开始标签
    const m = /^<([\w:.-]+)/.exec(s.slice(lt, lt + 200));
    if (!m) { stack.at(-1)!.children.push({ text: "<" }); i = lt + 1; continue; }
    const el: El = { tag: m[1], attrs: [], children: [] };
    let j = lt + m[0].length;
    const re = /\s*([\w:.-]+)\s*(?:=\s*("[^"]*"|'[^']*'|[^\s>"']+))?|\s*(\/?)>/y;
    let selfClose = false;
    for (;;) {
      re.lastIndex = j;
      const a = re.exec(s);
      if (!a) { j = s.indexOf(">", j); if (j < 0) j = s.length - 1; selfClose = s[j - 1] === "/"; j++; break; }
      j = re.lastIndex;
      if (a[0].trimStart().endsWith(">") && a[1] === undefined) { selfClose = a[3] === "/"; break; }
      let v = a[2] ?? "";
      if (v.startsWith('"') || v.startsWith("'")) v = v.slice(1, -1);
      el.attrs.push([a[1], decode(v)]);
    }
    stack.at(-1)!.children.push(el);
    if (!selfClose) stack.push(el);
    i = j;
  }
  return root;
}

export const getAttr = (el: El, k: string) => el.attrs.find((a) => a[0] === k)?.[1];
export function setAttr(el: El, k: string, v: string | undefined) {
  const i = el.attrs.findIndex((a) => a[0] === k);
  if (v === undefined) { if (i >= 0) el.attrs.splice(i, 1); }
  else if (i >= 0) el.attrs[i][1] = v;
  else el.attrs.push([k, v]);
}
export function walk(el: El, fn: (e: El, parent: El | null) => void, parent: El | null = null) {
  fn(el, parent);
  for (const c of el.children) if (isEl(c)) walk(c, fn, el);
}

export function serialize(el: El): string {
  const attrs = el.attrs.map(([k, v]) => ` ${k}="${encAttr(v)}"`).join("");
  if (!el.children.length) return `<${el.tag}${attrs}/>`;
  const inner = el.children.map((c) => (isEl(c) ? serialize(c) : c.cdata ? `<![CDATA[${c.text}]]>` : encText(c.text))).join("");
  return `<${el.tag}${attrs}>${inner}</${el.tag}>`;
}

/* ---------------- 颜色 ---------------- */
const NAMED: Record<string, string> = { black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff", yellow: "#ffff00", orange: "#ffa500", gray: "#808080", grey: "#808080", silver: "#c0c0c0", purple: "#800080", navy: "#000080", teal: "#008080", maroon: "#800000", lime: "#00ff00", aqua: "#00ffff", fuchsia: "#ff00ff", olive: "#808000" };
/** 归一化颜色；非颜色（none、url()、currentColor 等）返回 null */
export function normColor(v: string | undefined): string | null {
  if (!v) return null;
  const t = v.trim().toLowerCase();
  if (!t || /^(none|transparent|inherit|currentcolor|initial|unset|context-fill|context-stroke)$/.test(t) || t.startsWith("url(") || t.startsWith("var(")) return null;
  if (NAMED[t]) return NAMED[t];
  let m = /^#([0-9a-f]{3,4})$/.exec(t);
  if (m) return "#" + [...m[1].slice(0, 3)].map((c) => c + c).join("");
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(t);
  if (m) return "#" + m[1];
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(t);
  if (m) return "#" + [m[1], m[2], m[3]].map((x) => Math.min(255, +x).toString(16).padStart(2, "0")).join("");
  return t;
}
export const COLOR_ATTRS = ["fill", "stroke", "stop-color", "color", "flood-color", "lighting-color"];
const PRESENTATION = new Set([...COLOR_ATTRS, "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "stroke-opacity", "fill-opacity", "fill-rule", "clip-rule", "opacity", "stop-opacity", "display", "visibility", "transform", "vector-effect", "shape-rendering", "paint-order"]);

/* ---------------- 名字 ---------------- */
export function kebab(file: string) {
  const base = file.split("/").pop()!.replace(/\.svg$/i, "");
  return base.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
export function componentName(name: string) {
  const p = name.split(/[^a-zA-Z0-9]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join("");
  return "Icon" + p;
}
export const validName = (n: string) => /^[a-z0-9][a-z0-9-]*$/.test(n);

/* ---------------- 清理 ---------------- */
export type Mode = "auto" | "currentColor" | "keep" | "recolor";
export interface CleanOpts { mode: Mode; recolor?: string; precision: number; square: boolean; keepTitle: boolean; title?: string }
export interface Cleaned { svg: El; colors: string[]; applied: "currentColor" | "keep" | "recolor"; viewBox: string; w: number; h: number; notes: string[]; removed: string[] }

const round = (s: string, p: number) => s.replace(/-?(?:\d+\.\d*|\.\d+|\d+)(?:e[-+]?\d+)?/gi, (n: string, at: number, all: string) => {
  const x = Number(n);
  if (!Number.isFinite(x) || !/[.e]/i.test(n)) return n;
  let r = String(Math.round(x * 10 ** p) / 10 ** p);
  if (r === "-0") r = "0";
  // 尽量短：0.5 → .5；但前一个字符是数字时（如 3.41.81 里的 .81），必须保持可分隔
  r = r.replace(/^(-?)0\./, "$1.");
  if (at > 0 && /[\d.]/.test(all[at - 1]) && !/^[-.]/.test(r)) r = " " + r;
  if (all[at + n.length] === "." && !/[.e]/i.test(r)) r += " ";
  return r;
});
const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

export function cleanSvg(src: string, o: CleanOpts): Cleaned {
  const doc = parseXml(src);
  const svg = doc.children.find((c): c is El => isEl(c) && c.tag.replace(/^\w+:/, "") === "svg");
  if (!svg) throw new Error("no <svg> element");
  svg.tag = "svg";
  const notes: string[] = [], removed = new Set<string>();
  // 1. 删除编辑器垃圾和危险内容
  const DROP = new Set(["metadata", "desc", "script", "foreignObject", "sodipodi:namedview", "inkscape:perspective", "inkscape:grid"]);
  if (!o.keepTitle) DROP.add("title");
  const refs = new Set<string>();
  walk(svg, (e) => {
    for (const [, v] of e.attrs) for (const m of v.matchAll(/url\(\s*['"]?#([^'")\s]+)|^#(.+)$/g)) refs.add(m[1] ?? m[2]);
    for (const c of e.children) if (!isEl(c)) for (const m of c.text.matchAll(/url\(\s*['"]?#([^'")\s]+)/g)) refs.add(m[1]);
  });
  const prune = (e: El) => {
    e.children = e.children.filter((c) => {
      if (!isEl(c)) return e.tag === "style" || e.tag === "title" || e.tag === "text" || e.tag === "tspan" || c.text.trim() !== "";
      const name = c.tag;
      if (DROP.has(name) || name.includes(":")) { removed.add(name === "script" || name === "foreignObject" ? `<${name}> (unsafe)` : `<${name}>`); return false; }
      return true;
    });
    for (const c of e.children) if (isEl(c)) prune(c);
  };
  prune(svg);
  walk(svg, (e) => {
    // style="…" → 属性
    const st = getAttr(e, "style");
    if (st !== undefined) {
      const rest: string[] = [];
      for (const part of st.split(";")) {
        const k = part.slice(0, part.indexOf(":")).trim().toLowerCase(), v = part.slice(part.indexOf(":") + 1).trim();
        if (!k || part.indexOf(":") < 0) continue;
        if (PRESENTATION.has(k)) { if (getAttr(e, k) === undefined) e.attrs.push([k, v]); }
        else if (!/^-inkscape|^font-variation|^isolation|^mix-blend-mode$/.test(k)) rest.push(`${k}:${v}`);
      }
      setAttr(e, "style", rest.length ? rest.join(";") : undefined);
    }
    e.attrs = e.attrs.filter(([k, v]) => {
      if (/^on/i.test(k)) { removed.add("on* handlers (unsafe)"); return false; }
      if ((k === "href" || k === "xlink:href") && /^\s*javascript:/i.test(v)) { removed.add("javascript: link"); return false; }
      if (k.startsWith("xmlns:") || /^(sodipodi|inkscape|sketch|serif|figma|data-name|xml:space|enable-background|version|baseProfile)/.test(k) || k.startsWith("data-")) { removed.add(k.replace(/:.*$/, ":*")); return false; }
      if (k === "id" && !refs.has(v)) return false;
      if (/^(fill-opacity|stroke-opacity|opacity|stop-opacity)$/.test(k) && Number(v) === 1) return false;
      return true;
    });
    const href = getAttr(e, "xlink:href");
    if (href !== undefined) { setAttr(e, "xlink:href", undefined); setAttr(e, "href", href); }
    for (const a of e.attrs) if (/^(d|points|transform|x|y|x1|y1|x2|y2|cx|cy|r|rx|ry|width|height|stroke-width|offset|viewBox)$/.test(a[0])) a[1] = round(a[1], o.precision).replace(/\s+/g, " ").trim();
  });
  // 去掉没属性的 <g> 和空 <defs>
  const unwrap = (e: El) => {
    const out: Node[] = [];
    for (const c of e.children) {
      if (isEl(c)) { unwrap(c); if (c.tag === "g" && !c.attrs.length) out.push(...c.children); else if ((c.tag === "defs" || c.tag === "g") && !c.children.length) continue; else out.push(c); }
      else out.push(c);
    }
    e.children = out;
  };
  unwrap(svg);
  // 2. viewBox
  const num = (v?: string) => { const m = /^\s*([\d.]+)\s*(px)?\s*$/.exec(v ?? ""); return m ? Number(m[1]) : NaN; };
  let vb = (getAttr(svg, "viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  if (vb.length !== 4 || vb.some((n) => !Number.isFinite(n)) || vb[2] <= 0 || vb[3] <= 0) {
    const w = num(getAttr(svg, "width")), h = num(getAttr(svg, "height"));
    if (Number.isFinite(w) && Number.isFinite(h)) { vb = [0, 0, w, h]; notes.push("viewBox added from width/height"); }
    else { vb = [0, 0, 24, 24]; notes.push("no viewBox or size — assumed 0 0 24 24"); }
  }
  let [x, y, w, h] = vb;
  if (o.square && Math.abs(w - h) > 1e-6) { const m = Math.max(w, h); x -= (m - w) / 2; y -= (m - h) / 2; w = h = m; notes.push(`padded to square (${fmt(vb[2])}×${fmt(vb[3])} → ${fmt(m)}×${fmt(m)})`); }
  const viewBox = [x, y, w, h].map(fmt).join(" ");
  for (const k of ["width", "height", "x", "y", "id", "class", "viewBox", "xmlns", "style"]) if (k !== "style" || !getAttr(svg, "style")) setAttr(svg, k, undefined);
  svg.attrs.unshift(["xmlns", "http://www.w3.org/2000/svg"], ["viewBox", viewBox]);
  // 3. 颜色
  const colors = new Map<string, number>();
  let hasStyleText = false;
  walk(svg, (e) => {
    for (const [k, v] of e.attrs) if (COLOR_ATTRS.includes(k)) { const c = normColor(v); if (c) colors.set(c, (colors.get(c) ?? 0) + 1); }
    if (e.tag === "style") { hasStyleText = true; for (const c of e.children) if (!isEl(c)) for (const m of c.text.matchAll(/(?:fill|stroke|stop-color|color)\s*:\s*([^;}\s]+)/g)) { const n = normColor(m[1]); if (n) colors.set(n, (colors.get(n) ?? 0) + 1); } }
  });
  let shapesWithoutFill = false;
  walk(svg, (e) => { if (/^(path|rect|circle|ellipse|polygon|polyline)$/.test(e.tag) && getAttr(e, "fill") === undefined) shapesWithoutFill = true; });
  const list = [...colors.keys()];
  if (!list.length && shapesWithoutFill && getAttr(svg, "fill") === undefined) list.push("#000000");
  const applied: Cleaned["applied"] = o.mode === "auto" ? (list.length <= 1 ? "currentColor" : "keep") : o.mode === "recolor" ? (normColor(o.recolor) ? "recolor" : "keep") : o.mode;
  if (applied !== "keep") {
    const to = applied === "currentColor" ? "currentColor" : o.recolor!.trim();
    walk(svg, (e) => {
      for (const a of e.attrs) if (COLOR_ATTRS.includes(a[0]) && normColor(a[1])) a[1] = to;
      if (e.tag === "style") for (const c of e.children) if (!isEl(c)) c.text = c.text.replace(/((?:fill|stroke|stop-color|color)\s*:\s*)([^;}\s]+)/g, (m0, p: string, v: string) => (normColor(v) ? p + to : m0));
    });
    if (getAttr(svg, "fill") === undefined && shapesWithoutFill) svg.attrs.push(["fill", to]);
    if (applied === "currentColor" && list.length > 1) notes.push(`${list.length} colours flattened to currentColor`);
  } else if (o.mode === "auto" && list.length > 1) notes.push(`${list.length} colours — kept (multi-colour)`);
  if (hasStyleText) notes.push("has a <style> block");
  let raster = false, text = false;
  walk(svg, (e) => { if (e.tag === "image") raster = true; if (e.tag === "text") text = true; });
  if (raster) notes.push("contains an embedded bitmap <image>");
  if (text) notes.push("uses <text> — depends on installed fonts");
  if (o.keepTitle && o.title) {
    const t = svg.children.find((c): c is El => isEl(c) && c.tag === "title");
    if (t) t.children = [{ text: o.title }]; else svg.children.unshift({ tag: "title", attrs: [], children: [{ text: o.title }] });
  }
  return { svg, colors: list, applied, viewBox, w, h, notes, removed: [...removed] };
}

/** 把图标里的 id 加前缀，避免多个图标放进同一个雪碧图时冲突 */
export function prefixIds(svg: El, prefix: string): El {
  const copy: El = JSON.parse(JSON.stringify(svg));
  const ids = new Map<string, string>();
  walk(copy, (e) => { const id = getAttr(e, "id"); if (id) { ids.set(id, `${prefix}-${id}`); setAttr(e, "id", `${prefix}-${id}`); } });
  if (!ids.size) return copy;
  const fix = (v: string) => v.replace(/url\(\s*(['"]?)#([^'")\s]+)\1\s*\)/g, (m, q: string, id: string) => (ids.has(id) ? `url(#${ids.get(id)})` : m)).replace(/^#(.+)$/, (m, id: string) => (ids.has(id) ? `#${ids.get(id)}` : m));
  walk(copy, (e) => {
    for (const a of e.attrs) a[1] = fix(a[1]);
    if (e.tag === "style") for (const c of e.children) if (!isEl(c)) { c.text = fix(c.text); for (const [o, n] of ids) c.text = c.text.replace(new RegExp(`#${o.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`, "g"), `#${n}`); }
  });
  return copy;
}

export function sprite(icons: { id: string; svg: El }[]) {
  const syms = icons.map(({ id, svg }) => {
    const s = prefixIds(svg, id);
    const keep = s.attrs.filter(([k]) => k !== "xmlns" && k !== "viewBox");
    return `  <symbol id="${encAttr(id)}" viewBox="${encAttr(getAttr(s, "viewBox")!)}"${keep.map(([k, v]) => ` ${k}="${encAttr(v)}"`).join("")}>${s.children.map((c) => (isEl(c) ? serialize(c) : encText((c as { text: string }).text))).join("")}</symbol>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">\n${syms.join("\n")}\n</svg>\n`;
}

/* ---------------- React ---------------- */
const camel = (k: string) => k.replace(/[-:]([a-z])/g, (_, c: string) => c.toUpperCase());
export function jsxAttr(k: string) {
  if (k === "class") return "className";
  if (k.startsWith("data-") || k.startsWith("aria-")) return k;
  if (k === "xlink:href") return "href";
  return camel(k);
}
function styleObj(st: string) {
  const parts = st.split(";").map((p) => p.trim()).filter((p) => p.includes(":")).map((p) => { const i = p.indexOf(":"); return `${JSON.stringify(camel(p.slice(0, i).trim()))}: ${JSON.stringify(p.slice(i + 1).trim())}`; });
  return `{{ ${parts.join(", ")} }}`;
}
export function toJsx(el: El, indent = "      "): string {
  const attrs = el.attrs.map(([k, v]) => ` ${jsxAttr(k)}=${k === "style" ? styleObj(v) : JSON.stringify(v)}`).join("");
  if (!el.children.length) return `${indent}<${el.tag}${attrs} />`;
  const kids = el.children.map((c) => (isEl(c) ? toJsx(c, indent + "  ") : `${indent}  {${JSON.stringify((c as { text: string }).text)}}`));
  return `${indent}<${el.tag}${attrs}>\n${kids.join("\n")}\n${indent}</${el.tag}>`;
}
export function component(name: string, svg: El, ts: boolean, size: number) {
  const s = prefixIds(svg, name);
  const rootAttrs = s.attrs.filter(([k]) => k !== "xmlns");
  const comp = componentName(name);
  const attrs = rootAttrs.map(([k, v]) => `${jsxAttr(k)}=${k === "style" ? styleObj(v) : JSON.stringify(v)}`).join(" ");
  const kids = s.children.map((c) => (isEl(c) ? toJsx(c) : `      {${JSON.stringify((c as { text: string }).text)}}`)).join("\n");
  const sig = ts ? `{ size = ${size}, ...props }: SVGProps<SVGSVGElement> & { size?: number | string }` : `{ size = ${size}, ...props }`;
  return `${ts ? `import type { SVGProps } from "react";\n\n` : ""}export function ${comp}(${sig}) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" ${attrs} width={size} height={size} aria-hidden={props["aria-label"] ? undefined : true} {...props}>
${kids}
    </svg>
  );
}

export default ${comp};
`;
}
