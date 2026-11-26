import { rgb, type PDFPage } from "pdf-lib";
import { hexRgb, MM, newPdf, PAGE, type PdfKit } from "./kit/pdf.ts";

export interface CalEvent { date: string; endDate: string; title: string; kind: "event" | "holiday" | "workday"; color: string }
export interface CalOpts { year: number; startMonth: number; months: number; layout: "month" | "year"; weekStart: 0 | 1; page: "A4" | "Letter"; landscape: boolean; title: string; accent: string; weekNumbers: boolean; lang: "zh" | "en" | "both" }

const pad = (n: number) => String(n).padStart(2, "0");
export const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
export const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const dow = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
export function isoWeek(y: number, m: number, d: number) {
  const t = new Date(Date.UTC(y, m - 1, d));
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day + 3);
  const first = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((+t - +first) / 86400000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
}
const MONTH_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WD_ZH = ["日", "一", "二", "三", "四", "五", "六"];
const WD_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** 把多天事件展开到每一天。 */
export function byDay(events: CalEvent[]) {
  const map = new Map<string, CalEvent[]>();
  for (const e of events) {
    const end = e.endDate && e.endDate >= e.date ? e.endDate : e.date;
    for (let d = new Date(`${e.date}T00:00:00Z`); d <= new Date(`${end}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
      const k = d.toISOString().slice(0, 10);
      map.set(k, [...(map.get(k) ?? []), e]);
    }
  }
  return map;
}

export function monthsOf(o: CalOpts) {
  return Array.from({ length: o.months }, (_, i) => { const n = o.startMonth - 1 + i; return { y: o.year + Math.floor(n / 12), m: (n % 12) + 1 }; });
}
/** 一个月的格子：每行 7 天，null 为空格。 */
export function grid(y: number, m: number, weekStart: 0 | 1) {
  const first = (dow(y, m, 1) - weekStart + 7) % 7;
  const cells: (number | null)[] = Array(first).fill(null);
  for (let d = 1; d <= daysIn(y, m); d++) cells.push(d);
  while (cells.length % 7) cells.push(null);
  const rows: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

const RED = "#dc2626", GREY = "#9ca3af";
function monthTitle(y: number, m: number, lang: CalOpts["lang"]) {
  return lang === "en" ? `${MONTH_EN[m - 1]} ${y}` : lang === "zh" ? `${y} 年 ${m} 月` : `${y} 年 ${m} 月  ${MONTH_EN[m - 1]}`;
}
const wdLabel = (i: number, lang: CalOpts["lang"]) => (lang === "en" ? WD_EN[i] : lang === "zh" ? WD_ZH[i] : `${WD_ZH[i]} ${WD_EN[i]}`);

function monthPage(k: PdfKit, page: PDFPage, W: number, H: number, y: number, m: number, days: Map<string, CalEvent[]>, o: CalOpts) {
  const mg = 12 * MM;
  const ac = o.accent;
  k.text(page, monthTitle(y, m, o.lang), mg, H - mg - 18, { size: 24, bold: true, color: ac });
  if (o.title) k.text(page, o.title, W - mg, H - mg - 14, { size: 11, color: "#6b7280", align: "right", maxWidth: W / 2 });
  const rows = grid(y, m, o.weekStart);
  const top = H - mg - 34, bottom = mg;
  const wn = o.weekNumbers ? 8 * MM : 0;
  const cw = (W - 2 * mg - wn) / 7;
  const headH = 16;
  const rh = (top - headH - bottom) / rows.length;
  for (let i = 0; i < 7; i++) {
    const wd = (i + o.weekStart) % 7;
    page.drawRectangle({ x: mg + wn + i * cw, y: top - headH, width: cw, height: headH, color: hexRgb(ac), borderWidth: 0, opacity: wd === 0 || wd === 6 ? 0.75 : 1 });
    k.text(page, wdLabel(wd, o.lang), mg + wn + i * cw + cw / 2, top - headH + 4.5, { size: 8.5, bold: true, color: "#ffffff", align: "center" });
  }
  rows.forEach((row, r) => {
    const yy = top - headH - (r + 1) * rh;
    if (o.weekNumbers) {
      const d = row.find((x) => x !== null)!;
      k.text(page, `W${isoWeek(y, m, d)}`, mg + wn / 2, yy + rh - 12, { size: 7, color: GREY, align: "center" });
    }
    row.forEach((d, c) => {
      const x = mg + wn + c * cw;
      const wd = (c + o.weekStart) % 7;
      const key = d ? iso(y, m, d) : "";
      const evs = d ? days.get(key) ?? [] : [];
      const hol = evs.find((e) => e.kind === "holiday");
      const work = evs.find((e) => e.kind === "workday");
      const weekend = wd === 0 || wd === 6;
      page.drawRectangle({ x, y: yy, width: cw, height: rh, color: !d ? rgb(0.97, 0.97, 0.97) : hol ? rgb(1, 0.95, 0.95) : weekend && !work ? rgb(0.985, 0.985, 0.99) : rgb(1, 1, 1), borderColor: rgb(0.85, 0.86, 0.88), borderWidth: 0.5 });
      if (!d) return;
      const numColor = hol || (weekend && !work) ? RED : "#111827";
      k.text(page, String(d), x + 5, yy + rh - 15, { size: 13, bold: true, color: numColor });
      if (hol || work) {
        const tag = hol ? (o.lang === "en" ? "Off" : "休") : o.lang === "en" ? "Work" : "班";
        const tw = k.width(tag, 7) + 6;
        page.drawRectangle({ x: x + cw - tw - 4, y: yy + rh - 14, width: tw, height: 10, color: hexRgb(hol ? RED : "#4b5563"), borderWidth: 0 });
        k.text(page, tag, x + cw - tw - 1, yy + rh - 11.5, { size: 7, color: "#ffffff" });
      }
      let ly = yy + rh - 27;
      const lineH = 9.5;
      const max = Math.max(0, Math.floor((rh - 30) / lineH));
      const shown = evs.filter((e) => e.kind !== "workday" || e.title);
      shown.slice(0, shown.length > max ? max - 1 : max).forEach((e) => {
        const col = e.kind === "holiday" ? RED : e.kind === "workday" ? "#4b5563" : e.color || ac;
        page.drawCircle({ x: x + 6, y: ly + 2.6, size: 1.8, color: hexRgb(col) });
        k.text(page, e.title, x + 10, ly, { size: 7, color: e.kind === "holiday" ? RED : "#1f2937", maxWidth: cw - 14 });
        ly -= lineH;
      });
      if (shown.length > max && max > 0) k.text(page, `+${shown.length - max + 1}`, x + 10, ly, { size: 7, color: GREY });
    });
  });
}

function yearPage(k: PdfKit, page: PDFPage, W: number, H: number, list: { y: number; m: number }[], days: Map<string, CalEvent[]>, o: CalOpts, events: CalEvent[]) {
  const mg = 10 * MM;
  const ac = o.accent;
  const head = o.title || (list[0].y === list[list.length - 1].y ? String(list[0].y) : `${list[0].y}–${list[list.length - 1].y}`);
  k.text(page, head, W / 2, H - mg - 22, { size: 26, bold: true, color: ac, align: "center" });
  const cols = o.landscape ? 4 : 3, rowsN = Math.ceil(list.length / cols);
  const listH = 26 * MM;
  const top = H - mg - 34, bottom = mg + listH;
  const gw = (W - 2 * mg) / cols, gh = (top - bottom) / rowsN;
  list.forEach(({ y, m }, i) => {
    const gx = mg + (i % cols) * gw, gy = top - Math.floor(i / cols) * gh;
    const pw = gw - 6 * MM, cw = pw / 7;
    const x0 = gx + 3 * MM;
    k.text(page, o.lang === "en" ? MONTH_EN[m - 1] : `${m} 月${o.lang === "both" ? ` ${MONTH_EN[m - 1]}` : ""}`, x0, gy - 12, { size: 11, bold: true, color: ac });
    for (let c = 0; c < 7; c++) { const wd = (c + o.weekStart) % 7; k.text(page, o.lang === "en" ? WD_EN[wd][0] : WD_ZH[wd], x0 + c * cw + cw / 2, gy - 25, { size: 6.5, color: wd === 0 || wd === 6 ? RED : "#6b7280", align: "center" }); }
    const rows = grid(y, m, o.weekStart);
    const rh = Math.min(18, (gh - 36) / 6);
    rows.forEach((row, r) => row.forEach((d, c) => {
      if (!d) return;
      const wd = (c + o.weekStart) % 7;
      const evs = days.get(iso(y, m, d)) ?? [];
      const hol = evs.some((e) => e.kind === "holiday"), work = evs.some((e) => e.kind === "workday"), ev = evs.find((e) => e.kind === "event");
      const cx = x0 + c * cw + cw / 2, cy = gy - 36 - r * rh;
      if (hol) page.drawRectangle({ x: cx - cw / 2 + 0.6, y: cy - 2.5, width: cw - 1.2, height: rh - 2, color: rgb(1, 0.9, 0.9), borderWidth: 0 });
      k.text(page, String(d), cx, cy, { size: Math.min(9, rh * 0.62), color: hol || (wd % 6 === 0 && !work) ? RED : "#111827", align: "center", bold: !!ev || hol });
      if (ev) page.drawCircle({ x: cx, y: cy - 2.6, size: 0.9, color: hexRgb(ev.color || ac) });
    }));
  });
  // 底部列表
  const items = [...events].filter((e) => e.kind !== "workday").sort((a, b) => a.date.localeCompare(b.date));
  const colsL = 3, per = Math.max(1, Math.floor((listH - 6) / 9));
  const lw = (W - 2 * mg) / colsL;
  page.drawLine({ start: { x: mg, y: bottom - 2 }, end: { x: W - mg, y: bottom - 2 }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) });
  items.slice(0, per * colsL).forEach((e, i) => {
    const x = mg + Math.floor(i / per) * lw, yy = bottom - 12 - (i % per) * 9;
    const d = `${Number(e.date.slice(5, 7))}/${Number(e.date.slice(8))}${e.endDate && e.endDate > e.date ? `–${Number(e.endDate.slice(5, 7))}/${Number(e.endDate.slice(8))}` : ""}`;
    page.drawCircle({ x: x + 2, y: yy + 2.5, size: 1.6, color: hexRgb(e.kind === "holiday" ? RED : e.color || ac) });
    k.text(page, d, x + 6, yy, { size: 7, bold: true, color: "#374151" });
    const dx = Math.max(34, k.width(d, 7, true) + 10);
    k.text(page, e.title, x + 6 + dx, yy, { size: 7, color: e.kind === "holiday" ? RED : "#374151", maxWidth: lw - 10 - dx });
  });
  if (items.length > per * colsL) k.text(page, `+${items.length - per * colsL}`, W - mg, mg - 2, { size: 7, color: GREY, align: "right" });
}

export async function calendarPdf(events: CalEvent[], o: CalOpts, fontPath?: string): Promise<Uint8Array> {
  const k = await newPdf(fontPath);
  const [pw, ph] = PAGE[o.page];
  const [W, H] = o.landscape ? [ph, pw] : [pw, ph];
  const days = byDay(events);
  const list = monthsOf(o);
  k.doc.setTitle(o.title || `${o.year} calendar`);
  if (o.layout === "year") {
    for (let i = 0; i < list.length; i += 12) yearPage(k, k.doc.addPage([W, H]), W, H, list.slice(i, i + 12), days, o, events.filter((e) => list.slice(i, i + 12).some(({ y, m }) => e.date.startsWith(`${y}-${pad(m)}`) || (e.endDate && e.endDate.startsWith(`${y}-${pad(m)}`)))));
  } else for (const { y, m } of list) monthPage(k, k.doc.addPage([W, H]), W, H, y, m, days, o);
  return k.doc.save();
}
