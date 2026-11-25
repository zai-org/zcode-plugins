// 核对：从报告里挑出可核对的句子（含数字、引文或引用标记），在资料里找最接近的原文，逐个比对数字与引文。
import { norm, cites, compact, compactMap, dice, features, numbers, quotes, sameNumber, sentences, stripCites, type Num } from "./text.ts";
import type { Doc } from "./docs.ts";

export type Status = "ok" | "weak" | "number" | "quote" | "missing";
export const STATUSES: Status[] = ["number", "quote", "missing", "weak", "ok"];
export type Verdict = "supported" | "partly" | "wrong" | "unsupported" | "open";
export const VERDICTS: Verdict[] = ["supported", "partly", "wrong", "unsupported", "open"];

/** 资料中的一句（或相邻两句）：block = 段落/页下标，start/end = 在该块文字中的位置。 */
export interface Passage { file: string; block: number; start: number; end: number; text: string; loc: string; page?: number; section?: string }
export interface Evidence extends Passage { score: number; matched: string[] }
export interface NumberCheck { raw: string; found: boolean; evidence?: number; suggest?: string }
export interface QuoteCheck { text: string; found: boolean; closest?: Passage & { similarity: number } }
export interface Claim {
  id: string; key: string; text: string; loc: string; section?: string; cites: string[]; citedFiles: string[];
  status: Status; reason: string; coverage: number; numbers: NumberCheck[]; quotes: QuoteCheck[]; evidence: Evidence[]; citeMismatch?: string;
  review?: { verdict: Verdict; note?: string; evidence?: { file: string; loc?: string; text?: string }; at: string };
}
export interface Ref { key: string; text: string; file?: string }

const MAX_PASSAGE = 240;
interface Unit { file: string; block: number; start: number; end: number; feats: Map<string, number>; nums: Num[]; next?: number }

export class Index {
  units: Unit[] = [];
  df = new Map<string, number>();
  compacts: { file: string; block: number; text: string; map: number[] }[] = [];
  docs: Doc[];
  constructor(docs: Doc[]) {
    this.docs = docs;
    for (const d of docs) d.blocks.forEach((b, bi) => {
      const ss = sentences(b.text);
      ss.forEach((s, k) => {
        const u: Unit = { file: d.file, block: bi, start: s.start, end: s.end, feats: features(s.text), nums: numbers(s.text).map((n) => ({ ...n, start: n.start + s.start, end: n.end + s.start })) };
        if (k + 1 < ss.length) u.next = this.units.length + 1;
        this.units.push(u);
        for (const f of u.feats.keys()) this.df.set(f, (this.df.get(f) ?? 0) + 1);
      });
      this.compacts.push({ file: d.file, block: bi, ...compactMap(b.text) });
    });
  }
  idf(f: string) { return Math.log(1 + this.units.length / (1 + (this.df.get(f) ?? 0))); }
  doc(file: string) { return this.docs.find((d) => d.file === file)!; }
  passage(file: string, block: number, start: number, end: number): Passage {
    const d = this.doc(file), b = d.blocks[block];
    return { file, block, start, end, text: b.text.slice(start, end), loc: b.loc, page: b.page, section: b.section };
  }

