/** 简历 Markdown：# 姓名 / 第二行联系方式 / ## 板块 / ### 标题 | 时间 / - 要点。 */
export interface Entry { section: string; title: string; dates: string; details: string }
export interface Resume { name: string; contact: string; entries: Entry[] }

export function parseResume(md: string): Resume {
  const lines = md.replace(/\r/g, "").split("\n");
  let name = "", contact = "", section = "";
  const entries: Entry[] = [];
  let cur: Entry | undefined;
  for (const raw of lines) {
    const l = raw.trimEnd();
    if (!l.trim()) continue;
    let m: RegExpExecArray | null;
    if ((m = /^#\s+(.+)$/.exec(l)) && !name) { name = m[1].trim(); continue; }
    if ((m = /^##\s+(.+)$/.exec(l))) { section = m[1].trim(); cur = undefined; continue; }
    if ((m = /^###\s+(.+)$/.exec(l))) {
      const [t, d] = m[1].split(/\s+\|\s+/);
      cur = { section, title: t.trim(), dates: (d ?? "").trim(), details: "" };
      entries.push(cur);
      continue;
    }
    if (!section) { contact = contact ? `${contact} · ${l.trim()}` : l.trim(); continue; }
    const text = l.replace(/^\s*[-*+]\s+/, "• ").trim();
    if (!cur) { cur = { section, title: "", dates: "", details: "" }; entries.push(cur); }
    cur.details = cur.details ? `${cur.details}\n${text}` : text;
  }
  return { name, contact, entries };
}

/** “2023.03 – 至今” → [2023*12+2, now]；认不出返回 undefined。 */
const MON: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
function ym(t: string, now: number): number | undefined {
  const s = t.trim().toLowerCase();
  if (/^(至今|今|现在|present|now|current)$/.test(s)) return now;
  let m = /^(\d{4})\s*[./\-年]\s*(\d{1,2})\s*月?$/.exec(s);
  if (m) return Number(m[1]) * 12 + Number(m[2]) - 1;
  m = /^([a-z]{3,4})[a-z]*\.?\s+(\d{4})$/.exec(s);
  if (m && MON[m[1]]) return Number(m[2]) * 12 + MON[m[1]] - 1;
  m = /^(\d{4})$/.exec(s);
  if (m) return Number(m[1]) * 12;
  return undefined;
}
export function parseRange(d: string, now: number): { start?: number; end?: number; style: string } {
  const parts = d.replace(/至今|现在/g, "present").split(/\s*(?:–|—|-{1,2}|~|～|至|to)\s*(?=\d|至今|今|现在|present|now|current|[A-Za-z]{3})/i);
  if (parts.length !== 2) return { style: "" };
  const style = d.replace(/\d/g, "9").replace(/\s+/g, "").replace(/至今|present|now/gi, "P");
  return { start: ym(parts[0], now), end: ym(parts[1], now), style };
}
export const fmtYM = (v: number) => `${Math.floor(v / 12)}.${String((v % 12) + 1).padStart(2, "0")}`;

export const WEAK = /^(负责|参与|协助|帮助|配合|responsible for|helped|assisted|worked on|participated)/i;
export const isWork = (section: string) => /工作|经历|实习|experience|employment|work/i.test(section) && !/教育|education/i.test(section);
export const bullets = (e: Entry) => e.details.split("\n").map((x) => x.replace(/^•\s*/, "").trim()).filter(Boolean);
const cjk = (t: string) => (t.match(/[\u4e00-\u9fff]/g) ?? []).length;
export const tooLong = (t: string) => cjk(t) > 60 || t.length > 180;
