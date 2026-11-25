const z = (n: number) => String(n).padStart(2, "0");
export const fmtLocal = (d: Date) => `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;

const valid = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0) => y >= 1990 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && h < 24 && mi < 60 && s < 60;

/** 从文件名猜日期（IMG_20261103_101522、Screenshot 2026-11-05 at 10.22.31、mmexport1762750000000 …）。 */
export function dateFromName(name: string): string | undefined {
  const full = name.match(/(?<!\d)((?:19|20)\d{2})[-_.]?(\d{2})[-_.]?(\d{2})(?:[ _T-]|\sat\s|[-_ ]?)(\d{2})[-_.:h]?(\d{2})[-_.:m]?(\d{2})(?!\d)/);
  if (full) {
    const [y, mo, d, h, mi, s] = full.slice(1).map(Number);
    if (valid(y, mo, d, h, mi, s)) return `${full[1]}-${full[2]}-${full[3]} ${full[4]}:${full[5]}:${full[6]}`;
  }
  const ms = name.match(/(?<!\d)(1[3-9]\d{11})(?!\d)/);
  if (ms) return fmtLocal(new Date(Number(ms[1])));
  const day = name.match(/(?<!\d)((?:19|20)\d{2})[-_.]?(\d{2})[-_.]?(\d{2})(?!\d)/);
  if (day && valid(+day[1], +day[2], +day[3])) return `${day[1]}-${day[2]}-${day[3]} 00:00:00`;
  return undefined;
}

export function normalizeDate(v: string): string | undefined {
  const m = v.trim().match(/^(\d{4})[-/.:年](\d{1,2})[-/.:月](\d{1,2})日?(?:[ T](\d{1,2})(?::(\d{2}))?(?::(\d{2}))?)?$/);
  if (!m) return undefined;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4] ?? "0", m[5] ?? "0", m[6] ?? "0"].map(Number);
  return valid(y, mo, d, h, mi, s) ? `${y}-${z(mo)}-${z(d)} ${z(h)}:${z(mi)}:${z(s)}` : undefined;
}

export function fill(pattern: string, date: string) {
  const [y, mo, d, h, mi, s] = date.split(/[- :]/);
  return pattern.replace(/yyyy/g, y).replace(/MM/g, mo).replace(/dd/g, d).replace(/HH/g, h).replace(/mm/g, mi).replace(/ss/g, s);
}
