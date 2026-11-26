/** 表头别名匹配：把用户表格里的中英文列名对应到插件字段。 */
const norm = (s: string) => s.toLowerCase().replace(/[\s_\-:：()（）.#]/g, "");

export function mapHeaders(headers: string[], aliases: Record<string, string[]>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  const used = new Set<string>();
  const nh = headers.map((h) => [h, norm(h)] as const);
  for (const [key, names] of Object.entries(aliases)) {
    const wanted = [key, ...names].map(norm);
    let hit = nh.find(([h, n]) => !used.has(h) && wanted.includes(n));
    hit ??= nh.find(([h, n]) => !used.has(h) && wanted.some((w) => w.length >= 2 && n.includes(w)));
    if (hit) { out[key] = hit[0]; used.add(hit[0]); }
  }
  return out;
}

/** 解析金额 / 数字："¥1,234.50"、"12%"、"（3）"、全角数字。失败返回 NaN。 */
export function num(value: unknown): number {
  if (typeof value === "number") return value;
  let s = String(value ?? "").trim().replace(/[０-９．－]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  if (!s) return NaN;
  let neg = false;
  if (/^\(.*\)$|^（.*）$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[¥￥$€£,，\s元]|RMB|CNY|USD|EUR/gi, "");
  if (s.endsWith("%")) s = s.slice(0, -1);
  const n = Number(s);
  return neg ? -n : n;
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** 解析日期：2026-11-25、2026/11/25、2026年11月25日、11/25/2026、Excel 序号。返回 YYYY-MM-DD 或 ""。 */
export function parseDate(value: unknown): string {
  if (value instanceof Date && !isNaN(+value)) return value.toISOString().slice(0, 10);
  const s = String(value ?? "").trim();
  if (!s) return "";
  let m = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const d = new Date(s);
  return isNaN(+d) ? "" : d.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
