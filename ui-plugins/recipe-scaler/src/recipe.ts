/** 菜谱解析、数量读取、单位换算与取整。 */

export interface Ing { item: string; qty: string; unit: string; note: string; raw: string }
export interface Recipe { title: string; servings: number | null; servingsRaw: string; ings: Ing[]; steps: string[]; file: string }

const CN: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 半: 0.5 };
const FR: Record<string, number> = { "½": 0.5, "⅓": 1 / 3, "⅔": 2 / 3, "¼": 0.25, "¾": 0.75, "⅛": 0.125 };

/** “1 1/2”“1½”“0.5”“半”“两”“十二”“1斤半”里的数字部分 → 数值；读不懂 null；空/适量 → undefined。 */
export function parseQty(v: string): number | null | undefined {
  let t = v.trim().replace(/，/g, ",");
  if (!t || /^(适量|少许|少量|若干|按口味|to taste|a pinch|pinch|as needed|optional|可选)$/i.test(t)) return undefined;
  for (const [k, x] of Object.entries(FR)) t = t.replace(new RegExp(`(\\d)?\\s*${k}`), (_, d) => String((d ? Number(d) : 0) + x));
  let m = /^(\d+)\s+(\d+)\/(\d+)$/.exec(t);
  if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  m = /^(\d+)\/(\d+)$/.exec(t);
  if (m) return Number(m[1]) / Number(m[2]);
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  if (/^[零一二两三四五六七八九十半]+$/.test(t)) {
    if (t === "半") return 0.5;
    if (t.length === 1) return CN[t];
    const ten = t.indexOf("十");
    if (ten >= 0) return (ten === 0 ? 1 : CN[t[ten - 1]]) * 10 + (t[ten + 1] ? CN[t[ten + 1]] : 0);
    return null;
  }
  return null;
}

type Dim = "mass" | "vol" | "count";
interface U { dim: Dim; base: number; zh: string; en: string }
const UNITS: [RegExp, U][] = [
  [/^(g|克|gram|grams|gr)$/i, { dim: "mass", base: 1, zh: "克", en: "g" }],
  [/^(kg|千克|公斤|kilo|kilos|kilogram|kilograms)$/i, { dim: "mass", base: 1000, zh: "千克", en: "kg" }],
  [/^(斤)$/, { dim: "mass", base: 500, zh: "斤", en: "jin" }],
  [/^(两)$/, { dim: "mass", base: 50, zh: "两", en: "liang" }],
  [/^(oz|ounce|ounces|盎司)$/i, { dim: "mass", base: 28.35, zh: "盎司", en: "oz" }],
  [/^(lb|lbs|pound|pounds|磅)$/i, { dim: "mass", base: 453.6, zh: "磅", en: "lb" }],
  [/^(ml|毫升|milliliter|milliliters|cc)$/i, { dim: "vol", base: 1, zh: "毫升", en: "ml" }],
  [/^(l|升|liter|liters|litre|litres)$/i, { dim: "vol", base: 1000, zh: "升", en: "L" }],
  [/^(tsp|teaspoon|teaspoons|茶匙|小勺|小匙)$/i, { dim: "vol", base: 5, zh: "茶匙", en: "tsp" }],
  [/^(tbsp|tablespoon|tablespoons|汤匙|大勺|大匙|勺)$/i, { dim: "vol", base: 15, zh: "汤匙", en: "tbsp" }],
  [/^(cup|cups|杯|量杯)$/i, { dim: "vol", base: 240, zh: "杯", en: "cup" }],
  [/^(fl ?oz)$/i, { dim: "vol", base: 29.57, zh: "液盎司", en: "fl oz" }],
];
const COUNT = /^(个|颗|只|根|片|瓣|块|条|把|棵|根|张|袋|包|罐|盒|枚|粒|朵|段|头|piece|pieces|pc|pcs|clove|cloves|slice|slices|can|cans|egg|eggs|large|medium|small|whole)?$/i;

export function unitOf(u: string): U | null | "count" {
  const t = u.trim();
  for (const [re, x] of UNITS) if (re.test(t)) return x;
  return COUNT.test(t) ? "count" : null;
}

const NUM = String.raw`(?:\d+\s+\d+\/\d+|\d+\/\d+|\d*\s*[½⅓⅔¼¾⅛]|\d+(?:\.\d+)?|[零一二两三四五六七八九十半]+)`;
const UNIT_WORD = String.raw`(?:fl ?oz|[a-zA-Z]+\.?|[克千公斤两毫升茶汤小大匙勺杯量盎司磅个颗只根片瓣块条把棵张袋包罐盒枚粒朵段头]{1,3})`;

