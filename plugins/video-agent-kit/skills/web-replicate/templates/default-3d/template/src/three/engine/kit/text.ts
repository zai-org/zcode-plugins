import { FontLoader, type Font } from 'three/examples/jsm/loaders/FontLoader.js'
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js'

// engine/kit — 3D 文字 (可选, corpus 4.8%)。加载 typeface json 字体 → TextGeometry。
// 字体 json 放 public/ (如 '/fonts/helvetiker_regular.typeface.json')。
export function loadFont(url: string): Promise<Font> {
  return new Promise((resolve, reject) => new FontLoader().load(url, resolve, undefined, reject))
}

export function makeTextGeometry(
  text: string,
  font: Font,
  size = 1,
  depth = 0.2,
): TextGeometry {
  // r163 起参数名由 height 改为 depth (three@0.185)。
  return new TextGeometry(text, { font, size, depth, curveSegments: 6 })
}
