import { createApp, esc, htmlPage, type AppDef, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { mapHeaders, num } from "./kit/columns.ts";
import { readTable } from "./kit/table.ts";
import { writeXlsx } from "./kit/sheet.ts";
import { KitError } from "./kit/workspace.ts";
import { clauseTone, DEFAULT_TOPICS, parseTopics, tagReview } from "./topics.ts";
import { s } from "./util.ts";

export const NAME = "review-insights";
export const VERSION = "0.1.0";
const ALIAS = { text: ["评价内容", "评价", "评论", "内容", "评论内容", "买家评价", "review", "content", "comment", "text", "body"], rating: ["评分", "星级", "星", "打分", "rating", "stars", "score"], date: ["日期", "时间", "评价时间", "date", "time"], product: ["商品", "sku", "规格", "颜色分类", "product", "variant"] };
const TONES = ["好评", "中评", "差评"];

function toneOf(r: Row) {
  const t = s(r.tone);
  if (TONES.includes(t)) return t;
  const n = num(r.rating);
  if (n >= 4) return "好评";
  if (n > 0 && n <= 2) return "差评";
  if (n === 3) return "中评";
  const sc = clauseTone(s(r.text));
  return sc > 0 ? "好评" : sc < 0 ? "差评" : "中评";
}

function analyse(p: Project) {
  const topics = parseTopics(s(p.settings.topics) || DEFAULT_TOPICS);
  const rows = p.rows.map((r) => {
    const tags = tagReview(s(r.text), topics);
    const manual = s(r.topics) ? s(r.topics).split(/[,，、]/).map((x) => x.trim()).filter(Boolean) : null;
    return { r, tone: toneOf(r), tags, list: manual ?? [...tags.keys()] };
  });
  const stat = new Map<string, { pos: number; neg: number; mid: number; praise: string[]; complain: string[] }>();
  for (const x of rows) {
    if (!s(x.r.text)) continue;
    for (const t of x.list) {
      const st = stat.get(t) ?? { pos: 0, neg: 0, mid: 0, praise: [], complain: [] };
      const snip = x.tags.get(t)?.snippet ?? s(x.r.text).slice(0, 40);
      const tone = x.tags.get(t)?.tone ?? 0;
      const neg = tone < 0 || (tone === 0 && x.tone === "差评");
      const pos = tone > 0 || (tone === 0 && x.tone === "好评");
      if (neg) { st.neg++; st.complain.push(snip); } else if (pos) { st.pos++; st.praise.push(snip); } else st.mid++;
      stat.set(t, st);
    }
  }
  const order = [...stat.entries()].sort((a, b) => b[1].pos + b[1].neg + b[1].mid - (a[1].pos + a[1].neg + a[1].mid));
  return { rows, topics, order };
}

const top = (xs: string[], k: number) => { const c = new Map<string, number>(); xs.forEach((x) => c.set(x, (c.get(x) ?? 0) + 1)); return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length).slice(0, k); };

