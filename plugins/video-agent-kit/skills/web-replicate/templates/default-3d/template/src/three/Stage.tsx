import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { createRenderer } from './engine/core/renderer'
import { createTicker } from './engine/core/loop'
import { createSignals } from './engine/core/signals'
import { createForensic } from './engine/core/forensic'
import { mulberry32 } from './engine/core/rng'
import { createScene, type SceneContext } from './scene/Scene'

// ── Stage: 3D 挂载点 (引擎 core, 禁改) ──────────────────────────────────────────
// 负责 canvas / renderer 生命周期、rAF 循环、resize、pixelRatio、StrictMode 双挂载防护,
// 每帧算出 t (scrollT 或 ?t 覆盖)、dt 与 time (墙钟秒数, ?time= 可覆盖), 交给 SceneModule。
// 每帧 render 之后把交给 update / render 的 time / t 发布到 window.__v2c; ?hud=1 时右下角同帧写出。
// 复刻只改 scene/Scene.ts, 不改这里。
export default function Stage({ seed = 1337 }: { seed?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hudRef = useRef<HTMLDivElement>(null)
  const hud = new URLSearchParams(location.search).get('hud') === '1'

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let disposed = false

    const forensic = createForensic()
    const renderer = createRenderer(canvas, { antialias: true })
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100)
    const clock = new THREE.Clock()
    const signals = createSignals()
    const rng = mulberry32(seed)

    const ctx: SceneContext = {
      renderer,
      scene,
      camera,
      clock,
      sizes: { width: window.innerWidth, height: window.innerHeight, dpr: renderer.getPixelRatio() },
      rng,
      signals,
      forensic,
    }

    const mod = createScene()
    void Promise.resolve(mod.init(ctx))

    const onResize = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
      ctx.sizes = { width: w, height: h, dpr: renderer.getPixelRatio() }
      mod.resize?.(w, h)
    }
    window.addEventListener('resize', onResize)

    let heldTime = 0
    let frame = 0
    const ticker = createTicker(clock, (elapsed, dtRaw) => {
      if (disposed) return
      signals.update()
      if (!forensic.freeze) heldTime = elapsed
      const dt = forensic.freeze ? 0 : dtRaw
      // time = 时间轴 (秒): ?time= 确定性覆盖 > ?freeze 保持当前 > 真实墙钟
      const time = forensic.frozenTime ?? heldTime
      const t = forensic.frozenT ?? signals.scrollT
      mod.update(t, dt, time)
      if (mod.render) mod.render()
      else renderer.render(scene, camera)
      frame += 1
      ;(window as any).__v2c = { time, t, frame, frozenTime: forensic.frozenTime, frozenT: forensic.frozenT }
      if (hudRef.current) hudRef.current.textContent = `time=${time.toFixed(3)} t=${t.toFixed(3)} f=${frame}`
    })
    ticker.start()

    return () => {
      disposed = true
      ticker.stop()
      window.removeEventListener('resize', onResize)
      signals.dispose()
      mod.dispose()
      renderer.dispose()
    }
  }, [seed])

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', display: 'block' }}
      />
      {hud && <div ref={hudRef} data-forensic-hud style={{ position: 'fixed', right: 4, bottom: 4, zIndex: 2147483647,
        font: '12px/1 monospace', color: '#0f0', background: 'rgba(0,0,0,.8)', padding: '2px 4px',
        pointerEvents: 'none', whiteSpace: 'pre' }} />}
    </>
  )
}
