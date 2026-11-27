/** 排班：按可上班时间、每周工时上限，平均分配班次。 */
export interface Shift { name: string; start: number; end: number; need: number }
export interface Staff { i: number; name: string; max: number; avail: string[] }
export const DAYS_ZH = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
export const DAYS_EN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const hm = (x: string) => { const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(x.trim()); return m ? +m[1] * 60 + (+(m[2] ?? 0)) : NaN; };
export const hours = (s: Shift) => ((s.end <= s.start ? s.end + 1440 : s.end) - s.start) / 60;
export const clock = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** "早班 08:00-16:00 ×2; 晚班 16:00-24:00 x2" */
export function parseShifts(text: string): Shift[] {
  const out: Shift[] = [];
  for (const part of text.split(/[;；\n]+/)) {
    const m = /^\s*(.+?)\s+(\d{1,2}(?::\d{2})?)\s*[-–~至到]\s*(\d{1,2}(?::\d{2})?)\s*(?:[×x*]\s*(\d+)|(\d+)\s*人)?\s*$/i.exec(part);
    if (!m) continue;
    out.push({ name: m[1].trim(), start: hm(m[2]), end: hm(m[3]) % 1440, need: Number(m[4] ?? m[5] ?? 1) });
  }
  return out;
}

/** 一个格子能上哪些班：空/全天 → 全部；休/x → 无；“早,晚” → 按名称前缀；“10-18” → 完全落在时间段内的班。 */
export function availableShifts(cell: string, shifts: Shift[]): Set<number> {
  const c = cell.trim();
  const all = new Set(shifts.map((_, i) => i));
  if (!c || /^(全天|全|all|any|✓|√|y|yes|ok|可|可以)$/i.test(c)) return all;
  if (/^(休|休息|x|×|no|n|off|-|—|不可|请假|不行)$/i.test(c)) return new Set();
  const out = new Set<number>();
  for (const tok of c.split(/[,，、/\s]+/).filter(Boolean)) {
    const r = /^(\d{1,2}(?::\d{2})?)\s*[-–~至到]\s*(\d{1,2}(?::\d{2})?)$/.exec(tok);
    if (r) {
      const a = hm(r[1]), b0 = hm(r[2]), b = b0 <= a ? b0 + 1440 : b0;
      shifts.forEach((s, i) => { const e = s.end <= s.start ? s.end + 1440 : s.end; if (s.start >= a && e <= b) out.add(i); });
    } else shifts.forEach((s, i) => { if (s.name.startsWith(tok) || tok.startsWith(s.name)) out.add(i); });
  }
  return out;
}

function hash(s: string) { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

export interface Rota { grid: number[][][]; hours: number[]; short: { day: number; shift: number; missing: number }[]; overMax: number[] }

export function buildRota(staff: Staff[], shifts: Shift[], o: { seed: string; restHours: number; maxShiftsPerDay: number }): Rota {
  const grid = Array.from({ length: 7 }, () => shifts.map(() => [] as number[]));
  const h = staff.map(() => 0);
  const avail = staff.map((p) => p.avail.map((c) => availableShifts(c, shifts)));
  const short: Rota["short"] = [];
  const startAbs = (d: number, k: number) => d * 1440 + shifts[k].start;
  const endAbs = (d: number, k: number) => startAbs(d, k) + hours(shifts[k]) * 60;
  const busy = (i: number) => grid.flatMap((day, d) => day.flatMap((list, k) => (list.includes(i) ? [[startAbs(d, k), endAbs(d, k)]] : [])));
  for (let d = 0; d < 7; d++) {
    const order = shifts.map((_, k) => k).sort((a, b) => shifts[a].start - shifts[b].start);
    for (const k of order) {
      const sh = shifts[k], len = hours(sh), a = startAbs(d, k), b = endAbs(d, k);
      for (let n = 0; n < sh.need; n++) {
        const cands = staff.filter((p) => {
          if (!avail[p.i][d]?.has(k) || grid[d][k].includes(p.i)) return false;
          if (h[p.i] + len > p.max) return false;
          if (grid[d].filter((l) => l.includes(p.i)).length >= o.maxShiftsPerDay) return false;
          return busy(p.i).every(([x, y]) => b + o.restHours * 60 <= x || y + o.restHours * 60 <= a);
        });
        cands.sort((x, y) => h[x.i] / x.max - h[y.i] / y.max || hash(`${o.seed}|${d}|${k}|${x.name}`) - hash(`${o.seed}|${d}|${k}|${y.name}`));
        const pick = cands[0];
        if (!pick) { short.push({ day: d, shift: k, missing: sh.need - n }); break; }
        grid[d][k].push(pick.i); h[pick.i] += len;
      }
    }
  }
  return { grid, hours: h, short, overMax: staff.filter((p) => h[p.i] > p.max).map((p) => p.i) };
}

/** iCalendar 文本（本地时间，不带时区）。 */
export function ics(events: { title: string; start: Date; end: Date; uid: string }[], name: string) {
  const f = (d: Date) => d.toISOString().slice(0, 19).replace(/[-:]/g, "");
  const esc = (x: string) => x.replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Penova//shift-scheduler//EN", `X-WR-CALNAME:${esc(name)}`, ...events.flatMap((e) => ["BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${f(new Date(Date.UTC(2026, 0, 1)))}Z`, `DTSTART:${f(e.start)}`, `DTEND:${f(e.end)}`, `SUMMARY:${esc(e.title)}`, "END:VEVENT"]), "END:VCALENDAR", ""].join("\r\n");
}
