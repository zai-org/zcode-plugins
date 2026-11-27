import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { createApp, esc, type AppDef, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { mapHeaders, parseDate } from "./kit/columns.ts";
import { initRenderer, loadFonts, renderSvg, escapeXml } from "./kit/render.ts";
import { writeXlsx } from "./kit/sheet.ts";
import { readTable } from "./kit/table.ts";
import { KitError } from "./kit/workspace.ts";
import { balances, money, parsePayers, parseShares, settle, type Parsed, type Transfer } from "./split.ts";

export const NAME = "expense-splitter";
export const VERSION = "0.1.0";

const s = (v: unknown) => String(v ?? "").trim();
const sep = /[,，、;；\n]+/;
const ALL = /^(全部|全体|所有人|大家|全员|all|everyone|everybody|\*)$/i;

/** 表里出现过的名字（付款人 + 参与人里写明的），按首次出现的顺序。 */
function namesIn(rows: Row[]) {
  const out: string[] = [];
  const add = (n: string) => { n = n.trim(); if (n && !out.includes(n)) out.push(n); };
  for (const r of rows) {
    for (const p of s(r.payer).split(sep)) { const m = /^(.+?)\s*(?:[:：=]\s*|\s+)[¥￥$]?\s*[\d.,]+\s*元?$/.exec(p.trim()); add(m ? m[1] : p); }
    for (const t of s(r.participants).split(sep).map((x) => x.trim()).filter(Boolean)) {
      if (ALL.test(t) || /^(?:-|－|除了?|except\s|not\s)/i.test(t)) continue;
      add(t.replace(/\s*(?:[:：=+＋]\s*[¥￥$]?\s*[\d.,]+\s*元?|[*×xX]\s*\d+(?:\.\d+)?|[（(]\d+(?:\.\d+)?[)）])$/, ""));
    }
  }
  return out;
}

export function analyse(p: Project) {
  const listed = s(p.settings.people).split(sep).map((x) => x.trim()).filter(Boolean);
  const seen = namesIn(p.rows);
  const people = listed.length ? [...listed, ...seen.filter((n) => !listed.includes(n))] : seen;
  const issues: Issue[] = [];
  if (listed.length) for (const n of seen.filter((x) => !listed.includes(x))) issues.push({ level: "warn", message: `“${n}” is not in the people list; added / “${n}”不在成员名单里，已加入` });
  const norm = (x: string) => x.replace(/\s+/g, "").toLowerCase();
  for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) if (norm(people[i]) === norm(people[j])) issues.push({ level: "warn", message: `“${people[i]}” and “${people[j]}” look like the same person — use one spelling / 名字写法不一致` });
  const items: Parsed[] = p.rows.map((r, row) => {
    const errors: string[] = [], warns: string[] = [];
    const amount = money(r.amount);
    if (!Number.isFinite(amount)) errors.push(`amount “${s(r.amount)}” is not a number / 金额不是数字`);
    else if (amount < 0) errors.push("negative amount — enter refunds as a separate expense paid by the person who got the money / 金额为负");
    const a = Number.isFinite(amount) ? amount : 0;
    const pay = parsePayers(s(r.payer), a);
    if (pay.error) errors.push(pay.error);
    const sh = parseShares(s(r.participants), Math.round(a * 100), people);
    if (sh.error) errors.push(sh.error);
    if (sh.warn) warns.push(sh.warn);
    if (!s(r.item)) warns.push("no description / 没有写项目");
    return { row, amount: a, paid: pay.paid, owed: sh.owed, errors, warns };
  });
  for (const it of items) {
    for (const e of it.errors) issues.push({ level: "error", row: it.row, message: e });
    for (const w of it.warns) issues.push({ level: "warn", row: it.row, message: w });
  }
  const { bal, paid, owed } = balances(items, people);
  const transfers = settle(bal);
  return { people, items, bal, paid, owed, transfers, issues };
}

