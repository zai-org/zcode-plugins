// 导出核对表：HTML（自带样式，可直接分享）、CSV（Excel 可开）、Markdown。
import type { Doc } from "./docs.ts";
import type { Claim, Status, Verdict } from "./check.ts";
import type { State } from "./server.ts";

export const LABEL: Record<Status, [string, string]> = { number: ["数字不符", "Number mismatch"], quote: ["引文不符", "Quote mismatch"], missing: ["找不到依据", "No source found"], weak: ["需确认", "Needs a look"], ok: ["有依据", "Supported"] };
export const VLABEL: Record<Verdict, [string, string]> = { supported: ["属实", "Supported"], partly: ["部分属实", "Partly supported"], wrong: ["有误", "Wrong"], unsupported: ["无依据", "Unsupported"], open: ["待定", "Open"] };

export function langOf(d: Doc): "zh" | "en" {
  const t = d.blocks.map((b) => b.text).join("").slice(0, 20000);
  const cjk = (t.match(/[\u4e00-\u9fff]/g) ?? []).length;
  return cjk > t.length * 0.15 ? "zh" : "en";
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[c]!);
const fmtTime = (iso: string) => { const d = new Date(iso); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };

/** 中文报告的说明文字（自动核对给的是英文原因，给智能体看）。 */
export function reasonZh(c: Claim): string {
  const ev = c.evidence[0], q = c.quotes.find((x) => !x.found)?.closest;
  const where = (p?: { file: string; loc: string; page?: number }) => (p ? `${p.file} ${p.page ? `第 ${p.page} 页` : p.loc}` : "");
  switch (c.status) {
    case "ok": return c.numbers.length ? `数字与措辞都与 ${where(ev ?? c.quotes[0]?.closest)} 一致` : `措辞与 ${where(ev ?? c.quotes[0]?.closest)} 一致`;
    case "weak": return c.numbers.length ? "数字在资料中都找到了，但措辞差别较大（转述或翻译？），需确认意思一致" : `只有部分措辞吻合（${Math.round(c.coverage * 100)}%），需确认`;
    case "number": return c.numbers.filter((n) => !n.found).map((n) => `${n.raw} 资料中没有${n.suggest ? `（资料为 ${n.suggest}）` : ""}`).join("；");
    case "quote": return q ? `引文与资料原文不一致，最接近的是 ${where(q)}（相似 ${Math.round(q.similarity * 100)}%）` : "资料中找不到这段引文";
    default: return `资料中找不到支持这句话的内容（最接近 ${Math.round(c.coverage * 100)}%）`;
  }
}

function rows(s: State, zh: boolean) {
  const k = zh ? 0 : 1;
  return s.claims.map((c) => {
    const ev = c.evidence[0];
    const q = c.quotes.find((x) => !x.found)?.closest;
    return {
      id: c.id, loc: c.loc, claim: c.text, status: LABEL[c.status][k], statusKey: c.status,
      reason: [zh ? reasonZh(c) : c.reason, c.citeMismatch ? (zh ? `出处不符：${c.citeMismatch}` : c.citeMismatch) : ""].filter(Boolean).join(zh ? "；" : "; "),
      numbers: c.numbers.map((n) => `${n.raw}${n.found ? " ✓" : ` ✗${n.suggest ? ` → ${n.suggest}` : ""}`}`).join("  "),
      verdict: c.review ? VLABEL[c.review.verdict][k] : "", verdictKey: c.review?.verdict ?? "", note: c.review?.note ?? "",
      source: c.review?.evidence ? `${c.review.evidence.file}${c.review.evidence.loc ? ` ${c.review.evidence.loc}` : ""}` : q ? `${q.file} ${q.loc}` : ev ? `${ev.file} ${ev.loc}` : "",
      passage: c.review?.evidence?.text ?? q?.text ?? ev?.text ?? "",
    };
  });
}

const H = { zh: ["编号", "位置", "报告原句", "自动核对", "说明", "数字", "结论", "备注", "来源", "来源原文"], en: ["ID", "Location", "Claim", "Auto check", "Details", "Numbers", "Verdict", "Note", "Source", "Source passage"] };

