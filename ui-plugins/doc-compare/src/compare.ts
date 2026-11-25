import { createHash } from "node:crypto";
import { diffArrays } from "diff";
import type { Para } from "./extract.ts";

export type Op = "=" | "+" | "-";
export interface Seg { op: Op; text: string }
export type Kind = "added" | "deleted" | "modified" | "moved";
export interface Row { kind: "same" | Kind; old?: number; new?: number; change?: string; ghost?: boolean }
export interface Change {
  id: string;
  kind: Kind;
  old?: number;
  new?: number;
  oldLoc?: string;
  newLoc?: string;
  oldText: string;
  newText: string;
  segs?: Seg[];
  numbers: boolean;
  summary: string;
}
export interface Options { ignoreCase?: boolean; ignorePunctuation?: boolean }

const CJKC = "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}";
const W = `(?:(?![${CJKC}])[\\p{L}\\p{N}_])`;
const TOKEN = new RegExp(`[${CJKC}]|${W}+(?:[.,'’]${W}+)*|\\s+|[^\\s\\p{L}\\p{N}_]`, "gu");
export const tokens = (s: string) => s.match(TOKEN) ?? [];
const PUNCT = /[\p{P}\p{S}]/gu;
function norm(s: string, o: Options) {
  let t = s.replace(/\s+/g, " ").trim().replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  if (o.ignorePunctuation) t = t.replace(PUNCT, "").replace(/\s+/g, " ").trim();
  return o.ignoreCase ? t.toLowerCase() : t;
}

/** 两段文字的相似度：词元多重集合的 Dice 系数（0..1）。 */
export function similarity(a: string, b: string) {
  const ta = tokens(a.toLowerCase()).filter((t) => t.trim());
  const tb = tokens(b.toLowerCase()).filter((t) => t.trim());
  if (!ta.length || !tb.length) return 0;
  const bag = new Map<string, number>();
  for (const t of ta) bag.set(t, (bag.get(t) ?? 0) + 1);
  let common = 0;
  for (const t of tb) { const n = bag.get(t) ?? 0; if (n) { common++; bag.set(t, n - 1); } }
  // 一段在另一段基础上增补（或删减）时 Dice 偏低，用“包含度”兜底。
  return Math.max((2 * common) / (ta.length + tb.length), Math.min(ta.length, tb.length) >= 4 ? (0.8 * common) / Math.min(ta.length, tb.length) : 0);
}

/** 段内字词级差异：英文按词，中日韩按字；夹在两处改动之间的空白并入改动，便于阅读。 */
export function wordDiff(a: string, b: string, o: Options = {}): Seg[] {
  const ta = tokens(a), tb = tokens(b);
  const key = (t: string) => { let k = /^\s+$/.test(t) ? " " : t.replace(/[“”]/g, '"').replace(/[‘’]/g, "'"); if (o.ignoreCase) k = k.toLowerCase(); return k; };
  const parts = diffArrays(ta.map(key), tb.map(key));
  const segs: Seg[] = [];
  let ia = 0, ib = 0;
  for (const p of parts) {
    const n = p.count ?? p.value.length;
    if (p.added) { segs.push({ op: "+", text: tb.slice(ib, ib + n).join("") }); ib += n; }
    else if (p.removed) { segs.push({ op: "-", text: ta.slice(ia, ia + n).join("") }); ia += n; }
    else { segs.push({ op: "=", text: tb.slice(ib, ib + n).join("") }); ia += n; ib += n; }
  }
  // 清理：两处改动之间只隔着空白或一个短词时合并成一次替换。
  for (let i = 1; i < segs.length - 1; i++) {
    const s = segs[i];
    if (s.op === "=" && segs[i - 1].op !== "=" && segs[i + 1].op !== "=" && (/^\s*$/.test(s.text) || (tokens(s.text).length <= 1 && s.text.length <= 3 && !/\p{Script=Han}/u.test(s.text)))) {
      segs.splice(i, 1, { op: "-", text: s.text }, { op: "+", text: s.text });
      i++;
    }
  }
  const out: Seg[] = [];
  let del = "", add = "";
  const push = () => { if (del) out.push({ op: "-", text: del }); if (add) out.push({ op: "+", text: add }); del = add = ""; };
  for (const s of segs) {
    if (s.op === "-") del += s.text;
    else if (s.op === "+") add += s.text;
    else { push(); if (out.at(-1)?.op === "=") out.at(-1)!.text += s.text; else out.push({ ...s }); }
  }
  push();
  return out.filter((s) => s.text);
}

const clip = (s: string, n = 80) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
function summarize(kind: Kind, a: string, b: string, segs?: Seg[]) {
  if (kind === "added") return `+ ${clip(b)}`;
  if (kind === "deleted") return `− ${clip(a)}`;
  if (kind === "moved") return `↕ ${clip(b)}`;
  const changes: string[] = [];
  for (let i = 0; i < segs!.length; i++) {
    const s = segs![i];
    if (s.op === "-" && segs![i + 1]?.op === "+") { changes.push(`“${clip(s.text.trim(), 40)}” → “${clip(segs![i + 1].text.trim(), 40)}”`); i++; }
    else if (s.op === "-") changes.push(`−“${clip(s.text.trim(), 40)}”`);
    else if (s.op === "+") changes.push(`+“${clip(s.text.trim(), 40)}”`);
  }
  return changes.slice(0, 3).join("; ") + (changes.length > 3 ? `; +${changes.length - 3} more` : "");
}
const hasNumberChange = (a: string, b: string, segs?: Seg[]) => (segs ? segs.some((s) => s.op !== "=" && /\d|[零一二三四五六七八九十百千万亿]/.test(s.text)) : /\d/.test(a + b));