  /** 按覆盖率排序的候选（单句或相邻两句）；bonus 让数字吻合、出自所引资料的候选靠前。 */
  rank(text: string, opt: { nums?: Num[]; prefer?: string[]; limit?: number } = {}) {
    const q = features(text);
    let total = 0;
    for (const [f, c] of q) total += c * this.idf(f) * (f.startsWith("#") ? 2 : 1);
    if (!total) return [];
    const checkable = (opt.nums ?? []).filter((n) => !n.date);
    const score = (fs: Map<string, number>[]) => {
      let hit = 0;
      const matched: string[] = [];
      for (const [f, c] of q) {
        const have = fs.reduce((s, m) => s + (m.get(f) ?? 0), 0);
        if (have) { hit += Math.min(c, have) * this.idf(f) * (f.startsWith("#") ? 2 : 1); matched.push(f); }
      }
      return { cov: hit / total, matched };
    };
    const out: { i: number; j: number; cov: number; rank: number; matched: string[] }[] = [];
    this.units.forEach((u, i) => {
      for (const j of u.next !== undefined ? [i, u.next] : [i]) {
        const us = j === i ? [u] : [u, this.units[j]];
        const { cov, matched } = score(us.map((x) => x.feats));
        if (cov <= 0) continue;
        const numHits = checkable.filter((n) => us.some((x) => x.nums.some((m) => sameNumber(n, m)))).length;
        const rank = cov + 0.15 * numHits + (opt.prefer?.includes(u.file) ? 0.05 : 0) - (j !== i ? 0.03 : 0);
        out.push({ i, j, cov, rank, matched });
      }
    });
    out.sort((a, b) => b.rank - a.rank);
    const seen = new Set<number>(), res: typeof out = [];
    for (const o of out) {
      if (seen.has(o.i) || seen.has(o.j)) continue;
      seen.add(o.i); seen.add(o.j);
      res.push(o);
      if (res.length >= (opt.limit ?? 8)) break;
    }
    return res;
  }
  evidence(o: { i: number; j: number; cov: number; matched: string[] }, claimLen = 120): Evidence {
    const a = this.units[o.i], b = this.units[o.j];
    let start = a.start, end = b.end;
    const limit = Math.min(MAX_PASSAGE, Math.max(100, claimLen * 2));
    if (end - start > limit + 40) [start, end] = this.narrow(a.file, a.block, start, end, o.matched, limit);
    return { ...this.passage(a.file, a.block, start, end), score: Math.round(o.cov * 100) / 100, matched: o.matched.filter((m) => !m.startsWith("#")).slice(0, 12) };
  }
  /** 太长的“句子”（表格、没有句号的长段）只保留命中最密的一段，再扩到最近的逗号/分号/空格。 */
  narrow(file: string, block: number, start: number, end: number, matched: string[], limit = MAX_PASSAGE): [number, number] {
    const text = this.doc(file).blocks[block].text;
    const low = norm(text.slice(start, end)).toLowerCase();
    const pos: number[] = [];
    for (const m of matched) {
      if (m.startsWith("#")) continue;
      for (let k = low.indexOf(m); k >= 0 && pos.length < 400; k = low.indexOf(m, k + 1)) pos.push(k);
    }
    for (const n of numbers(text.slice(start, end))) if (matched.some((m) => m === `#${n.unit}${Number(n.value.toPrecision(6))}`)) pos.push(n.start, n.start, n.start);
    if (!pos.length) return [start, Math.min(end, start + limit)];
    pos.sort((x, y) => x - y);
    let best = [pos[0], pos[0]], bestN = 0;
    for (let l = 0, r = 0; r < pos.length; r++) {
      while (pos[r] - pos[l] > limit - 30) l++;
      if (r - l + 1 > bestN) { bestN = r - l + 1; best = [pos[l], pos[r]]; }
    }
    const seg = text.slice(start, end);
    let s = best[0], e = Math.min(seg.length, best[1] + 12);
    for (let k = 0; k < 40 && s > 0 && !/[，,；;。\s]/.test(seg[s - 1]); k++) s--;
    for (let k = 0; k < 40 && e < seg.length && !/[，,；;。]/.test(seg[e - 1]); k++) e++;
    return [start + s, start + e];
  }
  numsIn(o: { i: number; j: number }) { return o.i === o.j ? this.units[o.i].nums : [...this.units[o.i].nums, ...this.units[o.j].nums]; }

