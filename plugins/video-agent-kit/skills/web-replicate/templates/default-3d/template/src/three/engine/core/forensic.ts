// engine/core — 取证钩子: 用 URL 参数把动画钉在确定状态, 供验证脚本确定性截图。禁改。
//   ?t=<0..1>    把场景钉在该滚动进度 (冻结 scrollT), 用于滚动驱动页逐 BEAT 静帧比对
//   ?time=<秒>   把场景钉在该播放秒数 (冻结时间轴), 用于时间驱动页 (自动播放/shader) 确定性 seek
//   ?freeze      冻结时间轴 (dt=0 且 time 不推进), 动画停住
//   ?autodemo    自动演示 (无交互也走完 BEAT), scene 自行读取 forensic.autodemo
// ?t 与 ?time 是两根独立的轴, 各冻各的。?freeze 不是确定性 seek —— 参数在加载时就生效,
// 停住的是起始那一帧; 要"停在第 2.0 秒"必须用 ?time=2.0。
export interface Forensic {
  frozenT: number | null
  frozenTime: number | null
  freeze: boolean
  autodemo: boolean
}

export function createForensic(search: string = window.location.search): Forensic {
  const p = new URLSearchParams(search)
  const traw = p.get('t')
  let frozenT: number | null = null
  if (traw !== null && traw !== '') {
    const v = Number(traw)
    if (Number.isFinite(v)) frozenT = Math.min(1, Math.max(0, v))
  }
  // 秒数无上界, 只钳负值 (不像 t 钳到 0..1)。
  const timeRaw = p.get('time')
  let frozenTime: number | null = null
  if (timeRaw !== null && timeRaw !== '') {
    const v = Number(timeRaw)
    if (Number.isFinite(v)) frozenTime = Math.max(0, v)
  }
  return {
    frozenT,
    frozenTime,
    freeze: p.has('freeze'),
    autodemo: p.has('autodemo'),
  }
}