export function exportCsv(s: State, zh: boolean) {
  const cell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, "\"\"")}"` : v);
  const lines = [H[zh ? "zh" : "en"].map(cell).join(",")];
  for (const r of rows(s, zh)) lines.push([r.id, r.loc, r.claim, r.status, r.reason, r.numbers, r.verdict, r.note, r.source, r.passage].map(cell).join(","));
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

export function exportMd(s: State, zh: boolean) {
  const cell = (v: string) => v.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const h = H[zh ? "zh" : "en"];
  const out = [`# ${zh ? "引用核对" : "Citation check"}: ${s.report}`, "", `${zh ? "核对时间" : "Checked"}: ${fmtTime(s.checkedAt)} · ${zh ? "资料" : "Sources"}: ${s.sources.map((x) => x.file).join(", ")}`, "", `| ${[h[0], h[1], h[2], h[3], h[6], h[8], h[4]].join(" | ")} |`, "|---|---|---|---|---|---|---|"];
  for (const r of rows(s, zh)) out.push(`| ${[r.id, r.loc, r.claim, r.status, r.verdict + (r.note ? `：${r.note}` : ""), r.source, r.reason].map(cell).join(" | ")} |`);
  return out.join("\n") + "\n";
}

export function exportHtml(s: State, zh: boolean) {
  const h = H[zh ? "zh" : "en"];
  const k = zh ? 0 : 1;
  const counts = (Object.keys(LABEL) as Status[]).map((st) => `<span class="chip ${st}">${LABEL[st][k]} ${s.claims.filter((c) => c.status === st).length}</span>`).join(" ");
  const body = rows(s, zh).map((r) => `<tr class="${r.statusKey}"><td>${r.id}</td><td>${esc(r.loc)}</td><td>${esc(r.claim)}</td><td><span class="chip ${r.statusKey}">${esc(r.status)}</span><div class="sub">${esc(r.reason)}</div>${r.numbers ? `<div class="nums">${esc(r.numbers)}</div>` : ""}</td><td>${r.verdict ? `<b class="v ${r.verdictKey}">${esc(r.verdict)}</b>` : "—"}${r.note ? `<div class="sub">${esc(r.note)}</div>` : ""}</td><td><div class="src">${esc(r.source)}</div><blockquote>${esc(r.passage)}</blockquote></td></tr>`).join("\n");
  return `<!doctype html><html lang="${zh ? "zh-CN" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc((zh ? "引用核对 · " : "Citation check · ") + s.title)}</title>
<style>
body{font:14px/1.55 -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;margin:24px;color:#1d2433}
h1{font-size:20px;margin:0 0 4px}.meta{color:#667;margin-bottom:12px}
table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #e3e6ec;padding:8px;vertical-align:top;text-align:left}
th{background:#f5f6f8;font-weight:600;position:sticky;top:0;white-space:nowrap}
td:nth-child(1),td:nth-child(2){white-space:nowrap;color:#667}td:nth-child(3){width:30%}td:nth-child(6){width:30%}
.chip{display:inline-block;border-radius:10px;padding:1px 8px;font-size:12px;background:#eef}
.chip.ok{background:#e3f5e8;color:#1b6b34}.chip.weak{background:#fff4d6;color:#7a5a00}.chip.number,.chip.quote{background:#fde4e4;color:#a12020}.chip.missing{background:#ececec;color:#444}
.sub{color:#667;font-size:12px;margin-top:4px}.nums{font-family:ui-monospace,monospace;font-size:12px;margin-top:4px}
.v.supported{color:#1b6b34}.v.wrong,.v.unsupported{color:#a12020}.v.partly{color:#7a5a00}
.src{font-size:12px;color:#556}blockquote{margin:4px 0 0;padding-left:8px;border-left:3px solid #d0d5de;color:#333}
</style></head><body>
<h1>${zh ? "引用核对" : "Citation check"}：${esc(s.title)}</h1>
<div class="meta">${esc(s.report)} · ${zh ? "核对时间" : "checked"} ${fmtTime(s.checkedAt)} · ${zh ? "资料" : "sources"}：${s.sources.map((x) => esc(x.file)).join("、")}</div>
<p>${counts}</p>
<table><thead><tr><th>${h[0]}</th><th>${h[1]}</th><th>${h[2]}</th><th>${h[3]}</th><th>${h[6]}</th><th>${h[8]}</th></tr></thead><tbody>
${body}
</tbody></table></body></html>
`;
}
