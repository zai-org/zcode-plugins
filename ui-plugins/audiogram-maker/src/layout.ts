/** 三种画幅的版面。所有坐标为输出像素。 */
export interface Layout {
  W: number; H: number;
  cover: { x: number; y: number; s: number };
  title: { x: number; y: number; w: number; size: number; anchor: "middle" | "start" };
  sub: { y: number; size: number };
  wave: { x: number; y: number; w: number; h: number };
  cap: { cx: number; cy: number; w: number; size: number };
  bar: { x: number; y: number; w: number; h: number };
}

export function layoutFor(format: string): Layout {
  if (format === "vertical") return {
    W: 1080, H: 1920, cover: { x: 220, y: 200, s: 640 }, title: { x: 540, y: 900, w: 940, size: 64, anchor: "middle" }, sub: { y: 1060, size: 38 },
    wave: { x: 90, y: 1130, w: 900, h: 300 }, cap: { cx: 540, cy: 1580, w: 940, size: 56 }, bar: { x: 140, y: 1780, w: 800, h: 10 },
  };
  if (format === "landscape") return {
    W: 1920, H: 1080, cover: { x: 110, y: 230, s: 560 }, title: { x: 780, y: 220, w: 1040, size: 64, anchor: "start" }, sub: { y: 380, size: 38 },
    wave: { x: 780, y: 440, w: 1040, h: 260 }, cap: { cx: 1300, cy: 820, w: 1040, size: 46 }, bar: { x: 780, y: 960, w: 1040, h: 10 },
  };
  return {
    W: 1080, H: 1080, cover: { x: 350, y: 60, s: 380 }, title: { x: 540, y: 470, w: 960, size: 54, anchor: "middle" }, sub: { y: 610, size: 32 },
    wave: { x: 90, y: 660, w: 900, h: 190 }, cap: { cx: 540, cy: 930, w: 960, size: 44 }, bar: { x: 140, y: 1025, w: 800, h: 8 },
  };
}
