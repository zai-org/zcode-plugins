import { gunzipSync } from "node:zlib";
import { createApp, esc, htmlPage, htmlTable, toCsv, type AppDef, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { KitError } from "./kit/workspace.ts";
import { BOT, parseLine, refHost, STATIC, type Req } from "./parse.ts";
import { s } from "./util.ts";

export const NAME = "log-analyzer";
export const VERSION = "0.1.0";
const MAX = 300_000;

type Packed = [number, number, string, number, number, number, number, string];
type Meta = { ips: string[]; refs: string[]; uas: string[]; reqs: Packed[]; bad: number; truncated: boolean; files: string[] };

function unpack(m: Meta): Req[] {
  return m.reqs.map(([t, ip, path, status, bytes, ref, ua, method]) => { const d = new Date(t); return { t, day: d.toISOString().slice(0, 10), hour: d.getUTCHours(), ip: m.ips[ip], path, status, bytes, ref: m.refs[ref], ua: m.uas[ua], method }; });
}

const cache = new WeakMap<object, Req[]>();
function filtered(p: Project) {
  const m = p.meta as Meta;
  let all = cache.get(m.reqs);
  if (!all) { all = unpack(m); cache.set(m.reqs, all); }
  const st = p.settings, from = s(st.from), to = s(st.to), only = s(st.path);
  const off = new Set(p.rows.filter((r) => r.include === false).map((r) => s(r.path)));
  let bots = 0;
  const reqs = all.filter((r) => {
    if (from && r.day < from) return false;
    if (to && r.day > to) return false;
    if (st.staticFiles === false && STATIC.test(r.path)) return false;
    if (off.has(r.path)) return false;
    if (only && !r.path.startsWith(only)) return false;
    if (BOT.test(r.ua)) { bots++; if (st.bots !== true) return false; }
    return true;
  });
  return { reqs, bots, total: all.length };
}

const count = <T,>(xs: T[], key: (x: T) => string) => { const m = new Map<string, number>(); for (const x of xs) { const k = key(x); if (k) m.set(k, (m.get(k) ?? 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])); };
const mb = (b: number) => `${(b / 1048576).toFixed(2)} MB`;

function report(p: Project) {
  const { reqs, bots, total } = filtered(p);
  const top = Number(p.settings.topN) || 20, own = s(p.settings.site);
  const byPath = new Map<string, { hits: number; e4: number; e5: number; bytes: number; ips: Set<string> }>();
  for (const r of reqs) {
    const a = byPath.get(r.path) ?? { hits: 0, e4: 0, e5: 0, bytes: 0, ips: new Set() };
    a.hits++; a.bytes += r.bytes; a.ips.add(r.ip); if (r.status >= 500) a.e5++; else if (r.status >= 400) a.e4++;
    byPath.set(r.path, a);
  }
  const pages = [...byPath.entries()].sort((a, b) => b[1].hits - a[1].hits);
  const hours = Array.from({ length: 24 }, (_, h) => reqs.filter((r) => r.hour === h).length);
  const days = count(reqs, (r) => r.day).sort((a, b) => a[0].localeCompare(b[0]));
  const status = count(reqs, (r) => String(r.status)).sort((a, b) => a[0].localeCompare(b[0]));
  const notFound = count(reqs.filter((r) => r.status === 404), (r) => r.path).slice(0, top);
  const errors5 = count(reqs.filter((r) => r.status >= 500), (r) => `${r.status} ${r.path}`).slice(0, top);
  const refs = count(reqs, (r) => refHost(r.ref, own)).slice(0, top);
  const ips = count(reqs, (r) => r.ip);
  const bytes = reqs.reduce((a, r) => a + r.bytes, 0);
  return { reqs, bots, total, pages, hours, days, status, notFound, errors5, refs, ips, bytes, visitors: ips.length };
}

function hourSvg(hours: number[]) {
  const max = Math.max(1, ...hours), W = 620, H = 170;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="sans-serif" font-size="10">${hours.map((v, h) => { const bh = (v / max) * 120; return `<rect x="${30 + h * 24}" y="${140 - bh}" width="18" height="${bh.toFixed(1)}" fill="#2563eb" rx="2"/><text x="${39 + h * 24}" y="155" text-anchor="middle" fill="#6b7280">${h}</text>${v ? `<text x="${39 + h * 24}" y="${135 - bh}" text-anchor="middle" fill="#111827">${v}</text>` : ""}`; }).join("")}<text x="30" y="168" fill="#6b7280">hour 小时</text></svg>`;
}

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "logs",
  title: ["访问日志分析", "Access Log Analyzer"],
  openDescription:
    "Analyse web server access logs (Nginx/Apache common or combined format, plain or .gz; several rotated files at once): requests, unique visitors (IPs), traffic by hour and day, top pages, 404s, 5xx errors, status codes, referrers and bandwidth. Bots and crawlers are recognised by user agent and left out by default (setting bots=true to include them); static files can be excluded; filter by date (from/to, YYYY-MM-DD) or path prefix. Each row is one URL path: untick a row to drop it from the report.",
  inputs: { exts: [".log", ".gz", ".txt", ".1", ".2", ".3"], min: 1, max: 50, folders: true, label: ["选择访问日志（可多选或选文件夹）", "Pick access logs (several files or a folder)"] },
  settings: [
    { key: "site", label: ["本站域名（来源里算站内）", "Your site's domain (internal referrers)"], type: "text", default: "" },
    { key: "bots", label: ["包含爬虫/机器人", "Include bots and crawlers"], type: "bool", default: false },
    { key: "staticFiles", label: ["包含静态文件（css/js/图片）", "Include static files (css/js/images)"], type: "bool", default: true },
    { key: "from", label: ["开始日期", "From date"], type: "date", default: "" },
    { key: "to", label: ["结束日期", "To date"], type: "date", default: "" },
    { key: "path", label: ["只看路径前缀（如 /blog）", "Only paths starting with (e.g. /blog)"], type: "text", default: "" },
    { key: "topN", label: ["排行显示前几名", "Top N in rankings"], type: "number", default: 20, min: 5, max: 500 },
  ],
  columns: () => [
    { key: "include", label: ["计入", "Include"], type: "bool" },
    { key: "path", label: ["路径", "Path"], readOnly: true, wide: true },
    { key: "hits", label: ["请求数", "Hits"], type: "number", readOnly: true },
    { key: "visitors", label: ["访客", "Visitors"], type: "number", readOnly: true },
    { key: "e4", label: ["4xx", "4xx"], type: "number", readOnly: true },
    { key: "e5", label: ["5xx", "5xx"], type: "number", readOnly: true },
    { key: "mb", label: ["流量 MB", "MB"], type: "number", readOnly: true },
  ],
  async load({ ws, files }) {
    const list: string[] = [];
    for (const f of files) {
      const sub = (await ws.list({ dir: f, limit: 500 })).map((x) => x.path).filter((x) => /(\.log|\.gz|\.txt|\.log\.\d+)$/i.test(x) && !x.startsWith(`${NAME}/`));
      if (sub.length) list.push(...sub); else list.push(f);
    }
    const ipI = new Map<string, number>(), refI = new Map<string, number>(), uaI = new Map<string, number>();
    const idx = (m: Map<string, number>, k: string) => { let i = m.get(k); if (i === undefined) { i = m.size; m.set(k, i); } return i; };
    const reqs: Packed[] = [];
    let bad = 0, truncated = false;
    for (const f of [...new Set(list)]) {
      let buf = await ws.read(f, 500 * 1024 * 1024);
      if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
      for (const line of buf.toString("utf8").split(/\r?\n/)) {
        if (!line.trim()) continue;
        const r = parseLine(line);
        if (!r) { bad++; continue; }
        if (reqs.length >= MAX) { truncated = true; break; }
        reqs.push([r.t, idx(ipI, r.ip), r.path, r.status, r.bytes, idx(refI, r.ref), idx(uaI, r.ua), r.method]);
      }
    }
    if (!reqs.length) throw new KitError("no_requests", `No access-log lines recognised in ${list.join(", ") || "the inputs"} (${bad} unreadable line(s)). Expected Nginx/Apache common or combined format.`);
    reqs.sort((a, b) => a[0] - b[0]);
    const meta: Meta = { ips: [...ipI.keys()], refs: [...refI.keys()], uas: [...uaI.keys()], reqs, bad, truncated, files: list };
    const hits = new Map<string, number>();
    for (const r of reqs) hits.set(r[2], (hits.get(r[2]) ?? 0) + 1);
    const rows: Row[] = [...hits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3000).map(([path]) => ({ include: true, path }));
    return { rows, meta: meta as unknown as Record<string, unknown> };
  },
  compute(p): Computed {
    const r = report(p);
    const m = p.meta as Meta;
    const byPath = new Map(r.pages);
    const rows = p.rows.map((row) => { const a = byPath.get(s(row.path)); return { ...row, hits: a?.hits ?? 0, visitors: a?.ips.size ?? 0, e4: a?.e4 ?? 0, e5: a?.e5 ?? 0, mb: a ? Math.round((a.bytes / 1048576) * 100) / 100 : 0 }; });
    const issues: Issue[] = [];
    if (m.bad) issues.push({ level: "warn", message: `${m.bad} line(s) could not be read as access-log lines and were skipped.` });
    if (m.truncated) issues.push({ level: "warn", message: `Only the first ${MAX.toLocaleString("en")} requests were loaded.` });
    if (r.bots) issues.push({ level: "info", message: `${r.bots} request(s) from bots/crawlers ${p.settings.bots === true ? "included" : "left out (setting bots)"}.` });
    for (const [k, v] of r.errors5.slice(0, 5)) issues.push({ level: "warn", message: `Server error ${k}: ${v} time(s).` });
    const e4 = r.reqs.filter((x) => x.status >= 400 && x.status < 500).length, e5 = r.reqs.filter((x) => x.status >= 500).length;
    const first = r.reqs[0]?.day ?? "", last = r.reqs.at(-1)?.day ?? "";
    return {
      rows,
      summary: `${r.reqs.length} request(s) from ${r.visitors} visitor IP(s), ${first}${last !== first ? ` – ${last}` : ""}; ${e4} 4xx, ${e5} 5xx; ${mb(r.bytes)} sent.`,
      stats: { requests: r.reqs.length, visitors: r.visitors, errors4xx: e4, errors5xx: e5, bots: r.bots, MB: Math.round((r.bytes / 1048576) * 100) / 100 },
      issues,
      preview: hourSvg(r.hours) + htmlTable(["Top page 热门页面", "Hits", "Visitors"], r.pages.slice(0, 10).map(([k, a]) => [k, a.hits, a.ips.size])) + htmlTable(["404 path 找不到", "Hits"], r.notFound.slice(0, 8)) + htmlTable(["Referrer 来源", "Hits"], r.refs.slice(0, 8)),
    };
  },
  exports: [
    {
      id: "html", label: ["HTML 报告", "HTML report"], description: "access-report.html — overview, hourly chart, top pages, errors, referrers, status codes",
      async run({ project, write, computed }: ExportCtx) {
        const r = report(project), top = Number(project.settings.topN) || 20;
        const body = `<h1>Access log report 访问日志报告</h1><p class="muted">${esc(computed.summary)}</p><h2>Traffic by hour 每小时请求</h2>${hourSvg(r.hours)}<h2>By day 每日</h2>${htmlTable(["Day", "Requests"], r.days)}<h2>Top pages 热门页面</h2>${htmlTable(["Path", "Hits", "Visitors", "4xx", "5xx", "MB"], r.pages.slice(0, top).map(([k, a]) => [k, a.hits, a.ips.size, a.e4, a.e5, (a.bytes / 1048576).toFixed(2)]))}<h2>Not found 404</h2>${htmlTable(["Path", "Hits"], r.notFound)}<h2>Server errors 5xx</h2>${htmlTable(["Status + path", "Hits"], r.errors5)}<h2>Status codes 状态码</h2>${htmlTable(["Status", "Requests"], r.status)}<h2>Referrers 来源</h2>${htmlTable(["Referrer", "Hits"], r.refs)}<h2>Top visitors 访问最多的 IP</h2>${htmlTable(["IP", "Requests"], r.ips.slice(0, top))}`;
        return [await write("access-report.html", htmlPage("Access log report", body))];
      },
    },
    {
      id: "csv", label: ["CSV 表格", "CSV tables"], description: "pages.csv, hourly.csv, daily.csv, errors.csv, referrers.csv",
      async run({ project, write }: ExportCtx) {
        const r = report(project);
        const errs = r.reqs.filter((x) => x.status >= 400);
        return [
          await write("pages.csv", toCsv(["path", "hits", "visitors", "4xx", "5xx", "bytes"], r.pages.map(([k, a]) => [k, a.hits, a.ips.size, a.e4, a.e5, a.bytes]))),
          await write("hourly.csv", toCsv(["hour", "requests"], r.hours.map((v, h) => [h, v]))),
          await write("daily.csv", toCsv(["day", "requests"], r.days)),
          await write("errors.csv", toCsv(["time", "ip", "method", "path", "status", "referrer", "user_agent"], errs.map((x) => [new Date(x.t).toISOString().slice(0, 19).replace("T", " "), x.ip, x.method, x.path, x.status, x.ref, x.ua]))),
          await write("referrers.csv", toCsv(["referrer", "hits"], count(r.reqs, (x) => refHost(x.ref, s(project.settings.site))))),
        ];
      },
    },
  ],
  describeRow: (r, i) => `#${i}${r.include === false ? " [excluded]" : ""} ${s(r.path)} hits=${r.hits ?? ""} 4xx=${r.e4 ?? ""} 5xx=${r.e5 ?? ""}`,
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