function reportHtml(p: Project) {
  const a = analyse(p), valid = a.rows.filter((x) => s(x.r.text));
  const tones = TONES.map((t) => valid.filter((x) => x.tone === t).length);
  const stars = [5, 4, 3, 2, 1].map((n) => valid.filter((x) => Math.round(num(x.r.rating)) === n).length);
  const avg = valid.filter((x) => num(x.r.rating) > 0);
  const max = Math.max(1, ...a.order.map(([, v]) => v.pos + v.neg + v.mid));
  const bars = a.order.map(([t, v]) => `<tr><td><b>${esc(t)}</b></td><td>${v.pos + v.neg + v.mid}</td><td style="width:45%"><div style="display:flex;height:14px;border-radius:7px;overflow:hidden;width:${((v.pos + v.neg + v.mid) / max) * 100}%"><span style="background:#16a34a;flex:${v.pos}"></span><span style="background:#cbd5e1;flex:${v.mid}"></span><span style="background:#dc2626;flex:${v.neg}"></span></div></td><td style="color:#16a34a">${v.pos}</td><td style="color:#dc2626">${v.neg}</td><td>${v.pos + v.neg ? Math.round((v.neg / (v.pos + v.neg)) * 100) : 0}%</td></tr>`).join("");
  const quotes = (k: "praise" | "complain") => a.order.filter(([, v]) => v[k].length).sort((x, y) => y[1][k].length - x[1][k].length).slice(0, 10).map(([t, v]) => `<li><b>${esc(t)}</b>（${v[k].length}）：${top(v[k], 3).map(([q, n]) => `“${esc(q)}”${n > 1 ? ` ×${n}` : ""}`).join("；")}</li>`).join("");
  const none = valid.filter((x) => !x.list.length);
  return htmlPage(
    s(p.settings.title) || "评价分析报告",
    `<h1>${esc(s(p.settings.title) || "评价分析报告")}</h1><p>${valid.length} 条评价${avg.length ? `，平均 ${(avg.reduce((s2, x) => s2 + num(x.r.rating), 0) / avg.length).toFixed(2)} 星` : ""}：好评 ${tones[0]}，中评 ${tones[1]}，差评 ${tones[2]}（差评率 ${Math.round((tones[2] / Math.max(1, valid.length)) * 100)}%）。</p>
${avg.length ? `<p>星级分布：${[5, 4, 3, 2, 1].map((n, i) => `${n}★ ${stars[i]}`).join(" · ")}</p>` : ""}
<h2>主要差评原因</h2><ol>${quotes("complain") || "<li>没有差评</li>"}</ol>
<h2>主要好评点</h2><ol>${quotes("praise") || "<li>—</li>"}</ol>
<h2>按主题</h2><table><tr><th>主题</th><th>提及</th><th>好 / 中 / 差</th><th>好</th><th>差</th><th>差评占比</th></tr>${bars}</table>
${none.length ? `<h2>未归类（${none.length}）</h2><ul>${none.slice(0, 15).map((x) => `<li>${esc(s(x.r.text))}</li>`).join("")}</ul><p style="color:#6b7280">在设置的主题词库里加关键词即可归类。</p>` : ""}`,
  );
}

