import { KitError, safeFileName } from "./kit/workspace.ts";
import { PRESETS, type Preset } from "./synth.ts";

export interface Sound {
  name: string;
  category: string;
  event: string;
  kind: "synth" | "file";
  preset: Preset;
  seed: number;
  params: Record<string, unknown>;
  source: string;
  trim: boolean;
  loop: boolean;
  crossfade: number;
  gain: number;
}
export interface Project { version: 1; name: string; sounds: Sound[]; loudness: number; format: "wav" | "ogg" | "both"; sampleRate: number; output: string }

const RULES: [RegExp, Preset, string][] = [
  [/coin|gold|money|金币|钱/i, "coin", "pickup"],
  [/pick ?up|collect|item|gem|拾取|捡|道具|宝石/i, "pickup", "pickup"],
  [/laser|shoot|shot|fire|bullet|gun|射击|激光|开火|子弹/i, "laser", "combat"],
  [/explo|bomb|blast|爆炸|炸弹/i, "explosion", "combat"],
  [/hit|hurt|damage|punch|impact|受击|受伤|击中|打击/i, "hit", "combat"],
  [/power|level ?up|upgrade|buff|升级|强化|增益/i, "powerup", "pickup"],
  [/jump|hop|bounce|跳/i, "jump", "player"],
  [/step|walk|foot|run|脚步|走路/i, "step", "player"],
  [/dash|swing|whoosh|swoosh|slash|冲刺|挥|闪避/i, "whoosh", "player"],
  [/error|fail|wrong|deny|invalid|错误|失败|不可/i, "error", "ui"],
  [/confirm|success|ok|accept|win|complete|确认|成功|完成|胜利/i, "confirm", "ui"],
  [/click|button|select|hover|menu|tap|toggle|按钮|点击|选择|菜单/i, "blip", "ui"],
];
export function guess(event: string): { preset: Preset; category: string } {
  for (const [re, preset, category] of RULES) if (re.test(event)) return { preset, category };
  return { preset: "blip", category: "misc" };
}

const fileName = (s: string) => safeFileName(s.trim().toLowerCase().replace(/[\s/\\]+/g, "_"), "sound").slice(0, 60);

export function normalizeProject(raw: any): { project: Project; warnings: string[] } {
  const warnings: string[] = [];
  const list = Array.isArray(raw?.sounds) ? raw.sounds : [];
  if (!list.length) throw new KitError("no_sounds", "Add at least one sound (an event name, or an existing file).");
  if (list.length > 300) throw new KitError("too_many", "At most 300 sounds.");
  const seen = new Set<string>();
  const sounds: Sound[] = list.map((s: any, i: number) => {
    const event = String(s?.event ?? s?.name ?? "").trim().slice(0, 120);
    const kind = s?.kind === "file" || (s?.source && s?.kind !== "synth") ? "file" : "synth";
    if (kind === "file" && !s?.source) throw new KitError("missing_source", `Sound ${i + 1}: kind "file" needs a source.`);
    const g = guess(`${s?.name ?? ""} ${event}`);
    const category = fileName(String(s?.category ?? "") || g.category);
    let name = fileName(String(s?.name ?? "") || event || `sound_${i + 1}`);
    const base = name;
    for (let k = 2; seen.has(`${category}/${name}`); k++) name = `${base}_${k}`;
    seen.add(`${category}/${name}`);
    const preset = PRESETS.includes(s?.preset) ? s.preset : g.preset;
    if (s?.preset && !PRESETS.includes(s.preset)) warnings.push(`${name}: unknown preset "${s.preset}", using ${preset}.`);
    return {
      name, category, event: event || name, kind, preset,
      seed: Number.isInteger(s?.seed) ? Math.abs(s.seed) % 1e9 : 1,
      params: s?.params && typeof s.params === "object" ? s.params : {},
      source: kind === "file" ? String(s.source) : "",
      trim: s?.trim !== false,
      loop: !!s?.loop,
      crossfade: Math.max(0.01, Math.min(5, Number(s?.crossfade) || 0.5)),
      gain: Math.max(-24, Math.min(12, Number(s?.gain) || 0)),
    };
  });
  const loud = Number(raw?.loudness ?? -18);
  return {
    project: {
      version: 1,
      name: fileName(String(raw?.name ?? "")) || "sfx",
      sounds,
      loudness: Number.isFinite(loud) ? Math.max(-36, Math.min(-6, loud)) : -18,
      format: ["wav", "ogg", "both"].includes(raw?.format) ? raw.format : "wav",
      sampleRate: [22050, 44100, 48000].includes(Number(raw?.sampleRate)) ? Number(raw.sampleRate) : 44100,
      output: String(raw?.output ?? "").replace(/^\/+|\/+$/g, "") || "sfx",
    },
    warnings,
  };
}
