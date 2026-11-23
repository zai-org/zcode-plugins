import * as THREE from 'three'
import type { Signals } from '../engine/core/signals'
import type { Forensic } from '../engine/core/forensic'

// ── 场景契约 (Stage 唯一依赖的接口) ─────────────────────────────────────────────
// 这是引擎层与场景层的边界。Stage 只认这个接口, 不假设你用相机路径 / composer / 粒子 ——
// raymarch 页可以只用 core + 一个全屏 quad, 把 kit 全丢掉。
export interface SceneContext {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  clock: THREE.Clock
  sizes: { width: number; height: number; dpr: number }
  rng: () => number        // 固定种子随机 (可复现)
  signals: Signals         // signals.scrollT (0..1) / signals.pointer (-1..1)
  forensic: Forensic       // ?t / ?time / ?freeze / ?autodemo
}

export interface SceneModule {
  init(ctx: SceneContext): void | Promise<void>
  // t    = 滚动进度 0..1 (页面不滚动时恒为 0; ?t= 可覆盖)
  // dt   = 钳制后的帧间秒数 (?freeze 时为 0)
  // time = 已播放秒数, 时间驱动的动画用这根轴 (?time=<秒> 可确定性覆盖)
  update(t: number, dt: number, time: number): void
  render?(): void                        // 可选: 用 composer 时覆盖; 否则 Stage 直接 renderer.render
  resize?(width: number, height: number): void
  dispose(): void
}

// ══════════════════════════════════════════════════════════════════════════════
//  PLACEHOLDER SCENE — REPLACE ME
//  ──────────────────────────────────────────────────────────────────────────
//  这是占位桩, 唯一目的: 证明引擎链路已通 (renderer / rAF 墙钟 / scroll→t / ?t / ?time 冻结)。
//  它故意画一团旋转的随机点云 (时间轴驱动) + 随滚动变色 (滚动轴驱动), 明显不是任何真实设计。
//  两根轴都在这里示范一次, 是为了让"这页到底靠什么驱动"成为你的选择, 而不是照抄默认。
//
//  复刻时: 删掉整个 PlaceholderScene, 按视频写你自己的 SceneModule (粒子 morph / shader /
//  几何 / 材质 / 相机 BEAT)。主体与环境是同一种软融合、无贴图的团块外观 → 整帧 raymarch SDF,
//  只用 core + engine/kit/fullscreenQuad.ts, 不要 mesh 堆积木 (判据见 video2code SKILL §1)。
//  引擎 core (renderer/loop/signals/rng/forensic/Stage) 已给, 别重写; kit 按 archetype 取用。
// ══════════════════════════════════════════════════════════════════════════════
export class PlaceholderScene implements SceneModule {
  private ctx!: SceneContext
  private points?: THREE.Points
  private mat?: THREE.PointsMaterial

  init(ctx: SceneContext) {
    this.ctx = ctx
    ctx.camera.position.set(0, 0, 5)
    const N = 2000
    const pos = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) {
      pos[i * 3 + 0] = (ctx.rng() - 0.5) * 6
      pos[i * 3 + 1] = (ctx.rng() - 0.5) * 6
      pos[i * 3 + 2] = (ctx.rng() - 0.5) * 6
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.mat = new THREE.PointsMaterial({ size: 0.03, color: 0x66ccff })
    this.points = new THREE.Points(geo, this.mat)
    ctx.scene.add(this.points)
  }

  // 两根轴各示范一根, 复刻时按你的页面留 —— 它们不是同一件事:
  //   time (时间轴): 自动播放的动画走这根。用 time 算绝对值, 不要 `+= dt` 累加 ——
  //                  累加量取决于历史帧数, ?time=<秒> 就冻不出确定的一帧。
  //                  (dt 仍有用: 物理/惯性这类必须积分的量按 dt 走固定子步。)
  //   t (滚动轴):    页面不滚动时 t 恒为 0 —— 这时删掉下面用 t 的两行, 别把恒零的量当主时间轴。
  update(t: number, _dt: number, time: number) {
    if (!this.points || !this.mat) return
    this.points.rotation.y = time * 0.2      // 时间轴: 匀速自转 (fps 无关, ?time= 冻得住)
    this.points.rotation.x = t * Math.PI     // 滚动轴: 随 scrollT 翻转
    this.mat.color.setHSL(t, 0.6, 0.6)       // 滚动轴: 随 scrollT 变色, 让 ?t 冻结的效果可见
  }

  dispose() {
    if (!this.points) return
    this.ctx.scene.remove(this.points)
    this.points.geometry.dispose()
    ;(this.points.material as THREE.Material).dispose()
  }
}

// Stage 默认加载的场景。复刻时把返回值换成你的 SceneModule。
export function createScene(): SceneModule {
  return new PlaceholderScene()
}
