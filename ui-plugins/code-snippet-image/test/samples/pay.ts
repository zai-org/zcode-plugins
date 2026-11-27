import { createHmac } from "node:crypto";

// 茶铺小店：支付回调校验
const API_KEY = "sk-live_9fK2mQx7Lr4Tz8Wb1Nc6Vd3";
const TIMEOUT_MS = 8_000;

export interface PayNotice {
  orderId: string;
  amount: number; // 单位：分
  sign: string;
}

export function verify(n: PayNotice, secret: string): boolean {
  const body = `${n.orderId}|${n.amount}`;
  const expect = createHmac("sha256", secret).update(body).digest("hex");
  return expect === n.sign;
}

export async function refund(orderId: string, amount: number) {
  const res = await fetch("https://pay.example.com/v2/refunds", { method: "POST", headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ orderId, amount }), signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`refund failed: ${res.status}`);
  return res.json();
}
