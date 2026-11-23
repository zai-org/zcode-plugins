// ══════════════════════════════════════════════════════════════════════════════
//  EXAMPLE FRAGMENT SHADER — REPLACE ME
//  ──────────────────────────────────────────────────────────────────────────
//  同 PlaceholderScene 的定位: 只证明链路通 (?raw 导入 → 编译 → 上屏 → ?time= 冻得住),
//  故意画一圈明显不是任何真实设计的同心波纹。复刻时把整份内容换成你自己的着色器。
//
//  接线 (scene/Scene.ts):
//    import frag from './shaders/example.frag.glsl?raw'
//    const quad = createFullscreenQuad(frag); ctx.scene.add(quad.mesh)
//    // update(t, dt, time) 里: quad.update(ctx.sizes, time, dt, ctx.signals.pointer)
//
//  这是完整的 GLSL ES 1.00 片元着色器 —— RawShaderMaterial 不注入任何东西, 所以
//  precision 和每个用到的 uniform 都要自己声明 (没用到的不必声明)。片元输出写 gl_FragColor。
// ══════════════════════════════════════════════════════════════════════════════
precision highp float;

uniform vec3  iResolution;  // 绘制缓冲像素 (x, y, 1) —— 与 gl_FragCoord 同坐标系
uniform float iTime;        // 已播放秒数 (?time=<秒> 冻结的就是它)
// 还可声明: uniform float iTimeDelta; uniform int iFrame; uniform vec4 iMouse;

void main() {
  // 以短边归一的居中坐标: 不随视口宽高比拉伸。
  vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
  float r = length(uv);

  float rings = 0.5 + 0.5 * sin(r * 24.0 - iTime * 2.0);
  vec3 col = mix(vec3(0.02, 0.03, 0.08), vec3(0.15, 0.65, 0.95), rings);
  col *= smoothstep(0.85, 0.15, r);          // 边缘压暗, 让画面有个中心

  gl_FragColor = vec4(col, 1.0);
}