/** 一行食材 → 名称、数量、单位、备注。 */
export function parseIng(line: string): Ing {
  let t = line.replace(/^\s*(?:[-*•·]|\d+[.)、])\s*/, "").trim();
  const raw = t;
  let note = "";
  const nm = /[（(]([^）)]*)[）)]/.exec(t);
  if (nm) { note = nm[1].trim(); t = t.replace(nm[0], " ").trim(); }
  const cm = /^(.*?)[,，]\s*(.+)$/.exec(t);
  if (cm && !/^\d/.test(cm[2])) { note = [note, cm[2].trim()].filter(Boolean).join("，"); t = cm[1].trim(); }
  // 英文：数量在前 “1 1/2 cups flour”
  let m = new RegExp(String.raw`^(${NUM})\s*(${UNIT_WORD})?\s+(?:of\s+)?(.+)$`, "i").exec(t);
  if (m && /^[\d½⅓⅔¼¾⅛]/.test(m[1])) {
    let unit = (m[2] ?? "").replace(/\.$/, ""), item = m[3].trim();
    if (unit && unitOf(unit) === null && !/^[a-z]/i.test(item)) { item = `${unit} ${item}`.trim(); unit = ""; }
    if (unit && unitOf(unit) === null && /^[a-z]/i.test(unit) && !/^(tspn|tbs|tbl|c|t)$/i.test(unit)) { item = `${unit} ${item}`; unit = ""; }
    if (/^(large|medium|small|whole|fresh)$/i.test(unit)) { item = `${unit} ${item}`; unit = ""; }
    return { item, qty: m[1].trim(), unit, note, raw };
  }
  // 中文：名称在后面带数量 “五花肉 500 g”“冰糖 30g”“鸡蛋 3 个”“盐 适量”
  m = new RegExp(String.raw`^(.+?)\s*(${NUM})\s*(${UNIT_WORD})?\s*(半)?$`).exec(t);
  if (m) { const half = m[4] ? " 半" : ""; return { item: m[1].trim(), qty: `${m[2].trim()}${half}`, unit: (m[3] ?? "").trim(), note, raw }; }
  m = /^(.+?)\s+(适量|少许|少量|若干|按口味|to taste|a pinch|optional|可选)$/i.exec(t);
  if (m) return { item: m[1].trim(), qty: m[2], unit: "", note, raw };
  const sp = /^(\S+)\s+(.+)$/.exec(t);
  if (sp && /\d|[一二两三四五六七八九十半]/.test(sp[2])) return { item: sp[1], qty: sp[2], unit: "", note, raw };
  return { item: t, qty: "", unit: "", note, raw };
}

/** “1斤半”类：数量末尾的“ 半”= +0.5。 */
export function qtyValue(q: string): number | null | undefined {
  const t = q.trim();
  if (/\s半$/.test(t)) { const v = parseQty(t.replace(/\s半$/, "")); return typeof v === "number" ? v + 0.5 : v; }
  return parseQty(t);
}

export function parseRecipe(md: string, file: string): Recipe {
  const lines = md.split(/\r?\n/);
  let title = "", servings: number | null = null, servingsRaw = "", sec: "ing" | "step" | "" = "";
  const ings: Ing[] = [], steps: string[] = [];
  for (const l of lines) {
    const t = l.trim();
    if (!t) continue;
    const h = /^(#{1,6})\s*(.+)$/.exec(t);
    if (h) {
      if (h[1].length === 1 && !title) { title = h[2].trim(); continue; }
      sec = /食材|材料|配料|用料|ingredient/i.test(h[2]) ? "ing" : /步骤|做法|方法|制作|step|method|direction|instruction/i.test(h[2]) ? "step" : "";
      continue;
    }
    const sv = /^(?:份量|分量|人数|供|serves|servings|yield|makes)\s*[:：]?\s*(.+)$/i.exec(t) ?? /^(\S+)\s*人份$/.exec(t);
    if (sv && !sec) { servingsRaw = sv[1].trim(); const n = /(\d+(?:\.\d+)?|[一二两三四五六七八九十]+)/.exec(sv[1]); servings = n ? (parseQty(n[1]) ?? null) : null; continue; }
    if (sec === "ing" && /^([-*•·]|\d+[.)、]|\S)/.test(t)) ings.push(parseIng(t));
    else if (sec === "step") steps.push(t.replace(/^\s*(?:[-*•·]|\d+[.)、])\s*/, ""));
  }
  if (!title) title = file.split("/").pop()!.replace(/\.(md|txt)$/i, "");
  return { title, servings, servingsRaw, ings, steps, file };
}

