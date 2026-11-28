import { createHash } from "node:crypto";
import { createApp, esc, type AppDef, type Column, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { mapHeaders } from "./kit/columns.ts";
import { hexRgb, newPdf, PAGE } from "./kit/pdf.ts";
import { writeXlsx } from "./kit/sheet.ts";
import { readTable } from "./kit/table.ts";
import { KitError } from "./kit/workspace.ts";
import { addDays, daysBetween, fmtDur, fmtOffset, hhmm, KIND_ZH, kindOf, localToUtc, offsetAt, parseDate, parseTime, parseTz, utcToLocal, weekday, type Kind, type Tz } from "./trip.ts";
import { s, yes } from "./util.ts";

export const NAME = "travel-itinerary";
export const VERSION = "0.1.0";

const HEAD = {
  date: ["日期", "出发日期", "入住日期", "date", "day"],
  start: ["开始", "开始时间", "出发时间", "起飞", "起飞时间", "时间", "入住时间", "start", "depart", "departure", "time", "from time"],
  end: ["结束", "结束时间", "到达时间", "降落", "到达", "退房时间", "end", "arrive", "arrival", "to time"],
  endDate: ["结束日期", "到达日期", "退房日期", "离店日期", "退房", "end date", "checkout", "check-out"],
  tz: ["时区", "出发时区", "timezone", "time zone", "tz"],
  endTz: ["到达时区", "结束时区", "arrival tz", "arrival timezone", "end tz"],
  kind: ["类型", "类别", "种类", "kind", "type", "category"],
  title: ["事项", "安排", "行程", "标题", "内容", "名称", "title", "item", "activity", "what"],
  place: ["地点", "地方", "出发地", "place", "location", "where", "city"],
  address: ["地址", "address"],
  ref: ["预订号", "订单号", "确认号", "预约号", "booking", "booking ref", "ref", "confirmation", "pnr"],
  note: ["备注", "说明", "note", "notes"],
};

interface Item {
  i: number; r: Row; kind: Kind; date: string | null; tz: Tz | null; endTz: Tz | null; tzLabel: string;
  start?: { min: number; plus: number } | null; end?: { min: number; plus: number } | null; endDate: string | null;
  su?: number; eu?: number; nights: number; ok: boolean;
}

const KIND_OPTS = ["航班", "火车", "交通", "住宿", "游玩", "用餐", "其他"];

function analyse(p: Project) {
  const issues: Issue[] = [], items: Item[] = [];
  const home = parseTz(s(p.settings.homeTz) || "Asia/Shanghai");
  if (!home) issues.push({ level: "error", message: `Home time zone “${s(p.settings.homeTz)}” isn't a known time zone — use e.g. Asia/Shanghai or UTC+8.` });
  let lastTz: Tz | null = home, lastLabel = s(p.settings.homeTz) || "Asia/Shanghai";
  let year: number | undefined;
  let pending: { i: number; name: string; tz: Tz; label: string; at: number } | null = null;
  p.rows.forEach((r, i) => {
    if (r.include === false) return;
    const kind = kindOf(s(r.kind), s(r.title));
    const name = s(r.title) || `row ${i}`;
    const date = parseDate(r.date, year);
    if (date) year = +date.slice(0, 4);
    if (!date) issues.push({ level: "error", row: i, key: "date", message: s(r.date) ? `#${i} ${name}: can't read the date “${s(r.date)}” — write it like 2026-12-18.` : `#${i} ${name}: no date.` });
    let tz: Tz | null = lastTz, tzLabel = lastLabel;
    if (s(r.tz)) {
      const nt = parseTz(s(r.tz));
      if (pending && nt && date && offsetAt(nt, Date.parse(`${date}T12:00:00Z`)) !== offsetAt(pending.tz, Date.parse(`${date}T12:00:00Z`)))
        issues.push({ level: "warn", row: pending.i, key: "endTz", message: `#${pending.i} ${pending.name} has no arrival time zone (到达时区), so it and the rows after it use ${pending.label}, but #${i} ${name} is in ${s(r.tz)} — set 到达时区 on #${pending.i} so the arrival and the days after are in local time.` });
      pending = null;
    }
    if (s(r.tz)) { tz = parseTz(s(r.tz)); tzLabel = s(r.tz); if (!tz) issues.push({ level: "error", row: i, key: "tz", message: `#${i} ${name}: unknown time zone “${s(r.tz)}” — use e.g. Asia/Tokyo, UTC+9 or a city like 东京.` }); }
    let endTz = tz;
    if (s(r.endTz)) { endTz = parseTz(s(r.endTz)); if (!endTz) issues.push({ level: "error", row: i, key: "endTz", message: `#${i} ${name}: unknown arrival time zone “${s(r.endTz)}”.` }); }
    const start = parseTime(r.start), end = parseTime(r.end);
    if (start === null) issues.push({ level: "error", row: i, key: "start", message: `#${i} ${name}: can't read the start time “${s(r.start)}” — write it like 08:55.` });
    if (end === null) issues.push({ level: "error", row: i, key: "end", message: `#${i} ${name}: can't read the end time “${s(r.end)}” — write it like 12:50 (add +1 if it's the next day).` });
    let endDate = s(r.endDate) ? parseDate(r.endDate, year) : null;
    if (s(r.endDate) && !endDate) issues.push({ level: "error", row: i, key: "endDate", message: `#${i} ${name}: can't read the end date “${s(r.endDate)}”.` });
    if (!endDate && date) endDate = addDays(date, end?.plus ?? 0);
    const it: Item = { i, r, kind, date, tz, endTz, tzLabel, start, end, endDate, nights: 0, ok: false };
    if (date && tz && endTz && start !== null && end !== null) {
      it.ok = true;
      if (kind === "hotel") {
        const ci = start?.min ?? 15 * 60, co = end?.min ?? 11 * 60;
        if (!s(r.endDate)) { issues.push({ level: "error", row: i, key: "endDate", message: `#${i} ${name}: a stay needs a check-out date (结束日期).` }); it.ok = false; }
        else {
          it.nights = daysBetween(date, endDate!);
          if (it.nights <= 0) { issues.push({ level: "error", row: i, key: "endDate", message: `#${i} ${name}: check-out ${endDate} isn't after check-in ${date}.` }); it.ok = false; }
          it.su = localToUtc(date, ci, tz); it.eu = localToUtc(endDate!, co, endTz);
        }
      } else if (start) {
        it.su = localToUtc(addDays(date, start.plus), start.min, tz);
        if (end) {
          it.eu = localToUtc(endDate!, end.min, endTz);
          const dur = Math.round((it.eu - it.su) / 60000);
          if (dur < 0) {
            issues.push({ level: "error", row: i, key: kind === "flight" || kind === "train" ? "endTz" : "end", message: kind === "flight" || kind === "train"
              ? `#${i} ${name}: arrives ${hhmm(end.min)} ${fmtOffset(offsetAt(endTz, it.eu))} before it departs ${hhmm(start.min)} ${fmtOffset(offsetAt(tz, it.su))} (${fmtDur(dur)}) — check the arrival time zone (到达时区) or write +1 for a next-day arrival.`
              : `#${i} ${name}: ends ${hhmm(end.min)} before it starts ${hhmm(start.min)} — write +1 if it ends the next day.` });
            it.ok = false;
          } else if ((kind === "flight" && dur > 20 * 60) || (kind !== "flight" && dur > 16 * 60)) issues.push({ level: "warn", row: i, message: `#${i} ${name} lasts ${fmtDur(dur)} — check the times, dates and time zones.` });
        } else if (kind === "flight" || kind === "train") issues.push({ level: "warn", row: i, key: "end", message: `#${i} ${name}: no arrival time, so the next stop can't be checked against it.` });
      } else if (kind === "flight" || kind === "train") issues.push({ level: "error", row: i, key: "start", message: `#${i} ${name}: a ${kind === "flight" ? "flight" : "train"} needs a departure time.` });
      if (yes(p.settings.requireRef ?? true) && (kind === "flight" || kind === "hotel" || kind === "train") && !s(r.ref)) issues.push({ level: "warn", row: i, key: "ref", message: `#${i} ${name}: no booking reference (预订号) — add it so it's on the printout.` });
    }
    if ((kind === "flight" || kind === "train") && !s(r.endTz) && tz) pending = { i, name, tz, label: tzLabel, at: i };
    else if (s(r.endTz)) pending = null;
    lastTz = endTz ?? tz ?? lastTz; lastLabel = s(r.endTz) || tzLabel;
    items.push(it);
  });

  // 时间先后：重叠、换乘时间
  const timed = items.filter((x) => x.ok && x.su !== undefined && x.kind !== "hotel").sort((a, b) => a.su! - b.su!);
  const buf = Number(p.settings.buffer ?? 30), air = Number(p.settings.airport ?? 120);
  for (let k = 1; k < timed.length; k++) {
    const a = timed[k - 1], b = timed[k], aEnd = a.eu ?? a.su!;
    const gap = Math.round((b.su! - aEnd) / 60000), an = s(a.r.title), bn = s(b.r.title);
    if (gap < 0 && a.eu !== undefined) issues.push({ level: "warn", row: b.i, key: "start", message: `#${b.i} ${bn} (${hhmm(utcToLocal(b.su!, b.tz!).min)}) overlaps #${a.i} ${an} (until ${hhmm(utcToLocal(aEnd, a.endTz!).min)}) by ${fmtDur(-gap)}.` });
    else if (b.kind === "flight" && a.eu !== undefined && gap < air) issues.push({ level: "warn", row: b.i, key: "start", message: `#${b.i} ${bn}: only ${fmtDur(gap)} between the end of #${a.i} ${an} and departure — you wanted ${air} min to get to the airport and check in.` });
    else if (gap >= 0 && gap < buf && a.eu !== undefined && s(a.r.place) && s(b.r.place) && s(a.r.place) !== s(b.r.place)) issues.push({ level: "info", row: b.i, key: "start", message: `#${b.i} ${bn}: ${gap} min to get from ${s(a.r.place)} to ${s(b.r.place)} after #${a.i} ${an}.` });
  }
  // 每晚住哪儿
  const dated = items.filter((x) => x.date);
  const first = dated.map((x) => x.date!).sort()[0], last = dated.map((x) => (x.endDate && x.endDate > x.date! ? x.endDate : x.date!)).sort().at(-1);
  const nights: { date: string; where: string[] }[] = [];
  if (first && last) for (let d = first; d < last; d = addDays(d, 1)) {
    const stays = items.filter((x) => x.ok && x.kind === "hotel" && x.date! <= d && d < x.endDate!);
    const moving = items.some((x) => x.ok && x.kind !== "hotel" && x.su !== undefined && x.eu !== undefined && utcToLocal(x.su, x.tz!).date <= d && utcToLocal(x.eu, x.endTz!).date > d);
    nights.push({ date: d, where: stays.map((x) => s(x.r.title)) });
    if (stays.length > 1) issues.push({ level: "warn", row: stays[1].i, key: "date", message: `Two places booked for the night of ${d} (${weekday(d)}): ${stays.map((x) => `#${x.i} ${s(x.r.title)}`).join(" and ")} — check the check-in / check-out dates.` });
    if (!stays.length && !moving) issues.push({ level: "warn", message: `Nowhere to stay on the night of ${d} (${weekday(d)}) — add a stay or check the check-in / check-out dates.` });
  }
  return { items, issues, first, last, nights, home };
}

const dayOf = (x: Item) => (x.su !== undefined && x.tz ? utcToLocal(x.su, x.tz).date : x.date ?? "");
const span = (x: Item) => {
  if (x.kind === "hotel") return `${x.start ? `入住 ${hhmm(x.start.min)}` : "入住"} · ${x.nights} 晚 · 退房 ${x.endDate}${x.end ? ` ${hhmm(x.end.min)}` : ""}`;
  if (!x.start) return "全天";
  const a = hhmm(x.start.min), b = x.end ? hhmm(x.end.min) : "";
  const tzA = x.su !== undefined && x.tz ? fmtOffset(offsetAt(x.tz, x.su)) : "", tzB = x.eu !== undefined && x.endTz ? fmtOffset(offsetAt(x.endTz, x.eu)) : tzA;
  const plus = x.eu !== undefined && x.su !== undefined && x.endDate && x.date && x.endDate > dayOf(x) ? ` (+${daysBetween(dayOf(x), x.endDate)})` : "";
  return b ? (tzA !== tzB ? `${a} ${tzA} → ${b} ${tzB}${plus}` : `${a}–${b}${plus}`) : a;
};
const dayLabel = (first: string, d: string) => `第 ${daysBetween(first, d) + 1} 天 · ${d.slice(5).replace("-", "/")} ${weekday(d)}`;
const sorted = (items: Item[]) => [...items].sort((a, b) => (dayOf(a) < dayOf(b) ? -1 : dayOf(a) > dayOf(b) ? 1 : (a.su ?? Infinity) - (b.su ?? Infinity) || a.i - b.i));

function makeDef(): AppDef {
  return {
    name: NAME,
    version: VERSION,
    prefix: "trip",
    title: ["行程单制作", "Travel Itinerary"],
    openDescription:
      "Turn a trip plan sheet into a printable day-by-day itinerary, a calendar file and a bookings list. Pick a .xlsx/.csv (or a folder) with one row per item: 日期/date, 开始/start and 结束/end (local times like 08:55; “+1” or 次日 for next day), 结束日期/end date (check-out date for stays, arrival date for overnight travel), 时区/timezone (IANA like Asia/Tokyo, UTC+9, or a city like 东京; blank = same as the previous row, the first row uses the home time zone), 到达时区 (arrival time zone for flights/trains), 类型/kind (航班 flight, 火车 train, 交通 transfer, 住宿 stay, 游玩 activity, 用餐 meal, 其他), 事项/title, 地点/place, 地址/address, 预订号/booking ref, 备注/note. Settings: title, travellers, homeTz (default Asia/Shanghai; used for “home time” and rows without a time zone), buffer (min minutes between items at different places, default 30), airport (minutes needed before a flight, default 120), alarm (calendar reminder minutes before flights/trains, default 180), requireRef (warn when flights, trains and stays have no booking ref). Every time is converted through its own time zone, so a flight 08:55 Asia/Shanghai → 12:50 Asia/Tokyo is 2h55. Checks: unreadable dates/times, unknown time zones, arrivals before departures (usually a wrong arrival time zone or a missing +1), items that end before they start, overlapping items, too little time before a flight or between places, nights with nowhere to stay and nights booked twice, stays without a check-out date, missing booking refs, implausibly long items. Rows: set include=false to leave one out; add rows with add. Exports itinerary.pdf (day-by-day printout with local times, time zones, addresses and booking refs, plus a bookings page), itinerary.ics (calendar: timed items in UTC, stays as all-day spans, reminders for flights/trains) and itinerary.xlsx (sorted itinerary with home time, nights, bookings).",
    inputs: { exts: [".xlsx", ".csv"], min: 1, max: 1, folders: true, label: ["选择行程表", "Pick the trip plan"] },
    settings: [
      { key: "title", label: ["行程名称", "Trip title"], type: "text", default: "" },
      { key: "travellers", label: ["出行人", "Travellers"], type: "text", default: "" },
      { key: "homeTz", label: ["家里的时区", "Home time zone"], type: "text", default: "Asia/Shanghai" },
      { key: "buffer", label: ["换地点至少留（分钟）", "Min minutes between places"], type: "number", default: 30, min: 0, max: 600 },
      { key: "airport", label: ["航班前至少留（分钟）", "Minutes before a flight"], type: "number", default: 120, min: 0, max: 600 },
      { key: "alarm", label: ["日历提醒提前（分钟）", "Calendar reminder (min)"], type: "number", default: 180, min: 0, max: 2880 },
      { key: "requireRef", label: ["航班/火车/住宿要有预订号", "Require booking refs"], type: "bool", default: true },
    ],
    columns: () => [
      { key: "include", label: ["保留", "Keep"], type: "bool" },
      { key: "_day", label: ["第几天", "Day"], readOnly: true },
      { key: "date", label: ["日期", "Date"] },
      { key: "start", label: ["开始", "Start"] },
      { key: "end", label: ["结束", "End"] },
      { key: "endDate", label: ["结束日期", "End date"] },
      { key: "tz", label: ["时区", "Time zone"] },
      { key: "endTz", label: ["到达时区", "Arrival tz"] },
      { key: "kind", label: ["类型", "Kind"], type: "select", options: KIND_OPTS },
      { key: "title", label: ["事项", "Item"], wide: true },
      { key: "place", label: ["地点", "Place"] },
      { key: "address", label: ["地址", "Address"], wide: true },
      { key: "ref", label: ["预订号", "Booking ref"] },
      { key: "_dur", label: ["时长", "Duration"], readOnly: true },
      { key: "_home", label: ["家里时间", "Home time"], readOnly: true },
      { key: "note", label: ["备注", "Note"], wide: true },
    ] as Column[],
    newRow: () => ({ include: true, date: "", start: "", end: "", endDate: "", tz: "", endTz: "", kind: "游玩", title: "", place: "", address: "", ref: "", note: "" }),
    async load({ ws, files }) {
      let file = files[0];
      if (!/\.(xlsx|csv)$/i.test(file)) {
        const list = (await ws.list({ dir: file, exts: [".xlsx", ".csv"], limit: 20 })).map((x) => x.path).filter((f) => !f.startsWith(NAME + "/"));
        if (!list.length) throw new KitError("no_plan", "No .xlsx/.csv trip plan in that folder.");
        file = list[0];
      }
      const t = await readTable(ws, file);
      const h = mapHeaders(t.columns, HEAD);
      if (!h.date || !h.title) throw new KitError("bad_plan", `The trip plan needs at least a 日期/date and a 事项/title column (found: ${t.columns.join(", ")}).`);
      const g = (r: Record<string, unknown>, k: keyof typeof HEAD) => (h[k] ? r[h[k]!] : "");
      const str = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : s(v));
      const tm = (v: unknown) => (v instanceof Date ? `${String(v.getUTCHours()).padStart(2, "0")}:${String(v.getUTCMinutes()).padStart(2, "0")}` : s(v));
      const rows = t.rows.filter((r) => s(g(r, "title")) || s(g(r, "date"))).map((r) => ({
        include: true, date: str(g(r, "date")), start: tm(g(r, "start")), end: tm(g(r, "end")), endDate: str(g(r, "endDate")), tz: s(g(r, "tz")), endTz: s(g(r, "endTz")),
        kind: s(g(r, "kind")) || KIND_ZH[kindOf("", s(g(r, "title")))], title: s(g(r, "title")), place: s(g(r, "place")), address: s(g(r, "address")), ref: s(g(r, "ref")), note: s(g(r, "note")),
      }));
      if (!rows.length) throw new KitError("empty_plan", "The trip plan has no rows.");
      return { rows, meta: { file } };
    },
    compute(p): Computed {
      const { items, issues, first, last, nights, home } = analyse(p);
      const byI = new Map(items.map((x) => [x.i, x]));
      const rows = p.rows.map((r, i) => {
        const x = byI.get(i);
        if (!x) return { ...r, _day: "", _dur: "", _home: "" };
        const d = dayOf(x), dur = x.su !== undefined && x.eu !== undefined ? Math.round((x.eu - x.su) / 60000) : undefined;
        const homeT = home && x.su !== undefined && x.tz && offsetAt(home, x.su) !== offsetAt(x.tz, x.su) ? (() => { const l = utcToLocal(x.su!, home); return `${l.date === d ? "" : `${l.date.slice(5)} `}${hhmm(l.min)}`; })() : "";
        return { ...r, _day: first && d ? dayLabel(first, d) : "", _dur: x.kind === "hotel" ? (x.nights ? `${x.nights} 晚` : "") : dur !== undefined ? fmtDur(dur) : "", _home: homeT };
      });
      const kept = items.length, fl = items.filter((x) => x.kind === "flight").length, hn = items.filter((x) => x.kind === "hotel").reduce((a, x) => a + x.nights, 0);
      const days = first && last ? daysBetween(first, last) + 1 : 0;
      const title = s(p.settings.title) || "Trip";
      const ord = sorted(items);
      let html = `<div style="font:13px/1.5 system-ui,sans-serif">`, cur = "";
      for (const x of ord) {
        const d = dayOf(x);
        if (d !== cur) { cur = d; html += `<div style="margin:10px 0 4px;font-weight:700;color:#1D4ED8">${esc(first ? dayLabel(first, d) : d)}</div>`; }
        html += `<div style="display:flex;gap:8px;padding:2px 0;border-bottom:1px solid #eee"><span style="min-width:170px;color:#374151">${esc(span(x))}</span><span style="min-width:36px;color:#6B7280">${esc(KIND_ZH[x.kind])}</span><span><b>${esc(s(x.r.title))}</b>${s(x.r.place) ? ` · ${esc(s(x.r.place))}` : ""}${s(x.r.ref) ? ` <span style="color:#047857">#${esc(s(x.r.ref))}</span>` : ""}</span></div>`;
      }
      html += `</div>`;
      return {
        rows, issues,
        summary: `${title}: ${kept} item(s) over ${days} day(s)${first ? ` (${first} → ${last})` : ""}, ${fl} flight(s), ${hn} night(s) booked of ${nights.length}.`,
        stats: { items: kept, days, flights: fl, nights: hn },
        preview: html,
      };
    },
    exports: [
      { id: "pdf", label: ["行程单 PDF", "Itinerary (PDF)"], description: "itinerary.pdf", async run(ctx: ExportCtx) {
        const p = ctx.project, { items, first, last, nights } = analyse(p), k = await newPdf(), [W, H] = PAGE.A4, M = 44;
        let pg = k.doc.addPage([W, H]), y = H - 54;
        const need = (h: number) => { if (y - h < 50) { pg = k.doc.addPage([W, H]); y = H - 54; } };
        k.text(pg, s(p.settings.title) || "行程单", M, y, { size: 20, bold: true }); y -= 22;
        k.text(pg, [first && last ? `${first} → ${last}（${daysBetween(first, last) + 1} 天）` : "", s(p.settings.travellers) ? `出行人：${s(p.settings.travellers)}` : ""].filter(Boolean).join("    "), M, y, { size: 11, color: "#4B5563" }); y -= 26;
        let cur = "";
        for (const x of sorted(items)) {
          const d = dayOf(x);
          if (d !== cur) {
            cur = d; need(60);
            pg.drawRectangle({ x: M - 6, y: y - 6, width: W - 2 * M + 12, height: 22, color: hexRgb("#EEF2FF") });
            const stay = nights.find((n) => n.date === d)?.where.join(" / ");
            k.text(pg, first ? dayLabel(first, d) : d, M, y, { size: 12, bold: true, color: "#1D4ED8" });
            if (stay) k.text(pg, `住：${stay}`, W - M, y, { size: 9, align: "right", color: "#4B5563", maxWidth: 260 });
            y -= 26;
          }
          const sub = [s(x.r.place), s(x.r.address)].filter(Boolean).join(" · "), note = s(x.r.note);
          const tl = k.wrap(s(x.r.title), 11, W - M - 200, true), sl = sub ? k.wrap(sub, 9, W - M - 200) : [], nl = note ? k.wrap(note, 9, W - M - 200) : [];
          const tm = x.kind === "hotel" && x.ok ? [`入住${x.start ? ` ${hhmm(x.start.min)}` : ""} · ${x.nights} 晚`, `退房 ${x.endDate!.slice(5).replace("-", "/")}${x.end ? ` ${hhmm(x.end.min)}` : ""}`] : k.wrap(span(x), 10, 140);
          need(Math.max(16 * tl.length + 12 * (sl.length + nl.length), 13 * tm.length) + 10);
          tm.forEach((l, j) => k.text(pg, l, M, y - j * 13, { size: 10 }));
          k.text(pg, KIND_ZH[x.kind], M + 148, y, { size: 9, color: "#6B7280" });
          let yy = y;
          for (const l of tl) { k.text(pg, l, M + 190, yy, { size: 11, bold: true }); yy -= 15; }
          for (const l of sl) { k.text(pg, l, M + 190, yy, { size: 9, color: "#4B5563" }); yy -= 12; }
          for (const l of nl) { k.text(pg, l, M + 190, yy, { size: 9, color: "#92400E" }); yy -= 12; }
          if (s(x.r.ref)) { k.text(pg, `预订号 ${s(x.r.ref)}`, W - M, y, { size: 9, bold: true, align: "right", color: "#047857" }); }
          y = Math.min(yy, y - 13 * tm.length) - 8;
        }
        const book = sorted(items).filter((x) => s(x.r.ref) || x.kind === "flight" || x.kind === "hotel" || x.kind === "train");
        if (book.length) {
          pg = k.doc.addPage([W, H]); y = H - 54;
          k.text(pg, "预订汇总", M, y, { size: 16, bold: true }); y -= 26;
          for (const x of book) {
            const lines = k.wrap(s(x.r.address) || s(x.r.place), 9, 200);
            need(14 + 11 * lines.length);
            k.text(pg, dayOf(x), M, y, { size: 9 }); k.text(pg, KIND_ZH[x.kind], M + 70, y, { size: 9, color: "#6B7280" });
            k.text(pg, s(x.r.title), M + 110, y, { size: 10, bold: true, maxWidth: 170 });
            k.text(pg, s(x.r.ref) || "（无预订号）", M + 290, y, { size: 10, bold: !!s(x.r.ref), color: s(x.r.ref) ? "#047857" : "#B91C1C" });
            let yy = y; for (const l of lines) { k.text(pg, l, W - M, yy, { size: 9, align: "right", color: "#4B5563" }); yy -= 11; }
            y = Math.min(yy, y - 14) - 4;
          }
        }
        return [await ctx.write("itinerary.pdf", await k.doc.save())];
      } },
      { id: "ics", label: ["日历 .ics", "Calendar (.ics)"], description: "itinerary.ics", async run(ctx: ExportCtx) {
        const p = ctx.project, { items } = analyse(p), alarm = Number(p.settings.alarm ?? 180);
        const u = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
        const e = (t: string) => t.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
        const fold = (l: string) => { const out: string[] = []; let cur = "", n = 0; for (const ch of l) { const b = Buffer.byteLength(ch); if (n + b > 73) { out.push(cur); cur = " "; n = 1; } cur += ch; n += b; } out.push(cur); return out.join("\r\n"); };
        const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Penova//travel-itinerary//ZH", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${e(s(p.settings.title) || "行程")}`];
        const now = u(Date.now());
        for (const x of sorted(items)) {
          if (!x.date) continue;
          const uid = createHash("sha1").update(`${s(p.name)}|${x.i}|${s(x.r.title)}|${x.date}`).digest("hex").slice(0, 16);
          const desc = [s(x.r.ref) ? `预订号：${s(x.r.ref)}` : "", s(x.r.note), x.kind === "hotel" ? span(x) : ""].filter(Boolean).join("\n");
          L.push("BEGIN:VEVENT", `UID:${uid}@travel-itinerary`, `DTSTAMP:${now}`);
          if (x.kind === "hotel" && x.ok) L.push(`DTSTART;VALUE=DATE:${x.date.replace(/-/g, "")}`, `DTEND;VALUE=DATE:${x.endDate!.replace(/-/g, "")}`, "TRANSP:TRANSPARENT");
          else if (x.su !== undefined && x.ok) L.push(`DTSTART:${u(x.su)}`, `DTEND:${u(x.eu ?? x.su + 3600000)}`);
          else L.push(`DTSTART;VALUE=DATE:${x.date.replace(/-/g, "")}`, `DTEND;VALUE=DATE:${addDays(x.date, 1).replace(/-/g, "")}`);
          L.push(fold(`SUMMARY:${e(`${x.kind === "hotel" ? "住：" : ""}${s(x.r.title)}`)}`));
          if (s(x.r.address) || s(x.r.place)) L.push(fold(`LOCATION:${e(s(x.r.address) || s(x.r.place))}`));
          if (desc) L.push(fold(`DESCRIPTION:${e(desc)}`));
          if ((x.kind === "flight" || x.kind === "train") && alarm > 0 && x.su !== undefined) L.push("BEGIN:VALARM", "ACTION:DISPLAY", fold(`DESCRIPTION:${e(s(x.r.title))}`), `TRIGGER:-PT${alarm}M`, "END:VALARM");
          L.push("END:VEVENT");
        }
        L.push("END:VCALENDAR");
        return [await ctx.write("itinerary.ics", L.join("\r\n") + "\r\n")];
      } },
      { id: "xlsx", label: ["行程表 Excel", "Itinerary (Excel)"], description: "itinerary.xlsx", async run(ctx: ExportCtx) {
        const p = ctx.project, { items, first, nights, home } = analyse(p), c = ctx.computed;
        const errRows = new Set((c.issues ?? []).filter((x) => x.row !== undefined && x.level !== "info").map((x) => x.row));
        const ord = sorted(items);
        const homeOf = (x: Item) => { if (!home || x.su === undefined) return ""; const l = utcToLocal(x.su, home); return `${l.date} ${hhmm(l.min)}`; };
        return [await ctx.write("itinerary.xlsx", await writeXlsx([
          { name: "行程", headers: ["第几天", "日期", "时间", "类型", "事项", "地点", "地址", "预订号", "时长", "家里时间", "备注"],
            rows: ord.map((x) => [first ? dayLabel(first, dayOf(x)) : "", dayOf(x), span(x), KIND_ZH[x.kind], s(x.r.title), s(x.r.place), s(x.r.address), s(x.r.ref), (c.rows?.[x.i]?._dur as string) ?? "", homeOf(x), s(x.r.note)]),
            marks: ord.flatMap((x, k) => (errRows.has(x.i) ? [{ row: k, col: 2, color: "#FDE68A" }] : [])) },
          { name: "住宿", headers: ["日期", "星期", "住在"], rows: nights.map((n) => [n.date, weekday(n.date), n.where.join(" / ") || "（未安排）"]), marks: nights.flatMap((n, k) => (n.where.length === 1 ? [] : [{ row: k, col: 2, color: "#FECACA" }])) },
          { name: "预订", headers: ["日期", "类型", "事项", "预订号", "地址"], rows: ord.filter((x) => s(x.r.ref) || ["flight", "hotel", "train"].includes(x.kind)).map((x) => [dayOf(x), KIND_ZH[x.kind], s(x.r.title), s(x.r.ref), s(x.r.address) || s(x.r.place)]) },
        ]))];
      } },
    ],
    describeRow: (r, i) => `#${i}${r.include === false ? " [dropped]" : ""} ${s(r._day) || s(r.date)} ${s(r.date)} ${s(r.start)}${s(r.end) ? `–${s(r.end)}` : ""}${s(r.endDate) ? ` (end ${s(r.endDate)})` : ""} tz:${s(r.tz) || "↑"}${s(r.endTz) ? `→${s(r.endTz)}` : ""} [${s(r.kind)}] ${s(r.title)}${s(r.place) ? ` @ ${s(r.place)}` : ""}${s(r.ref) ? ` ref:${s(r.ref)}` : ""}${s(r._dur) ? ` (${s(r._dur)})` : ""}`,
  };
}

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(makeDef(), options).server;
}
