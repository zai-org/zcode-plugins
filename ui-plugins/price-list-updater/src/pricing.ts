// 调价规则与尾数取整（纯函数，便于测试）
export type Action = { kind: "pct" | "add" | "set" | "markup" | "mul"; value: number };
export type Rule = { line: number; field: "all" | "category" | "supplier" | "sku" | "name"; values: string[]; action: Action; text: string };

const FIELD: Record<string, Rule["field"]> = {
  全部: "all", 所有: "all", all: "all", "*": "all", 其他: "all", others: "all", default: "all",
  分类: "category", 类别: "category", 品类: "category", category: "category", cat: "category",
  供应商: "supplier", 厂家: "supplier", supplier: "supplier", vendor: "supplier",
  sku: "sku", 编码: "sku", 货号: "sku", code: "sku",
  名称: "name", 商品: "name", name: "name", 含: "name", contains: "name",
};

const half = (t: string) => t.replace(/[０-９．＋－＝％：，＊]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/×/g, "x");

export function parseAction(raw: string): Action | undefined {
  let t = half(raw).replace(/\s+/g, "").toLowerCase();
  let m = t.match(/^(?:成本|进价|cost)\+?([\d.]+)%$/);
  if (m) return { kind: "markup", value: Number(m[1]) };
  m = t.match(/^([+-])([\d.]+)%$/) ?? t.match(/^(涨|降|up|down)([\d.]+)%$/);
  if (m) return { kind: "pct", value: (/^[-降d]/.test(m[1]) ? -1 : 1) * Number(m[2]) };
  m = t.match(/^([+-])([\d.]+)$/) ?? t.match(/^(涨|降|up|down)([\d.]+)元?$/);
  if (m) return { kind: "add", value: (/^[-降d]/.test(m[1]) ? -1 : 1) * Number(m[2]) };
  m = t.match(/^=([\d.]+)$/) ?? t.match(/^(?:改为|set|to)([\d.]+)$/);
  if (m) return { kind: "set", value: Number(m[1]) };
  m = t.match(/^[x*]([\d.]+)$/);
  if (m) return { kind: "mul", value: Number(m[1]) };
  return undefined;
}

/** 每行一条：“分类=饮料,零食: +5%”“供应商=绿源: +0.5”“SKU=A001: =12.9”“全部: 成本+40%”。从上到下，第一条匹配的规则生效。 */
export function parseRules(text: string): { rules: Rule[]; errors: string[] } {
  const rules: Rule[] = [], errors: string[] = [];
  half(text).split(/\n|；|;/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const m = line.match(/^(.*?)[:]\s*(.+)$/);
    if (!m) { errors.push(`Rule “${line}”: write “selector: change”, e.g. “分类=饮料: +5%” / 规则格式：条件: 调整`); return; }
    const sel = m[1].trim(), action = parseAction(m[2]);
    if (!action) { errors.push(`Rule “${line}”: don't understand the change “${m[2]}” (try +5%, -3%, +2, =19.9, x1.1, 成本+40%) / 看不懂调整方式`); return; }
    const sm = sel.match(/^([^=]+?)\s*[=]\s*(.+)$/);
    const fieldName = (sm ? sm[1] : sel).trim().toLowerCase();
    const field = FIELD[fieldName];
    if (!field) { errors.push(`Rule “${line}”: unknown field “${fieldName}” (use 全部/all, 分类/category, 供应商/supplier, SKU, 名称/name) / 不认识的条件`); return; }
    const values = field === "all" ? [] : (sm?.[2] ?? "").split(/[,，、|]/).map((v) => v.trim()).filter(Boolean);
    if (field !== "all" && !values.length) { errors.push(`Rule “${line}”: give a value after “=” / 条件缺少值`); return; }
    rules.push({ line: i + 1, field, values, action, text: line });
  });
  return { rules, errors };
}

export type Item = { sku: string; name: string; category: string; supplier: string; cost: number; price: number };
const low = (s: string) => s.normalize("NFKC").trim().toLowerCase();

export function matchRule(rules: Rule[], item: Item): Rule | undefined {
  return rules.find((r) => {
    if (r.field === "all") return true;
    const v = low(item[r.field]);
    return r.field === "name" ? r.values.some((x) => v.includes(low(x))) : r.values.some((x) => low(x) === v);
  });
}

export function applyAction(a: Action, price: number, cost: number): number {
  switch (a.kind) {
    case "pct": return price * (1 + a.value / 100);
    case "add": return price + a.value;
    case "set": return a.value;
    case "mul": return price * a.value;
    case "markup": return cost * (1 + a.value / 100);
  }
}

export type Rounding = "none" | "0.01" | "0.1" | "1" | "0.5" | "0.99" | "0.9" | "9" | "0.8";
export const ROUNDINGS: Rounding[] = ["none", "0.01", "0.1", "1", "0.5", "0.99", "0.9", "0.8", "9"];
const STEP: Record<Exclude<Rounding, "none">, [number, number]> = { "0.01": [0.01, 0], "0.1": [0.1, 0], "1": [1, 0], "0.5": [0.5, 0], "0.99": [1, 0.99], "0.9": [1, 0.9], "0.8": [1, 0.8], "9": [10, 9] };
const c2 = (n: number) => Math.round(n * 100) / 100;

/** 尾数取整：0.99 → x.99，9 → 个位是 9（19、29…），0.5 → 半元。dir: up 向上、down 向下、nearest 最近。 */
export function charm(p: number, mode: Rounding, dir: "up" | "down" | "nearest" = "up"): number {
  if (!Number.isFinite(p)) return p;
  if (mode === "none") return c2(p);
  const [step, off] = STEP[mode];
  const k = (p - off) / step;
  const up = c2(off + step * Math.ceil(k - 1e-9));
  const down = c2(off + step * Math.floor(k + 1e-9));
  const d = down > 0 ? down : up;
  if (dir === "up") return up;
  if (dir === "down") return d;
  return up - p <= p - d ? up : d;
}
