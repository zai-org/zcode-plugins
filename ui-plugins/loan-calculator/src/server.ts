import { createApp, esc, type AppDef, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { mapHeaders, num } from "./kit/columns.ts";
import { writeXlsx, type SheetSpec } from "./kit/sheet.ts";
import { readTable } from "./kit/table.ts";
import { KitError } from "./kit/workspace.ts";
import { parsePrepays, parseRates, schedule, type Plan, type Result } from "./loan.ts";

export const NAME = "loan-calculator";
export const VERSION = "0.1.0";

const s = (v: unknown) => String(v ?? "").trim();
const COLORS = ["#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c", "#0891b2"];
const thisMonth = () => { const d = new Date(); d.setMonth(d.getMonth() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const ym = (v: unknown) => { const m = /(\d{4})[-/.年](\d{1,2})/.exec(s(v)); return m ? `${m[1]}-${m[2].padStart(2, "0")}` : ""; };

function plansOf(p: Project): { plan: Plan; row: number; errors: string[] }[] {
  return p.rows.map((r, i) => ({ r, i })).filter(({ r }) => r.include !== false).map(({ r, i }) => {
    const errors: string[] = [];
    const start = ym(r.start) || thisMonth();
    const principal = num(r.principal) * (/万/.test(s(r.principal)) ? 10000 : 1);
    const rate = num(r.rate);
    const months = Math.round(num(r.years) * 12) || 0;
    if (!(principal > 0)) errors.push("loan amount must be more than 0");
    if (!(rate >= 0) || rate > 36) errors.push(`rate “${s(r.rate)}” should be a yearly % like 3.1`);
    if (!(months > 0) || months > 600) errors.push(`term “${s(r.years)}” should be 1–50 years`);
    const prepays = parsePrepays(s(r.prepay), start);
    if (!prepays) errors.push(`prepayments “${s(r.prepay)}” aren't understood (e.g. 2029-01:200000 缩短期限; 第36期:5万 减少月供)`);
    const rates = parseRates(s(r.rateChanges), start);
    if (!rates) errors.push(`rate changes “${s(r.rateChanges)}” aren't understood (e.g. 2028-01:2.9)`);
    return { row: i, errors, plan: { name: s(r.name) || `方案 ${i + 1}`, principal, rate, months, method: /本金|principal/i.test(s(r.method)) ? "principal" : "annuity", start, prepays: prepays ?? [], rates: rates ?? [] } };
  });
}

const money = (n: number, cur: string) => `${cur}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const wan = (n: number, cur: string) => (Math.abs(n) >= 10000 ? `${cur}${(n / 10000).toFixed(2)} 万` : money(n, cur));

function chartSvg(items: { plan: Plan; res: Result }[], cur: string, w = 760, h = 300) {
  const maxN = Math.max(...items.map((x) => x.res.months), 1);
  const maxB = Math.max(...items.map((x) => x.plan.principal), 1);
  const L = 64, R = 16, T = 16, B = 34;
  const X = (n: number) => L + ((w - L - R) * n) / maxN, Y = (b: number) => T + (h - T - B) * (1 - b / maxB);
  const yt = [0, 0.25, 0.5, 0.75, 1].map((f) => `<line x1="${L}" x2="${w - R}" y1="${Y(maxB * f)}" y2="${Y(maxB * f)}" stroke="#eef2f7"/><text x="${L - 6}" y="${Y(maxB * f) + 4}" text-anchor="end" font-size="11" fill="#6b7280">${esc(wan(maxB * f, cur))}</text>`).join("");
  const years = Math.ceil(maxN / 12);
  const step = years > 20 ? 5 : years > 10 ? 2 : 1;
  const xt = Array.from({ length: Math.floor(years / step) + 1 }, (_, i) => i * step * 12).map((n) => `<text x="${X(n)}" y="${h - 12}" text-anchor="middle" font-size="11" fill="#6b7280">${n / 12}年</text>`).join("");
  const lines = items.map(({ plan, res }, i) => `<polyline fill="none" stroke="${COLORS[i % COLORS.length]}" stroke-width="2" points="${[`${X(0)},${Y(plan.principal)}`, ...res.schedule.map((p) => `${X(p.n).toFixed(1)},${Y(p.balance).toFixed(1)}`)].join(" ")}"/>`).join("");
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="-apple-system,'PingFang SC','Microsoft YaHei',sans-serif">${yt}${xt}${lines}</svg>`;
}

function reportHtml(p: Project, items: { plan: Plan; res: Result }[], full: boolean) {
  const cur = s(p.settings.currency) || "¥";
  const base = items[0]?.res.totalInterest ?? 0;
  const cards = items.map(({ plan, res }, i) => `<div style="flex:1;min-width:200px;border:1px solid #e5e7eb;border-top:4px solid ${COLORS[i % COLORS.length]};border-radius:10px;padding:12px 14px"><div style="font-weight:700;margin-bottom:6px">${esc(plan.name)}</div><div style="font-size:12px;color:#6b7280">${plan.method === "annuity" ? "等额本息" : "等额本金"} · ${plan.rate}% · ${plan.months / 12} 年</div><div style="margin-top:8px;font-size:13px">首月月供 <b>${esc(money(res.firstPayment, cur))}</b></div><div style="font-size:13px">总利息 <b style="color:#b91c1c">${esc(wan(res.totalInterest, cur))}</b></div><div style="font-size:13px">还清 <b>${esc(res.payoff)}</b>（${Math.floor(res.months / 12)} 年 ${res.months % 12} 个月）</div>${i > 0 ? `<div style="font-size:13px;color:${base - res.totalInterest >= 0 ? "#15803d" : "#b91c1c"}">比方案 1 ${base - res.totalInterest >= 0 ? "少" : "多"}付利息 ${esc(wan(Math.abs(base - res.totalInterest), cur))}</div>` : ""}</div>`).join("");
  const legend = items.map(({ plan }, i) => `<span style="margin-right:14px;font-size:12px"><i style="display:inline-block;width:14px;height:3px;background:${COLORS[i % COLORS.length]};vertical-align:middle;margin-right:4px"></i>${esc(plan.name)}</span>`).join("");
  const body = `<div style="display:flex;gap:10px;flex-wrap:wrap">${cards}</div><h3 style="font-size:14px;margin:18px 0 4px">剩余本金 Remaining balance</h3><div>${legend}</div>${chartSvg(items, cur)}`;
  if (!full) return `<div style="font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;color:#1f2937">${body}</div>`;
  const yearly = items.map(({ plan, res }) => { const ys = new Map<string, { pay: number; int: number; pre: number; bal: number }>(); for (const x of res.schedule) { const y = x.month.slice(0, 4); const v = ys.get(y) ?? { pay: 0, int: 0, pre: 0, bal: 0 }; v.pay += x.payment; v.int += x.interest; v.pre += x.prepay; v.bal = x.balance; ys.set(y, v); } return `<h3 style="font-size:14px">${esc(plan.name)} · 按年 By year</h3><table><tr><th>年份</th><th>月供合计</th><th>其中利息</th><th>提前还款</th><th>年末剩余本金</th></tr>${[...ys].map(([y, v]) => `<tr><td>${y}</td><td>${esc(money(v.pay, cur))}</td><td>${esc(money(v.int, cur))}</td><td>${v.pre ? esc(money(v.pre, cur)) : ""}</td><td>${esc(money(v.bal, cur))}</td></tr>`).join("")}</table>`; }).join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(s(p.settings.title) || "贷款方案对比")}</title><style>body{font:14px/1.5 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#1f2937;max-width:900px;margin:24px auto;padding:0 16px}h1{font-size:20px}table{border-collapse:collapse;width:100%;font-size:12px;margin-bottom:14px}td,th{border-bottom:1px solid #eef2f7;padding:4px 8px;text-align:right}th{background:#f8fafc}td:first-child,th:first-child{text-align:left}.note{color:#6b7280;font-size:12px}</style></head><body><h1>${esc(s(p.settings.title) || "贷款方案对比 Loan comparison")}</h1>${body}${yearly}<p class="note">按月计息，提前还款在当月正常还款后发生，利率调整从当月起生效。结果仅供参考，以银行实际计算为准。</p></body></html>`;
}

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "loan",
  title: ["贷款分期计算", "Loan Calculator"],
  openDescription:
    "Compare up to several loan / mortgage plans side by side: amount, yearly interest rate, term, repayment method (等额本息 annuity — equal monthly payments; 等额本金 equal principal — decreasing payments), first payment month, prepayments (e.g. “2029-01:200000 缩短期限; 第36期:5万 减少月供” — shorten the term or lower the payment) and rate changes (e.g. “2028-01:2.9”). Shows first and highest monthly payment, total interest, payoff date and interest saved versus plan 1, with a remaining-balance chart. Exports a workbook with the comparison and a month-by-month schedule per plan, and a chart page. Pick a plans sheet, or start with no file and type the plans in.",
  inputs: { exts: [".csv", ".xlsx", ".tsv"], min: 0, max: 1, label: ["选择方案表（可选）", "Pick a plans sheet (optional)"] },
  settings: [
    { key: "title", label: ["标题", "Title"], type: "text", default: "" },
    { key: "currency", label: ["货币符号", "Currency symbol"], type: "text", default: "¥" },
  ],
  columns: () => [
    { key: "include", label: ["对比", "Compare"], type: "bool" },
    { key: "name", label: ["方案", "Plan"] },
    { key: "principal", label: ["贷款金额", "Amount"], type: "number" },
    { key: "rate", label: ["年利率 %", "Rate % / yr"], type: "number" },
    { key: "years", label: ["期限（年）", "Term (years)"], type: "number" },
    { key: "method", label: ["还款方式", "Method"], type: "select", options: ["等额本息", "等额本金"] },
    { key: "start", label: ["首次还款（年-月）", "First payment (YYYY-MM)"] },
    { key: "prepay", label: ["提前还款", "Prepayments"], wide: true },
    { key: "rateChanges", label: ["利率调整", "Rate changes"] },
  ],
  newRow: () => ({ include: true, name: "", principal: 1000000, rate: 3.1, years: 30, method: "等额本息", start: thisMonth(), prepay: "", rateChanges: "" }),
  async load({ ws, files }) {
    if (!files.length) return { rows: [{ include: true, name: "等额本息", principal: 1000000, rate: 3.1, years: 30, method: "等额本息", start: thisMonth(), prepay: "", rateChanges: "" }, { include: true, name: "等额本金", principal: 1000000, rate: 3.1, years: 30, method: "等额本金", start: thisMonth(), prepay: "", rateChanges: "" }] };
    const t = await readTable(ws, files[0]);
    const m = mapHeaders(t.columns, { name: ["方案", "名称", "plan", "name"], principal: ["贷款金额", "金额", "本金", "贷款额", "amount", "principal", "loan"], rate: ["年利率", "利率", "rate", "interest rate", "apr"], years: ["期限", "年限", "贷款年限", "years", "term"], months: ["期数", "月数", "months"], method: ["还款方式", "方式", "method", "type"], start: ["首次还款", "首月", "开始", "first payment", "start"], prepay: ["提前还款", "prepay", "prepayment", "prepayments"], rateChanges: ["利率调整", "利率变化", "rate change", "rate changes"] });
    if (!m.principal) throw new KitError("no_amount", `Couldn't find a loan amount column (贷款金额/amount). Columns: ${t.columns.join(", ")}`);
    const rows: Row[] = t.rows.filter((r) => s(r[m.principal!])).map((r, i) => ({ include: true, name: m.name ? s(r[m.name]) : `方案 ${i + 1}`, principal: num(r[m.principal!]) * (/万/.test(s(r[m.principal!])) ? 10000 : 1), rate: m.rate ? num(r[m.rate]) : 0, years: m.years ? num(r[m.years]) : m.months ? num(r[m.months]) / 12 : 30, method: /本金|principal/i.test(m.method ? s(r[m.method]) : "") ? "等额本金" : "等额本息", start: (m.start ? ym(r[m.start]) : "") || thisMonth(), prepay: m.prepay ? s(r[m.prepay]) : "", rateChanges: m.rateChanges ? s(r[m.rateChanges]) : "" }));
    return { rows };
  },
  compute(p): Computed {
    const issues: Issue[] = [];
    const plans = plansOf(p);
    for (const x of plans) for (const e of x.errors) issues.push({ level: "error", row: x.row, message: `${x.plan.name}: ${e}.` });
    const ok = plans.filter((x) => !x.errors.length).map((x) => ({ plan: x.plan, res: schedule(x.plan) }));
    for (const x of plans.filter((y) => !y.errors.length)) {
      const res = schedule(x.plan);
      for (const pp of x.plan.prepays) if (pp.month < x.plan.start || pp.month > res.payoff) issues.push({ level: "warn", row: x.row, key: "prepay", message: `${x.plan.name}: prepayment in ${pp.month} is outside the loan period.` });
    }
    if (!ok.length) return { rows: p.rows, issues, preview: "", summary: "No valid plans", stats: { plans: 0 } };
    const cur = s(p.settings.currency) || "¥";
    const best = [...ok].sort((a, b) => a.res.totalInterest - b.res.totalInterest)[0];
    return { rows: p.rows, issues, preview: reportHtml(p, ok, false), summary: `${ok.length} plans · least interest: ${best.plan.name} (${wan(best.res.totalInterest, cur)})`, stats: { plans: ok.length, minInterest: best.res.totalInterest } };
  },
  exports: [
    {
      id: "xlsx", label: ["还款计划 Excel", "Schedule workbook"], description: "loan-schedule.xlsx — comparison + month-by-month schedule per plan",
      async run({ project, write, computed }: ExportCtx) {
        if ((computed.issues ?? []).some((i) => i.level === "error")) throw new KitError("has_errors", "Fix the errors first.");
        const items = plansOf(project).map((x) => ({ plan: x.plan, res: schedule(x.plan) }));
        const base = items[0].res.totalInterest;
        const money = "#,##0.00";
        const sheets: SheetSpec[] = [{ name: "对比 Compare", headers: ["方案", "还款方式", "贷款金额", "年利率%", "期限(月)", "首月月供", "最高月供", "总利息", "还款总额", "实际期数", "还清年月", "比方案1少付利息"], rows: items.map(({ plan, res }) => [plan.name, plan.method === "annuity" ? "等额本息" : "等额本金", plan.principal, plan.rate, plan.months, res.firstPayment, res.maxPayment, res.totalInterest, res.totalPaid, res.months, res.payoff, Math.round((base - res.totalInterest) * 100) / 100]), numberFormat: { 2: money, 5: money, 6: money, 7: money, 8: money, 11: money } }];
        for (const { plan, res } of items) sheets.push({ name: plan.name.slice(0, 28), headers: ["期数", "年月", "年利率%", "月供", "本金", "利息", "提前还款", "剩余本金"], rows: res.schedule.map((x) => [x.n, x.month, x.rate, x.payment, x.principal, x.interest, x.prepay || "", x.balance]), numberFormat: { 3: money, 4: money, 5: money, 6: money, 7: money }, marks: res.schedule.flatMap((x, i) => (x.prepay ? [{ row: i, col: 6, color: "#BBF7D0" }] : [])) });
        return [await write("loan-schedule.xlsx", await writeXlsx(sheets))];
      },
    },
    {
      id: "html", label: ["对比图表网页", "Comparison chart page"], description: "loan-report.html — plan cards, balance chart and yearly totals",
      async run({ project, write }: ExportCtx) {
        const items = plansOf(project).filter((x) => !x.errors.length).map((x) => ({ plan: x.plan, res: schedule(x.plan) }));
        return [await write("loan-report.html", reportHtml(project, items, true))];
      },
    },
  ],
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
