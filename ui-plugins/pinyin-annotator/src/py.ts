import { pinyin } from "pinyin-pro";

export interface Tok { ch: string; py: string; alts: string[]; zh: boolean; line: number }

const MARKS: Record<string, string[]> = { a: ["ā", "á", "ǎ", "à"], e: ["ē", "é", "ě", "è"], i: ["ī", "í", "ǐ", "ì"], o: ["ō", "ó", "ǒ", "ò"], u: ["ū", "ú", "ǔ", "ù"], ü: ["ǖ", "ǘ", "ǚ", "ǜ"] };
const UNMARK = new Map<string, [string, number]>(Object.entries(MARKS).flatMap(([v, arr]) => arr.map((m, i) => [m, [v, i + 1]] as [string, [string, number]])));

/** huan2 / lv4 / lü4 → huán / lǜ；已带声调的原样返回。 */
export function numToMark(s: string) {
  return s.trim().toLowerCase().split(/\s+/).map((syl) => {
    const m = /^([a-zü:v]+)([0-5])$/.exec(syl);
    if (!m) return syl.replace(/v|u:/g, "ü");
    const base = m[1].replace(/v|u:/g, "ü"), tone = Number(m[2]);
    if (tone === 0 || tone === 5) return base;
    const idx = /a/.test(base) ? base.indexOf("a") : /e/.test(base) ? base.indexOf("e") : /ou/.test(base) ? base.indexOf("o") : Math.max(...["i", "o", "u", "ü"].map((v) => base.lastIndexOf(v)));
    if (idx < 0) return base;
    return base.slice(0, idx) + MARKS[base[idx]][tone - 1] + base.slice(idx + 1);
  }).join(" ");
}

export function markToNum(s: string) {
  let tone = 0;
  const base = [...s].map((c) => { const u = UNMARK.get(c); if (u) { tone = u[1]; return u[0]; } return c; }).join("");
  return tone ? `${base.replace(/ü/g, "v")}${tone}` : base.replace(/ü/g, "v");
}
export const plain = (s: string) => [...s].map((c) => UNMARK.get(c)?.[0] ?? c).join("");
export const style = (py: string, tone: string) => (tone === "num" ? markToNum(py) : tone === "none" ? plain(py) : py);
export const isSyllable = (s: string) => /^[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]+$/.test(s);

/** 逐字注音（pinyin-pro 按词语上下文选读音），再套用“词: 拼音”自定义读音。 */
export function annotate(text: string, custom: string): Tok[] {
  const toks: Tok[] = [];
  text.split(/\r?\n/).forEach((line, li) => {
    if (li) toks.push({ ch: "\n", py: "", alts: [], zh: false, line: li });
    if (!line) return;
    for (const x of pinyin(line, { type: "all" }) as { origin: string; pinyin: string; polyphonic: string[]; isZh: boolean }[]) toks.push({ ch: x.origin, py: x.isZh ? x.pinyin : "", alts: x.isZh ? x.polyphonic : [], zh: x.isZh, line: li });
  });
  const rules = custom.split(/\r?\n/).map((l) => /^\s*([^:：\s]+)\s*[:：]\s*(.+)$/.exec(l)).filter((m): m is RegExpExecArray => !!m).map((m) => ({ word: [...m[1]], py: numToMark(m[2]).split(/\s+/) })).filter((r) => r.word.length === r.py.length);
  for (const r of rules) for (let i = 0; i + r.word.length <= toks.length; i++) if (r.word.every((c, k) => toks[i + k].ch === c)) r.py.forEach((p, k) => (toks[i + k].py = p));
  return toks;
}
