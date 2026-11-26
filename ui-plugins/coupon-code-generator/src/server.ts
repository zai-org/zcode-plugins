import { createApp, esc, type AppDef, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { mapHeaders, num } from "./kit/columns.ts";
import { readTable } from "./kit/table.ts";
import { KitError } from "./kit/workspace.ts";
import { cardsPdf, qrText, type Coupon } from "./cards.ts";
import { CHARSETS, generate, newSeed, type Charset } from "./codes.ts";

export const NAME = "coupon-code-generator";
export const VERSION = "0.1.0";

const s = (v: unknown) => String(v ?? "").trim();
const cleanPrefix = (v: unknown) => s(v).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

function build(p: Project): { coupons: Coupon[]; errors: string[] } {
  const st = p.settings;
  const charset = (s(st.charset) in CHARSETS ? s(st.charset) : "safe") as Charset;
  const pattern = s(st.pattern).toUpperCase() || "XXXX-XXXX";
  const taken = new Set<string>(((p.meta?.excluded as string[]) ?? []).map((c) => c.toUpperCase()));
  const coupons: Coupon[] = [];
  const errors: string[] = [];
  p.rows.forEach((r) => {
    if (r.include === false) return;
    const count = Math.max(0, Math.floor(Number(r.count) || 0));
    if (!count) return;
    try {
      const codes = generate({ seed: s(st.seed), batch: s(r.batch) || "batch", prefix: cleanPrefix(r.prefix), pattern, charset, checksum: st.checksum !== false, count, taken });
      for (const code of codes) coupons.push({ code, batch: s(r.batch), value: s(r.value), expiry: s(r.expiry), note: s(r.note) });
    } catch (e) { errors.push(`${s(r.batch) || "batch"}: ${(e as Error).message}`); }
  });
  return { coupons, errors };
}

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "coupon",
  title: ["兑换码批量生成", "Coupon Code Generator"],
  openDescription:
    "Generate unique coupon / redeem / gift codes in batches from a campaign sheet (CSV/XLSX with columns such as 批次/batch, 前缀/prefix, 数量/count, 面值/value, 有效期/expiry, 说明/note). Codes follow a pattern such as XXXX-XXXX, use a character set without look-alikes (no 0/O/1/I) or digits only, can end in a check character so typos are caught, and are derived from a seed so the same campaign always gives the same codes. Pick a list of already-issued codes too and they are never reused. Exports codes.csv for your shop system and a cards PDF (10 per A4, value, code, expiry and QR code that can link to your redeem page).",
  inputs: { exts: [".csv", ".xlsx", ".tsv", ".txt"], min: 1, max: 3, label: ["选择活动批次表（可再选已发码清单）", "Pick the campaign sheet (and any list of codes already issued)"] },
  settings: [
    { key: "seed", label: ["种子（改了会生成全新的一批码）", "Seed (changing it makes all-new codes)"], type: "text", default: "" },
    { key: "pattern", label: ["码型（X 为随机字符）", "Pattern (X = random character)"], type: "text", default: "XXXX-XXXX" },
    { key: "charset", label: ["字符集", "Characters"], type: "select", default: "safe", options: [{ value: "safe", label: ["字母+数字（去掉易混的 0O1I）", "Letters + digits, no look-alikes"] }, { value: "upper", label: ["仅字母", "Letters only"] }, { value: "digits", label: ["仅数字", "Digits only"] }, { value: "alnum", label: ["全部字母+数字", "All letters + digits"] }] },
    { key: "checksum", label: ["末尾加校验位", "Add a check character"], type: "bool", default: true },
    { key: "brand", label: ["卡片抬头（店名）", "Card heading (shop name)"], type: "text", default: "" },
    { key: "accent", label: ["主题色", "Accent colour"], type: "color", default: "#dc2626" },
    { key: "qr", label: ["卡片二维码（code=只放码；或填兑换页网址，可用 {code}）", "Card QR (code = just the code; or a redeem URL, {code} allowed)"], type: "text", default: "code" },
  ],
  columns: () => [
    { key: "include", label: ["生成", "Make"], type: "bool" },
    { key: "batch", label: ["批次", "Batch"] },
    { key: "prefix", label: ["前缀", "Prefix"] },
    { key: "count", label: ["数量", "Count"], type: "number" },
    { key: "value", label: ["面值 / 内容", "Value"] },
    { key: "expiry", label: ["有效期", "Expiry"] },
    { key: "note", label: ["说明", "Note"], wide: true },
  ],
  newRow: () => ({ include: true, batch: "", prefix: "", count: 10, value: "", expiry: "", note: "" }),
  async load({ ws, files, settings }) {
    let rows: Row[] | undefined;
    const excluded: string[] = [];
    for (const f of files) {
      if (/\.txt$/i.test(f)) { excluded.push(...(await ws.readText(f)).split(/[\r\n,\t]+/).map((x) => x.trim()).filter(Boolean)); continue; }
      const t = await readTable(ws, f);
      const m = mapHeaders(t.columns, { batch: ["批次", "活动", "名称", "batch", "campaign", "name"], prefix: ["前缀", "prefix"], count: ["数量", "张数", "count", "quantity", "qty"], value: ["面值", "金额", "内容", "value", "amount", "reward"], expiry: ["有效期", "截止", "到期", "expiry", "expires", "valid until"], note: ["说明", "备注", "规则", "note", "terms"], code: ["兑换码", "优惠码", "券码", "code", "coupon"] });
      if (!rows && m.count) {
        rows = t.rows.filter((r) => s(r[m.batch ?? m.count!]) || s(r[m.count!])).map((r) => ({ include: true, batch: m.batch ? s(r[m.batch]) : "", prefix: m.prefix ? cleanPrefix(r[m.prefix]) : "", count: Math.max(0, Math.floor(num(r[m.count!]) || 0)), value: m.value ? s(r[m.value]) : "", expiry: m.expiry ? s(r[m.expiry]).slice(0, 10) : "", note: m.note ? s(r[m.note]) : "" }));
      } else {
        const col = m.code ?? t.columns[0];
        if (!m.code) excluded.push(t.columns[0]);
        for (const r of t.rows) if (s(r[col])) excluded.push(s(r[col]));
      }
    }
    if (!rows) rows = [{ include: true, batch: "批次 1", prefix: "", count: 50, value: "", expiry: "", note: "" }];
    if (!s(settings.seed)) settings.seed = newSeed();
    return { rows, meta: { excluded } };
  },
  compute(p) {
    const issues: Issue[] = [];
    const { coupons, errors } = build(p);
    for (const e of errors) issues.push({ level: "error", message: e });
    const prefixes = new Map<string, number>();
    p.rows.forEach((r, i) => {
      if (r.include === false) return;
      if (!(Number(r.count) > 0)) issues.push({ level: "warn", row: i, key: "count", message: `${r.batch || `Row ${i + 1}`}: count is 0.` });
      if (Number(r.count) > 20000) issues.push({ level: "warn", row: i, key: "count", message: `${r.batch}: ${r.count} codes — the cards PDF will be very large; export the CSV only.` });
      if (!s(r.value)) issues.push({ level: "info", row: i, key: "value", message: `${r.batch || `Row ${i + 1}`}: no value set.` });
      const ex = s(r.expiry);
      if (ex && /^\d{4}-\d{2}-\d{2}$/.test(ex) && ex < new Date().toISOString().slice(0, 10)) issues.push({ level: "warn", row: i, key: "expiry", message: `${r.batch}: expiry ${ex} is in the past.` });
      const pf = cleanPrefix(r.prefix);
      if (pf && prefixes.has(pf)) issues.push({ level: "info", row: i, key: "prefix", message: `${r.batch}: same prefix ${pf} as row ${prefixes.get(pf)! + 1}.` });
      if (pf) prefixes.set(pf, i);
    });
    if (!/X/i.test(s(p.settings.pattern) || "X")) issues.push({ level: "error", key: "pattern", message: "The pattern needs at least one X." });
    const ex = ((p.meta?.excluded as string[]) ?? []).length;
    const sample = coupons.slice(0, 12);
    const preview = `<div style="font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif"><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px">${sample.map((c) => `<div style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden"><div style="background:${esc(s(p.settings.accent) || "#dc2626")};color:#fff;font-size:11px;padding:3px 8px">${esc(s(p.settings.brand) || c.batch)}</div><div style="padding:6px 8px"><div style="font-weight:700;color:${esc(s(p.settings.accent) || "#dc2626")}">${esc(c.value)}</div><div style="font:600 14px ui-monospace,Menlo,monospace;letter-spacing:.5px">${esc(c.code)}</div><div style="font-size:11px;color:#6b7280">${esc(c.expiry ? `至 ${c.expiry}` : "")}</div></div></div>`).join("")}</div>${coupons.length > 12 ? `<p style="color:#6b7280;font-size:12px">… ${coupons.length - 12} more</p>` : ""}</div>`;
    return { rows: p.rows, issues, preview, summary: `${coupons.length} codes in ${p.rows.filter((r) => r.include !== false && Number(r.count) > 0).length} batches${ex ? ` · ${ex} existing codes avoided` : ""}`, stats: { codes: coupons.length, excluded: ex } };
  },
  exports: [
    {
      id: "csv", label: ["兑换码 CSV", "Codes CSV"], description: "codes.csv — code, batch, value, expiry, note (UTF-8 with BOM, opens in Excel)",
      async run({ project, write, computed }: ExportCtx) {
        const errs = (computed.issues ?? []).filter((i) => i.level === "error");
        if (errs.length) throw new KitError("has_errors", `Fix first: ${errs[0].message}`);
        const { coupons } = build(project);
        const csv = "\ufeff" + ["code,batch,value,expiry,note,qr", ...coupons.map((c) => [c.code, c.batch, c.value, c.expiry, c.note, s(project.settings.qr) === "none" ? "" : qrText(s(project.settings.qr) === "code" ? "" : s(project.settings.qr), c.code)].map(csvCell).join(","))].join("\r\n") + "\r\n";
        return [await write("codes.csv", csv)];
      },
    },
    {
      id: "cards", label: ["兑换卡 PDF", "Cards PDF"], description: "coupon-cards.pdf — 10 cards per A4 with cut lines",
      async run({ project, write }: ExportCtx) {
        const { coupons } = build(project);
        if (coupons.length > 20000) throw new KitError("too_many", "More than 20,000 codes — print cards in smaller batches.");
        return [await write("coupon-cards.pdf", await cardsPdf(coupons, { brand: s(project.settings.brand), accent: s(project.settings.accent) || "#dc2626", qr: s(project.settings.qr) || "code" }))];
      },
    },
  ],
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