/** 在一对“删除块 / 新增块”之间按相似度做单调配对（动态规划），配上的算“修改”。 */
function pairBlock(dels: number[], adds: number[], A: Para[], B: Para[]): [number | undefined, number | undefined][] {
  const n = dels.length, m = adds.length;
  if (!n || !m) return [...dels.map((d) => [d, undefined] as [number, undefined]), ...adds.map((a) => [undefined, a] as [undefined, number])];
  const big = n * m > 160_000;
  const sim = (i: number, j: number) => similarity(A[dels[i]].text, B[adds[j]].text);
  const score: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  const S: number[][] = big ? [] : Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => sim(i, j)));
  const get = (i: number, j: number) => (big ? (Math.abs(i / n - j / m) < 0.2 ? sim(i, j) : 0) : S[i][j]);
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) {
      const s = get(i, j);
      score[i][j] = Math.max(score[i + 1][j], score[i][j + 1], s >= 0.45 ? s + score[i + 1][j + 1] : -1);
    }
  const out: [number | undefined, number | undefined][] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    const s = get(i, j);
    if (s >= 0.45 && Math.abs(score[i][j] - (s + score[i + 1][j + 1])) < 1e-9) { out.push([dels[i], adds[j]]); i++; j++; }
    else if (score[i][j] === score[i + 1][j]) out.push([dels[i++], undefined]);
    else out.push([undefined, adds[j++]]);
  }
  while (i < n) out.push([dels[i++], undefined]);
  while (j < m) out.push([undefined, adds[j++]]);
  return out;
}

export function fingerprint(kind: string, a: string, b: string) {
  return createHash("sha1").update(`${kind}\0${a}\0${b}`).digest("hex").slice(0, 10);
}

export function compare(A: Para[], B: Para[], o: Options = {}) {
  const ka = A.map((p) => norm(p.text, o)), kb = B.map((p) => norm(p.text, o));
  const parts = diffArrays(ka, kb);
  const rows: Row[] = [];
  let ia = 0, ib = 0;
  for (let k = 0; k < parts.length; k++) {
    const p = parts[k];
    const n = p.count ?? p.value.length;
    if (!p.added && !p.removed) { for (let t = 0; t < n; t++) rows.push({ kind: "same", old: ia++, new: ib++ }); continue; }
    const dels: number[] = [], adds: number[] = [];
    while (k < parts.length && (parts[k].added || parts[k].removed)) {
      const q = parts[k], c = q.count ?? q.value.length;
      for (let t = 0; t < c; t++) (q.removed ? dels.push(ia++) : adds.push(ib++));
      k++;
    }
    k--;
    for (const [d, a] of pairBlock(dels, adds, A, B)) rows.push({ kind: d !== undefined && a !== undefined ? "modified" : d !== undefined ? "deleted" : "added", old: d, new: a });
  }
  // 移动：一处删除和另一处新增的文字完全相同。
  const addedBy = new Map<string, Row[]>();
  for (const r of rows) if (r.kind === "added") addedBy.set(kb[r.new!], [...(addedBy.get(kb[r.new!]) ?? []), r]);
  for (const r of rows) {
    if (r.kind !== "deleted" || ka[r.old!].length < 12) continue;
    const twin = addedBy.get(ka[r.old!])?.shift();
    if (twin) { twin.kind = "moved"; twin.old = r.old; r.kind = "moved"; r.new = twin.new; r.ghost = true; }
  }
  const changes: Change[] = [];
  const seen = new Map<string, number>();
  for (const r of rows) {
    if (r.kind === "same" || r.ghost) continue;
    const a = r.old !== undefined ? A[r.old].text : "", b = r.new !== undefined ? B[r.new].text : "";
    const segs = r.kind === "modified" ? wordDiff(a, b, o) : undefined;
    if (r.kind === "modified" && !segs!.some((s) => s.op !== "=")) { r.kind = "same"; continue; }
    let id = fingerprint(r.kind, a, b);
    const dup = seen.get(id) ?? 0;
    seen.set(id, dup + 1);
    if (dup) id += `-${dup + 1}`;
    r.change = id;
    changes.push({ id, kind: r.kind, old: r.old, new: r.new, oldLoc: r.old !== undefined ? A[r.old].loc : undefined, newLoc: r.new !== undefined ? B[r.new].loc : undefined, oldText: a, newText: b, segs, numbers: r.kind !== "moved" && hasNumberChange(a, b, segs), summary: summarize(r.kind, a, b, segs) });
  }
  for (const r of rows) if (r.ghost) r.change = changes.find((c) => c.kind === "moved" && c.old === r.old)?.id;
  const count = (k: Kind) => changes.filter((c) => c.kind === k).length;
  return { rows, changes, stats: { oldParas: A.length, newParas: B.length, same: rows.filter((r) => r.kind === "same").length, added: count("added"), deleted: count("deleted"), modified: count("modified"), moved: count("moved"), numbers: changes.filter((c) => c.numbers).length } };
}
export type Result = ReturnType<typeof compare>;
