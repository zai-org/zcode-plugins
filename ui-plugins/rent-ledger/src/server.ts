import { createApp, esc, type AppDef, type Column, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { mapHeaders, num } from "./kit/columns.ts";
import { hexRgb, newPdf, PAGE } from "./kit/pdf.ts";
import { writeXlsx } from "./kit/sheet.ts";
import { readTable } from "./kit/table.ts";
import { KitError } from "./kit/workspace.ts";
import { allocate, cycleOf, days, rmbUpper, schedule, type Charge, type Lease } from "./rent.ts";
import { fmt2, s } from "./util.ts";

export const NAME = "rent-ledger";
export const VERSION = "0.1.0";

const TH = {
  unit: ["房号", "房间", "单元", "门牌", "房源", "unit", "room", "flat", "apartment"],
  tenant: ["租客", "承租人", "姓名", "租户", "tenant", "name"],
  phone: ["电话", "手机", "联系方式", "phone", "mobile"],
  rent: ["月租", "租金", "月租金", "rent", "monthly rent"],
  deposit: ["押金", "deposit"],
  start: ["起租日", "起租日期", "开始日期", "租期开始", "start", "lease start"],
  end: ["到期日", "到期日期", "结束日期", "租期结束", "end", "lease end"],
  dueDay: ["交租日", "每月交租日", "缴费日", "due day", "rent day"],
  cycle: ["付款方式", "付款周期", "支付方式", "cycle", "payment cycle"],
  settledTo: ["已结清至", "已付至", "已交至", "paid through", "settled to"],
};
const PH = {
  date: ["日期", "收款日期", "付款日期", "到账日期", "date", "paid on"],
  unit: ["房号", "房间", "单元", "unit", "room"],
  tenant: ["租客", "付款人", "姓名", "tenant", "payer", "from"],
  amount: ["金额", "收款金额", "实收", "amount", "paid"],
  method: ["方式", "收款方式", "渠道", "method", "via"],
  note: ["备注", "说明", "note", "memo"],
};

const dateOf = (v: unknown): string | null => {
  if (v instanceof Date && !isNaN(+v)) return v.toISOString().slice(0, 10);
  const t = s(v); const m = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/.exec(t); if (!m) return null;
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return dt.getUTCMonth() === +m[2] - 1 && dt.getUTCDate() === +m[3] ? dt.toISOString().slice(0, 10) : null;
};
const ymOf = (v: unknown) => { const t = s(v); if (!t) return ""; const m = /^(\d{4})[-/.年](\d{1,2})/.exec(t); return m ? `${m[1]}-${m[2].padStart(2, "0")}` : null; };
const asOfOf = (p: Project) => dateOf(p.settings.asOf) ?? new Date().toISOString().slice(0, 10);
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface TenantState { i: number; l: Lease; phone: string; deposit: string; charges: Charge[]; credit: number; paidTotal: number; owed: number; overdue: Charge[]; lateDays: number }
interface PayState { i: number; date: string; unit: string; amount: number; method: string; tenant: string; alloc: { label: string; amount: number }[]; receipt: string }

function lev(a: string, b: string) { const d = Array.from({ length: b.length + 1 }, (_, j) => j); for (let i = 1; i <= a.length; i++) { let prev = d[0]; d[0] = i; for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; } } return d[b.length]; }