  /** 引文逐字查找（忽略空白、引号写法与引用标记）；找不到时给出最像的一句。 */
  findQuote(q: string): QuoteCheck {
    const c = compact(q);
    for (const b of this.compacts) {
      const at = b.text.indexOf(c);
      if (at >= 0) return { text: q, found: true, closest: { ...this.passage(b.file, b.block, b.map[at], b.map[at + c.length - 1] + 1), similarity: 1 } };
    }
    let best: (Passage & { similarity: number }) | undefined;
    for (const u of this.units) {
      const d = this.doc(u.file), b = d.blocks[u.block];
      const s = dice(c, compact(b.text.slice(u.start, u.end)));
      if (s > (best?.similarity ?? 0.4)) best = { ...this.passage(u.file, u.block, u.start, u.end), similarity: Math.round(s * 100) / 100 };
    }
    return { text: q, found: false, closest: best };
  }
}

/** 参考文献条目 → 资料文件（按文件名或标题匹配）。 */
export function mapRefs(refs: Ref[], docs: Doc[]): Ref[] {
  const base = (f: string) => f.split("/").pop()!.replace(/\.[^.]+$/, "").normalize("NFKC").toLowerCase();
  return refs.map((r) => {
    const t = r.text.normalize("NFKC").toLowerCase();
    const byName = docs.find((d) => t.includes(base(d.file)) && base(d.file).length >= 3);
    const byTitle = byName ?? docs.map((d) => ({ d, s: d.title.length >= 6 ? dice(compact(d.title), compact(r.text)) : 0 })).sort((a, b) => b.s - a.s).find((x) => x.s >= 0.45)?.d;
    return { ...r, file: byTitle?.file };
  });
}

const REF_HEAD = /^(参考|引用|资料来源|数据来源|来源|文献|references?|bibliography|sources|works cited|notes)/i;
const REF_LINE = /^\s*(?:\[\^?(\w+)\][:：]?|【(\d+)】|(\d+)[.)、])\s*(.+)$/;

