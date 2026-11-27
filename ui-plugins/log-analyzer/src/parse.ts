/** 解析 Nginx/Apache common 与 combined 访问日志。 */
export interface Req { t: number; day: string; hour: number; ip: string; method: string; path: string; status: number; bytes: number; ref: string; ua: string }

const RE = /^(\S+) \S+ \S+ \[([^\]]+)\] "(?:(\S+) (\S+)(?: [^"]*)?|[^"]*)" (\d{3}) (\S+)(?: "((?:[^"\\]|\\.)*)" "((?:[^"\\]|\\.)*)")?/;
const MON: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

/** 日志里的本地时间（不换算时区）。 */
export function parseTime(x: string): { t: number; day: string; hour: number } | undefined {
  const m = /^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})/.exec(x);
  if (!m || MON[m[2]] === undefined) return undefined;
  const t = Date.UTC(+m[3], MON[m[2]], +m[1], +m[4], +m[5], +m[6]);
  return { t, day: new Date(t).toISOString().slice(0, 10), hour: +m[4] };
}

export function parseLine(line: string): Req | undefined {
  const m = RE.exec(line);
  if (!m) return undefined;
  const time = parseTime(m[2]);
  if (!time) return undefined;
  const path = (m[4] ?? "").split("?")[0] || "(bad request)";
  return { ...time, ip: m[1], method: m[3] ?? "-", path, status: +m[5], bytes: m[6] === "-" ? 0 : Number(m[6]) || 0, ref: m[7] && m[7] !== "-" ? m[7] : "", ua: m[8] ?? "" };
}

export const BOT = /bot\b|bot\/|crawl|spider|slurp|bingpreview|facebookexternalhit|curl\/|wget|python-requests|go-http-client|httpclient|headless|scrapy|ahrefs|semrush|mj12/i;
export const STATIC = /\.(css|js|mjs|map|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|mp4|webm)$/i;

/** 来源只保留域名；同站来源算“站内”。 */
export function refHost(ref: string, own: string) {
  if (!ref) return "";
  const m = /^[a-z]+:\/\/([^/:]+)/i.exec(ref);
  const h = (m?.[1] ?? ref).toLowerCase().replace(/^www\./, "");
  return own && h === own.toLowerCase().replace(/^www\./, "") ? "(internal)" : h;
}
