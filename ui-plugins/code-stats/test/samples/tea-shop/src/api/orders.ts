// 订单接口：下单、查询、取消
import { db } from "./db.ts";

/**
 * 创建订单。
 * 金额以分为单位。
 */
export async function createOrder(userId: string, items: { sku: string; qty: number }[]) {
  const total = items.reduce((t, i) => t + i.qty * 1200, 0);

  return db.insert("orders", { userId, items, total }); // 返回新订单
}

export async function cancelOrder(id: string) {
  /* 已发货的订单不能取消 */
  const o = await db.get("orders", id);
  if (o.shipped) throw new Error("already shipped");
  return db.update("orders", id, { status: "cancelled" });
}
