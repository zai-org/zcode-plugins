// HUD — 2D 覆盖层 (Tailwind, pointer-events:none)。放导航 / 文案 / 声部标签等 2D chrome,
// 叠在 3D canvas 之上。复刻时按视频改内容; 需要交互的元素单独开 pointer-events:auto。
export default function Hud() {
  return (
    <div className="pointer-events-none fixed inset-0 z-10 flex flex-col justify-between p-6 text-white">
      <header className="text-sm uppercase tracking-widest opacity-70">REPLACE ME — HUD</header>
      <footer className="text-xs opacity-50">scroll ↓</footer>
    </div>
  )
}
