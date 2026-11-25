// engine/core — 输入信号: scroll→t 纯映射 + pointer→归一化坐标。
// scrollT 用 rAF 轮询 (每帧 update, 非 scroll 事件): 避免被动监听的抖动/节流。
// pointer 既驱动相机视差, 也驱动 hover 扭曲类 shader uniform, 故提到 core (不埋在 cameraRig)。禁改。
export interface Signals {
  scrollT: number
  pointer: { x: number; y: number }
  update(): void
  dispose(): void
}

export function createSignals(): Signals {
  const pointer = { x: 0, y: 0 }
  const onMove = (e: PointerEvent) => {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1
    pointer.y = -((e.clientY / window.innerHeight) * 2 - 1)
  }
  window.addEventListener('pointermove', onMove, { passive: true })

  const signals: Signals = {
    scrollT: 0,
    pointer,
    update() {
      const max = document.documentElement.scrollHeight - window.innerHeight
      signals.scrollT = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0
    },
    dispose() {
      window.removeEventListener('pointermove', onMove)
    },
  }
  return signals
}
