import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

// engine/kit — 相机 rig (可选)。两模式:
//   · 样条飞行 (corpus 46% CatmullRomCurve3): createSplinePath + moveCameraAlong, 相机 = f(scrollT)
//   · 轨道环绕 (模型/产品展示常见): attachOrbit
// scene 按 archetype 取用; 也可整个不用, 直接摆 ctx.camera。

export function createSplinePath(points: THREE.Vector3[]): THREE.CatmullRomCurve3 {
  return new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5)
}

// 沿样条按进度 t (0..1) 放置相机, 看向 lookAt (或曲线前方一点做"顺行镜头")。
export function moveCameraAlong(
  camera: THREE.Camera,
  path: THREE.CatmullRomCurve3,
  t: number,
  lookAt: THREE.Vector3,
): void {
  const u = Math.min(1, Math.max(0, t))
  camera.position.copy(path.getPointAt(u))
  camera.lookAt(lookAt)
}

export function attachOrbit(
  camera: THREE.Camera,
  dom: HTMLElement,
  opts: { enableDamping?: boolean; autoRotate?: boolean } = {},
): OrbitControls {
  const controls = new OrbitControls(camera, dom)
  controls.enableDamping = opts.enableDamping ?? true
  controls.autoRotate = opts.autoRotate ?? false
  return controls
}
