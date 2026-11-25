// engine/core — 固定种子 RNG (mulberry32)。corpus 64% 用固定种子: 保证复刻可复现,
// 且验证时同一 t 出同一帧 (?t 冻结才有意义)。禁改。
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
