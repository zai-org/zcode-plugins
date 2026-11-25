import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeAll, describe, expect, it } from "vitest";
import { decodeWav, encodeWav, loudness, makeLoop, normalize, trimSilence } from "../src/audio.ts";
import { guess } from "../src/project.ts";
import { PRESETS, preset, SR, synth } from "../src/synth.ts";
import { createServer } from "../src/server.ts";

let workspace: string;
let client: Client;
const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args }, undefined, { timeout: 300_000 })) as any;

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "sfx-"));
  // 已有声音：前后各 0.5 秒静音的 1 秒噪声；以及 3 秒“雨声”（mp3，需要 ffmpeg）
  const n = new Float32Array(SR * 2);
  for (let i = SR / 2; i < SR * 1.5; i++) n[i] = (Math.random() * 2 - 1) * 0.05;
  await writeFile(join(workspace, "door_slam.wav"), encodeWav([n, n], SR));
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "anoisesrc=d=3:c=pink:a=0.2", "-ar", "48000", join(workspace, "rain_ambience.mp3")]);
  const server = createServer({ workspaceRoot: workspace, assetRoot: join(import.meta.dirname, "../dist") });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: "t", version: "1" });
  await client.connect(b);
});

describe("synth and audio", () => {
  it("is deterministic per seed and every preset makes sound", () => {
    for (const k of PRESETS) {
      const a = synth(preset(k, 3), 3);
      expect(a.length).toBeGreaterThan(SR * 0.02);
      expect(loudness(a, SR)).toBeGreaterThan(-45);
      expect(synth(preset(k, 3), 3)).toEqual(a);
    }
    expect(preset("jump", 1).freq).not.toBe(preset("jump", 2).freq);
    expect(preset("laser", 5).slide).toBeLessThan(0);
  });
  it("normalises, trims and loops", () => {
    const x = synth(preset("explosion", 1), 1);
    const r = normalize(x, SR, -18);
    expect(Math.abs(loudness(x, SR) - -18) < 0.1 || r.limited).toBe(true);
    const silent = new Float32Array(SR);
    silent.fill(0.3, 20000, 22000);
    expect(trimSilence(silent, SR).length).toBe(2000 + 2 * Math.round(SR * 0.005));
    const ramp = Float32Array.from({ length: 1000 }, (_, i) => i / 1000);
    const loop = makeLoop(ramp, 1000, 0.1);
    expect(loop.length).toBe(900);
    expect(loop[0]).toBeCloseTo(ramp[900], 2); // 循环接缝处连续：末尾 → 开头
  });
  it("round-trips WAV and guesses presets from event names", () => {
    const x = Float32Array.from({ length: 100 }, (_, i) => Math.sin(i / 5) * 0.5);
    const d = decodeWav(encodeWav([x], 22050));
    expect(d.sampleRate).toBe(22050);
    expect(d.channels[0][10]).toBeCloseTo(x[10], 3);
    expect([guess("拾取金币"), guess("Player hurt"), guess("菜单确认"), guess("big bomb")].map((g) => `${g.category}:${g.preset}`)).toEqual(["pickup:coin", "combat:hit", "ui:confirm", "combat:explosion"]);
  });
});

describe("tools", () => {
  it("builds a pack from events and files", async () => {
    const r = await call("sfx_open", { name: "Platformer", events: ["jump", "拾取金币", "player hurt", { name: "menu_click", category: "ui", preset: "blip" }, "game over fail"], files: ["door_slam.wav", "rain_ambience.mp3"] });
    expect(r.isError).toBeFalsy();
    const p = r.structuredContent.project;
    expect(p.sounds.map((s: any) => `${s.category}/${s.name}`)).toEqual(["player/jump", "pickup/拾取金币", "combat/player_hurt", "ui/menu_click", "ui/game_over_fail", "imported/door_slam", "imported/rain_ambience"]);
    expect(p.sounds[6].loop).toBe(true);
    const prev = await call("sfx_render", { project: p, index: 0 });
    expect(prev.structuredContent.params.wave).toBe("square");
    p.sounds[0].params = { freq: 900 };
    p.sounds[6].crossfade = 0.5;
    const x = await call("sfx_export", { project: { ...p, format: "both" } });
    expect(x.isError).toBeFalsy();
    const m = JSON.parse(await readFile(join(workspace, "sfx/manifest.json"), "utf8"));
    expect(m.sounds).toHaveLength(7);
    for (const s of m.sounds) expect(Math.abs(s.loudness + 18) < 0.3 || s.peak > -1.05).toBe(true);
    expect(m.sounds[0].params.freq).toBe(900);
    const door = m.sounds.find((s: any) => s.name === "door_slam");
    expect(door.duration).toBeCloseTo(1.01, 1);
    const rain = decodeWav(await readFile(join(workspace, "sfx/imported/rain_ambience.wav")));
    expect(rain.sampleRate).toBe(44100);
    expect(rain.channels[0].length / 44100).toBeCloseTo(2.5, 1);
    expect(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name", "-of", "csv=p=0", join(workspace, "sfx/player/jump.ogg")]).toString().trim()).toBe("vorbis");
    expect(await readFile(join(workspace, "sfx/manifest.csv"), "utf8")).toContain("player,jump,jump,player/jump.wav,");
    expect(x.content[0].text).toMatch(/Exported 7 sound\(s\)/);
  });
  it("reports errors", async () => {
    expect((await call("sfx_open", { files: ["nope.wav"] })).content[0].text).toMatch(/File not found/);
    expect((await call("sfx_save", { project: { sounds: [] } })).content[0].text).toMatch(/at least one sound/);
  });
});
