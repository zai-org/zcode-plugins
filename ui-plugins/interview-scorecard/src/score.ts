/** 面试评分维度解析与汇总。 */
export interface Criterion { name: string; weight: number; anchors: Record<number, string>; aliases: string[] }
export interface Rubric { title: string; min: number; max: number; threshold: number; criteria: Criterion[] }

const num = (t: string) => Number(t.replace(/[％%]/, ""));

/** 解析评分维度 Markdown：## 维度名 30%，下面 “1 = 描述” 或 “- 5 分：描述”。 */
export function parseRubric(md: string): Rubric {
  const lines = md.replace(/\r/g, "").split("\n");
  let title = "", min = 1, max = 5, threshold = NaN;
  const criteria: Criterion[] = [];
  let cur: Criterion | undefined;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const h1 = /^#\s+(.+)$/.exec(line);
    if (h1 && !title) { title = h1[1].trim(); continue; }
    const h2 = /^#{2,3}\s+(.+?)\s*(?:[（(]?\s*(?:权重|weight)?\s*[:：]?\s*(\d+(?:\.\d+)?)\s*[%％][)）]?)?\s*$/i.exec(line);
    if (h2) {
      const [name, ...alias] = h2[1].split(/\s*[/／]\s*/);
      cur = { name: name.trim(), weight: h2[2] ? num(h2[2]) : NaN, anchors: {}, aliases: alias.map((a) => a.trim()).filter(Boolean) };
      criteria.push(cur);
      continue;
    }
    const sc = /(?:评分|分值|scale)\s*[:：]?\s*(\d+)\s*[-–~至到]\s*(\d+)/i.exec(line);
    if (sc && !cur) { min = +sc[1]; max = +sc[2]; }
    const th = /(\d+(?:\.\d+)?)\s*分?\s*(?:以上|及以上|or above|\+)\s*(?:建议)?(?:录用|通过|hire|pass)/i.exec(line) ?? /(?:录用|通过|hire|pass)(?:线|分数线|threshold|bar)?\s*[:：≥>=]+\s*(\d+(?:\.\d+)?)/i.exec(line);
    if (th && !cur) threshold = +th[1];
    const an = /^[-*]?\s*(\d+)\s*(?:分)?\s*[=:：、.]\s*(.+)$/.exec(line);
    if (an && cur) cur.anchors[+an[1]] = an[2].trim();
  }
  const given = criteria.filter((c) => !isNaN(c.weight)), rest = criteria.length - given.length;
  const used = given.reduce((a, c) => a + c.weight, 0);
  for (const c of criteria) if (isNaN(c.weight)) c.weight = rest ? Math.max(0, (100 - used) / rest) : 0;
  return { title, min, max, threshold: isNaN(threshold) ? Math.round((min + (max - min) * 0.625) * 10) / 10 : threshold, criteria };
}

const norm = (t: string) => t.replace(/[\s（）()·\-_/／]/g, "").toLowerCase();
/** 表头对应到第几个维度。 */
export function matchHeader(h: string, criteria: Criterion[]): number {
  const k = norm(h.replace(/[（(].*?[)）]|\d+\s*[%％]|分$/g, ""));
  if (!k) return -1;
  let i = criteria.findIndex((c) => [c.name, ...c.aliases].some((n) => norm(n) === k));
  if (i < 0) i = criteria.findIndex((c) => [c.name, ...c.aliases].some((n) => norm(n).includes(k) || k.includes(norm(n))));
  return i;
}

/** “4”“4分”“4.5”“★★★★” → 数字；空 → undefined；无法识别 → NaN。 */
export function parseScore(v: unknown): number | undefined {
  const t = String(v ?? "").trim();
  if (!t || t === "-" || t === "—") return undefined;
  if (/^[★☆]+$/.test(t)) return (t.match(/★/g) ?? []).length;
  const m = /^(\d+(?:\.\d+)?)\s*(?:分|pts?)?$/i.exec(t.replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
  return m ? +m[1] : NaN;
}

export const VERDICTS = ["强烈推荐", "推荐", "待定", "不推荐"];
export function parseVerdict(v: unknown): string {
  const t = String(v ?? "").trim().toLowerCase();
  if (!t) return "";
  if (/强烈|strong(ly)?\s*(yes|hire)|^strong$/.test(t)) return "强烈推荐";
  if (/不推荐|不通过|不录用|淘汰|no\s*hire|^no$|reject/.test(t)) return "不推荐";
  if (/待定|再议|保留|maybe|hold|lean/.test(t)) return "待定";
  if (/推荐|通过|录用|^yes$|hire/.test(t)) return "推荐";
  return "";
}

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
export const r2 = (x: number) => Math.round(x * 100) / 100;

/** 按权重求加权平均，只计有分的维度。 */
export function weighted(scores: (number | undefined)[], criteria: Criterion[]): number {
  let s = 0, w = 0;
  scores.forEach((v, i) => { if (v !== undefined && !isNaN(v) && criteria[i]) { s += v * criteria[i].weight; w += criteria[i].weight; } });
  return w ? s / w : NaN;
}

export const cleanName = (t: string) => t.replace(/\s+/g, " ").trim().replace(/^([\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/, "$1").replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])$/, "$1$2");
