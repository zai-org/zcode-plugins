import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { countWords, EN_STOP, layoutCloud, ZH_STOP } from "../src/count.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("counting", () => {
  it("segments Chinese and English and drops stopwords", () => {
    const { list } = countWords([{ name: "a", text: "客户的反馈很多，客户满意。The customers love the tea, customers!" }], { stop: new Set([...ZH_STOP, ...EN_STOP]), minLen: 2, ngram: 1, numbers: false });
    const m = Object.fromEntries(list.map((x) => [x.word, x.count]));
    expect(m["客户"]).toBe(2);
    expect(m["customers"]).toBe(2);
    expect(m["the"]).toBeUndefined();
    expect(m["的"]).toBeUndefined();
  });
  it("adds phrases and lays out a cloud without overlaps", () => {
    const { list } = countWords([{ name: "a", text: "delivery speed improved. delivery speed matters" }], { stop: EN_STOP, minLen: 2, ngram: 2, numbers: false });
    expect(list.find((x) => x.word === "delivery speed")?.count).toBe(2);
    const placed = layoutCloud(Array.from({ length: 40 }, (_, i) => ({ word: `词${i}`, weight: 40 - i })), { width: 800, height: 500, palette: ["#000"], rotate: true, circle: false, minSize: 12, maxSize: 80 });
    expect(placed.length).toBe(40);
    for (const a of placed) for (const b of placed) if (a !== b) expect(Math.abs(a.x - b.x) * 2 >= a.w + b.w || Math.abs(a.y - b.y) * 2 >= a.h + b.h).toBe(true);
  });
});

describe("tools", () => {
  it("counts a folder, merges synonyms and exports", async () => {
    const root = await mkdtemp(join(tmpdir(), "wf-"));
    await cp(join(HERE, "samples"), join(root, "docs"), { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("wordfreq_open", { inputs: ["docs/reports"], project: "fb" });
    expect(o.data.stats).toMatchObject({ files: 3 });
    expect(o.text).toMatch(/top: 客户 \d+/);
    const rows = (await c.call("wordfreq_status", { project: "fb" })).data.rows as { word: string; count: number }[];
    const at = (w: string) => rows.findIndex((r) => r.word === w);
    const kehu = rows[at("客户")].count, guke = rows[at("顾客")].count;
    await c.call("wordfreq_edit", { project: "fb", set: [{ row: at("顾客"), values: { 合并到: "客户" } }, { row: at("提升"), values: { include: false } }] });
    const st = await c.call("wordfreq_status", { project: "fb" });
    expect(st.text).toContain(`客户 ${kehu + guke}`);
    await c.call("wordfreq_edit", { project: "fb", settings: { stopwords: "本季度 季度" } });
    const st2 = await c.call("wordfreq_status", { project: "fb" });
    expect((st2.data.rows as { word: string }[]).some((r) => r.word === "季度")).toBe(false);
    expect(st2.text).toContain(`客户 ${kehu + guke}`);
    await c.call("wordfreq_edit", { project: "fb", set: [{ row: at("顾客"), values: { 合并到: "" } }], settings: { merge: "顾客=客户\n不存在的词=客户", stopwords: "本季度 季度 ai" } });
    const st3 = await c.call("wordfreq_status", { project: "fb" });
    expect(st3.text).toContain(`客户 ${kehu + guke}`);
    expect(st3.text).toMatch(new RegExp(`客户 ×${kehu} \\(merged total ${kehu + guke}\\)`));
    expect(st3.text).toMatch(/顾客 ×\d+ → 客户/);
    expect(st3.text).toMatch(/“不存在的词” isn't among the counted words/);
    expect((st3.data.rows as { word: string }[]).some((r) => r.word === "AI")).toBe(false);
    await c.call("wordfreq_export", { project: "fb" });
    const dir = join(root, "word-frequency/fb");
    expect(await readFile(join(dir, "wordcloud.svg"), "utf8")).toContain(">客户</text>");
    expect(await readFile(join(dir, "word-frequency.csv"), "utf8")).toMatch(/"客户",\d+/);
    expect((await readFile(join(dir, "wordcloud.png"))).subarray(1, 4).toString()).toBe("PNG");
    expect((await readFile(join(dir, "word-frequency.xlsx"))).subarray(0, 2).toString()).toBe("PK");
  }, 60_000);
});
