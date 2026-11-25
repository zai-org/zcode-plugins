import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

// engine/kit — 模型加载 (可选)。corpus 里没有 (全程序化生成), 但真实世界"产品/模型展示·配置器"
// 是第一大类, 故补齐。GLTF (+可选 DRACO 压缩) + 无 HDRI 也能给 PBR 像样反射的中性环境。

// dracoDecoderPath: draco 解码器目录 (如 '/draco/' 放 public/, 或 CDN)。仅当模型 draco 压缩时需要。
export function createGLTFLoader(dracoDecoderPath?: string): GLTFLoader {
  const loader = new GLTFLoader()
  if (dracoDecoderPath) {
    const draco = new DRACOLoader()
    draco.setDecoderPath(dracoDecoderPath)
    loader.setDRACOLoader(draco)
  }
  return loader
}

export function loadGLTF(loader: GLTFLoader, url: string): Promise<GLTF> {
  return new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject))
}

// RoomEnvironment + PMREM: 无需 HDRI 文件即可给 MeshStandard/Physical 材质中性环境反射。
// 用法: scene.environment = neutralEnvironment(renderer)
export function neutralEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer)
  return pmrem.fromScene(new RoomEnvironment(), 0.04).texture
}
