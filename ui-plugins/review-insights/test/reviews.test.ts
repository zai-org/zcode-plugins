import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { clauseTone, DEFAULT_TOPICS, parseTopics, tagReview } from "../src/topics.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("tone and topics", () => {
  it("handles negation and longer words", () => {
    expect(clauseTone("没有色差")).toBe(1);
    expect(clauseTone("不太满意")).toBe(-1);
    expect(clauseTone("质量太差了")).toBe(-1);
    expect(clauseTone("做工不错")).toBe(1);
    expect(clauseTone("the size runs small")).toBe(-1);
  });
  it("tags each clause with its topic", () => {
    const t = tagReview("颜色和图片一样好看，就是尺码偏小", parseTopics(DEFAULT_TOPICS));
    expect(t.get("外观")?.tone).toBe(1);
    expect(t.get("尺码")).toEqual({ tone: -1, snippet: "就是尺码偏小" });
    expect(parseTopics("面料: 面料，布料\n坏行\n")).toEqual([{ name: "面料", words: ["面料", "布料"] }]);
  });
});

describe("tools", () => {
  it("reports complaints, takes manual tags and exports", async () => {
    const root = await mkdtemp(join(tmpdir(), "ri-"));
    await cp(join(HERE, "samples"), join(root, "shop"), { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("reviews_open", { inputs: ["shop/reviews.csv"], project: "tee" });
    expect(o.data.stats).toMatchObject({ reviews: 18, untagged: 2 });
    expect(o.text).toMatch(/Rating 6 is outside 1–5/);
    expect(o.text).toMatch(/Same text as row 0/);
    const e = await c.call("reviews_edit", { project: "tee", set: [{ row: 14, values: { 评分: "5" } }, { row: 15, values: { tone: "中评", topics: "物流" } }] });
    expect(e.text).not.toMatch(/outside 1–5/);
    expect(e.data.stats).toMatchObject({ untagged: 1 });
    await c.call("reviews_export", { project: "tee" });
    const dir = join(root, "review-insights/tee");
    const html = await readFile(join(dir, "review-report.html"), "utf8");
    expect(html).toMatch(/主要差评原因/);
    expect(html).toMatch(/<b>尺码<\/b>（3）/);
    expect(html).toContain("“有很重的异味”");
    expect((await readFile(join(dir, "review-insights.xlsx"))).subarray(0, 2).toString()).toBe("PK");
  }, 60_000);
});
