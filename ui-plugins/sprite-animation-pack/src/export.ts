import type { Layout, Project } from "./sprites.ts";

const r = (l: Layout, p: Project, f: Layout["frames"][number]) => ({ x: f.x * p.scale, y: f.y * p.scale, w: l.cellW * p.scale, h: l.cellH * p.scale });

/** Aseprite 导出格式（JSON Hash + frameTags）：Phaser 3 用 load.aseprite / createFromAseprite，也能当普通 atlas 用。 */
export function asepriteJson(p: Project, l: Layout, image: string) {
  const frames: Record<string, unknown> = {};
  for (const f of l.frames) {
    const rect = r(l, p, f);
    frames[f.name] = { frame: rect, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w: rect.w, h: rect.h }, sourceSize: { w: rect.w, h: rect.h }, duration: f.duration };
  }
  let i = 0;
  const frameTags = p.actions.map((a) => {
    const from = i;
    i += a.frames.length;
    return { name: a.name, from, to: i - 1, direction: "forward", ...(a.loop ? {} : { repeat: "1" }) };
  });
  return JSON.stringify({ frames, meta: { app: "https://github.com/ppppp2005-p (ZCode Sprite Animation Pack)", version: "0.1.0", image, format: "RGBA8888", size: { w: l.width * p.scale, h: l.height * p.scale }, scale: "1", frameTags, pivot: { x: l.pivot[0] / l.cellW, y: l.pivot[1] / l.cellH } } }, null, 1) + "\n";
}

/** Godot 4 SpriteFrames 资源；图集按相对路径引用（与 .tres 放在同一文件夹）。 */
export function godotTres(p: Project, l: Layout, image: string) {
  const subs: string[] = [];
  const anims: string[] = [];
  let n = 0;
  for (const a of p.actions) {
    const list = l.frames.filter((f) => f.action === a.name);
    const base = mode(list.map((f) => f.duration));
    const frames = list.map((f) => {
      n++;
      const rect = r(l, p, f);
      subs.push(`[sub_resource type="AtlasTexture" id="AtlasTexture_${n}"]\natlas = ExtResource("1_atlas")\nregion = Rect2(${rect.x}, ${rect.y}, ${rect.w}, ${rect.h})\n`);
      return `{\n"duration": ${fmt(f.duration / base)},\n"texture": SubResource("AtlasTexture_${n}")\n}`;
    });
    anims.push(`{\n"frames": [${frames.join(", ")}],\n"loop": ${a.loop},\n"name": &"${a.name}",\n"speed": ${fmt(1000 / base)}\n}`);
  }
  return `[gd_resource type="SpriteFrames" load_steps=${n + 2} format=3]\n\n[ext_resource type="Texture2D" path="${image}" id="1_atlas"]\n\n${subs.join("\n")}\n[resource]\nanimations = [${anims.join(", ")}]\n`;
}

/** Unity：Sprite Editor 按网格切片的参数 + 每帧矩形（Unity 的 y 轴从下往上）。 */
export function unityNotes(p: Project, l: Layout, image: string) {
  const W = l.cellW * p.scale, H = l.cellH * p.scale, height = l.height * p.scale;
  const px = (l.pivot[0] / l.cellW).toFixed(4), py = (1 - l.pivot[1] / l.cellH).toFixed(4);
  const lines = [
    `# ${p.name} — Unity import`,
    "",
    `1. Copy \`${image}\` into \`Assets/\`. In the Inspector: Texture Type **Sprite (2D and UI)**, Sprite Mode **Multiple**, Filter Mode **Point (no filter)** for pixel art, Compression **None**.`,
    `2. Sprite Editor → Slice → Type **Grid By Cell Size**, Pixel Size **${W} × ${H}**, Offset 0, Padding 0, Pivot **Custom (${px}, ${py})** — the character's feet / anchor. Slice, then Apply.`,
    `3. Name the slices from this table (or keep Unity's numbering, they come in the same order). Drag each action's sprites into the Scene to create an Animation Clip, then set the sample rate below.`,
    "",
    "| Action | Frames | Sprites (x, y from bottom-left, w, h) | Frame durations (ms) | Loop |",
    "|---|---|---|---|---|",
  ];
  for (const a of p.actions) {
    const list = l.frames.filter((f) => f.action === a.name);
    const rects = list.map((f) => `${f.name} (${f.x * p.scale}, ${height - (f.y + l.cellH) * p.scale}, ${W}, ${H})`).join("<br>");
    lines.push(`| ${a.name} | ${list.length} | ${rects} | ${list.map((f) => f.duration).join(", ")} (≈${fmt(1000 / mode(list.map((f) => f.duration)))} fps) | ${a.loop ? "yes" : "no"} |`);
  }
  return lines.join("\n") + "\n";
}

export function phaserSnippet(p: Project, l: Layout, json: string, image: string) {
  return `// Phaser 3 — load the atlas and create every animation from its tags.
// preload():
this.load.aseprite("${p.name}", "${image}", "${json}");
// create():
this.anims.createFromAseprite("${p.name}");
const sprite = this.add.sprite(400, 300, "${p.name}").setOrigin(${(l.pivot[0] / l.cellW).toFixed(3)}, ${(l.pivot[1] / l.cellH).toFixed(3)});
sprite.play({ key: "${p.actions[0]?.name}", repeat: -1 });
`;
}

function mode(values: number[]) {
  const c = new Map<number, number>();
  for (const v of values) c.set(v, (c.get(v) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 100;
}
const fmt = (n: number) => String(Math.round(n * 1000) / 1000).replace(/^(\d+)$/, "$1.0");
