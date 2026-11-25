import type { Change, Seg } from "./compare.ts";

export type Status = "open" | "ok" | "question";
export interface Review { status: Status; note: string }
export type Reviewed = Change & Review;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const KIND_ZH: Record<string, string> = { added: "新增", deleted: "删除", modified: "修改", moved: "移动" };
const STATUS_ZH: Record<Status, string> = { open: "未确认", ok: "已确认", question: "有疑问" };

function segHtml(segs: Seg[], side: "old" | "new") {
  return segs.map((s) => (s.op === "=" ? esc(s.text) : s.op === "-" ? (side === "old" ? `<del>${esc(s.text)}</del>` : "") : side === "new" ? `<ins>${esc(s.text)}</ins>` : "")).join("");
}

export function reportHtml(o: { oldName: string; newName: string; changes: Reviewed[]; stats: Record<string, number>; generated: string }) {
  const count = (s: Status) => o.changes.filter((c) => c.status === s).length;
  const rows = o.changes.map((c, i) => {
    const oldHtml = c.segs ? segHtml(c.segs, "old") : c.kind === "added" ? "" : c.kind === "deleted" ? `<del>${esc(c.oldText)}</del>` : esc(c.oldText);
    const newHtml = c.segs ? segHtml(c.segs, "new") : c.kind === "deleted" ? "" : c.kind === "added" ? `<ins>${esc(c.newText)}</ins>` : esc(c.newText);
    return `<tr class="${c.status}" id="c-${c.id}"><td>${i + 1}</td><td><span class="k ${c.kind}">${KIND_ZH[c.kind]} ${c.kind}</span>${c.numbers ? '<br><span class="num"># 数字 / numbers</span>' : ""}</td><td class="loc">${esc(c.oldLoc ?? "—")}<br>${esc(c.newLoc ?? "—")}</td><td>${oldHtml}</td><td>${newHtml}</td><td><span class="st ${c.status}">${STATUS_ZH[c.status]}</span>${c.note ? `<div class="note">${esc(c.note)}</div>` : ""}</td></tr>`;
  });
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>文档对照 ${esc(o.oldName)} → ${esc(o.newName)}</title><style>
body{font:14px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;margin:24px;color:#0f172a}h1{font-size:20px;margin:0 0 4px}.meta{color:#64748b;font-size:12px}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.chips span{background:#f1f5f9;border-radius:12px;padding:2px 10px;font-size:12px}
table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #e2e8f0;padding:6px 8px;vertical-align:top;text-align:left}th{background:#f8fafc;font-size:12px;position:sticky;top:0}
td:nth-child(4),td:nth-child(5){width:34%;white-space:pre-wrap;word-break:break-word}.loc{color:#64748b;font-size:12px;white-space:nowrap}
del{background:#fee2e2;color:#991b1b;text-decoration:line-through}ins{background:#dcfce7;color:#166534;text-decoration:none}
.k{font-size:11px;border-radius:8px;padding:0 6px;white-space:nowrap}.added{background:#dcfce7}.deleted{background:#fee2e2}.modified{background:#fef3c7}.moved{background:#e0e7ff}
.num{font-size:11px;color:#b45309}.st{font-size:12px;white-space:nowrap}.st.ok{color:#15803d}.st.question{color:#b91c1c;font-weight:600}.st.open{color:#64748b}.note{font-size:12px;color:#334155;margin-top:4px}
tr.question td{background:#fff7f7}@media print{th{position:static}}
</style></head><body><h1>文档对照报告 / Document comparison</h1><div class="meta">旧版 Old: ${esc(o.oldName)} · 新版 New: ${esc(o.newName)} · ${esc(o.generated)}</div>
<div class="chips"><span>修改 ${o.stats.modified}</span><span>新增 ${o.stats.added}</span><span>删除 ${o.stats.deleted}</span><span>移动 ${o.stats.moved}</span><span># 涉及数字 ${o.stats.numbers}</span><span>已确认 ${count("ok")}</span><span>有疑问 ${count("question")}</span><span>未确认 ${count("open")}</span></div>
<table><thead><tr><th>#</th><th>类型 Type</th><th>位置 Where<br>(旧 / 新)</th><th>旧版 Old</th><th>新版 New</th><th>状态 Status</th></tr></thead><tbody>
${rows.join("\n")}
</tbody></table></body></html>
`;
}

const csvCell = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
export function reportCsv(changes: Reviewed[]) {
  const head = ["no", "id", "type", "numbers", "old_location", "new_location", "status", "note", "summary", "old_text", "new_text"];
  const lines = changes.map((c, i) => [String(i + 1), c.id, c.kind, c.numbers ? "yes" : "", c.oldLoc ?? "", c.newLoc ?? "", c.status, c.note, c.summary, c.oldText, c.newText].map(csvCell).join(","));
  return "\ufeff" + [head.join(","), ...lines].join("\r\n") + "\r\n";
}
