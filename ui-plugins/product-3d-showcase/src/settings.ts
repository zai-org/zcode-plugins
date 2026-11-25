import { safeFileName } from "./kit/workspace.ts";

export interface Angle { name: string; yaw: number; pitch: number; zoom: number }
export interface Settings {
  version: 1;
  model: string;
  title: string;
  angles: Angle[];
  lighting: "studio" | "soft" | "dramatic";
  background: string; // "transparent" | "#rrggbb"
  shadow: boolean;
  exposure: number;
  size: number;
  video: { enabled: boolean; seconds: number; size: number; pitch: number };
  viewer: boolean;
  output: string;
}
export const DEFAULT_ANGLES: Angle[] = [
  { name: "front", yaw: 0, pitch: 8, zoom: 1 },
  { name: "three-quarter-left", yaw: -35, pitch: 15, zoom: 1 },
  { name: "three-quarter-right", yaw: 35, pitch: 15, zoom: 1 },
  { name: "side", yaw: 90, pitch: 5, zoom: 1 },
  { name: "back", yaw: 180, pitch: 10, zoom: 1 },
  { name: "top", yaw: 20, pitch: 60, zoom: 1 },
];
const clamp = (v: unknown, lo: number, hi: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };

export function normalizeSettings(raw: any, model: string): Settings {
  const stem = model.split("/").pop()!.replace(/\.[^.]+$/, "");
  const angles: Angle[] = [];
  const seen = new Set<string>();
  for (const a of Array.isArray(raw?.angles) ? raw.angles : DEFAULT_ANGLES.slice(0, 4)) {
    const preset = typeof a === "string" ? DEFAULT_ANGLES.find((d) => d.name === a) : undefined;
    const src = preset ?? a;
    let name = safeFileName(String(src?.name ?? `angle-${angles.length + 1}`).toLowerCase().replace(/\s+/g, "-"), "angle");
    for (let k = 2; seen.has(name); k++) name = `${src?.name}-${k}`;
    seen.add(name);
    angles.push({ name, yaw: clamp(src?.yaw, -360, 360, 0), pitch: clamp(src?.pitch, -30, 89, 10), zoom: clamp(src?.zoom, 0.3, 4, 1) });
  }
  if (!angles.length) angles.push({ ...DEFAULT_ANGLES[0] });
  const bg = String(raw?.background ?? "#ffffff").toLowerCase();
  return {
    version: 1,
    model,
    title: String(raw?.title ?? stem).slice(0, 80) || stem,
    angles: angles.slice(0, 24),
    lighting: ["studio", "soft", "dramatic"].includes(raw?.lighting) ? raw.lighting : "studio",
    background: bg === "transparent" || /^#[0-9a-f]{6}$/.test(bg) ? bg : "#ffffff",
    shadow: raw?.shadow !== false,
    exposure: clamp(raw?.exposure, 0.2, 3, 1),
    size: Math.round(clamp(raw?.size, 256, 4096, 2000)),
    video: { enabled: raw?.video?.enabled !== false, seconds: clamp(raw?.video?.seconds, 2, 30, 6), size: Math.round(clamp(raw?.video?.size, 360, 2160, 1080) / 2) * 2, pitch: clamp(raw?.video?.pitch, -10, 60, 12) },
    viewer: raw?.viewer !== false,
    output: String(raw?.output ?? "").replace(/^\/+|\/+$/g, "") || `showcase/${safeFileName(stem, "product")}`,
  };
}
