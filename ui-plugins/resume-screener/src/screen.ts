/** 岗位要求解析 + 简历匹配（关键词组、年限、学历）。 */

export interface Group { text: string; alts: string[] }
export interface Jd { title: string; minYears: number; degree: string; must: Group[]; nice: Group[]; flagged: string[] }

const FILLER = /熟练使用|熟练掌握|熟练|熟悉|掌握|精通|了解|具备|具有|拥有|能够|会用|会|使用|相关|经验|工作|行业|优先|等|以上|良好的?|较强的?|一定的?|能力|技能|工具|可视化|专业|有/g;
const DISCRIM = /(\d+\s*岁以[下上内]|年龄[^，。；]*|男性|女性|限男|限女|男士|女士|已婚|未婚|已育|籍贯|本地户口|身高[^，。；]*)/g;
export const DEGREES = ["大专", "本科", "硕士", "博士"];

/** 一条要求 → 关键词组：“或 / or / /” 是任选其一，“、，和” 拆成多组。 */
export function groupsOf(line: string): Group[] {
  const t = line.replace(/^[-*•\d.、\s]+/, "").trim();
  const out: Group[] = [];
  for (const part of t.split(/[、，,；;和及与]|以及|\band\b/)) {
    const alts: string[] = [];
    for (const a0 of part.split(/或|\bor\b|\s\/\s/)) {
      let a = a0.trim();
      const ab = /A\/B\s*(测试|test(ing)?)?/i.exec(a);
      if (ab) { alts.push("A/B 测试"); a = a.replace(ab[0], " "); }
      for (const m of a.matchAll(/[A-Za-z][A-Za-z0-9+#.]*(?:\s+[A-Z][A-Za-z0-9+#.]*)*/g)) alts.push(m[0].trim());
      const zh = a.replace(/[A-Za-z0-9+#./\s]+/g, " ").replace(FILLER, " ").split(/\s+/).filter((x) => x.length >= 2 && x.length <= 8);
      alts.push(...zh);
    }
    const uniq = [...new Set(alts.filter(Boolean))];
    if (uniq.length) out.push({ text: part.trim(), alts: uniq });
  }
  return out;
}

export function parseJd(md: string): Jd {
  const jd: Jd = { title: "", minYears: 0, degree: "", must: [], nice: [], flagged: [] };
  let mode: "" | "must" | "nice" = "";
  for (const raw of md.replace(/\r/g, "").split("\n")) {
    const l = raw.trim();
    if (!l) continue;
    const h = /^#{1,6}\s*(.+)$/.exec(l);
    if (h) {
      if (!jd.title && /^#\s/.test(l)) { jd.title = h[1].trim(); continue; }
      mode = /要求|任职|资格|必须|requirement|qualification|must/i.test(h[1]) ? "must" : /加分|优先|nice|bonus|preferred|plus/i.test(h[1]) ? "nice" : "";
      continue;
    }
    if (!mode || !/^[-*•\d]/.test(l)) continue;
    let line = l;
    for (const m of l.matchAll(DISCRIM)) { jd.flagged.push(m[0].trim()); line = line.replace(m[0], ""); }
    const y = /(\d+)\s*年以上|(\d+)\+?\s*years/i.exec(line);
    if (y && mode === "must") { jd.minYears = Number(y[1] ?? y[2]); continue; }
    const dg = DEGREES.find((d) => line.includes(d)) ?? (/master/i.test(line) ? "硕士" : /bachelor|degree/i.test(line) ? "本科" : "");
    if (dg && mode === "must") { jd.degree = dg; continue; }
    if (/^[-*•\d.、\s，,。]*$/.test(line.replace(/优先/g, ""))) continue;
    (mode === "must" ? jd.must : jd.nice).push(...groupsOf(line.replace(/优先/g, "")));
  }
  return jd;
}

/** 别名：中英文和常见写法互认。 */
const ALIAS: Record<string, string[]> = {
  "a/b 测试": ["a/b test", "ab test", "ab测试", "a/b testing", "a/b tests", "a/b实验", "ab实验"],
  "power bi": ["powerbi"], python: ["pandas"], sql: ["mysql", "hive sql", "postgresql"],
  餐饮: ["restaurant", "coffee", "茶饮", "咖啡", "餐厅"], 零售: ["retail", "连锁零售", "门店"],
  统计: ["statistics", "统计学"], 数学: ["mathematics", "math", "应用数学"], 计算机: ["computer science", "计算机科学"],
};
const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ");
export function hasTerm(text: string, term: string): boolean {
  const t = norm(text), k = norm(term), keys = [k, ...(ALIAS[k] ?? [])];
  return keys.some((x) => (/^[a-z0-9 +#./]+$/.test(x) ? new RegExp(`(^|[^a-z0-9])${x.replace(/[.+#/]/g, (c) => `\\${c}`)}($|[^a-z0-9])`).test(t) : t.includes(x)));
}
export const groupHit = (text: string, g: Group) => g.alts.find((a) => hasTerm(text, a));

/* ---------- 年限、学历、联系方式 ---------- */
const MON: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const EDU = /大学|学院|本科|硕士|博士|university|college|bsc|msc|bachelor|master|phd/i;
export function workYears(text: string, now: number): number {
  const spans: [number, number][] = [];
  const ym = (s: string) => {
    const v = s.trim().toLowerCase();
    if (/至今|现在|present|now|current/.test(v)) return now;
    let m = /(\d{4})\s*[./\-年]\s*(\d{1,2})/.exec(v); if (m) return Number(m[1]) * 12 + Number(m[2]) - 1;
    m = /([a-z]{3})[a-z]*\.?\s+(\d{4})/.exec(v); if (m && MON[m[1]]) return Number(m[2]) * 12 + MON[m[1]] - 1;
    return undefined;
  };
  for (const line of text.split("\n")) {
    if (EDU.test(line)) continue;
    const m = /((?:\d{4}\s*[./\-年]\s*\d{1,2})|(?:[A-Za-z]{3,9}\.?\s+\d{4}))\s*(?:–|—|-|~|至|to)\s*((?:\d{4}\s*[./\-年]\s*\d{1,2})|(?:[A-Za-z]{3,9}\.?\s+\d{4})|至今|现在|present|now|current)/i.exec(line);
    if (!m) continue;
    const a = ym(m[1]), b = ym(m[2]);
    if (a !== undefined && b !== undefined && b >= a) spans.push([a, b + 1]);
  }
  spans.sort((x, y) => x[0] - y[0]);
  let total = 0, end = -1;
  for (const [a, b] of spans) { if (a >= end) { total += b - a; end = b; } else if (b > end) { total += b - end; end = b; } }
  return Math.round((total / 12) * 10) / 10;
}
export function degreeOf(text: string): string {
  if (/博士|phd|doctor/i.test(text)) return "博士";
  if (/硕士|研究生|master|msc|m\.s\./i.test(text)) return "硕士";
  if (/本科|学士|bachelor|bsc|b\.s\.|b\.a\./i.test(text)) return "本科";
  if (/大专|专科|associate/i.test(text)) return "大专";
  return "";
}
export const emailOf = (t: string) => /[\w.+-]+@[\w-]+(\.[\w-]+)+/.exec(t)?.[0] ?? "";
export const phoneOf = (t: string) => { const m = /(\+?\d[\d\s-]{9,16}\d)/.exec(t.replace(/\d{4}\s*[.\-/年]\s*\d{1,2}/g, " ")); const d = m?.[1].replace(/\D/g, "") ?? ""; return d.length >= 11 ? d.slice(-11) : ""; };