const fmt = (c: number, cur: string) => `${c < 0 ? "-" : ""}${cur}${(Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const shareText = (m: Map<string, number>, people: string[]) => people.filter((n) => m.get(n)).map((n) => `${n} ${(m.get(n)! / 100).toFixed(2)}`).join(" · ");

function previewHtml(a: ReturnType<typeof analyse>, cur: string) {
  const max = Math.max(1, ...[...a.bal.values()].map(Math.abs));
  const rows = a.people.map((n) => {
    const b = a.bal.get(n) ?? 0, w = Math.round((Math.abs(b) / max) * 100);
    const bar = `<div style="display:flex;height:10px"><div style="flex:1;display:flex;justify-content:flex-end">${b < 0 ? `<div style="width:${w}%;background:#f87171;border-radius:3px 0 0 3px"></div>` : ""}</div><div style="flex:1">${b > 0 ? `<div style="width:${w}%;height:10px;background:#34d399;border-radius:0 3px 3px 0"></div>` : ""}</div></div>`;
    return `<tr><td>${esc(n)}</td><td class="num">${esc(fmt(a.paid.get(n) ?? 0, cur))}</td><td class="num">${esc(fmt(a.owed.get(n) ?? 0, cur))}</td><td class="num" style="color:${b > 0 ? "#059669" : b < 0 ? "#dc2626" : "inherit"}">${esc(fmt(b, cur))}</td><td style="width:30%">${bar}</td></tr>`;
  }).join("");
  const tr = a.transfers.length ? a.transfers.map((t) => `<li><b>${esc(t.from)}</b> → <b>${esc(t.to)}</b> <span style="float:right">${esc(fmt(t.amount, cur))}</span></li>`).join("") : "<li>已结清 / All settled</li>";
  return `<div style="font-size:13px"><h3 style="margin:0 0 6px;font-size:14px">怎么转账 How to settle — ${a.transfers.length} 笔</h3><ol style="margin:0 0 12px;padding-left:20px;max-width:420px">${tr}</ol><table class="data"><thead><tr><th>成员 Person</th><th>已付 Paid</th><th>应摊 Share</th><th>差额 Net</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/** 结算卡片 SVG（导出 PNG 用）。 */
function cardSvg(a: ReturnType<typeof analyse>, cur: string, title: string, family: string) {
  const W = 760, pad = 36;
  const total = a.items.filter((x) => !x.errors.length).reduce((t, x) => t + Math.round(x.amount * 100), 0);
  let y = 0;
  const parts: string[] = [];
  const text = (x: number, yy: number, t: string, o: { size?: number; weight?: number; color?: string; anchor?: string } = {}) => parts.push(`<text x="${x}" y="${yy}" font-size="${o.size ?? 18}" font-weight="${o.weight ?? 400}" fill="${o.color ?? "#1f2937"}" text-anchor="${o.anchor ?? "start"}" font-family="${escapeXml(family)}">${escapeXml(t)}</text>`);
  y = 64; text(pad, y, title || "AA 分账结算", { size: 30, weight: 700 });
  y += 34; text(pad, y, `${a.people.length} 人 · ${a.items.length} 笔花费 · 合计 ${fmt(total, cur)}`, { size: 17, color: "#6b7280" });
  y += 40; text(pad, y, `转账 ${a.transfers.length} 笔即可结清`, { size: 20, weight: 700, color: "#2563eb" });
  y += 14;
  for (const t of a.transfers.length ? a.transfers : [null]) {
    parts.push(`<rect x="${pad}" y="${y}" width="${W - 2 * pad}" height="48" rx="10" fill="#eff6ff"/>`);
    if (t) { text(pad + 18, y + 31, `${t.from}  →  ${t.to}`, { size: 20, weight: 700 }); text(W - pad - 18, y + 31, fmt(t.amount, cur), { size: 22, weight: 700, color: "#1d4ed8", anchor: "end" }); }
    else text(pad + 18, y + 31, "已经结清，不用转账", { size: 20 });
    y += 58;
  }
  y += 22; text(pad, y, "成员", { size: 15, color: "#6b7280" }); text(W - pad - 250, y, "已付", { size: 15, color: "#6b7280", anchor: "end" }); text(W - pad - 125, y, "应摊", { size: 15, color: "#6b7280", anchor: "end" }); text(W - pad, y, "差额", { size: 15, color: "#6b7280", anchor: "end" });
  y += 8; parts.push(`<line x1="${pad}" x2="${W - pad}" y1="${y}" y2="${y}" stroke="#e5e7eb"/>`);
  for (const n of a.people) {
    y += 32; const b = a.bal.get(n) ?? 0;
    text(pad, y, n, { size: 18 }); text(W - pad - 250, y, fmt(a.paid.get(n) ?? 0, cur), { size: 17, anchor: "end" }); text(W - pad - 125, y, fmt(a.owed.get(n) ?? 0, cur), { size: 17, anchor: "end" });
    text(W - pad, y, `${b > 0 ? "+" : ""}${fmt(b, cur)}`, { size: 17, weight: 700, anchor: "end", color: b > 0 ? "#059669" : b < 0 ? "#dc2626" : "#6b7280" });
  }
  y += 40; text(pad, y, "正数 = 应收回，负数 = 还需付出", { size: 13, color: "#9ca3af" });
  const H = y + 28;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#ffffff"/><rect width="${W}" height="8" fill="#2563eb"/>${parts.join("")}</svg>`;
}

