// 规格组合：选项 → 全部变体（笛卡尔积），按模式生成 SKU，按选项加价算价格。
export interface OptValue { value: string; code: string; delta: number; pct: number; stock?: number }
export interface Option { name: string; values: OptValue[] }
export interface Variant { key: string; values: string[]; codes: string[]; sku: string; price: number; stock: number; excluded: boolean }

const s = (v: unknown) => String(v ?? "").trim();

/** 值的写法：“黑色=BK(+10)”、“XL(+5%)”、“S”；库存写成 “[20]”。 */
export function parseValue(t: string): OptValue | undefined {
  const m = /^(.+?)(?:\s*[=＝:：]\s*([A-Za-z0-9._-]+))?\s*(?:[（(]\s*([+＋-]?\s*\d+(?:\.\d+)?)\s*(%)?\s*[)）])?\s*(?:\[\s*(\d+)\s*\])?$/.exec(t.trim());
  if (!m) return undefined;
  const n = m[3] ? Number(m[3].replace(/[\s＋+]/g, "")) : 0;
  return { value: m[1].trim(), code: m[2] ?? "", delta: m[4] ? 0 : n, pct: m[4] ? n : 0, stock: m[5] ? Number(m[5]) : undefined };
}

/** “颜色: 黑色=BK, 白色=WH; 尺码: S, M, L, XL(+10)”（每行或分号一个选项）。 */
export function parseOptions(text: string): { options: Option[]; error?: string } {
  const options: Option[] = [];
  for (const part of s(text).split(/[;；\n]+/).map((x) => x.trim()).filter(Boolean)) {
    const m = /^(.+?)\s*[:：]\s*(.+)$/.exec(part);
    if (!m) return { options, error: `can't read option “${part}” (use 名称: 值1, 值2) / 看不懂这个规格` };
    const values: OptValue[] = [];
    for (const v of m[2].split(/[,，、|]+/).map((x) => x.trim()).filter(Boolean)) {
      const pv = parseValue(v);
      if (!pv) return { options, error: `can't read value “${v}” in ${m[1]} / 看不懂规格值` };
      if (values.some((x) => x.value === pv.value)) return { options, error: `${m[1]}: “${pv.value}” is listed twice / 规格值重复` };
      values.push(pv);
    }
    if (options.some((o) => o.name === m[1].trim())) return { options, error: `option “${m[1].trim()}” is listed twice / 规格名重复` };
    options.push({ name: m[1].trim(), values });
  }
  if (options.length > 3) return { options, error: "at most 3 options (most stores allow 3) / 最多 3 个规格" };
  return { options };
}

/** 规格表的行（规格名, 值, 编码, 加价, 库存）→ 选项文本。 */
export function optionsTextFromRows(rows: { name: string; value: string; code: string; delta: string; stock: string }[]) {
  const by = new Map<string, string[]>();
  let last = "";
  for (const r of rows) {
    const name = r.name || last;
    last = name;
    if (!name || !r.value) continue;
    const d = r.delta.replace(/\s+/g, "");
    const delta = d && d !== "0" ? `(${/^[+-]/.test(d) ? d : `+${d}`})` : "";
    by.set(name, [...(by.get(name) ?? []), `${r.value}${r.code ? `=${r.code}` : ""}${delta}${r.stock ? `[${r.stock}]` : ""}`]);
  }
  return [...by].map(([n, v]) => `${n}: ${v.join(", ")}`).join("\n");
}

/** 不要的组合：“白色+XXL; 红色+S”（每个组合里的值都匹配才排除；只写一个值就排除含它的全部）。 */
export const parseExcludes = (t: string) => s(t).split(/[;；\n]+/).map((x) => x.split(/\s*[+＋&]\s*/).map((y) => y.trim()).filter(Boolean)).filter((x) => x.length);

export function codeOf(v: OptValue) {
  if (v.code) return v.code;
  const ascii = v.value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "");
  return ascii || v.value;
}

export interface BuildOpts { base: string; pattern: string; price: number; stock: number; upper: boolean; excludes: string[][] }
export function build(options: Option[], o: BuildOpts): Variant[] {
  let combos: OptValue[][] = [[]];
  for (const opt of options) combos = combos.flatMap((c) => opt.values.map((v) => [...c, v]));
  if (!options.length) combos = [];
  return combos.map((c, i) => {
    const values = c.map((v) => v.value), codes = c.map(codeOf);
    let sku = (o.pattern || "{base}-{1}-{2}-{3}").replace(/\{(\w+|[^{}]+)\}/g, (_, k: string) => {
      if (k === "base") return o.base;
      if (k === "n") return String(i + 1).padStart(3, "0");
      if (/^[123]$/.test(k)) return codes[Number(k) - 1] ?? "";
      const j = options.findIndex((x) => x.name === k);
      return j >= 0 ? codes[j] : `{${k}}`;
    });
    sku = sku.replace(/([-_./])\1+/g, "$1").replace(/^[-_./]+|[-_./]+$/g, "");
    if (o.upper) sku = sku.toUpperCase();
    const delta = c.reduce((a, v) => a + v.delta, 0), pct = c.reduce((a, v) => a + v.pct, 0);
    const price = Math.round((o.price + delta) * (1 + pct / 100) * 100) / 100;
    const stocks = c.map((v) => v.stock).filter((x): x is number => x !== undefined);
    const excluded = o.excludes.some((ex) => ex.every((e) => values.includes(e)));
    return { key: values.join("\u0000"), values, codes, sku, price, stock: stocks.length ? Math.min(...stocks) : o.stock, excluded };
  });
}
