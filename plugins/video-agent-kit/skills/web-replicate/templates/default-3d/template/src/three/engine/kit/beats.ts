import * as THREE from 'three'

// engine/kit — BEAT 表原语 (可选)。滚动叙事页的标准形态: 场景状态 = beatAt(scrollT) 纯函数,
// 相机/光照/模态全部从一张手写 BEAT 表插值出来 (fps 无关, ?t= 可冻结任意节拍)。
// 这里只给逐字节通用的数学原语 — **BEAT 表本身 (station 数值、关键帧内容、相位怎么叠、
// 模态何时切) 是视频专属内容, 由你的 scene 现场写**, kit 不替你组织它。

export const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))

// smoothstep: x 在 [a,b] 内 0..1 平滑过渡 (两端导数为 0) — BEAT 混合的标准缓动。
export function smoothstep(a: number, b: number, x: number): number {
  const k = clamp01((x - a) / (b - a))
  return k * k * (3 - 2 * k)
}

// 线性重映射 [a,b] → [c,d], 带 clamp。
export function remap(x: number, a: number, b: number, c: number, d: number): number {
  return c + (d - c) * clamp01((x - a) / (b - a))
}

// 逐字段插值两个同构关键帧: number 线性 lerp, THREE.Color 色彩 lerp, 其余字段在 f=0.5 处跳变。
// 颜色字段请存 THREE.Color 实例 (hex 字符串不会被识别为颜色)。
export function lerpFields<T extends Record<string, unknown>>(a: T, b: T, f: number): T {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(a)) {
    const va = a[k]
    const vb = (b as Record<string, unknown>)[k]
    if (typeof va === 'number' && typeof vb === 'number') out[k] = va + (vb - va) * f
    else if (va instanceof THREE.Color && vb instanceof THREE.Color) out[k] = va.clone().lerp(vb, f)
    else out[k] = f < 0.5 ? va : vb
  }
  return out as T
}

// 相机双样条: 位置与视线各一条 CatmullRom — 逐帧 camPath.getPoint(t) / lookPath.getPoint(t)。
export function createSplinePair(
  camPts: THREE.Vector3[],
  lookPts: THREE.Vector3[],
  tension = 0.4,
): { camPath: THREE.CatmullRomCurve3; lookPath: THREE.CatmullRomCurve3 } {
  return {
    camPath: new THREE.CatmullRomCurve3(camPts, false, 'catmullrom', tension),
    lookPath: new THREE.CatmullRomCurve3(lookPts, false, 'catmullrom', tension),
  }
}
