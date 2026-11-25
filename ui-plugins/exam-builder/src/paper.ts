// 组卷：按题型分节，按章节/难度比例抽题，多套之间不重复；同一种子结果固定。
import type { Level, QType, Question } from "./bank.ts";

export interface SectionRule { type: QType; count: number; score?: number; title?: string }
export interface Rules {
  title: string; subtitle?: string; sections: SectionRule[]; chapters?: string[];
  difficulty?: { easy: number; medium: number; hard: number }; sets?: number; seed?: string; unique?: boolean; exclude?: string[];
}
export interface PaperSection { type: QType; title?: string; ids: string[]; scores: number[] }
export interface Paper { set: string; sections: PaperSection[]; total: number; levels: Record<Level, number> }

export const DEFAULT_SCORE: Record<QType, number> = { single: 5, multi: 6, tf: 2, fill: 5, short: 12 };

function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const shuffle = <T>(xs: T[], r: () => number) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/** 按比例把 n 分给三个难度（最大余数法）。 */
export function quota(n: number, d: { easy: number; medium: number; hard: number }): Record<Level, number> {
  const w = [d.easy, d.medium, d.hard].map((x) => Math.max(0, x));
  const sum = w.reduce((a, b) => a + b, 0) || 1;
  const raw = w.map((x) => (x / sum) * n);
  const base = raw.map(Math.floor);
  let left = n - base.reduce((a, b) => a + b, 0);
  raw.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { base[i]++; left--; } });
  return { 1: base[0], 2: base[1], 3: base[2] };
}

export function buildPapers(bank: Question[], rules: Rules, bad: Set<string>) {
  const sets = Math.max(1, Math.min(10, rules.sets ?? 1));
  const r = rng(rules.seed ?? rules.title);
  const used = new Set<string>(rules.exclude ?? []);
  const warnings: string[] = [];
  const papers: Paper[] = [];
  const pool = bank.filter((q) => !bad.has(q.id) && (!rules.chapters?.length || rules.chapters.includes(q.chapter)));
  for (let s = 0; s < sets; s++) {
    const set = String.fromCharCode(65 + s);
    const taken = new Set<string>();
    const sections: PaperSection[] = [];
    const levels: Record<Level, number> = { 1: 0, 2: 0, 3: 0 };
    for (const sec of rules.sections) {
      const cands = pool.filter((q) => q.type === sec.type && !taken.has(q.id) && !(rules.unique !== false && used.has(q.id)));
      const want = rules.difficulty ? quota(sec.count, rules.difficulty) : undefined;
      const picked: Question[] = [];
      if (want) {
        for (const lv of [1, 2, 3] as Level[]) picked.push(...shuffle(cands.filter((q) => q.level === lv), r).slice(0, want[lv]));
        if (picked.length < sec.count) {
          // 某个难度不够：从相邻难度补，并提示
          const short = sec.count - picked.length;
          const rest = shuffle(cands.filter((q) => !picked.includes(q)), r).sort((a, b) => Math.abs(a.level - 2) - Math.abs(b.level - 2));
          picked.push(...rest.slice(0, short));
          if (rest.length) warnings.push(`set ${set} ${sec.type}: not enough questions at the requested difficulty; ${Math.min(short, rest.length)} filled from other levels`);
        }
      } else picked.push(...shuffle(cands, r).slice(0, sec.count));
      if (picked.length < sec.count) warnings.push(`set ${set} ${sec.type}: only ${picked.length} of ${sec.count} questions available${rules.unique !== false && sets > 1 ? " (questions are not repeated across sets)" : ""}`);
      // 题内按难度从易到难
      picked.sort((a, b) => a.level - b.level || a.id.localeCompare(b.id));
      for (const q of picked) { taken.add(q.id); used.add(q.id); levels[q.level]++; }
      sections.push({ type: sec.type, ...(sec.title ? { title: sec.title } : {}), ids: picked.map((q) => q.id), scores: picked.map((q) => sec.score ?? q.score ?? DEFAULT_SCORE[sec.type]) });
    }
    const total = sections.reduce((t, sec) => t + sec.scores.reduce((a, b) => a + b, 0), 0);
    papers.push({ set, sections, total, levels });
  }
  return { papers, warnings };
}

/** 替换一道题：同题型、同难度优先，且不与任何一套里已有的题重复。 */
export function swapQuestion(bank: Question[], papers: Paper[], set: string, id: string, bad: Set<string>, seed: string, chapters?: string[]) {
  const p = papers.find((x) => x.set === set);
  const sec = p?.sections.find((s) => s.ids.includes(id));
  const old = bank.find((q) => q.id === id);
  if (!p || !sec || !old) return undefined;
  const inUse = new Set(papers.flatMap((x) => x.sections.flatMap((s) => s.ids)));
  const cands = bank.filter((q) => q.type === old.type && !inUse.has(q.id) && !bad.has(q.id) && (!chapters?.length || chapters.includes(q.chapter)));
  const same = cands.filter((q) => q.level === old.level);
  const list = same.length ? same : cands;
  if (!list.length) return undefined;
  const r = rng(`${seed}:${set}:${id}:${inUse.size}`);
  const next = list[Math.floor(r() * list.length)];
  const k = sec.ids.indexOf(id);
  const fixed = sec.scores.every((x) => x === sec.scores[0]) && sec.ids.length > 1;
  sec.ids[k] = next.id;
  if (!fixed) { p.total += (next.score ?? sec.scores[k]) - sec.scores[k]; sec.scores[k] = next.score ?? sec.scores[k]; }
  p.levels[old.level]--; p.levels[next.level]++;
  return next;
}
