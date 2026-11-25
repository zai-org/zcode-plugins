// 题库：Markdown / XLSX 解析与检查。
import { posix } from "node:path";
import type { Workspace } from "./kit/workspace.ts";
import { readTable } from "./kit/table.ts";

export type QType = "single" | "multi" | "tf" | "fill" | "short";
export const QTYPES: QType[] = ["single", "multi", "tf", "fill", "short"];
export type Level = 1 | 2 | 3;
export interface Question {
  id: string; type: QType; chapter: string; level: Level; score?: number;
  stem: string; options: { label: string; text: string }[]; answer: string; explanation: string;
  file: string; line: number; dir: string;
}
export interface BankIssue { id: string; file: string; line: number; kind: "missing-answer" | "bad-answer" | "missing-options" | "missing-image" | "duplicate" | "latex" | "unknown-type" | "dollar"; message: string; other?: string }

const TYPE_WORDS: [QType, RegExp][] = [
  ["multi", /^(多选|多项选择|不定项|multi|multiple)/i], ["single", /^(单选|单项选择|选择|single|choice|mcq)/i],
  ["tf", /^(判断|是非|对错|tf|true|judge)/i], ["fill", /^(填空|fill|blank)/i], ["short", /^(简答|解答|计算|问答|论述|short|essay|problem|answer)/i],
];
export const typeOf = (s: string): QType | undefined => TYPE_WORDS.find(([, re]) => re.test(s.trim()))?.[0];
export function levelOf(s: string): Level | undefined {
  const t = s.trim().toLowerCase();
  if (/^(易|简单|容易|基础|easy|e)$/.test(t)) return 1;
  if (/^(中|中等|一般|适中|medium|mid|m)$/.test(t)) return 2;
  if (/^(难|较难|困难|提高|hard|difficult|h)$/.test(t)) return 3;
  const n = Number(t);
  if (Number.isFinite(n) && n >= 1 && n <= 5) return n <= 2 ? 1 : n === 3 ? 2 : 3;
  return undefined;
}
const OPTION = /^\s*[（(]?([A-H])[)）]?\s*[.．、:：)]\s*(.*)$/;
const ANSWER = /^\s*(答案|参考答案|answer|key)\s*[:：]\s*(.*)$/i;
const EXPL = /^\s*(解析|解答|分析|explanation|solution)\s*[:：]\s*(.*)$/i;

