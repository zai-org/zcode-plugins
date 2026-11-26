const GROUPS = [
  ["日期", "date", "时间", "下单日期", "订单日期", "day"],
  ["门店", "店铺", "store", "shop", "分店", "branch"],
  ["数量", "qty", "quantity", "件数", "count"],
  ["金额", "amount", "总额", "total", "销售额", "sales"],
  ["单价", "price", "unit price"],
  ["商品", "产品", "品名", "product", "item"],
  ["客户", "customer", "client", "客户名称"],
  ["备注", "note", "notes", "remark", "remarks", "comment"],
];
export const norm = (h: string) => h.toLowerCase().replace(/[（(][^)）]*[)）]/g, "").replace(/[\s_\-:：]/g, "").trim();

/** 把各文件的表头对齐到统一列名；user 规则形如 “金额=Amount=金额(元)”。 */
export function aligner(userRules: string) {
  const groups = [...userRules.split(/\n|;|；/).map((l) => l.split(/=|＝/).map((x) => x.trim()).filter(Boolean)).filter((g) => g.length > 1), ...GROUPS];
  const canon = new Map<string, string>(); // norm(header) -> 统一列名
  const groupOf = (h: string) => groups.findIndex((g) => g.some((x) => norm(x) === norm(h)));
  const byGroup = new Map<number, string>();
  return (h: string) => {
    const n = norm(h) || h;
    if (canon.has(n)) return canon.get(n)!;
    const g = groupOf(h);
    let name = h.trim();
    if (g >= 0) { if (byGroup.has(g)) name = byGroup.get(g)!; else byGroup.set(g, name); }
    canon.set(n, name);
    return name;
  };
}

export const numeric = (v: string) => (/^-?\d+(\.\d+)?$/.test(v.trim()) && !/^0\d/.test(v.trim()) ? Number(v) : v);