function analyse(p: Project) {
  const issues: Issue[] = [], asOf = asOfOf(p), grace = Number(p.settings.grace ?? 3);
  const tenants: TenantState[] = [], byUnit = new Map<string, TenantState>();
  p.rows.forEach((r, i) => {
    if (r.kind !== "tenant" || r.include === false) return;
    const unit = s(r.unit), who = `${unit || `#${i}`} ${s(r.tenant)}`.trim();
    const rent = num(r.rent), start = dateOf(r.start), end = s(r.end) ? dateOf(r.end) : "9999-12-31", cycle = cycleOf(s(r.cycle)), settled = ymOf(r.settledTo);
    let ok = true;
    if (!unit) { issues.push({ level: "error", row: i, key: "unit", message: `#${i} ${s(r.tenant)}: no unit (房号).` }); ok = false; }
    else if (byUnit.has(unit)) { issues.push({ level: "error", row: i, key: "unit", message: `Unit ${unit} has two tenant rows (#${byUnit.get(unit)!.i} and #${i}) — keep the current lease only.` }); ok = false; }
    if (!Number.isFinite(rent) || rent <= 0) { issues.push({ level: "error", row: i, key: "rent", message: `${who}: can't read the rent “${s(r.rent)}”.` }); ok = false; }
    if (!start) { issues.push({ level: "error", row: i, key: "start", message: `${who}: ${s(r.start) ? `can't read the lease start “${s(r.start)}”` : "no lease start date"}.` }); ok = false; }
    if (!end) { issues.push({ level: "error", row: i, key: "end", message: `${who}: can't read the lease end “${s(r.end)}”.` }); ok = false; }
    else if (start && end < start) { issues.push({ level: "error", row: i, key: "end", message: `${who}: lease ends ${end} before it starts ${start}.` }); ok = false; }
    if (!cycle) { issues.push({ level: "error", row: i, key: "cycle", message: `${who}: unknown payment cycle “${s(r.cycle)}” — use 月付 / 季付 / 半年付 / 年付.` }); ok = false; }
    if (settled === null) { issues.push({ level: "error", row: i, key: "settledTo", message: `${who}: can't read “${s(r.settledTo)}” — write the last settled month like 2026-08.` }); ok = false; }
    const dd = Number(s(r.dueDay)) || 0;
    if (s(r.dueDay) && (dd < 1 || dd > 31)) { issues.push({ level: "error", row: i, key: "dueDay", message: `${who}: rent day “${s(r.dueDay)}” must be 1–31.` }); ok = false; }
    if (!ok) return;
    const l: Lease = { unit, tenant: s(r.tenant), rent, start: start!, end: end!, dueDay: dd, cycle: cycle!, settledTo: settled || "" };
    const t: TenantState = { i, l, phone: s(r.phone), deposit: s(r.deposit), charges: schedule(l, asOf), credit: 0, paidTotal: 0, owed: 0, overdue: [], lateDays: 0 };
    tenants.push(t); byUnit.set(unit, t);
    if (end && end !== "9999-12-31" && end >= asOf && days(asOf, end!) <= Number(p.settings.renewDays ?? 45)) issues.push({ level: "info", row: i, key: "end", message: `${who}: lease ends ${end} (${days(asOf, end!)} days) — time to talk about renewal; deposit ${s(r.deposit) || "?"} to settle.` });
  });
  const pays: PayState[] = [], seen = new Map<string, number>();
  const units = [...byUnit.keys()], byName = new Map(tenants.map((t) => [t.l.tenant, t]));
  p.rows.forEach((r, i) => {
    if (r.kind !== "pay" || r.include === false) return;
    const date = dateOf(r.date), amount = num(r.amount);
    let unit = s(r.unit);
    if (!unit && s(r.tenant) && byName.has(s(r.tenant))) unit = byName.get(s(r.tenant))!.l.unit;
    const tag = `Payment #${i} (${s(r.date)} ${unit || s(r.tenant)} ${s(r.amount)})`;
    let ok = true;
    if (!date) { issues.push({ level: "error", row: i, key: "date", message: `${tag}: ${s(r.date) ? `can't read the date “${s(r.date)}”` : "no date"}.` }); ok = false; }
    if (!Number.isFinite(amount) || amount <= 0) { issues.push({ level: "error", row: i, key: "amount", message: `${tag}: can't read the amount “${s(r.amount)}”.` }); ok = false; }
    if (!byUnit.has(unit)) {
      const near = units.map((u) => [u, lev(unit.toUpperCase().replace(/O/g, "0"), u.toUpperCase())] as const).sort((a, b) => a[1] - b[1])[0];
      issues.push({ level: "error", row: i, key: "unit", message: `${tag}: no tenant in unit “${unit}”${near && near[1] <= 1 ? ` — did you mean ${near[0]} (${byUnit.get(near[0])!.l.tenant})?` : ""}.` }); ok = false;
    }
    if (!ok) return;
    const k = `${unit}|${date}|${amount}`;
    if (seen.has(k)) issues.push({ level: "warn", row: i, message: `${tag} looks like a duplicate of payment #${seen.get(k)} (same unit, date and amount) — drop one unless it really was paid twice.` });
    seen.set(k, i);
    const t = byUnit.get(unit)!;
    if (t.l.end !== "9999-12-31" && date! > t.l.end) issues.push({ level: "warn", row: i, message: `${tag} is after the lease ended (${t.l.end}).` });
    pays.push({ i, date: date!, unit, amount, method: s(r.method), tenant: t.l.tenant, alloc: [], receipt: "" });
  });
  pays.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.i - b.i)).forEach((x, n) => { x.receipt = `${s(p.settings.receiptPrefix) || "SJ"}${x.date.slice(0, 4)}-${String(n + 1).padStart(4, "0")}`; });
  for (const t of tenants) {
    const mine = pays.filter((x) => x.unit === t.l.unit);
    const { credit, used } = allocate(t.charges, mine.map((x) => ({ i: x.i, date: x.date, amount: x.amount })));
    for (const x of mine) x.alloc = used.get(x.i) ?? [];
    t.credit = credit; t.paidTotal = mine.reduce((a, x) => a + x.amount, 0);
    const lim = (c: Charge) => { const d = new Date(Date.parse(`${c.due}T00:00:00Z`) + grace * 86400000).toISOString().slice(0, 10); return d; };
    t.overdue = t.charges.filter((c) => c.amount - c.paid > 0.004 && lim(c) < asOf);
    t.owed = Math.round(t.charges.filter((c) => c.due <= asOf).reduce((a, c) => a + c.amount - c.paid, 0) * 100) / 100;
    const who = `${t.l.unit} ${t.l.tenant}`;
    if (t.overdue.length) {
      const amt = t.overdue.reduce((a, c) => a + c.amount - c.paid, 0); t.lateDays = days(t.overdue[0].due, asOf);
      issues.push({ level: "warn", row: t.i, message: `${who} owes ${money(amt)} overdue: ${t.overdue.map((c) => `${c.label}${c.paid ? `（已付 ${money(c.paid)}）` : ""} due ${c.due}, ${days(c.due, asOf)} days`).join("; ")}.` });
    }
    for (const c of t.charges) if (c.paidOn && days(c.due, c.paidOn) > grace) issues.push({ level: "info", row: t.i, message: `${who}: ${c.label} was paid ${days(c.due, c.paidOn)} days late (${c.paidOn}).` });
    if (credit > 0) issues.push({ level: "info", row: t.i, message: `${who} has ${money(credit)} paid in advance — it will cover the next rent.` });
  }
  return { issues, tenants, pays, asOf };
}

function makeDef(): AppDef {
  return {
    name: NAME,
    version: VERSION,
    prefix: "rent",
    title: ["房租台账", "Rent Ledger"],
    openDescription:
      "Track tenants and rent for a few rental units: see what's due, what's overdue and print receipts. Pick a folder with a tenant list (.xlsx/.csv: 房号/unit, 租客/tenant, 电话/phone, 月租/rent, 押金/deposit, 起租日/start, 到期日/end, 交租日/due day 1–31, 付款方式/cycle 月付·季付·半年付·年付, 已结清至/settled to YYYY-MM for months already settled before this ledger) and a payments sheet (日期/date, 房号/unit or 租客/tenant, 金额/amount, 方式/method, 备注/note). Rows: tenant rows (kind tenant) then payment rows (kind pay); record a new payment with add: [{kind: \"pay\", date, unit, amount, method}]. Rent is charged per cycle from the lease start (last part-period pro rata by day), up to the as-of date; payments are applied to the oldest unpaid rent first, part payments allowed, extra is carried forward. Settings: landlord, asOf (blank = today), grace (days after the rent day before it counts as overdue, default 3), renewDays (warn when a lease ends within this many days), receiptPrefix. Checks: payments for unknown units (with a suggestion for typos like 3O2), unreadable dates/amounts, duplicate payments, payments after the lease ended, overdue rent with days late, rent paid late, advance credit, leases ending soon, duplicate tenant rows, bad lease dates and cycles. Exports ledger.xlsx (tenants with balance, rent schedule, payments with what each paid, arrears), receipts.pdf (one receipt per payment with receipt number, amount in figures and 大写, what it pays for) and reminders.md (a polite overdue reminder per tenant, ready to paste into a chat).",
    inputs: { exts: [".xlsx", ".csv"], min: 1, max: 2, folders: true, label: ["选择租客表和收款记录", "Pick tenants and payments"] },
    settings: [
      { key: "landlord", label: ["房东/收款人", "Landlord"], type: "text", default: "" },
      { key: "asOf", label: ["截至日期（空 = 今天）", "As of (blank = today)"], type: "text", default: "" },
      { key: "grace", label: ["宽限天数", "Grace days"], type: "number", default: 3, min: 0, max: 60 },
      { key: "renewDays", label: ["到期前提醒（天）", "Lease-end notice (days)"], type: "number", default: 45, min: 0, max: 365 },
      { key: "receiptPrefix", label: ["收据编号前缀", "Receipt prefix"], type: "text", default: "SJ" },
    ],
    columns: () => [
      { key: "include", label: ["保留", "Keep"], type: "bool" },
      { key: "_type", label: ["行", "Row"], readOnly: true },
      { key: "unit", label: ["房号", "Unit"] },
      { key: "tenant", label: ["租客", "Tenant"] },
      { key: "date", label: ["收款日期", "Paid on"] },
      { key: "amount", label: ["收款金额", "Amount"], type: "number" },
      { key: "method", label: ["方式", "Method"] },
      { key: "rent", label: ["月租", "Rent"], type: "number" },
      { key: "deposit", label: ["押金", "Deposit"] },
      { key: "start", label: ["起租日", "Start"] },
      { key: "end", label: ["到期日", "End"] },
      { key: "dueDay", label: ["交租日", "Rent day"], type: "number" },
      { key: "cycle", label: ["付款方式", "Cycle"] },
      { key: "settledTo", label: ["已结清至", "Settled to"] },
      { key: "phone", label: ["电话", "Phone"] },
      { key: "_status", label: ["状态", "Status"], readOnly: true, wide: true },
      { key: "note", label: ["备注", "Note"], wide: true },
    ] as Column[],
    newRow: () => ({ kind: "pay", include: true, unit: "", tenant: "", date: new Date().toISOString().slice(0, 10), amount: "", method: "", rent: "", deposit: "", start: "", end: "", dueDay: "", cycle: "", settledTo: "", phone: "", note: "" }),
    async load({ ws, files }) {
      const list: string[] = [];
      for (const f of files) { if (/\.(xlsx|csv)$/i.test(f)) list.push(f); else for (const x of await ws.list({ dir: f, exts: [".xlsx", ".csv"], limit: 30 })) list.push(x.path); }
      let tf = "", pf = "";
      for (const f of [...new Set(list)].filter((x) => !x.startsWith(NAME + "/"))) { const t = await readTable(ws, f), h = mapHeaders(t.columns, TH), ph = mapHeaders(t.columns, PH); if (h.rent && h.unit) tf ||= f; else if (ph.amount && ph.date) pf ||= f; }
      if (!tf) throw new KitError("no_tenants", "No tenant list found (.xlsx/.csv with 房号/unit and 月租/rent columns).");
      const blank = { unit: "", tenant: "", date: "", amount: "", method: "", rent: "", deposit: "", start: "", end: "", dueDay: "", cycle: "", settledTo: "", phone: "", note: "" };
      const cell = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : s(v));
      const t = await readTable(ws, tf), h = mapHeaders(t.columns, TH);
      const rows: Row[] = t.rows.filter((r) => cell(r[h.unit!])).map((r) => ({ ...blank, kind: "tenant", include: true, ...Object.fromEntries(Object.entries(h).filter(([, c]) => c).map(([k, c]) => [k, cell(r[c!])])) }));
      if (pf) { const pt = await readTable(ws, pf), ph = mapHeaders(pt.columns, PH); for (const r of pt.rows) { if (!cell(r[ph.amount!]) && !cell(r[ph.date!])) continue; rows.push({ ...blank, kind: "pay", include: true, ...Object.fromEntries(Object.entries(ph).filter(([, c]) => c).map(([k, c]) => [k, cell(r[c!])])) }); } }
      return { rows, meta: { tenantFile: tf, payFile: pf } };
    },
    compute(p): Computed {
      const { issues, tenants, pays, asOf } = analyse(p), tb = new Map(tenants.map((t) => [t.i, t])), pb = new Map(pays.map((x) => [x.i, x]));
      const rows = p.rows.map((r, i) => {
        if (r.kind === "tenant") { const t = tb.get(i); return { ...r, _type: "租客", _status: t ? (t.overdue.length ? `欠 ${money(t.overdue.reduce((a, c) => a + c.amount - c.paid, 0))}（逾期 ${t.lateDays} 天）` : t.credit ? `已付清，预付 ${money(t.credit)}` : "已付清") : "" }; }
        const x = pb.get(i); return { ...r, _type: "收款", _status: x ? `${x.receipt}：${x.alloc.map((a) => `${a.label} ${money(a.amount)}`).join("；")}` : "" };
      });
      const due = tenants.reduce((a, t) => a + t.charges.filter((c) => c.due <= asOf).reduce((b, c) => b + c.amount, 0), 0), got = pays.reduce((a, x) => a + x.amount, 0);
      const od = tenants.filter((t) => t.overdue.length);
      return {
        rows, issues,
        summary: `${tenants.length} tenant(s), ${pays.length} payment(s) as of ${asOf}: rent due ${money(due)}, received ${money(got)}; ${od.length ? `overdue: ${od.map((t) => `${t.l.unit} ${t.l.tenant} ${money(t.overdue.reduce((a, c) => a + c.amount - c.paid, 0))}`).join(", ")}` : "nothing overdue"}.`,
        stats: { tenants: tenants.length, payments: pays.length, overdue: od.length },
        preview: `<table style="font:12px system-ui,sans-serif;border-collapse:collapse">${tenants.map((t) => `<tr><td style="padding:2px 8px"><b>${esc(t.l.unit)}</b> ${esc(t.l.tenant)}</td><td style="padding:2px 8px;text-align:right">${money(t.l.rent)}/月</td><td style="padding:2px 8px;color:${t.overdue.length ? "#B91C1C" : "#047857"}">${t.overdue.length ? `逾期 ${money(t.overdue.reduce((a, c) => a + c.amount - c.paid, 0))}` : "已付清"}</td></tr>`).join("")}</table>`,
      };
    },
    exports: [
      { id: "xlsx", label: ["台账 Excel", "Ledger (Excel)"], description: "ledger.xlsx", async run(ctx: ExportCtx) {
        const { tenants, pays, asOf } = analyse(ctx.project);
        const sched = tenants.flatMap((t) => t.charges.map((c) => ({ t, c })));
        return [await ctx.write("ledger.xlsx", await writeXlsx([
          { name: `租客（截至 ${asOf}）`, headers: ["房号", "租客", "电话", "月租", "押金", "起租日", "到期日", "付款方式", "应收", "已收", "欠款", "预付", "最早逾期天数"],
            rows: tenants.map((t) => { const due = t.charges.filter((c) => c.due <= asOf).reduce((a, c) => a + c.amount, 0); return [t.l.unit, t.l.tenant, t.phone, t.l.rent, t.deposit, t.l.start, t.l.end === "9999-12-31" ? "" : t.l.end, t.l.cycle === 1 ? "月付" : `${t.l.cycle} 个月一付`, due, t.paidTotal, t.owed > 0 ? t.owed : 0, t.credit, t.overdue.length ? t.lateDays : ""]; }),
            marks: tenants.flatMap((t, k) => (t.overdue.length ? [{ row: k, col: 10, color: "#FECACA" }] : [])), numberFormat: { 3: "#,##0.00", 8: "#,##0.00", 9: "#,##0.00", 10: "#,##0.00", 11: "#,##0.00" } },
          { name: "应收计划", headers: ["房号", "租客", "期间", "应付日", "应收", "已收", "未收", "付清日", "状态"],
            rows: sched.map(({ t, c }) => [t.l.unit, t.l.tenant, c.label, c.due, c.amount, c.paid, Math.round((c.amount - c.paid) * 100) / 100, c.paidOn ?? "", c.paid >= c.amount - 0.004 ? "已付清" : t.overdue.includes(c) ? "逾期" : c.due > asOf ? "未到期" : c.paid ? "部分付款" : "待付"]),
            marks: sched.flatMap(({ t, c }, k) => (t.overdue.includes(c) ? [{ row: k, col: 8, color: "#FECACA" }] : [])) },
          { name: "收款记录", headers: ["收据号", "日期", "房号", "租客", "金额", "方式", "冲抵"], rows: pays.map((x) => [x.receipt, x.date, x.unit, x.tenant, x.amount, x.method, x.alloc.map((a) => `${a.label} ${fmt2(a.amount)}`).join("；")]) },
          { name: "欠款", headers: ["房号", "租客", "电话", "期间", "应付日", "未收", "逾期天数"], rows: tenants.flatMap((t) => t.overdue.map((c) => [t.l.unit, t.l.tenant, t.phone, c.label, c.due, Math.round((c.amount - c.paid) * 100) / 100, days(c.due, asOf)])) },
        ]))];
      } },
      { id: "receipts", label: ["收据 PDF", "Receipts (PDF)"], description: "receipts.pdf", async run(ctx: ExportCtx) {
        const p = ctx.project, { pays } = analyse(p), k = await newPdf(), [W, H] = PAGE.A4, half = H / 2, M = 50;
        pays.forEach((x, n) => {
          if (n % 2 === 0) k.doc.addPage([W, H]);
          const pg = k.doc.getPage(k.doc.getPageCount() - 1), top = n % 2 === 0 ? H - 40 : half - 30;
          pg.drawRectangle({ x: M - 14, y: top + 8 - 250, width: W - 2 * M + 28, height: 250, borderColor: hexRgb("#9CA3AF"), borderWidth: 0.8 });
          let y = top - 22;
          k.text(pg, "收  款  收  据", W / 2, y, { size: 18, bold: true, align: "center" });
          k.text(pg, `No. ${x.receipt}`, W - M, y, { size: 10, align: "right", color: "#B91C1C" }); y -= 30;
          const line = (a: string, b: string, bold = false) => { k.text(pg, a, M, y, { size: 11, color: "#4B5563" }); k.text(pg, b, M + 90, y, { size: 11, bold, maxWidth: W - 2 * M - 90 }); pg.drawLine({ start: { x: M + 86, y: y - 4 }, end: { x: W - M, y: y - 4 }, thickness: 0.4, color: hexRgb("#D1D5DB") }); y -= 26; };
          line("今收到", `${x.tenant}（${x.unit}）`);
          line("金额（大写）", `人民币 ${rmbUpper(x.amount)}`, true);
          line("金额（小写）", `¥ ${money(x.amount)}`, true);
          line("款项", x.alloc.map((a) => `${a.label}${x.alloc.length > 1 ? ` ${money(a.amount)}` : ""}`).join("；") || "房租");
          line("收款方式", x.method || "—");
          y -= 6;
          k.text(pg, `收款人：${s(p.settings.landlord) || "________"}（签章）`, M, y, { size: 11 }); k.text(pg, `日期：${x.date.replace(/-/g, " 年 ").replace(/ 年 (\d+)$/, " 月 $1 日")}`, W - M, y, { size: 11, align: "right" });
        });
        if (!pays.length) k.doc.addPage([W, H]);
        return [await ctx.write("receipts.pdf", await k.doc.save())];
      } },
      { id: "md", label: ["催租提醒", "Reminders"], description: "reminders.md", async run(ctx: ExportCtx) {
        const p = ctx.project, { tenants, asOf } = analyse(p), od = tenants.filter((t) => t.overdue.length);
        const txt = od.map((t) => { const amt = t.overdue.reduce((a, c) => a + c.amount - c.paid, 0); return `## ${t.l.unit} ${t.l.tenant}${t.phone ? `（${t.phone}）` : ""}\n\n${t.l.tenant}您好，${t.overdue.map((c) => `${c.label}${c.paid ? `还差 ${money(c.amount - c.paid)} 元（已付 ${money(c.paid)} 元）` : ` ${money(c.amount)} 元`}`).join("，")}，应在 ${t.overdue[0].due} 前支付，截至 ${asOf} 合计 ${money(amt)} 元还没有收到。方便的话请这几天转一下，已经付过的话麻烦发个截图我核对一下，谢谢！${s(p.settings.landlord) ? `\n\n—— ${s(p.settings.landlord)}` : ""}\n`; }).join("\n");
        return [await ctx.write("reminders.md", `# 催租提醒（截至 ${asOf}）\n\n${txt || "没有逾期的租金。\n"}`)];
      } },
    ],
    describeRow: (r, i) => r.kind === "tenant"
      ? `#${i} [tenant] ${s(r.unit)} ${s(r.tenant)} rent ${s(r.rent)} ${s(r.cycle) || "月付"} ${s(r.start)}→${s(r.end) || "?"} day ${s(r.dueDay) || "-"}${s(r.settledTo) ? ` settled to ${s(r.settledTo)}` : ""}${s(r._status) ? ` | ${s(r._status)}` : ""}`
      : `#${i}${r.include === false ? " [dropped]" : ""} [pay] ${s(r.date)} ${s(r.unit) || s(r.tenant)} ${s(r.amount)} ${s(r.method)}${s(r._status) ? ` | ${s(r._status)}` : ""}`,
  };
}

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(makeDef(), options).server;
}
