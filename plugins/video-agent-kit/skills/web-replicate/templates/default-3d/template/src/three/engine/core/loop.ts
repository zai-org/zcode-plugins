import * as THREE from 'three'

// engine/core — 命令式渲染循环 (rAF)。墙钟驱动 (getElapsedTime) + dt 钳制:
// 掉帧时动画按真实时间推进而非帧数; dt 钳到 1/20s 防切后台/掉帧产生巨跳。禁改。
// 物理类场景可在 scene.update 里对 dt 做固定子步积分。
export interface Ticker {
  start(): void
  stop(): void
}

export function createTicker(
  clock: THREE.Clock,
  onFrame: (elapsed: number, dt: number) => void,
): Ticker {
  let raf = 0
  let running = false
  const tick = () => {
    if (!running) return
    const dt = Math.min(clock.getDelta(), 1 / 20)
    onFrame(clock.getElapsedTime(), dt)
    raf = requestAnimationFrame(tick)
  }
  return {
    start() {
      if (running) return
      running = true
      clock.start()
      raf = requestAnimationFrame(tick)
    },
    stop() {
      running = false
      if (raf) cancelAnimationFrame(raf)
    },
  }
}