/** Markdown 题库：`# 章节`，每题以 `## 题型 | 难度 | 分值 | id: 编号` 开头，选项 `A. …`，`答案：`、`解析：`。 */
export function parseMarkdown(file: string, text: string): Question[] {
  const lines = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const out: Question[] = [];
  let chapter = "", cur: (Question & { mode: "stem" | "options" | "answer" | "expl"; stemLines: string[]; explLines: string[]; answerLines: string[]; meta: string }) | undefined;
  const dir = posix.dirname(file);
  const flush = () => {
    if (!cur) return;
    const { mode: _m, stemLines, explLines, answerLines, meta: _x, ...q } = cur;
    out.push({ ...q, stem: stemLines.join("\n").trim(), explanation: explLines.join("\n").trim(), answer: answerLines.join("\n").trim() });
    cur = undefined;
  };
  lines.forEach((raw, i) => {
    const h1 = /^#\s+(.+?)\s*$/.exec(raw);
    if (h1) { flush(); chapter = h1[1]; return; }
    const h2 = /^##\s+(.+?)\s*$/.exec(raw);
    if (h2) {
      flush();
      const parts = h2[1].split(/\s*[|｜]\s*/);
      let type: QType | undefined, level: Level | undefined, score: number | undefined, id = "", ch = chapter;
      for (const p of parts) {
        const kv = /^(id|编号|章节|chapter)\s*[:：]\s*(.+)$/i.exec(p);
        if (kv) { if (/id|编号/i.test(kv[1])) id = kv[2].trim(); else ch = kv[2].trim(); continue; }
        const sc = /^(\d+(?:\.\d+)?)\s*(分|points?|pts?)$/i.exec(p);
        if (sc) { score = Number(sc[1]); continue; }
        type ??= typeOf(p); level ??= levelOf(p);
      }
      cur = { id: id || `${posix.basename(file).replace(/\.[^.]+$/, "")}-${out.length + 1}`, type: type ?? ("?" as QType), chapter: ch, level: level ?? 2, ...(score ? { score } : {}), stem: "", options: [], answer: "", explanation: "", file, line: i + 1, dir, mode: "stem", stemLines: [], explLines: [], answerLines: [], meta: h2[1] };
      return;
    }
    if (!cur) return;
    const am = ANSWER.exec(raw), em = EXPL.exec(raw), om = OPTION.exec(raw);
    if (am) { cur.mode = "answer"; cur.answerLines.push(am[2]); return; }
    if (em) { cur.mode = "expl"; cur.explLines.push(em[2]); return; }
    if (om && (cur.type === "single" || cur.type === "multi") && cur.mode !== "expl" && cur.mode !== "answer") { cur.mode = "options"; cur.options.push({ label: om[1], text: om[2].trim() }); return; }
    if (cur.mode === "options" && raw.trim() && cur.options.length) { cur.options[cur.options.length - 1].text += " " + raw.trim(); return; }
    if (cur.mode === "answer") { if (raw.trim()) cur.answerLines.push(raw); else cur.mode = "expl"; return; }
    if (cur.mode === "expl") { cur.explLines.push(raw); return; }
    cur.stemLines.push(raw);
  });
  flush();
  return out;
}

const COLS: Record<string, RegExp> = {
  id: /^(id|编号|题号)$/i, type: /^(type|题型|类型)$/i, chapter: /^(chapter|章节|知识点|单元|topic)$/i, level: /^(difficulty|level|难度)$/i, score: /^(score|points?|分值|分数)$/i,
  stem: /^(question|stem|题干|题目|内容)$/i, answer: /^(answer|答案|key)$/i, explanation: /^(explanation|解析|solution)$/i, image: /^(image|图片|配图)$/i,
};
export async function parseXlsx(ws: Workspace, file: string): Promise<Question[]> {
  const t = await readTable(ws, file);
  const col = (k: string) => t.columns.find((c) => COLS[k].test(c.trim()));
  const optCols = t.columns.map((c) => ({ c, m: /^(?:选项|option)?\s*([A-H])$/i.exec(c.trim()) })).filter((x) => x.m);
  return t.rows.map((r, i) => {
    const get = (k: string) => (col(k) ? r[col(k)!] ?? "" : "").trim();
    const img = get("image");
    return {
      id: get("id") || `${posix.basename(file).replace(/\.[^.]+$/, "")}-${i + 1}`, type: typeOf(get("type")) ?? ("?" as QType), chapter: get("chapter"), level: levelOf(get("level")) ?? 2,
      ...(Number(get("score")) > 0 ? { score: Number(get("score")) } : {}),
      stem: get("stem") + (img ? `\n![](${img})` : ""), options: optCols.map(({ c, m }) => ({ label: m![1].toUpperCase(), text: (r[c] ?? "").trim() })).filter((o) => o.text),
      answer: get("answer"), explanation: get("explanation"), file, line: i + 2, dir: posix.dirname(file),
    } as Question;
  });
}

/** 判断题答案 → true/false；无法识别返回 undefined。 */
export function tfValue(a: string): boolean | undefined {
  const t = a.trim().toLowerCase();
  if (/^(对|正确|是|√|✓|✔|t|true|yes|y)$/.test(t)) return true;
  if (/^(错|错误|否|×|✗|✘|x|f|false|no|n)$/.test(t)) return false;
  return undefined;
}
export const choiceLetters = (a: string) => [...new Set(a.toUpperCase().replace(/[^A-H]/g, "").split(""))].sort().join("");

