import { createApp, esc, type AppDef, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { mapHeaders } from "./kit/columns.ts";
import { writeXlsx } from "./kit/sheet.ts";
import { readTable } from "./kit/table.ts";
import { KitError, safeFileName } from "./kit/workspace.ts";
import { makeCode, normalizeCode, ticketsPdf, type Guest, type TicketOpts } from "./ticket.ts";

export const NAME = "event-ticket-maker";
export const VERSION = "0.1.0";

const s = (v: unknown) => String(v ?? "").trim();
const guestsOf = (p: Project): Guest[] => p.rows.filter((r) => r.include !== false && s(r.code)).map((r) => ({ code: s(r.code), name: s(r.name), type: s(r.type), seat: s(r.seat) }));
const optsOf = (p: Project, layout?: string): TicketOpts => ({ event: s(p.settings.event), date: s(p.settings.date), venue: s(p.settings.venue), accent: s(p.settings.accent) || "#7c3aed", note: s(p.settings.note), layout: (layout ?? s(p.settings.layout)) === "single" ? "single" : "a4" });
const cleanPrefix = (v: unknown) => s(v).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
const key = (r: Record<string, unknown>) => [s(r.name), s(r.phone), s(r.email)].join("|");

interface Scan { code: string; time: string }
async function readScans(ws: AppCtxWs, file: string): Promise<Scan[]> {
  if (/\.txt$/i.test(file)) return (await ws.readText(file)).split(/\r?\n/).map((l) => l.split(/[,\t]/)).filter((p) => s(p[0])).map((p) => ({ code: s(p[0]), time: s(p[1]) }));
  const t = await readTable(ws, file);
  const m = mapHeaders(t.columns, { code: ["票号", "编号", "code", "ticket", "二维码", "qr", "barcode", "内容", "content"], time: ["时间", "扫码时间", "time", "timestamp", "scanned", "date"] });
  const codeCol = m.code ?? t.columns[0];
  const out: Scan[] = [];
  if (!m.code && normalizeCode(t.columns[0]).valid) out.push({ code: t.columns[0], time: "" }); // 没有表头的扫描导出
  for (const r of t.rows) if (s(r[codeCol])) out.push({ code: s(r[codeCol]), time: m.time ? s(r[m.time]) : "" });
  return out;
}
type AppCtxWs = Parameters<AppDef["load"]>[0]["ws"];

/** 票号台账：同一份名单重新打开时沿用已发出的票号和签到状态（文件在 event-ticket-maker/ticket-codes.json）。 */
const LEDGER = `${NAME}/ticket-codes.json`;
type Ledger = { version: 1; lists: Record<string, Record<string, { code: string; checkedIn: boolean; checkedAt: string; include: boolean }>> };
async function readLedger(ws: AppCtxWs): Promise<Ledger> {
  try { if (await ws.exists(LEDGER)) { const l = JSON.parse(await ws.readText(LEDGER)); if (l?.lists) return l; } } catch { /* 台账损坏时重新开始 */ }
  return { version: 1, lists: {} };
}
async function saveLedger(ws: AppCtxWs, list: string, rows: Row[], scanned: string[]) {
  if (!list) return;
  const l = await readLedger(ws);
  const sc = new Set(scanned);
  // 只记手动签到；扫码签到每次从扫码文件重新计算，重复选同一个扫码文件不会被当成重复扫码
  l.lists[list] = Object.fromEntries(rows.filter((r) => s(r.code)).map((r) => { const manual = Boolean(r.checkedIn) && !sc.has(s(r.code).toUpperCase()); return [key(r), { code: s(r.code), checkedIn: manual, checkedAt: manual ? s(r.checkedAt) : "", include: r.include !== false }]; }));
  await ws.write(LEDGER, JSON.stringify(l, null, 1));
}

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "ticket",
  title: ["活动门票签到", "Event Tickets"],
  openDescription:
    "Turn a guest list (CSV/XLSX with columns such as 姓名/name, 票种/ticket type, 座位/seat, 手机/phone, 邮箱/email) into QR-code tickets and a check-in list. Every guest gets a unique hard-to-guess code (PREFIX-XXXX-XXXX with a check character, kept when the list is reopened). Exports a tickets PDF (3 per A4 with a tear-off stub, or one ticket per page for sending), one PDF per guest, and a check-in workbook. Pick scanner exports (CSV/XLSX/TXT of scanned codes) together with the guest list to mark who has arrived, with unknown, mistyped and repeated scans flagged.",
  inputs: { exts: [".csv", ".xlsx", ".tsv", ".txt"], min: 1, max: 6, label: ["选择嘉宾名单（可再选扫码记录）", "Pick the guest list (and any scan exports)"] },
  settings: [
    { key: "event", label: ["活动名称", "Event name"], type: "text", default: "" },
    { key: "date", label: ["日期时间", "Date & time"], type: "text", default: "" },
    { key: "venue", label: ["地点", "Venue"], type: "text", default: "" },
    { key: "prefix", label: ["票号前缀（字母数字）", "Code prefix (letters/digits)"], type: "text", default: "TKT", reload: true },
    { key: "accent", label: ["主题色", "Accent colour"], type: "color", default: "#7c3aed" },
    { key: "note", label: ["票面说明", "Note on the ticket"], type: "text", default: "" },
    { key: "layout", label: ["门票排版", "Ticket layout"], type: "select", default: "a4", options: [{ value: "a4", label: ["A4 一页 3 张（打印）", "3 per A4 (print)"] }, { value: "single", label: ["一页一张（发电子票）", "One per page (to send)"] }] },
  ],
  columns: () => [
    { key: "include", label: ["出票", "Issue"], type: "bool" },
    { key: "code", label: ["票号", "Code"] },
    { key: "name", label: ["姓名", "Name"] },
    { key: "type", label: ["票种", "Type"] },
    { key: "seat", label: ["座位", "Seat"] },
    { key: "phone", label: ["手机", "Phone"] },
    { key: "email", label: ["邮箱", "Email"] },
    { key: "checkedIn", label: ["已签到", "Checked in"], type: "bool" },
    { key: "checkedAt", label: ["签到时间", "Check-in time"] },
  ],
  newRow: () => ({ include: true, code: "", name: "", type: "", seat: "", phone: "", email: "", checkedIn: false, checkedAt: "" }),
  async load({ ws, files, settings, previous }) {
    let guestFile = "";
    const scanFiles: string[] = [];
    let t: Awaited<ReturnType<typeof readTable>> | undefined;
    let m: Record<string, string | undefined> = {};
    for (const f of files) {
      if (!guestFile && !/\.txt$/i.test(f)) {
        const tt = await readTable(ws, f);
        const mm = mapHeaders(tt.columns, { name: ["姓名", "名字", "name", "guest", "嘉宾"], type: ["票种", "类型", "type", "ticket type", "tier"], seat: ["座位", "座位号", "seat"], phone: ["手机", "电话", "phone", "mobile"], email: ["邮箱", "email", "e-mail"], code: ["票号", "编号", "code", "ticket"] });
        if (mm.name) { guestFile = f; t = tt; m = mm; continue; }
      }
      scanFiles.push(f);
    }
    if (!t || !m.name) throw new KitError("no_name_column", "Couldn't find a guest list with a name column (姓名/name) among the picked files.");
    const prefix = cleanPrefix(settings.prefix ?? "TKT");
    settings.prefix = prefix;
    const ledger = (await readLedger(ws)).lists[guestFile] ?? {};
    const prev = new Map<string, Record<string, unknown>>(Object.entries(ledger));
    for (const r of previous ?? []) prev.set(key(r), r);
    const taken = new Set<string>();
    const g = (r: Record<string, unknown>, k?: string) => (k ? s(r[k]) : "");
    const rows: Row[] = t.rows.filter((r) => g(r, m.name)).map((r) => ({ include: true, code: g(r, m.code), name: g(r, m.name), type: g(r, m.type), seat: g(r, m.seat), phone: g(r, m.phone), email: g(r, m.email), checkedIn: false, checkedAt: "" }));
    for (const r of rows) {
      const old = prev.get(key(r));
      if (old) { const oc = s(old.code); if (!r.code && (old.checkedIn || (prefix ? oc.startsWith(`${prefix}-`) : !/^[A-Z0-9]+-[^-]+-[^-]+$/.test(oc)))) r.code = oc; r.checkedIn = Boolean(old.checkedIn); r.checkedAt = s(old.checkedAt); r.include = old.include !== false; }
      if (r.code) taken.add(String(r.code));
    }
    for (const r of rows) if (!r.code) r.code = makeCode(prefix, taken);
    // 扫码记录
    const byCode = new Map(rows.map((r) => [String(r.code).toUpperCase(), r]));
    const unknown: string[] = [], invalid: string[] = [], repeat: string[] = [];
    let scans = 0;
    const scanned: string[] = [];
    for (const f of scanFiles) {
      for (const sc of await readScans(ws, f)) {
        scans++;
        const { code, valid } = normalizeCode(sc.code);
        const row = byCode.get(code);
        if (!row) { (valid ? unknown : invalid).push(code); continue; }
        if (row.checkedIn) { repeat.push(code); continue; }
        row.checkedIn = true;
        row.checkedAt = sc.time || row.checkedAt || "scanned";
        scanned.push(code);
      }
    }
    await saveLedger(ws, guestFile, rows, scanned);
    return { rows, meta: { guestFile, scanFiles, scans, scanned, unknown, invalid, repeat } };
  },
  async compute(p, ctx) {
    const issues: Issue[] = [];
    if (ctx?.ws) await saveLedger(ctx.ws, s(p.meta?.guestFile), p.rows, (p.meta?.scanned as string[]) ?? []);
    const seen = new Map<string, number>();
    p.rows.forEach((r, i) => {
      if (r.include === false) return;
      if (!s(r.name)) issues.push({ level: "error", row: i, key: "name", message: `Row ${i + 1}: no name.` });
      const c = s(r.code).toUpperCase();
      if (!c) issues.push({ level: "error", row: i, key: "code", message: `${r.name || `Row ${i + 1}`}: no ticket code.` });
      else if (seen.has(c)) issues.push({ level: "error", row: i, key: "code", message: `Code ${c} is on two tickets (rows ${seen.get(c)! + 1} and ${i + 1}).` });
      if (c) seen.set(c, i);
    });
    const meta = p.meta as { unknown?: string[]; invalid?: string[]; repeat?: string[]; scans?: number };
    for (const c of meta.unknown ?? []) issues.push({ level: "warn", message: `Scanned code ${c} isn't on the guest list.` });
    for (const c of meta.invalid ?? []) issues.push({ level: "warn", message: `Scanned “${c}” isn't a valid ticket code (mistyped or not ours).` });
    for (const c of [...new Set(meta.repeat ?? [])]) issues.push({ level: "info", message: `${c} was scanned more than once.` });
    if (!s(p.settings.event)) issues.push({ level: "warn", message: "No event name set (settings → event)." });
    const live = p.rows.filter((r) => r.include !== false);
    const inN = live.filter((r) => r.checkedIn).length;
    const types = new Map<string, { n: number; inN: number }>();
    for (const r of live) { const t = s(r.type) || "—"; const v = types.get(t) ?? { n: 0, inN: 0 }; v.n++; if (r.checkedIn) v.inN++; types.set(t, v); }
    const o = optsOf(p);
    const preview = `<div style="font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif">
<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px">${[...types].map(([t, v]) => `<div style="border:1px solid #e5e7eb;border-radius:8px;padding:8px 12px"><div style="font-size:12px;color:#6b7280">${esc(t)}</div><div style="font-size:18px;font-weight:700">${v.inN} / ${v.n}</div></div>`).join("")}</div>
<div style="display:flex;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;max-width:560px"><div style="width:10px;background:${esc(o.accent)}"></div><div style="flex:1;padding:12px 14px"><div style="font-weight:800;font-size:17px">${esc(o.event || "Event")}</div><div style="color:#4b5563;font-size:12px">${esc([o.date, o.venue].filter(Boolean).join(" · "))}</div><div style="margin-top:14px;font-size:13px"><b>${esc(s(live[0]?.name))}</b> · <span style="color:${esc(o.accent)}">${esc(s(live[0]?.type))}</span> · ${esc(s(live[0]?.seat) || "—")}</div></div><div style="width:130px;border-left:2px dashed #d1d5db;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:11px;color:#374151"><div style="width:64px;height:64px;border:1px dashed #9ca3af;display:flex;align-items:center;justify-content:center;color:#9ca3af">QR</div><b style="margin-top:6px">${esc(s(live[0]?.code))}</b></div></div></div>`;
    return { rows: p.rows, issues, preview, summary: `${live.length} tickets · ${inN} checked in${meta.scans ? ` · ${meta.scans} scans read` : ""}`, stats: { tickets: live.length, checkedIn: inN, scans: meta.scans ?? 0, unknown: (meta.unknown ?? []).length + (meta.invalid ?? []).length } };
  },
  exports: [
    {
      id: "tickets", label: ["门票 PDF", "Tickets PDF"], description: "tickets.pdf — all tickets (layout from settings)",
      async run({ project, write, computed }: ExportCtx) {
        const errs = (computed.issues ?? []).filter((i) => i.level === "error");
        if (errs.length) throw new KitError("has_errors", `Fix first: ${errs[0].message}`);
        return [await write("tickets.pdf", await ticketsPdf(guestsOf(project), optsOf(project)))];
      },
    },
    {
      id: "each", label: ["每人一张电子票", "One PDF per guest"], description: "tickets/<code>-<name>.pdf — one ticket per file, for sending",
      async run({ project, write }: ExportCtx) {
        const out: string[] = [];
        for (const g of guestsOf(project)) out.push(await write(`tickets/${g.code}-${safeFileName(g.name, "guest")}.pdf`, await ticketsPdf([g], optsOf(project, "single"))));
        return out;
      },
    },
    {
      id: "checkin", label: ["签到表 Excel", "Check-in workbook"], description: "checkin.xlsx — check-in list (by name) with arrival status, summary by ticket type",
      async run({ project, write }: ExportCtx) {
        const live = project.rows.filter((r) => r.include !== false);
        const sorted = [...live].sort((a, b) => s(a.name).localeCompare(s(b.name), "zh-CN"));
        const types = [...new Set(live.map((r) => s(r.type) || "—"))];
        const xlsx = await writeXlsx([
          { name: "签到表 Check-in", headers: ["票号 Code", "姓名 Name", "票种 Type", "座位 Seat", "手机 Phone", "已签到 In", "签到时间 Time", "签名 Signature"], rows: sorted.map((r) => [s(r.code), s(r.name), s(r.type), s(r.seat), s(r.phone), r.checkedIn ? "✓" : "", s(r.checkedAt), ""]), widths: [20, 16, 10, 8, 14, 8, 18, 18], marks: sorted.flatMap((r, i) => (r.checkedIn ? [{ row: i, col: 5, color: "#BBF7D0" }] : [])) },
          { name: "汇总 Summary", headers: ["票种 Type", "出票 Issued", "已签到 Checked in", "未到 Not yet"], rows: [...types.map((t) => { const g = live.filter((r) => (s(r.type) || "—") === t); const n = g.filter((r) => r.checkedIn).length; return [t, g.length, n, g.length - n]; }), ["合计 Total", live.length, live.filter((r) => r.checkedIn).length, live.filter((r) => !r.checkedIn).length]] },
        ]);
        return [await write("checkin.xlsx", xlsx)];
      },
    },
  ],
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
