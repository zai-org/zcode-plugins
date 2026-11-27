import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { annotate, markToNum, numToMark } from "../src/py.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("pinyin", () => {
  it("converts tone numbers and marks", () => {
    expect(numToMark("huan2")).toBe("huán");
    expect(numToMark("lv4")).toBe("lǜ");
    expect(numToMark("gou3")).toBe("gǒu");
    expect(numToMark("gui4")).toBe("guì");
    expect(numToMark("de5")).toBe("de");
    expect(markToNum("lǜ")).toBe("lv4");
  });
  it("uses word context and custom words", () => {
    const t = annotate("银行行长", "");
    expect(t.map((x) => x.py).join(" ")).toBe("yín háng háng zhǎng");
    expect(annotate("去还书", "还书: huan2 shu1")[1].py).toBe("huán");
  });
});

describe("tools", () => {
  it("flags likely misreadings, takes fixes and exports", async () => {
    const root = await mkdtemp(join(tmpdir(), "py-"));
    await cp(join(HERE, "samples"), join(root, "lessons"), { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("pinyin_open", { inputs: ["lessons/lesson.txt"], project: "autumn" });
    expect(o.text).toMatch(/【朝】阳.*read as cháo, probably zhāo/);
    expect(o.text).toMatch(/【种】花.*probably zhòng/);
    expect(o.text).toMatch(/乐【地】跑.*probably de/);
    const rows = (await c.call("pinyin_status", { project: "autumn" })).data.rows as { ch: string; context: string }[];
    const idx = (frag: string) => rows.findIndex((r) => r.context.includes(frag));
    await c.call("pinyin_edit", { project: "autumn", settings: { custom: "还书: huan2 shu1", cards: "朝背种数", layout: "grid" }, set: [{ row: idx("【朝】"), values: { 读音: "zhao1" } }, { row: idx("【种】"), values: { reading: "zhòng" } }, { row: idx("【数】"), values: { reading: "shu3" } }, { row: idx("乐【地】"), values: { reading: "de" } }, { row: idx("皮【地】"), values: { reading: "de" } }] });
    const st = await c.call("pinyin_status", { project: "autumn" });
    expect(st.text).not.toMatch(/probably/);
    await c.call("pinyin_export", { project: "autumn" });
    const dir = join(root, "pinyin-annotator/autumn");
    const html = await readFile(join(dir, "pinyin.html"), "utf8");
    expect(html).toContain("<ruby>朝<rt>zhāo</rt></ruby>");
    expect(html).toContain("<ruby>还<rt>huán</rt></ruby>");
    expect(await readFile(join(dir, "pinyin.txt"), "utf8")).toContain("zǎo shàng de zhāo yáng");
    expect((await readFile(join(dir, "pinyin.pdf"))).subarray(0, 4).toString()).toBe("%PDF");
    expect((await readFile(join(dir, "cards.pdf"))).subarray(0, 4).toString()).toBe("%PDF");
  }, 60_000);
});