const DEF: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "reviews",
  title: ["商品评价分析", "Review Insights"],
  openDescription:
    "Analyse exported product reviews (CSV/XLSX from Taobao/JD/Amazon etc.: a review text column — 评价内容/review/content — and optionally 评分/rating, 日期/date, 商品/sku). Each review is split into clauses and tagged with topics from an editable keyword lexicon (setting “topics”, one line per topic: `名称: 词1, 词2`; defaults cover quality, size, delivery, packaging, price, looks, smell, experience, service, in Chinese and English). Tone comes from the star rating, or from the wording (with negation, e.g. 不好/没有色差) when there is no rating. Rows are reviews: override the tone (好评/中评/差评) or the topics (comma list) per review. Reports top complaints and praise per topic with quotes, duplicate reviews and untagged reviews. Exports an HTML report and an XLSX (reviews + topic summary).",
  inputs: { exts: [".csv", ".xlsx", ".tsv"], min: 0, max: 1, label: ["选择导出的评价表", "Pick the exported reviews"] },
  settings: [
    { key: "title", label: ["报告标题", "Report title"], type: "text", default: "评价分析报告" },
    { key: "topics", label: ["主题词库（每行 名称: 关键词…）", "Topics (one per line: name: words…)"], type: "textarea", default: DEFAULT_TOPICS },
  ],
  columns: () => [
    { key: "text", label: ["评价内容", "Review"], wide: true },
    { key: "rating", label: ["评分", "Rating"], type: "number" },
    { key: "product", label: ["商品", "Product"] },
    { key: "tone", label: ["评价倾向（留空自动）", "Tone (blank = auto)"], type: "select", options: ["", ...TONES] },
    { key: "topics", label: ["主题（留空自动）", "Topics (blank = auto)"] },
    { key: "_tone", label: ["倾向", "Tone used"], readOnly: true },
    { key: "_topics", label: ["识别主题", "Topics found"], readOnly: true },
  ],
  newRow: () => ({ text: "", rating: "", product: "", tone: "", topics: "" }),
  async load({ ws, files }) {
    if (!files.length) return { rows: [] };
    const t = await readTable(ws, files[0]);
    const m = mapHeaders(t.columns, ALIAS);
    if (!m.text) throw new KitError("no_text", `Need a review text column (评价内容/review/content). Columns: ${t.columns.join(", ")}`);
    return { rows: t.rows.map((r) => ({ text: s(r[m.text!]), rating: m.rating ? s(r[m.rating]).replace(/[^\d.]/g, "") : "", product: m.product ? s(r[m.product]) : "", date: m.date ? s(r[m.date]) : "", tone: "", topics: "" })) };
  },
  compute(p): Computed {
    const a = analyse(p), issues: Issue[] = [];
    const seen = new Map<string, number>();
    a.rows.forEach((x, i) => {
      const t = s(x.r.text);
      if (!t) { issues.push({ level: "warn", row: i, key: "text", message: "Empty review — left out of the report." }); return; }
      const k = t.replace(/\s|[，。！!,.]/g, "");
      if (k.length >= 6 && seen.has(k)) issues.push({ level: "warn", row: i, key: "text", message: `Same text as row ${seen.get(k)} — possible duplicate or fake review.` });
      else seen.set(k, i);
      if (s(x.r.rating) && (num(x.r.rating) < 1 || num(x.r.rating) > 5)) issues.push({ level: "error", row: i, key: "rating", message: `Rating ${s(x.r.rating)} is outside 1–5.` });
      for (const tp of s(x.r.topics).split(/[,，、]/).map((y) => y.trim()).filter(Boolean)) if (!a.topics.some((q) => q.name === tp)) issues.push({ level: "info", row: i, key: "topics", message: `Topic “${tp}” is not in the lexicon — it is reported as its own topic.` });
    });
    const valid = a.rows.filter((x) => s(x.r.text)), untagged = valid.filter((x) => !x.list.length).length;
    if (untagged) issues.push({ level: "info", message: `${untagged} review(s) matched no topic — add keywords to the topics setting or set topics by hand.` });
    const neg = valid.filter((x) => x.tone === "差评").length;
    const worst = a.order.filter(([, v]) => v.neg).sort((x, y) => y[1].neg - x[1].neg).slice(0, 3).map(([t, v]) => `${t} ${v.neg}`);
    return {
      rows: a.rows.map((x) => ({ ...x.r, _tone: s(x.r.text) ? x.tone : "", _topics: x.list.join("、") })),
      issues,
      summary: `${valid.length} review(s), ${neg} negative; top complaints: ${worst.join(", ") || "none"}; ${a.order.length} topic(s) mentioned.`,
      stats: { reviews: valid.length, negative: neg, topics: a.order.length, untagged },
      preview: `<table><tr><th>主题</th><th>好评</th><th>差评</th></tr>${a.order.map(([t, v]) => `<tr><td>${esc(t)}</td><td>${v.pos}</td><td>${v.neg}</td></tr>`).join("")}</table>`,
    };
  },
  exports: [
    { id: "html", label: ["分析报告 HTML", "Report (HTML)"], description: "review-report.html", async run({ project, write }: ExportCtx) { return [await write("review-report.html", reportHtml(project))]; } },
    {
      id: "xlsx", label: ["评价明细 XLSX", "Reviews (XLSX)"], description: "review-insights.xlsx — tagged reviews + topic summary",
      async run({ project, write }: ExportCtx) {
        const a = analyse(project), valid = a.rows.filter((x) => s(x.r.text));
        return [await write("review-insights.xlsx", await writeXlsx([
          { name: "主题汇总", headers: ["主题", "提及", "好评", "中评", "差评", "差评占比", "典型差评", "典型好评"], rows: a.order.map(([t, v]) => [t, v.pos + v.neg + v.mid, v.pos, v.mid, v.neg, v.pos + v.neg ? Math.round((v.neg / (v.pos + v.neg)) * 100) / 100 : 0, top(v.complain, 2).map(([q]) => q).join(" / "), top(v.praise, 2).map(([q]) => q).join(" / ")]), widths: [12, 8, 8, 8, 8, 10, 50, 50], numberFormat: { 5: "0%" } },
          { name: "评价明细", headers: ["评价内容", "评分", "商品", "倾向", "主题"], rows: valid.map((x) => [s(x.r.text), s(x.r.rating) ? num(x.r.rating) : "", s(x.r.product), x.tone, x.list.join("、")]), widths: [70, 8, 16, 8, 24], marks: valid.flatMap((x, row) => (x.tone === "差评" ? [{ row, col: 3, color: "FFFDE2E2" }] : [])) },
        ]))];
      },
    },
  ],
  describeRow: (r, i) => `#${i} ${s(r.rating) ? `${s(r.rating)}★ ` : ""}${s(r.text).slice(0, 60)}${s(r.tone) ? ` [tone=${s(r.tone)}]` : ""}${s(r.topics) ? ` [topics=${s(r.topics)}]` : ""}`,
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(DEF, options).server;
}
