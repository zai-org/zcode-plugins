import { createOrder } from "./api/orders.ts";

// 首页：商品列表 + 购物车
export function App() {
  const items = [{ sku: "TEA-LJ-100", qty: 2 }];

  return (
    <main>
      {/* 购物车按钮 */}
      <button onClick={() => createOrder("u1", items)}>下单</button>
    </main>
  );
}