const compactStem = (s: string) => s.normalize("NFKC").replace(/\s+|[（）()　]/g, "").toLowerCase();
function dice(a: string, b: string) {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const m = new Map<string, number>();
  for (let i = 0; i + 1 < a.length; i++) m.set(a.slice(i, i + 2), (m.get(a.slice(i, i + 2)) ?? 0) + 1);
  let hit = 0;
  for (let i = 0; i + 1 < b.length; i++) { const g = b.slice(i, i + 2), n = m.get(g); if (n) { hit++; m.set(g, n - 1); } }
  return (2 * hit) / (a.length + b.length - 2);
}

export const imagesOf = (s: string) => [...s.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]);
export const mathOf = (s: string) => [...s.matchAll(/\$\$([\s\S]+?)\$\$|(?<!\\)\$((?:\\\$|[^$])+?)\$/g)].map((m) => m[1] ?? m[2]);

/** 检查：缺答案、答案不在选项里、选择题缺选项、缺图、重复题、公式错误、未知题型、$ 不成对。 */
export async function checkBank(qs: Question[], ws: Workspace, latexError: (tex: string) => string | undefined): Promise<BankIssue[]> {
  const issues: BankIssue[] = [];
  const add = (q: Question, kind: BankIssue["kind"], message: string, other?: string) => issues.push({ id: q.id, file: q.file, line: q.line, kind, message, ...(other ? { other } : {}) });
  const seenIds = new Map<string, Question>();
  for (const q of qs) {
    if (seenIds.has(q.id)) add(q, "duplicate", `duplicate id ${q.id}`, seenIds.get(q.id)!.id);
    seenIds.set(q.id, q);
    if (!QTYPES.includes(q.type)) add(q, "unknown-type", "unknown question type (use 单选/多选/判断/填空/简答 or single/multi/tf/fill/short)");
    if (!q.answer.trim()) add(q, "missing-answer", "no answer");
    if (q.type === "single" || q.type === "multi") {
      if (q.options.length < 2) add(q, "missing-options", "choice question needs at least two options");
      const letters = choiceLetters(q.answer), labels = q.options.map((o) => o.label);
      if (q.answer.trim() && (!letters || [...letters].some((l) => !labels.includes(l)))) add(q, "bad-answer", `answer “${q.answer}” is not among the options ${labels.join("")}`);
      else if (q.type === "single" && letters.length > 1) add(q, "bad-answer", `single-choice question has answer “${q.answer}”`);
    }
    if (q.type === "tf" && q.answer.trim() && tfValue(q.answer) === undefined) add(q, "bad-answer", `true/false answer “${q.answer}” not understood (use 对/错 or T/F)`);
    const all = [q.stem, ...q.options.map((o) => o.text), q.answer, q.explanation].join("\n");
    for (const src of imagesOf(all)) if (!/^(https?:|data:)/.test(src) && !(await ws.exists(posix.join(q.dir, src)))) add(q, "missing-image", `image not found: ${src}`);
    if ((all.replace(/\\\$/g, "").match(/\$/g) ?? []).length % 2) add(q, "dollar", "unpaired $ (formula not closed)");
    for (const tex of mathOf(all)) { const e = latexError(tex); if (e) add(q, "latex", `formula error “${e}” in $${tex}$`); }
  }
  for (let i = 0; i < qs.length; i++) for (let j = i + 1; j < qs.length; j++) {
    const a = compactStem(qs[i].stem), b = compactStem(qs[j].stem);
    if (a.length >= 6 && (a === b || (Math.min(a.length, b.length) > 12 && dice(a, b) >= 0.92 && JSON.stringify(qs[i].options) === JSON.stringify(qs[j].options)))) add(qs[j], "duplicate", `same question as ${qs[i].id}`, qs[i].id);
  }
  return issues;
}
