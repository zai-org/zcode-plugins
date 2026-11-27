import { esc } from "./kit/app.ts";

export const EN: Record<string, string> = { 尺码: "Size", 胸围: "Chest", 衣长: "Length", 肩宽: "Shoulder", 袖长: "Sleeve", 腰围: "Waist", 臀围: "Hip", 裤长: "Length", 下摆: "Hem", 领围: "Neck", 袖口: "Cuff", 大腿围: "Thigh", 腿围: "Thigh", 脚口: "Leg opening", 前裆: "Front rise", 后裆: "Back rise", 裙长: "Length", 身高: "Height", 体重: "Weight", 脚长: "Foot length", 鞋码: "Shoe size", 内长: "Insole", 头围: "Head", 手围: "Hand", 建议身高: "Height", 建议体重: "Weight" };
export const ZH: Record<string, string> = Object.fromEntries(Object.entries(EN).map(([z, e]) => [e.toLowerCase(), z]));

/** 一个单元格：数字、范围 "88-92" 或空。返回数值数组，非数字返回 null。 */
export function parseCell(v: string): number[] | null {
  const t = v.replace(/\s|cm|厘米|in(ch(es)?)?|"|″/gi, "").replace(/[～~—–至]/g, "-");
  if (!t) return [];
  const m = /^(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?$/.exec(t);
  return m ? (m[2] ? [Number(m[1]), Number(m[2])] : [Number(m[1])]) : null;
}

export const isWeight = (name: string) => /体重|weight|kg|斤|公斤|lb/i.test(name);
export const isPlain = (name: string) => /鞋码|shoe ?size|码数|eu|us ?size/i.test(name);

export function fmtCell(v: string, name: string, from: "cm" | "in", show: "cm" | "in" | "both", dec: number) {
  const n = parseCell(v);
  if (!n || !n.length || isPlain(name) || isWeight(name)) return v;
  const cm = from === "cm" ? n : n.map((x) => x * 2.54), inch = from === "in" ? n : n.map((x) => x / 2.54);
  const f = (a: number[], d: number) => a.map((x) => String(Math.round(x * 10 ** d) / 10 ** d)).join("-");
  return show === "cm" ? f(cm, 1) : show === "in" ? f(inch, dec) : `${f(cm, 1)} / ${f(inch, dec)}`;
}

/** 粗略文本宽度（px）：中日韩 1em，其他 0.58em。 */
export const textW = (t: string, size: number) => [...t].reduce((a, c) => a + (/[\u2e80-\uffff]/.test(c) ? size : /[A-Z0-9]/.test(c) ? size * 0.62 : size * 0.54), 0);

export interface ChartSpec { title: string; note: string; headers: string[]; rows: string[][]; hi: boolean[]; style: string; accent: string; family?: string }

export function chartSvg(c: ChartSpec) {
  const fs = 15, padX = 18, rowH = 40, headH = 46;
  const widths = c.headers.map((h, i) => Math.max(textW(h, fs) + 6, ...c.rows.map((r) => textW(r[i] ?? "", i ? fs : fs + 1)), 46) + padX * 2);
  const W = widths.reduce((a, b) => a + b, 0), M = 28, titleH = c.title ? 54 : 0, noteH = c.note ? 36 : 0;
  const totalW = W + M * 2, H = M + titleH + headH + rowH * c.rows.length + noteH + M;
  const dark = c.style === "bold", boutique = c.style === "boutique";
  const p: string[] = [`<rect width="100%" height="100%" fill="${boutique ? "#faf7f2" : "#ffffff"}"/>`];
  if (c.title) p.push(`<text x="${totalW / 2}" y="${M + 30}" font-size="24" font-weight="700" text-anchor="middle" fill="${boutique ? "#3f3a33" : "#111827"}"${boutique ? ' letter-spacing="3"' : ""}>${esc(c.title)}</text>`);
  const top = M + titleH;
  p.push(`<rect x="${M}" y="${top}" width="${W}" height="${headH}" fill="${dark || !boutique ? c.accent : "none"}"${boutique ? "" : ' rx="6"'}/>`);
  if (boutique) p.push(`<path d="M${M} ${top}h${W}M${M} ${top + headH}h${W}" stroke="#3f3a33" stroke-width="1.5"/>`);
  let x = M;
  c.headers.forEach((h, i) => { p.push(`<text x="${x + widths[i] / 2}" y="${top + headH / 2 + 5}" font-size="${fs}" font-weight="700" text-anchor="middle" fill="${boutique ? "#3f3a33" : "#ffffff"}">${esc(h)}</text>`); x += widths[i]; });
  c.rows.forEach((r, ri) => {
    const y = top + headH + ri * rowH;
    if (c.hi[ri]) p.push(`<rect x="${M}" y="${y}" width="${W}" height="${rowH}" fill="${c.accent}" fill-opacity="0.16"/>`);
    else if (!boutique && ri % 2 === 1) p.push(`<rect x="${M}" y="${y}" width="${W}" height="${rowH}" fill="${dark ? "#f1f5f9" : "#f8fafc"}"/>`);
    p.push(`<path d="M${M} ${y + rowH}h${W}" stroke="${boutique ? "#d6cfc4" : "#e5e7eb"}" stroke-width="1"/>`);
    let xx = M;
    r.forEach((v, i) => { p.push(`<text x="${xx + widths[i] / 2}" y="${y + rowH / 2 + 5}" font-size="${i ? fs : fs + 1}"${i === 0 || c.hi[ri] ? ' font-weight="700"' : ""} text-anchor="middle" fill="${i === 0 ? (boutique ? "#3f3a33" : c.accent) : "#1f2937"}">${esc(v)}</text>`); xx += widths[i]; });
  });
  if (c.note) p.push(`<text x="${M}" y="${top + headH + rowH * c.rows.length + 26}" font-size="12.5" fill="#6b7280">${esc(c.note)}</text>`);
  const font = ` font-family="${esc(c.family ?? "sans-serif")}"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(totalW)}" height="${Math.ceil(H)}" viewBox="0 0 ${Math.ceil(totalW)} ${Math.ceil(H)}"${font}>${p.join("")}</svg>`;
}

export function chartHtml(c: ChartSpec) {
  const boutique = c.style === "boutique";
  const th = `padding:10px 14px;text-align:center;font-weight:700;${boutique ? "color:#3f3a33;border-top:1.5px solid #3f3a33;border-bottom:1.5px solid #3f3a33" : `background:${c.accent};color:#fff`}`;
  const rows = c.rows.map((r, i) => `<tr style="${c.hi[i] ? `background:${c.accent}29;font-weight:700` : !boutique && i % 2 ? "background:#f8fafc" : ""}">${r.map((v, j) => `<td style="padding:9px 14px;text-align:center;border-bottom:1px solid #e5e7eb${j === 0 ? `;font-weight:700;color:${boutique ? "#3f3a33" : c.accent}` : ""}">${esc(v)}</td>`).join("")}</tr>`).join("\n");
  return `<!-- size chart: paste this <table> into a product page -->\n<div style="font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;max-width:100%;overflow-x:auto">\n${c.title ? `<h3 style="text-align:center;margin:0 0 10px">${esc(c.title)}</h3>\n` : ""}<table style="border-collapse:collapse;margin:0 auto;font-size:14px">\n<thead><tr>${c.headers.map((h) => `<th style="${th}">${esc(h)}</th>`).join("")}</tr></thead>\n<tbody>\n${rows}\n</tbody></table>\n${c.note ? `<p style="color:#6b7280;font-size:12px;text-align:center">${esc(c.note)}</p>\n` : ""}</div>\n`;
}
