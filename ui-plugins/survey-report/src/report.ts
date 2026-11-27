// 图表（SVG）、HTML 报告与 PDF 绘制
import { PAGE, hexRgb, type PdfKit } from "./kit/pdf.ts";
import type { PDFPage } from "pdf-lib";
import type { Cross, QResult } from "./survey.ts";

export const PALETTE = ["#2563eb", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#64748b", "#14b8a6", "#a855f7"];
export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface Section { no: string; label: string; chart: "bar" | "pie" | "none"; res: QResult; cross?: Cross }

export function npsColor(i: number) { return i <= 6 ? "#ef4444" : i <= 8 ? "#f59e0b" : "#10b981"; }

export function barSvg(sec: Section, width = 520): string {
  const opts = sec.res.options;
  if (!opts.length) return "";
  const lw = 150, bh = 18, gap = 6, h = opts.length * (bh + gap) + 4, max = Math.max(...opts.map((o) => o.pct), 1);
  const bw = width - lw - 90;
  const bars = opts.map((o, i) => {
    const y = i * (bh + gap) + 2, w = Math.max(1, (o.pct / max) * bw);
    const color = sec.res.type === "nps" ? npsColor(Number(o.label)) : PALETTE[sec.res.type === "rating" || sec.res.type === "number" ? 0 : i % PALETTE.length];
    const lab = o.label.length > 14 ? o.label.slice(0, 13) + "…" : o.label;
    return `<text x="${lw - 6}" y="${y + 13}" text-anchor="end" font-size="11" fill="#374151">${esc(lab)}</text><rect x="${lw}" y="${y}" width="${w.toFixed(1)}" height="${bh}" rx="3" fill="${color}"/><text x="${lw + w + 6}" y="${y + 13}" font-size="11" fill="#111827">${o.count} · ${o.pct}%</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}" font-family="sans-serif">${bars}</svg>`;
}

export function pieArcs(opts: { pct: number }[], cx: number, cy: number, r: number) {
  const total = opts.reduce((a, o) => a + o.pct, 0) || 1;
  let a0 = -Math.PI / 2;
  return opts.map((o, i) => {
    const a1 = a0 + (o.pct / total) * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (a: number) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
    const d = o.pct / total >= 0.9999 ? `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy} Z` : `M ${cx} ${cy} L ${p(a0)} A ${r} ${r} 0 ${large} 1 ${p(a1)} Z`;
    a0 = a1;
    return { d, color: PALETTE[i % PALETTE.length] };
  });
}

export function pieSvg(sec: Section): string {
  const opts = sec.res.options.filter((o) => o.count > 0);
  if (!opts.length) return "";
  const h = Math.max(150, opts.length * 20 + 10);
  const arcs = pieArcs(opts, 75, 75, 68).map((a) => `<path d="${a.d}" fill="${a.color}" stroke="#fff" stroke-width="1"/>`).join("");
  const legend = opts.map((o, i) => `<rect x="170" y="${i * 20 + 8}" width="12" height="12" rx="2" fill="${PALETTE[i % PALETTE.length]}"/><text x="188" y="${i * 20 + 18}" font-size="11" fill="#374151">${esc(o.label)} — ${o.count} · ${o.pct}%</text>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="${h}" viewBox="0 0 520 ${h}" font-family="sans-serif">${arcs}${legend}</svg>`;
}

export function headline(r: QResult, cur = ""): string {
  void cur;
  switch (r.type) {
    case "nps": return r.nps ? `NPS ${r.nps.score > 0 ? "+" : ""}${r.nps.score} · 推荐者 ${r.nps.promoters}% · 中立 ${r.nps.passives}% · 贬损者 ${r.nps.detractors}%` : "";
    case "rating": return `平均 Mean ${r.mean} / ${r.scale?.[1]} · 高分占比 Top box ${r.topBox}%`;
    case "number": return r.answered ? `平均 Mean ${r.mean} · 中位数 Median ${r.median} · ${r.min}–${r.max}` : "";
    case "multi": return `${r.mentions} 次选择 mentions · 每人平均 ${r.answered ? Math.round(((r.mentions ?? 0) / r.answered) * 10) / 10 : 0} 项`;
    case "single": return r.options[0] ? `最多 Top: ${r.options[0].label} (${r.options[0].pct}%)` : "";
    case "text": return `${r.answered} 条文字回答 text answers`;
    default: return "";
  }
}

function crossHtml(c: Cross, by: string): string {
  const head = `<tr><th></th>${c.groups.map((g) => `<th>${esc(g.label)}<br><span class="muted">n=${g.n}</span></th>`).join("")}</tr>`;
  const body = c.rows.map((r) => `<tr><th>${esc(r.label)}</th>${r.cells.map((x) => `<td>${x.value !== undefined ? esc(x.value) : `${x.count !== undefined ? `${x.count} · ` : ""}${x.pct}%`}</td>`).join("")}</tr>`).join("");
  return `<p class="muted">按“${esc(by)}”交叉 Cross-tab by ${esc(by)}</p><table class="x">${head}${body}</table>`;
}

export function chartSvg(sec: Section) { return sec.chart === "none" ? "" : sec.chart === "pie" && (sec.res.type === "single" || sec.res.type === "multi") ? pieSvg(sec) : barSvg(sec); }

export function reportHtml(o: { title: string; responses: number; sections: Section[]; crossBy?: string; maxText: number; generated: string }): string {
  const secs = o.sections.map((s) => {
    const texts = s.res.texts ?? [];
    return `<section><h2><span class="no">${esc(s.no)}</span> ${esc(s.label)}</h2><p class="muted">${s.res.answered} / ${o.responses} 人回答 answered${s.res.type === "multi" ? " · 多选 multiple choice" : ""} · ${esc(headline(s.res))}</p>${chartSvg(s)}${texts.length ? `<ul class="texts">${texts.slice(0, o.maxText).map((t) => `<li>${esc(t)}</li>`).join("")}</ul>${texts.length > o.maxText ? `<p class="muted">… 另有 ${texts.length - o.maxText} 条，见 results.xlsx / ${texts.length - o.maxText} more in results.xlsx</p>` : ""}` : ""}${s.cross && o.crossBy ? crossHtml(s.cross, o.crossBy) : ""}</section>`;
  }).join("\n");
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(o.title)}</title><style>
body{font-family:-apple-system,"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif;max-width:820px;margin:32px auto;padding:0 20px;color:#111827}
h1{font-size:24px;margin:0 0 4px}h2{font-size:16px;margin:0 0 4px}.no{color:#2563eb}.muted{color:#6b7280;font-size:12px;margin:2px 0 10px}
section{border-top:1px solid #e5e7eb;padding:18px 0}svg{max-width:100%;height:auto}ul.texts{font-size:13px;padding-left:18px;margin:6px 0}ul.texts li{margin:3px 0}
table.x{border-collapse:collapse;font-size:12px;margin-top:6px}table.x th,table.x td{border:1px solid #e5e7eb;padding:4px 8px;text-align:right}table.x th:first-child{text-align:left}
footer{color:#9ca3af;font-size:11px;margin-top:24px}</style></head><body>
<h1>${esc(o.title)}</h1><p class="muted">${o.responses} 份回答 responses · ${o.sections.length} 题 questions · ${esc(o.generated)}</p>
${secs}
<footer>Made with Survey Report (Penova)</footer></body></html>`;
}

/** 在 PDF 上画报告；返回页数。 */
export function drawReport(k: PdfKit, o: { title: string; responses: number; sections: Section[]; crossBy?: string; maxText: number; generated: string }): number {
  const [W, H] = PAGE.A4, m = 44;
  let page: PDFPage = k.doc.addPage(PAGE.A4), y = H - m, pages = 1;
  const need = (h: number) => { if (y - h < m) { page = k.doc.addPage(PAGE.A4); pages++; y = H - m; } };
  k.text(page, o.title, m, y - 18, { size: 18, bold: true, maxWidth: W - 2 * m });
  y -= 36;
  k.text(page, `${o.responses} 份回答 responses · ${o.sections.length} 题 questions · ${o.generated}`, m, y, { size: 9, color: "#6b7280" });
  y -= 22;
  for (const s of o.sections) {
    const opts = s.res.options;
    const pie = s.chart === "pie" && (s.res.type === "single" || s.res.type === "multi");
    const chartH = s.chart === "none" ? 0 : pie ? Math.max(120, opts.length * 16 + 10) : opts.length * 17 + 4;
    need(44 + Math.min(chartH, 300));
    page.drawLine({ start: { x: m, y: y + 6 }, end: { x: W - m, y: y + 6 }, thickness: 0.5, color: hexRgb("#e5e7eb") });
    k.text(page, `${s.no}  ${s.label}`, m, y - 8, { size: 11.5, bold: true, maxWidth: W - 2 * m });
    k.text(page, `${s.res.answered} / ${o.responses} 人回答 · ${headline(s.res)}`, m, y - 22, { size: 8.5, color: "#6b7280", maxWidth: W - 2 * m });
    y -= 36;
    if (s.chart !== "none" && opts.length) {
      if (pie) {
        const shown = opts.filter((x) => x.count > 0);
        const r = 52, cx = m + 60, cy = y - 58;
        for (const a of pieArcs(shown, 0, 0, r)) page.drawSvgPath(a.d, { x: cx, y: cy, color: hexRgb(a.color), borderColor: hexRgb("#ffffff"), borderWidth: 0.8 });
        shown.forEach((x, i) => {
          const ly = y - 10 - i * 16;
          page.drawRectangle({ x: m + 140, y: ly - 1, width: 9, height: 9, color: hexRgb(PALETTE[i % PALETTE.length]) });
          k.text(page, `${x.label} — ${x.count} · ${x.pct}%`, m + 154, ly, { size: 9, maxWidth: W - m - 160 - m });
        });
        y -= chartH;
      } else {
        const lw = 140, bw = W - 2 * m - lw - 70, max = Math.max(...opts.map((x) => x.pct), 1);
        opts.forEach((x, i) => {
          need(17);
          const color = s.res.type === "nps" ? npsColor(Number(x.label)) : PALETTE[s.res.type === "rating" || s.res.type === "number" ? 0 : i % PALETTE.length];
          k.text(page, x.label, m + lw - 6, y - 10, { size: 9, align: "right", maxWidth: lw - 10, color: "#374151" });
          const w = Math.max(1, (x.pct / max) * bw);
          page.drawRectangle({ x: m + lw, y: y - 13, width: w, height: 12, color: hexRgb(color) });
          k.text(page, `${x.count} · ${x.pct}%`, m + lw + w + 5, y - 10, { size: 8.5 });
          y -= 17;
        });
      }
      y -= 6;
    }
    const texts = (s.res.texts ?? []).slice(0, o.maxText);
    for (const t of texts) {
      for (const [j, line] of k.wrap(t, 9, W - 2 * m - 14).entries()) { need(13); k.text(page, (j ? "   " : "• ") + line, m + 4, y - 9, { size: 9, color: "#374151" }); y -= 13; }
    }
    if ((s.res.texts?.length ?? 0) > o.maxText) { need(13); k.text(page, `… 另有 ${s.res.texts!.length - o.maxText} 条 more in results.xlsx`, m + 4, y - 9, { size: 8.5, color: "#6b7280" }); y -= 13; }
    if (s.cross && o.crossBy) {
      const c = s.cross, cols = c.groups.length, lw = 150, cw = Math.min(80, (W - 2 * m - lw) / Math.max(1, cols));
      need(30 + c.rows.length * 14);
      k.text(page, `按“${o.crossBy}”交叉 Cross-tab`, m, y - 9, { size: 8.5, color: "#6b7280" });
      y -= 14;
      c.groups.forEach((g, i) => k.text(page, `${g.label} (n=${g.n})`, m + lw + (i + 1) * cw - 4, y - 9, { size: 8, bold: true, align: "right", maxWidth: cw - 6 }));
      y -= 14;
      for (const r of c.rows) {
        need(14);
        k.text(page, r.label, m, y - 9, { size: 8.5, maxWidth: lw - 6 });
        r.cells.forEach((x, i) => k.text(page, x.value !== undefined ? String(x.value) : `${x.pct}%`, m + lw + (i + 1) * cw - 4, y - 9, { size: 8.5, align: "right" }));
        y -= 14;
      }
    }
    y -= 12;
  }
  return pages;
}
