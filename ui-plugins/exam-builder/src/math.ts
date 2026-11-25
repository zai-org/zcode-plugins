// LaTeX → MathJax SVG；SVG 路径直接画进 PDF（矢量）。
import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { AllPackages } from "mathjax-full/js/input/tex/AllPackages.js";
import { concatTransformationMatrix, popGraphicsState, pushGraphicsState, rgb, type PDFFont, type PDFPage } from "pdf-lib";

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const packages = AllPackages.filter((p: string) => !["bussproofs", "html", "require", "autoload"].includes(p));
const doc = mathjax.document("", { InputJax: new TeX({ packages, formatError: (_jax: unknown, err: { message: string }) => { throw err; } }), OutputJax: new SVG({ fontCache: "none" }) });

type Node = any;
export interface MathBox { svg: string; node: Node; width: number; ascent: number; descent: number; error?: string } // 尺寸以 em 计

const cache = new Map<string, MathBox>();
export function tex2svg(tex: string, display = false): MathBox {
  const key = `${display ? "D" : "I"}${tex}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let node: Node, error: string | undefined;
  try {
    node = doc.convert(tex, { display, em: 16, ex: 8, containerWidth: 1200 });
  } catch (e) {
    error = String((e as { message?: string })?.message ?? e);
    node = doc.convert("\\text{?}", { display: false });
  }
  const svg = adaptor.firstChild(node) as Node;
  const vb = String(adaptor.getAttribute(svg, "viewBox")).split(/\s+/).map(Number);
  const box: MathBox = { svg: adaptor.outerHTML(svg), node: svg, width: vb[2] / 1000, ascent: -vb[1] / 1000, descent: (vb[3] + vb[1]) / 1000, ...(error ? { error } : {}) };
  cache.set(key, box);
  return box;
}
export const latexError = (tex: string) => tex2svg(tex).error;

type M = [number, number, number, number, number, number];
const mul = (a: M, b: M): M => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
function parseTransform(t: string | undefined): M {
  let m: M = [1, 0, 0, 1, 0, 0];
  if (!t) return m;
  for (const [, fn, args] of t.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = args.split(/[\s,]+/).filter(Boolean).map(Number);
    if (fn === "translate") m = mul(m, [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0]);
    else if (fn === "scale") m = mul(m, [a[0], 0, 0, a[1] ?? a[0], 0, 0]);
    else if (fn === "matrix") m = mul(m, a as M);
  }
  return m;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** 二次贝塞尔 → 三次（pdf-lib 把 Q 画成 PDF 的 v 运算符，形状不对）。 */
const quad = (x0: number, y0: number, qx: number, qy: number, x: number, y: number) =>
  `C${r3(x0 + (2 / 3) * (qx - x0))} ${r3(y0 + (2 / 3) * (qy - y0))} ${r3(x + (2 / 3) * (qx - x))} ${r3(y + (2 / 3) * (qy - y))} ${x} ${y}`;
/** 把 Q/T 展开成三次曲线、H/V 展开成 L：pdf-lib 画二次曲线会把括号画歪。 */
export function normalizePath(d: string): string {
  const out: string[] = [];
  let cx = 0, cy = 0, sx = 0, sy = 0, qx: number | undefined, qy: number | undefined;
  for (const [, cmd, rest] of d.matchAll(/([MLHVQTCSZAmlhvqtcsza])([^MLHVQTCSZAmlhvqtcsza]*)/g)) {
    const n = (rest.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number);
    const up = cmd.toUpperCase(), rel = cmd !== up;
    const ax = (v: number) => (rel ? cx + v : v), ay = (v: number) => (rel ? cy + v : v);
    let lastQ = false;
    const per: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, Q: 4, T: 2, C: 6, S: 4, A: 7, Z: 0 };
    const k = per[up];
    if (up === "Z") { out.push("Z"); cx = sx; cy = sy; qx = undefined; continue; }
    for (let i = 0; i + k <= n.length; i += k) {
      const a = n.slice(i, i + k);
      if (up === "M" && i === 0) { cx = ax(a[0]); cy = ay(a[1]); sx = cx; sy = cy; out.push(`M${cx} ${cy}`); }
      else if (up === "M" || up === "L") { cx = ax(a[0]); cy = ay(a[1]); out.push(`L${cx} ${cy}`); }
      else if (up === "H") { cx = ax(a[0]); out.push(`L${cx} ${cy}`); }
      else if (up === "V") { cy = rel ? cy + a[0] : a[0]; out.push(`L${cx} ${cy}`); }
      else if (up === "Q") { qx = ax(a[0]); qy = ay(a[1]); const x0 = cx, y0 = cy; cx = ax(a[2]); cy = ay(a[3]); out.push(quad(x0, y0, qx, qy, cx, cy)); lastQ = true; }
      else if (up === "T") {
        const px = qx !== undefined ? 2 * cx - qx : cx, py = qy !== undefined ? 2 * cy - qy! : cy;
        qx = px; qy = py; const x0 = cx, y0 = cy; cx = ax(a[0]); cy = ay(a[1]); out.push(quad(x0, y0, px, py, cx, cy)); lastQ = true;
      } else if (up === "C") { out.push(`C${ax(a[0])} ${ay(a[1])} ${ax(a[2])} ${ay(a[3])} ${ax(a[4])} ${ay(a[5])}`); cx = ax(a[4]); cy = ay(a[5]); }
      else if (up === "S") { out.push(`S${ax(a[0])} ${ay(a[1])} ${ax(a[2])} ${ay(a[3])}`); cx = ax(a[2]); cy = ay(a[3]); }
      else if (up === "A") { out.push(`A${a[0]} ${a[1]} ${a[2]} ${a[3]} ${a[4]} ${ax(a[5])} ${ay(a[6])}`); cx = ax(a[5]); cy = ay(a[6]); }
      if (!lastQ) qx = qy = undefined;
    }
  }
  return out.join("");
}

/** 在 (x, baseline) 处画公式；size = 字号（pt）。 */
export function drawMath(page: PDFPage, box: MathBox, x: number, baseline: number, size: number, textFont?: PDFFont) {
  const s = size / 1000;
  const P: M = [s, 0, 0, -s, x, baseline];
  const F: M = [1, 0, 0, -1, 0, 0];
  const color = rgb(0, 0, 0);
  const walk = (node: Node, m: M) => {
    const kind = adaptor.kind(node);
    if (kind === "#text" || kind === "#comment" || kind === "title") return;
    const own = mul(m, parseTransform(adaptor.getAttribute(node, "transform") as string | undefined));
    if (kind === "path" || kind === "rect" || kind === "line") {
      if (adaptor.getAttribute(node, "data-background")) return;
      let d = String(adaptor.getAttribute(node, "d") ?? "");
      if (kind === "rect") {
        const [rx, ry, w, h] = ["x", "y", "width", "height"].map((k) => Number(adaptor.getAttribute(node, k) ?? 0));
        d = `M${rx} ${ry}H${rx + w}V${ry + h}H${rx}Z`;
      } else if (kind === "line") {
        const [x1, y1, x2, y2] = ["x1", "y1", "x2", "y2"].map((k) => Number(adaptor.getAttribute(node, k) ?? 0));
        const sw = Number(adaptor.getAttribute(node, "stroke-width") ?? 40) / 2;
        d = y1 === y2 ? `M${x1} ${y1 - sw}H${x2}V${y1 + sw}H${x1}Z` : `M${x1 - sw} ${y1}V${y2}H${x1 + sw}V${y1}Z`;
      }
      if (!d) return;
      const c = mul(mul(P, own), F);
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...c));
      page.drawSvgPath(normalizePath(d), { x: 0, y: 0, color, borderWidth: 0 });
      page.pushOperators(popGraphicsState());
      return;
    }
    if (kind === "text" && textFont) {
      const str = (adaptor.childNodes(node) as Node[]).map((n) => adaptor.value(n) ?? "").join("");
      const fs = parseFloat(String(adaptor.getAttribute(node, "font-size") ?? "1000"));
      const c = mul(P, own);
      const scale = Math.sqrt(Math.abs(c[0] * c[3] - c[1] * c[2]));
      try { page.drawText(str, { x: c[4], y: c[5], size: fs * scale, font: textFont, color }); } catch { /* 字体缺字 */ }
      return;
    }
    for (const ch of adaptor.childNodes(node) as Node[]) walk(ch, own);
  };
  for (const ch of adaptor.childNodes(box.node) as Node[]) walk(ch, [1, 0, 0, 1, 0, 0]);
}
