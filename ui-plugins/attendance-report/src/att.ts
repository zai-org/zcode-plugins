/** 考勤规则与按天计算。时间都用“当天第几分钟”表示。 */
export interface Rules {
  start: number; end: number; grace: number; earlyGrace: number; lunch: number; otAfter: number; otMin: number;
  elastic: number; // 弹性分钟：晚到不超过这么多、并且相应晚走，就不算迟到
  weekend: number[]; holidays: Set<string>; workdays: Set<string>;
}
export interface DayResult { status: string; late: number; early: number; ot: number; worked: number; missing: number; absent: boolean; excused: boolean; rest: boolean; flags: string[] }

export const hm = (s: string): number | null => {
  const m = /(\d{1,2})[:：时](\d{2})/.exec(String(s ?? ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
export const fmt = (n: number | null) => (n === null ? "" : `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`);
export const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
export const WD = ["日", "一", "二", "三", "四", "五", "六"];

/** “2026-10-01..2026-10-07, 2026-11-03” → 日期集合。 */
export function parseDates(text: string): Set<string> {
  const out = new Set<string>();
  for (const part of String(text ?? "").split(/[\s,，;；、]+/).filter(Boolean)) {
    const m = /^(\d{4}-\d{2}-\d{2})(?:\.\.|~|～|至)(\d{4}-\d{2}-\d{2})$/.exec(part);
    if (m) { for (let d = new Date(`${m[1]}T00:00:00Z`); d <= new Date(`${m[2]}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) out.add(d.toISOString().slice(0, 10)); }
    else if (/^\d{4}-\d{2}-\d{2}$/.test(part)) out.add(part);
  }
  return out;
}

export function isWorkday(date: string, r: Rules) {
  if (r.workdays.has(date)) return true;
  if (r.holidays.has(date)) return false;
  return !r.weekend.includes(weekdayOf(date));
}

const EXCUSE = /请假|事假|病假|年假|婚假|产假|丧假|调休|出差|外出|公出|培训|leave|trip|sick|vacation|off/i;

export function evaluate(date: string, inT: number | null, outT: number | null, note: string, r: Rules): DayResult {
  const rest = !isWorkday(date, r);
  const res: DayResult = { status: "", late: 0, early: 0, ot: 0, worked: 0, missing: 0, absent: false, excused: false, rest, flags: [] };
  const excused = EXCUSE.test(note);
  if (inT !== null && outT !== null && outT > inT) {
    const span = outT - inT;
    const lunchOverlap = Math.max(0, Math.min(outT, 13 * 60) - Math.max(inT, 12 * 60)) > 0 ? r.lunch : 0;
    res.worked = Math.max(0, span - lunchOverlap);
  }
  if (rest) {
    if (res.worked > 0) { res.ot = res.worked >= r.otMin ? res.worked : 0; res.status = res.ot ? "休息日加班" : "休息日打卡"; }
    else res.status = inT !== null || outT !== null ? "休息日打卡" : "休息";
    return res;
  }
  if (inT === null && outT === null) {
    if (excused) { res.excused = true; res.status = note.trim(); return res; }
    res.absent = true; res.status = "缺勤"; return res;
  }
  if (inT === null || outT === null || outT <= inT) {
    res.missing = 1;
    res.flags.push(inT === null ? "缺上班卡" : "缺下班卡");
  }
  let lateBy = inT !== null ? inT - r.start : 0;
  let needOut = r.end;
  if (inT !== null && r.elastic > 0 && lateBy > 0 && lateBy <= r.elastic) { needOut = r.end + lateBy; lateBy = 0; }
  if (inT !== null && lateBy > r.grace) { res.late = lateBy; res.flags.push(`迟到 ${lateBy} 分`); }
  if (outT !== null && inT !== null && outT > inT && outT < needOut - r.earlyGrace) { res.early = needOut - outT; res.flags.push(`早退 ${res.early} 分`); }
  if (outT !== null && outT > inT! && outT - r.end >= r.otAfter) {
    const ot = outT - Math.max(needOut, r.end);
    if (ot >= r.otMin) { res.ot = ot; res.flags.push(`加班 ${(ot / 60).toFixed(1)} 时`); }
  }
  if (excused) { res.excused = true; res.flags.push(note.trim()); res.late = 0; res.early = 0; if (res.missing) { res.missing = 0; res.flags = res.flags.filter((f) => !/^缺/.test(f)); } }
  res.status = res.flags.length ? res.flags.join("，") : "正常";
  return res;
}
