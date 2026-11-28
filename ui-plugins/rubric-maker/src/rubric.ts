/** 评分量规解析与计分。 */
export interface Level { name: string; points: number }
export interface Criterion { name: string; mult: number; desc: Record<string, string> }
export interface Rubric { title: string; total: number; levels: Level[]; criteria: Criterion[] }

const DEFAULT_LEVELS: Level[] = [{ name: "优秀", points: 4 }, { name: "良好", points: 3 }, { name: "合格", points: 2 }, { name: "待改进", points: 1 }];

export function parseRubric(md: string): Rubric {
  const R: Rubric = { title: "", total: NaN, levels: [], criteria: [] };
  let cur: Criterion | undefined;
  const pending: { c: Criterion; pts?: number }[] = [];
  for (const raw of md.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const h1 = /^#\s+(.+)$/.exec(line);
    if (h1 && !R.title) { R.title = h1[1].trim(); continue; }
    const h2 = /^#{2,3}\s+(.+?)\s*(?:[×x*]\s*(\d+(?:\.\d+)?)|[（(]\s*(\d+(?:\.\d+)?)\s*分\s*[)）])?\s*$/i.exec(line);
    if (h2) { cur = { name: h2[1].trim(), mult: h2[2] ? +h2[2] : 1, desc: {} }; R.criteria.push(cur); pending.push({ c: cur, pts: h2[3] ? +h2[3] : undefined }); continue; }
    if (!cur) {
      const tot = /^(?:满分|总分|total)\s*[:：]\s*(\d+(?:\.\d+)?)/i.exec(line);
      if (tot) { R.total = +tot[1]; continue; }
      const lv = /^(?:等级|档次|levels?)\s*[:：]\s*(.+)$/i.exec(line);
      if (lv) { R.levels = lv[1].split(/\s*[|｜/／,，;；]\s*/).map((t) => { const m = /^(.+?)\s*[（(]?\s*(\d+(?:\.\d+)?)\s*分?\s*[)）]?$/.exec(t.trim()); return m ? { name: m[1].trim(), points: +m[2] } : { name: t.trim(), points: NaN }; }).filter((l) => l.name); continue; }
      continue;
    }
    const d = /^[-*]?\s*([^:：]{1,8}?)\s*[（(]?\s*(\d+(?:\.\d+)?)?\s*分?\s*[)）]?\s*[:：]\s*(.+)$/.exec(line);
    if (d) {
      const name = d[1].trim();
      if (!R.levels.length || !R.levels.some((l) => l.name === name)) { if (!R.levels.some((l) => l.name === name) && d[2]) R.levels.push({ name, points: +d[2] }); }
      cur.desc[name] = d[3].trim();
    }
  }
  if (!R.levels.length) R.levels = DEFAULT_LEVELS.map((l) => ({ ...l }));
  const n = R.levels.length;
  R.levels.forEach((l, i) => { if (isNaN(l.points)) l.points = n - i; });
  R.levels.sort((a, b) => b.points - a.points);
  const top = R.levels[0].points;
  for (const p of pending) if (p.pts) p.c.mult = p.pts / top;
  if (isNaN(R.total)) R.total = R.criteria.reduce((a, c) => a + c.mult * top, 0);
  return R;
}

export const maxOf = (R: Rubric) => R.criteria.reduce((a, c) => a + c.mult * R.levels[0].points, 0);

/** “优”“A”“4”“良好” → 等级名；空 → ""；无法识别 → undefined。 */
export function levelOf(v: unknown, R: Rubric): string | undefined {
  const t = String(v ?? "").trim();
  if (!t) return "";
  const exact = R.levels.find((l) => l.name === t);
  if (exact) return exact.name;
  if (/^\d+(\.\d+)?$/.test(t)) return R.levels.find((l) => l.points === +t)?.name;
  const letters = "ABCDEF";
  if (/^[A-F]$/i.test(t)) return R.levels[letters.indexOf(t.toUpperCase())]?.name;
  const pre = R.levels.filter((l) => l.name.startsWith(t) || t.startsWith(l.name));
  return pre.length === 1 ? pre[0].name : undefined;
}

export const r1 = (x: number) => Math.round(x * 10) / 10;
