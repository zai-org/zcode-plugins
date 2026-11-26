import { num, parseDate, round2 } from "./kit/columns.ts";

export interface Txn { date: string; description: string; amount: unknown; category: string; source: string }
export interface Rule { keyword: string; category: string; re: RegExp }

export const DEFAULT_RULES = `# 关键词 => 分类（一行一条，不区分大小写；可用 | 分隔多个关键词）
# keyword => category (one per line, case-insensitive; | separates alternatives)
工资|salary|payroll => 收入 Income
房租|rent|物业 => 住房 Housing
电费|水费|燃气|electric|water bill|gas bill|pge|utility => 生活缴费 Utilities
美团|饿了么|餐|咖啡|starbucks|coffee|chipotle|restaurant|cafe|瑞幸 => 餐饮 Dining
超市|safeway|grocery|whole foods|盒马|永辉 => 买菜 Groceries
滴滴|地铁|公交|uber|lyft|taxi|shell|加油|metro => 交通 Transport
淘宝|京东|拼多多|amazon|target|walmart => 购物 Shopping
netflix|spotify|爱奇艺|腾讯视频|icloud|apple.com|会员|subscription => 订阅 Subscriptions
transfer to savings|转账到余额宝|savings => 储蓄 Savings
还款|transfer from|refund|退款 => 转入 Transfers in`;

export function parseRules(text: string): { rules: Rule[]; bad: string[] } {
  const rules: Rule[] = [];
  const bad: string[] = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(.+?)\s*(?:=>|→|->|=)\s*(.+)$/.exec(line);
    if (!m) { bad.push(line); continue; }
    const words = m[1].split("|").map((w) => w.trim()).filter(Boolean);
    for (const keyword of words) rules.push({ keyword, category: m[2].trim(), re: new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") });
  }
  return { rules, bad };
}

/** 第一条命中的规则决定分类（规则顺序就是优先级）。 */
export function autoCategory(description: string, rules: Rule[]) {
  return rules.find((r) => r.re.test(description));
}

export const UNCATEGORIZED = "未分类 Uncategorized";

export interface Classified { date: string; month: string; description: string; amount: number; category: string; how: string; source: string; ok: boolean }

export function classify(rows: Txn[], rulesText: string) {
  const { rules, bad } = parseRules(rulesText);
  const out: Classified[] = rows.map((r) => {
    const amount = num(r.amount);
    const date = parseDate(r.date);
    const hit = autoCategory(String(r.description ?? ""), rules);
    const category = String(r.category ?? "").trim() || hit?.category || UNCATEGORIZED;
    return { date, month: date.slice(0, 7), description: String(r.description ?? ""), amount: Number.isFinite(amount) ? round2(amount) : NaN, category, how: String(r.category ?? "").trim() ? "manual" : hit ? `rule: ${hit.keyword}` : "—", source: r.source, ok: Number.isFinite(amount) && !!date };
  });
  const categories = [...new Set([...rules.map((r) => r.category), UNCATEGORIZED])];
  return { rows: out, rules, bad, categories };
}

export function pivot(rows: Classified[]) {
  const months = [...new Set(rows.filter((r) => r.ok).map((r) => r.month))].sort();
  const cats = [...new Set(rows.filter((r) => r.ok).map((r) => r.category))];
  const cell = new Map<string, number>();
  for (const r of rows) if (r.ok) cell.set(`${r.category}|${r.month}`, round2((cell.get(`${r.category}|${r.month}`) ?? 0) + r.amount));
  const total = (c: string) => round2(months.reduce((a, m) => a + (cell.get(`${c}|${m}`) ?? 0), 0));
  cats.sort((a, b) => total(a) - total(b));
  return { months, cats, get: (c: string, m: string) => cell.get(`${c}|${m}`) ?? 0, total };
}

export function duplicates(rows: Classified[]) {
  const seen = new Map<string, number>();
  const dup: [number, number][] = [];
  rows.forEach((r, i) => {
    if (!r.ok) return;
    const key = `${r.date}|${r.amount}|${r.description.toLowerCase().replace(/\s+/g, " ").trim()}`;
    if (seen.has(key) && rows[seen.get(key)!].source !== r.source) dup.push([seen.get(key)!, i]);
    else seen.set(key, i);
  });
  return dup;
}
