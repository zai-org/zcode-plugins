import * as THREE from 'three'

// engine/kit — 全屏 quad + RawShaderMaterial (可选)。全屏程序化视觉场 (shader 背景 / 渐变 /
// aurora / 流体 / raymarch) 的标准载体: 一张贴满视口的 quad, 画面全在片元着色器里算。
// 用 RawShaderMaterial 而不是 ShaderMaterial —— three 不往里注入 prelude / varying / define,
// 你写的是干净的 GLSL ES 1.00 而不是 three 方言。顶点着色器 kit 给 (clip-space 直通),
// 不吃相机矩阵 —— 所以这类页可以不用 cameraRig, 甚至 kit 里只用这一个模块。
//
// 用法 (scene 侧四行):
//   import frag from './shaders/myfield.frag.glsl?raw'   // ?raw 是 Vite 内建, 无需依赖
//   this.quad = createFullscreenQuad(frag)               // init
//   ctx.scene.add(this.quad.mesh)
//   this.quad.update(ctx.sizes, time, dt, ctx.signals.pointer)   // update(t, dt, time) 里喂
//
// 预置 uniform 是**默认值, 不是规定** —— 这组名字沿用该 archetype 最常见的写法, 换掉也行:
//   iResolution vec3  绘制缓冲像素 (width*dpr, height*dpr, 1), 与 gl_FragCoord 同坐标系
//   iTime       float 已播放秒数 (scene.update 的 time; ?time=<秒> 可确定性冻结)
//   iTimeDelta  float 帧间秒数 (?freeze 时为 0)
//   iFrame      int   由 time 推导的帧序
//   iMouse      vec4  xy = 指针像素坐标, zw = 0 (本模板不追点击态)
// 片元着色器要自己声明 precision 与用到的每个 uniform (RawShader 不代劳), 抄
// scene/shaders/example.frag.glsl 的头部。场景专属的量走 extraUniforms, 名字自己定。

const VERTEX_SHADER = `
precision highp float;
attribute vec3 position;
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

export interface QuadSizes {
  width: number
  height: number
  dpr: number
}

export interface FullscreenQuad {
  mesh: THREE.Mesh
  material: THREE.RawShaderMaterial
  uniforms: Record<string, THREE.IUniform>
  update(sizes: QuadSizes, time: number, dt: number, pointer?: { x: number; y: number }): void
  dispose(): void
}

export function createFullscreenQuad(
  fragmentShader: string,
  extraUniforms: Record<string, THREE.IUniform> = {},
): FullscreenQuad {
  const uniforms: Record<string, THREE.IUniform> = {
    iResolution: { value: new THREE.Vector3(1, 1, 1) },
    iTime: { value: 0 },
    iTimeDelta: { value: 0 },
    iFrame: { value: 0 },
    iMouse: { value: new THREE.Vector4(0, 0, 0, 0) },
    ...extraUniforms,
  }
  const material = new THREE.RawShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
  mesh.frustumCulled = false   // 顶点不吃相机矩阵, 别让 three 按包围盒剔掉它
  mesh.renderOrder = -1        // 与别的几何体同场时当背景先画

  return {
    mesh,
    material,
    uniforms,
    update(sizes, time, dt, pointer) {
      const w = sizes.width * sizes.dpr
      const h = sizes.height * sizes.dpr
      ;(uniforms.iResolution.value as THREE.Vector3).set(w, h, 1)
      uniforms.iTime.value = time
      uniforms.iTimeDelta.value = dt
      // iFrame 由 time 推导 (名义 60fps), 不是自增计数: 自增值取决于跑过多少帧,
      // ?time= 就冻不出确定的一帧 —— 而这类页的判读全靠那张静帧。
      uniforms.iFrame.value = Math.floor(time * 60)
      if (pointer) {
        // signals.pointer 是 -1..1 且 y 向上, 与 gl_FragCoord (左下原点) 同向。
        ;(uniforms.iMouse.value as THREE.Vector4).set(
          (pointer.x * 0.5 + 0.5) * w,
          (pointer.y * 0.5 + 0.5) * h,
          0,
          0,
        )
      }
    },
    // 从 scene 里摘掉 mesh 由调用方负责 (与 kit 其余模块一致)。
    dispose() {
      mesh.geometry.dispose()
      material.dispose()
    },
  }
}