function wasmPath(assetRoot: string) {
  const p = join(assetRoot, "resvg.wasm");
  if (existsSync(p)) return p;
  return createRequire(import.meta.url).resolve("@resvg/resvg-wasm/index_bg.wasm");
}

function makeDef(assetRoot: string): AppDef {
  return {
    name: NAME,
    version: VERSION,
    prefix: "split",
    title: ["AA 分账", "Expense Splitter"],
    openDescription:
      "Split shared expenses for a trip, dinner or flat: read an expense sheet (.csv/.xlsx; columns like 日期/date, 项目/item, 付款人/paid by, 金额/amount, 参与人/split between), or start empty with inputs: []. Payer can be one name or several with amounts (“小李:900; 阿珍:500”). Participants: 全部/all, a list (“A, B, C”), all except someone (“全部, -Tom”), weights (“A*2, B”) an exact amount (“Tom:80, 小王, 小李” — Tom pays exactly 80, the rest is split between the others) or an extra on top of an equal share (“Tom+80, 全部”). One currency. Shows each person's paid / share / net and the fewest transfers that settle everything.",
    inputs: { exts: [".csv", ".xlsx", ".tsv"], min: 0, max: 1, label: ["选择花费明细表（可选）", "Pick the expense sheet (optional)"] },
    settings: [
      { key: "title", label: ["标题", "Title"], type: "text", default: "" },
      { key: "currency", label: ["货币符号", "Currency symbol"], type: "text", default: "¥" },
      { key: "people", label: ["成员（逗号分隔，可选）", "People (comma-separated, optional)"], type: "text", default: "", help: ["“全部”按这里的名单分摊；留空则用表里出现过的名字", "“all” means these people; empty = everyone named in the sheet"] },
    ],
    columns: () => [
      { key: "date", label: ["日期", "Date"], type: "date" },
      { key: "item", label: ["项目", "Item"], wide: true },
      { key: "payer", label: ["付款人", "Paid by"] },
      { key: "amount", label: ["金额", "Amount"], type: "number" },
      { key: "participants", label: ["参与人", "Split between"], wide: true },
      { key: "note", label: ["备注", "Note"] },
      { key: "_each", label: ["每人分摊", "Each owes"], readOnly: true, wide: true },
    ],
    newRow: () => ({ date: new Date().toISOString().slice(0, 10), item: "", payer: "", amount: 0, participants: "全部", note: "" }),
    async load({ ws, files }) {
      if (!files.length) return { rows: [] };
      const t = await readTable(ws, files[0]);
      const m = mapHeaders(t.columns, {
        date: ["日期", "时间", "date", "day"],
        item: ["项目", "内容", "说明", "描述", "item", "description", "what", "expense"],
        payer: ["付款人", "谁付的", "付款", "垫付人", "paid by", "payer", "who paid"],
        amount: ["金额", "花费", "费用", "amount", "cost", "total", "price"],
        participants: ["参与人", "分摊人", "分摊", "参与", "split between", "for", "participants", "shared by", "split"],
        note: ["备注", "note", "notes", "memo"],
      });
      const miss = ["payer", "amount"].filter((k) => !m[k]);
      if (miss.length) throw new KitError("columns_not_found", `Couldn't find ${miss.join(" and ")} column(s) (付款人/paid by, 金额/amount). Columns: ${t.columns.join(", ")}`);
      const rows: Row[] = t.rows.filter((r) => s(r[m.amount!]) || s(r[m.payer!])).map((r) => {
        const d = m.date ? r[m.date] : "";
        const pd = parseDate(d) || s(d);
        return { date: pd, item: m.item ? s(r[m.item]) : "", payer: s(r[m.payer!]), amount: r[m.amount!] ?? "", participants: m.participants ? s(r[m.participants]) || "全部" : "全部", note: m.note ? s(r[m.note]) : "" };
      });
      return { rows };
    },
    compute(p): Computed {
      const a = analyse(p);
      const cur = s(p.settings.currency) || "¥";
      const rows = p.rows.map((r, i) => ({ ...r, _each: a.items[i]?.errors.length ? "" : shareText(a.items[i]?.owed ?? new Map(), a.people) }));
      const total = a.items.filter((x) => !x.errors.length).reduce((t, x) => t + Math.round(x.amount * 100), 0);
      return {
        rows,
        issues: a.issues,
        summary: `${a.people.length} people, ${p.rows.length} expense(s), total ${fmt(total, cur)} → ${a.transfers.length} transfer(s) settle up. ${a.people.length} 人 ${p.rows.length} 笔，共 ${fmt(total, cur)}，转账 ${a.transfers.length} 笔即可结清。`,
        stats: { people: a.people.length, expenses: p.rows.length, total: total / 100, transfers: a.transfers.length },
        preview: p.rows.length ? previewHtml(a, cur) : "",
      };
    },
    exports: [
      {
        id: "xlsx", label: ["结算表 Excel", "Settlement workbook"], description: "settlement.xlsx — transfers, balances and every expense split per person",
        async run({ project, write, computed }: ExportCtx) {
          if ((computed.issues ?? []).some((i) => i.level === "error")) throw new KitError("has_errors", "Fix the errors first (see the issue list).");
          const a = analyse(project);
          const yuan = (c: number) => Math.round(c) / 100;
          const xlsx = await writeXlsx([
            { name: "转账 Settle", headers: ["付款人 From", "收款人 To", "金额 Amount"], rows: a.transfers.map((t: Transfer) => [t.from, t.to, yuan(t.amount)]), numberFormat: { 2: "#,##0.00" }, widths: [16, 16, 14] },
            { name: "余额 Balances", headers: ["成员 Person", "已付 Paid", "应摊 Share", "差额 Net"], rows: a.people.map((n) => [n, yuan(a.paid.get(n) ?? 0), yuan(a.owed.get(n) ?? 0), yuan(a.bal.get(n) ?? 0)]), numberFormat: { 1: "#,##0.00", 2: "#,##0.00", 3: "#,##0.00;[Red]-#,##0.00" }, widths: [16, 14, 14, 14] },
            {
              name: "明细 Expenses",
              headers: ["日期", "项目", "付款人", "金额", "参与人", ...a.people.map((n) => `${n} 应摊`)],
              rows: a.items.map((it) => { const r = project.rows[it.row]; return [s(r.date), s(r.item), s(r.payer), it.amount, s(r.participants), ...a.people.map((n) => yuan(it.owed.get(n) ?? 0))]; }),
              numberFormat: Object.fromEntries([3, ...a.people.map((_, i) => 5 + i)].map((c) => [c, "#,##0.00"])),
              widths: [12, 24, 18, 12, 24, ...a.people.map(() => 12)],
            },
          ]);
          return [await write("settlement.xlsx", xlsx)];
        },
      },
      {
        id: "png", label: ["结算图片 PNG", "Settlement image (PNG)"], description: "settlement.png — a card to send to the group chat",
        async run({ project, write, computed }: ExportCtx) {
          if ((computed.issues ?? []).some((i) => i.level === "error")) throw new KitError("has_errors", "Fix the errors first (see the issue list).");
          await initRenderer(wasmPath(assetRoot));
          const fonts = await loadFonts(process.env.EXPENSE_SPLITTER_FONT);
          const svg = cardSvg(analyse(project), s(project.settings.currency) || "¥", s(project.settings.title), fonts.family);
          const png = await renderSvg(svg, fonts, 1520);
          return [await write("settlement.png", png.png)];
        },
      },
    ],
    describeRow: (r, i) => `#${i} ${s(r.date)} ${s(r.item)} · ${s(r.payer)} paid ${s(r.amount)} · split: ${s(r.participants)} → ${s(r._each)}`,
  };
}

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(makeDef(options.assetRoot), options).server;
}