/** 报告 → 可核对的句子 + 参考文献表。 */
export function claimsOf(report: Doc) {
  const out: { text: string; loc: string; section?: string }[] = [];
  const refs: Ref[] = [];
  let inRefs = false;
  for (const b of report.blocks) {
    if (b.heading) { inRefs = REF_HEAD.test(b.text.trim()); continue; }
    const rm = REF_LINE.exec(b.text);
    if (inRefs || (rm && /^\s*(?:\[\^|【)/.test(b.text)) || (rm && /^\s*\[\d+\]\s/.test(b.text) && !/[。.!?！？]\s*\S/.test(b.text.slice(0, -1)) && b.text.length < 300 && /https?:|\.pdf|\.html?|\.docx|出版|版社|报告|公报|journal|press|\d{4}/i.test(b.text))) {
      if (rm) refs.push({ key: rm[1] ?? rm[2] ?? rm[3], text: rm[4].trim() });
      else if (inRefs) refs.push({ key: String(refs.length + 1), text: b.text.trim() });
      continue;
    }
    for (const s of sentences(b.text)) {
      const nums = numbers(s.text).filter((n) => !n.date);
      if (!nums.length && !quotes(s.text).length && !cites(s.text).length) continue;
      out.push({ text: s.text, loc: b.loc, section: b.section });
    }
  }
  return { claims: out, refs };
}

export const claimKey = (t: string) => compact(stripCites(t)).slice(0, 200);

export function checkClaim(idx: Index, text: string, refs: Ref[]): Omit<Claim, "id" | "loc" | "section" | "key"> {
  const cs = cites(text);
  const citedFiles = [...new Set(cs.map((c) => refs.find((r) => r.key === c || (c.includes(" ") && r.text.includes(c.split(" ")[0])))?.file).filter((f): f is string => !!f))];
  const nums = numbers(stripCites(text));
  const checkable = nums.filter((n) => !n.date);
  const ranked = idx.rank(text, { nums, prefer: citedFiles });
  const best = ranked[0];
  const coverage = best ? Math.round(best.cov * 100) / 100 : 0;
  const evidence: Evidence[] = [];
  const evIndex = (o: (typeof ranked)[number]) => {
    const ev = idx.evidence(o, text.length);
    let k = evidence.findIndex((e) => e.file === ev.file && e.block === ev.block && e.start === ev.start);
    if (k < 0) { evidence.push(ev); k = evidence.length - 1; }
    return k;
  };
  if (best) evIndex(best);
  // 每个数字：先看最佳候选，再看其他像样的候选；都没有就按数字前文找资料里同类数字作为“可能应为”。
  const numberChecks: NumberCheck[] = checkable.map((n) => {
    const hit = ranked.find((o) => (o === best || o.cov >= Math.max(0.25, best.cov * 0.5)) && idx.numsIn(o).some((m) => sameNumber(n, m)));
    if (hit) return { raw: n.raw, found: true, evidence: evIndex(hit) };
    let sug: { o: (typeof ranked)[number]; m: Num; s: number } | undefined;
    const ctx = compact(n.context).slice(-8);
    for (const o of ranked.filter((o) => o.cov >= Math.max(0.2, (best?.cov ?? 0) * 0.5))) {
      for (const m of idx.numsIn(o)) {
        if (m.unit !== n.unit || m.date) continue;
        const s = dice(ctx, compact(m.context).slice(-8)) + (o === best ? 0.05 : 0);
        if (s > (sug?.s ?? 0.25)) sug = { o, m, s };
      }
    }
    return sug ? { raw: n.raw, found: false, evidence: evIndex(sug.o), suggest: sug.m.raw } : { raw: n.raw, found: false };
  });
  const quoteChecks = quotes(text).map((q) => idx.findQuote(q.text));
  const missingNums = numberChecks.filter((n) => !n.found);
  let status: Status, reason: string;
  if (quoteChecks.some((q) => !q.found)) {
    const q = quoteChecks.find((x) => !x.found)!;
    status = "quote";
    reason = q.closest ? `quote not verbatim in sources; closest (${Math.round(q.closest.similarity * 100)}%) in ${q.closest.file} ${q.closest.loc}` : "quote not found in any source";
  } else if (missingNums.length && (coverage >= 0.35 || numberChecks.some((n) => n.found) || missingNums.some((n) => n.suggest))) {
    status = "number";
    reason = missingNums.map((n) => `${n.raw} not in source${n.suggest ? ` (source says ${n.suggest})` : ""}`).join("; ");
  } else if (missingNums.length) {
    status = "missing";
    reason = `no source passage supports this (best match ${Math.round(coverage * 100)}%)`;
  } else if (coverage >= 0.5 || (quoteChecks.length && quoteChecks.every((q) => q.found))) {
    status = "ok";
    reason = checkable.length ? `numbers and wording match ${evidence[0]?.file} ${evidence[0]?.loc}` : `wording matches ${evidence[0]?.file} ${evidence[0]?.loc}`;
  } else if ((checkable.length >= 2) || (checkable.length && coverage >= 0.3) || coverage >= 0.35) {
    status = "weak";
    reason = checkable.length ? "numbers found but wording differs (paraphrase or translation?); confirm the meaning" : `only a partial match (${Math.round(coverage * 100)}%); confirm the meaning`;
  } else {
    status = "missing";
    reason = `no source passage supports this (best match ${Math.round(coverage * 100)}%)`;
  }
  if (status === "missing") evidence.splice(0, evidence.length, ...(best && best.cov >= 0.2 ? [idx.evidence(best, text.length)] : []));
  const quoteFile = quoteChecks.find((q) => q.found)?.closest?.file;
  const usedFile = quoteFile ?? evidence[0]?.file;
  const citeMismatch = citedFiles.length && usedFile && (status === "ok" || status === "weak") && !citedFiles.includes(usedFile) ? `cited ${cs.map((c) => `[${c}]`).join("")} → ${citedFiles.join(", ")}, but the support is in ${usedFile}` : undefined;
  return { text, cites: cs, citedFiles, status, reason, coverage, numbers: numberChecks, quotes: quoteChecks, evidence, ...(citeMismatch ? { citeMismatch } : {}) };
}
