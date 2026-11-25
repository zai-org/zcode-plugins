import { clock, type Need, type Utterance } from "./transcript.ts";

export interface Session {
  version: 1;
  audio: string;
  transcript: string;
  title: string;
  speakers: Record<string, string>;
  utterances: Utterance[];
  needs: Need[];
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const PRI: Record<string, [string, string]> = { high: ["高", "High"], medium: ["中", "Medium"], low: ["低", "Low"] };
const STATUS: Record<string, [string, string]> = { open: ["待确认", "Open"], confirmed: ["已确认", "Confirmed"], rejected: ["不采纳", "Rejected"] };

export function isZh(s: Session) {
  return /\p{Script=Han}/u.test(s.title + s.needs.map((n) => n.title).join(""));
}

export function toMarkdown(s: Session) {
  const zh = isZh(s);
  const L = (cn: string, en: string) => (zh ? cn : en);
  const byId = new Map(s.utterances.map((u) => [u.id, u]));
  const who = (u: Utterance) => s.speakers[u.speaker] ?? u.speaker;
  const lines = [`# ${s.title}`, "", `${L("录音", "Audio")}: ${s.audio} · ${L("转写", "Transcript")}: ${s.transcript}`, "", `## ${L("需求清单", "Needs")} (${s.needs.length})`, ""];
  s.needs.forEach((n, i) => {
    lines.push(`### ${i + 1}. ${n.title}`, "", `${L("分类", "Category")}: ${n.category || "—"} · ${L("优先级", "Priority")}: ${PRI[n.priority][zh ? 0 : 1]} · ${L("状态", "Status")}: ${STATUS[n.status][zh ? 0 : 1]}`, "");
    if (n.detail) lines.push(n.detail, "");
    for (const q of n.quotes) {
      const u = byId.get(q.utterance);
      if (u) lines.push(`> “${q.text}” — ${who(u)}, ${clock(u.start)}`, "");
    }
  });
  lines.push(`## ${L("文字稿", "Transcript")}`, "");
  for (const u of s.utterances) lines.push(`**${who(u)}** [${clock(u.start)}] ${u.text}  `);
  return lines.join("\n") + "\n";
}

export function toCsv(s: Session) {
  const byId = new Map(s.utterances.map((u) => [u.id, u]));
  const cell = (v: unknown) => {
    const t = String(v ?? "");
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const rows = [["#", "title", "category", "priority", "status", "detail", "quote", "speaker", "time"]];
  s.needs.forEach((n, i) => {
    const qs = n.quotes.length ? n.quotes : [{ utterance: "", text: "" }];
    for (const q of qs) {
      const u = byId.get(q.utterance);
      rows.push([String(i + 1), n.title, n.category, n.priority, n.status, n.detail, q.text, u ? (s.speakers[u.speaker] ?? u.speaker) : "", u ? clock(u.start) : ""]);
    }
  });
  return "\uFEFF" + rows.map((r) => r.map(cell).join(",")).join("\n") + "\n";
}

/** 自包含 HTML：需求清单 + 文字稿；点引用直接从录音对应时间播放（录音用相对路径引用）。 */
export function toHtml(s: Session, audioHref: string) {
  const zh = isZh(s);
  const L = (cn: string, en: string) => (zh ? cn : en);
  const byId = new Map(s.utterances.map((u) => [u.id, u]));
  const who = (u: Utterance) => esc(s.speakers[u.speaker] ?? u.speaker);
  const needs = s.needs
    .map(
      (n, i) => `<section class="need ${n.status}"><h3>${i + 1}. ${esc(n.title)} <span class="p ${n.priority}">${PRI[n.priority][zh ? 0 : 1]}</span> <span class="s">${STATUS[n.status][zh ? 0 : 1]}</span></h3>
${n.category ? `<div class="c">${esc(n.category)}</div>` : ""}${n.detail ? `<p>${esc(n.detail)}</p>` : ""}
${n.quotes
  .map((q) => {
    const u = byId.get(q.utterance);
    return u ? `<blockquote><button data-t="${u.start}" data-u="${u.id}">▶ ${clock(u.start)}</button> “${esc(q.text)}” <cite>— ${who(u)}</cite></blockquote>` : "";
  })
  .join("\n")}</section>`,
    )
    .join("\n");
  const transcript = s.utterances.map((u) => `<p id="${u.id}"><button data-t="${u.start}" data-u="${u.id}">${clock(u.start)}</button> <b>${who(u)}</b> ${esc(u.text)}</p>`).join("\n");
  return `<!doctype html><html lang="${zh ? "zh-CN" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(s.title)}</title>
<style>body{font:15px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;max-width:900px;margin:0 auto;padding:16px 20px 120px;color:#1f2937}h1{font-size:22px}h3{font-size:16px;margin:0 0 4px}.need{border:1px solid #e5e7eb;border-radius:10px;padding:12px 14px;margin:10px 0}.need.rejected{opacity:.55}.p{font-size:12px;padding:1px 7px;border-radius:9px;background:#e5e7eb}.p.high{background:#fee2e2;color:#b91c1c}.s{font-size:12px;color:#6b7280}.c{font-size:12px;color:#2563eb}blockquote{margin:6px 0;padding:4px 10px;border-left:3px solid #93c5fd;background:#f8fafc}cite{color:#6b7280;font-style:normal;font-size:13px}button{font:12px ui-monospace,monospace;border:1px solid #cbd5e1;background:#fff;border-radius:5px;cursor:pointer}#t p{margin:3px 0}#t p.on{background:#fef3c7}.bar{position:fixed;left:0;right:0;bottom:0;background:#fff;border-top:1px solid #e5e7eb;padding:8px}.bar audio{width:100%}</style></head><body>
<h1>${esc(s.title)}</h1><p style="color:#6b7280">${L("点 ▶ 从录音对应位置播放。录音文件需与本页面保持相对位置", "Click ▶ to play that moment. Keep the audio file next to this page")}: <code>${esc(audioHref)}</code></p>
<h2>${L("需求清单", "Needs")} (${s.needs.length})</h2>${needs}
<h2>${L("文字稿", "Transcript")}</h2><div id="t">${transcript}</div>
<div class="bar"><audio id="a" controls preload="metadata" src="${esc(encodeURI(audioHref))}"></audio></div>
<script>const a=document.getElementById("a");document.addEventListener("click",e=>{const b=e.target.closest("button[data-t]");if(!b)return;a.currentTime=Number(b.dataset.t);a.play();document.querySelectorAll("#t p.on").forEach(p=>p.classList.remove("on"));const p=document.getElementById(b.dataset.u);if(p){p.classList.add("on");if(b.closest("#t")===null)p.scrollIntoView({block:"center"})}});</script>
</body></html>`;
}
