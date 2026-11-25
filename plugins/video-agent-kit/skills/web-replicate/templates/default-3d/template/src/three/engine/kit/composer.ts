import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

// engine/kit — 后处理 composer (可选)。corpus 42% 用 EffectComposer + UnrealBloom + OutputPass。
// 起手参数取自普查常见档; scene 按视频观感调 strength/radius/threshold。
// 用法: scene.init 里建 composer, scene.render() 覆盖为 composer.render()。
export interface BloomOptions {
  strength?: number
  radius?: number
  threshold?: number
}

export function createBloomComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  bloom: BloomOptions = {},
): { composer: EffectComposer; bloomPass: UnrealBloomPass } {
  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    bloom.strength ?? 0.8,
    bloom.radius ?? 0.4,
    bloom.threshold ?? 0.85,
  )
  composer.addPass(bloomPass)
  composer.addPass(new OutputPass())
  return { composer, bloomPass }
}