export interface Amount { value: number; unit: string; dim: Dim | "count" | "none"; base?: number }

/** 漂亮的分数：1/4 步进。 */
export function nice(n: number, quarters = true): string {
  if (!quarters) { const r = n >= 100 ? Math.round(n / 5) * 5 : n >= 10 ? Math.round(n) : Math.round(n * 10) / 10; return String(r); }
  const w = Math.floor(n + 1e-9), f = Math.round((n - w) * 4) / 4;
  const ww = f === 1 ? w + 1 : w, ff = f === 1 ? 0 : f;
  const fs = ff === 0.25 ? "1/4" : ff === 0.5 ? "1/2" : ff === 0.75 ? "3/4" : "";
  if (!ww && !fs) return n > 0 ? "1/8" : "0";
  return [ww ? String(ww) : "", fs].filter(Boolean).join(" ");
}

/** 把基准单位（克/毫升）的量按体系格式化。 */
export function formatBase(base: number, dim: "mass" | "vol", system: "metric" | "us", zh: boolean): string {
  if (dim === "mass") {
    if (system === "us") return base >= 453.6 ? `${nice(base / 453.6)} lb` : `${nice(base / 28.35)} oz`;
    return base >= 1000 ? `${Math.round(base / 100) / 10} ${zh ? "千克" : "kg"}` : `${base >= 50 ? Math.round(base / 5) * 5 : Math.round(base)} ${zh ? "克" : "g"}`;
  }
  if (system === "us" || base <= 90) {
    if (base < 15) return `${nice(base / 5)} ${zh ? "茶匙" : "tsp"}`;
    if (base < 60 || system !== "us") return `${nice(base / 15)} ${zh ? "汤匙" : "tbsp"}`;
    return `${nice(base / 240)} ${zh ? "杯" : "cup"}`;
  }
  return base >= 1000 ? `${Math.round(base / 100) / 10} ${zh ? "升" : "L"}` : `${Math.round(base / 5) * 5} ${zh ? "毫升" : "ml"}`;
}

export const hasCJK = (t: string) => /[\u4e00-\u9fff]/.test(t);
const WHOLE = /蛋|egg|鸡腿|鸡翅|柠檬|lemon|番茄|西红柿|土豆|洋葱|onion|苹果|apple|香蕉|banana/i;
/** 计数类取整：鸡蛋等整个的向上取整，其他 1/2 步进。 */
export function roundCount(n: number, item: string): number { return WHOLE.test(item) ? Math.max(1, Math.ceil(n - 0.05)) : Math.max(0.5, Math.round(n * 2) / 2); }

export const AISLES: [string, RegExp][] = [
  ["肉禽蛋", /肉|鸡|鸭|猪|牛|羊|排骨|蛋|培根|火腿|香肠|bacon|beef|pork|chicken|egg|ham/i],
  ["水产", /鱼|虾|蟹|贝|鱿|海带|紫菜|fish|shrimp|prawn|salmon/i],
  ["乳制品", /奶|黄油|芝士|奶酪|酸奶|milk|butter|cheese|cream|yogurt/i],
  ["蔬菜水果", /菜|葱|姜|蒜|番茄|西红柿|土豆|萝卜|椒|菇|豆芽|洋葱|黄瓜|茄子|南瓜|玉米|柠檬|苹果|香蕉|莓|onion|garlic|ginger|tomato|potato|carrot|pepper|lemon|apple|banana|berr/i],
  ["调料", /盐|糖|酱|生抽|老抽|醋|料酒|油|淀粉|胡椒|八角|桂皮|香叶|花椒|味精|鸡精|蚝油|豆瓣|泡打粉|苏打|香草|肉桂|salt|sugar|sauce|vinegar|oil|pepper|baking|vanilla|cinnamon|soda|syrup/i],
  ["粮油干货", /米|面|粉|豆|粉丝|年糕|flour|rice|noodle|pasta|oat|bread/i],
];
export const aisleOf = (item: string) => AISLES.find(([, re]) => re.test(item))?.[0] ?? "其他";

/** 步骤里写的时间（分钟、小时）合计。 */
export function stepMinutes(steps: string[]): number {
  let m = 0;
  for (const s of steps) for (const x of s.matchAll(/(\d+(?:\.\d+)?|[一二两三四五六七八九十半]+)\s*(?:-|~|到|至)?\s*(?:\d+\s*)?(分钟|min|mins|minutes|小时|hour|hours|hr|h)/gi)) {
    const v = parseQty(x[1]); if (typeof v !== "number") continue;
    m += /小时|hour|hr|^h$/i.test(x[2]) ? v * 60 : v;
  }
  return Math.round(m);
}
