import * as THREE from 'three'

// engine/core — WebGLRenderer 工厂。pixelRatio 上限 1: 一个 canvas 像素 = 一个 CSS 像素, 截图尺寸
// 与录屏尺寸一致 (与渲染档位无关)。sRGB 输出, **不加 tone mapping**: 引擎不替场景做艺术决定
// —— 全局 S 曲线会压暗部/去饱和, 让逐材质校色永远对不上源。
// 源确有 filmic 观感时由场景自己显式 `ctx.renderer.toneMapping = ACESFilmicToneMapping`。禁改。
export function createRenderer(
  canvas: HTMLCanvasElement,
  opts: { antialias?: boolean } = {},
): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: opts.antialias ?? true,
    alpha: false,
    powerPreference: 'high-performance',
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1))
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NoToneMapping
  return renderer
}
