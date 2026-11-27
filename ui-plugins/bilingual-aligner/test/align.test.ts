import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { align, sentences } from "../src/align.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("sentences and alignment", () => {
  it("splits Chinese and English sentences", () => {
    expect(sentences("你好。“走吧！”他说。好的？")).toEqual(["你好。", "“走吧！”他说。", "好的？"]);
    expect(sentences("Dr. Li paid $3.50 today. Then he left. Ok")).toEqual(["Dr. Li paid $3.50 today.", "Then he left.", "Ok"]);
  });
  it("finds 2-1 matches", () => {
    const p = align(["我很好。", "谢谢你。", "今天下雨了，我们在家看了一部很长的电影。"], ["I am fine, thank you.", "It rained today, so we stayed home and watched a very long movie."]);
    expect(p.map((x) => x.kind)).toEqual(["2-1", "1-1"]);
  });
});

describe("tools", () => {
  it("aligns txt with docx, flags numbers, merges and exports TMX", async () => {
    const root = await mkdtemp(join(tmpdir(), "al-"));
    await cp(join(HERE, "samples"), join(root, "docs"), { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("align_open", { inputs: ["docs/隐私政策.txt", "docs/privacy-policy-en.docx"], project: "privacy" });
    expect(o.data.stats).toMatchObject({ pairs: 12 });
    expect(o.text).toMatch(/numbers differ — source has 3, translation has 2/);
    const rows = o.data.rows as { src: string; tgt: string; _kind: string }[];
    const bad = rows.findIndex((r) => r.src.includes("保存期限为 3 年"));
    const two = rows.findIndex((r) => r._kind === "2-1");
    expect(rows[two].src).toContain("配送完成后 30 天");
    const e = await c.call("align_edit", { project: "privacy", set: [{ row: bad, values: { 译文: rows[bad].tgt.replace("2 years", "3 years") } }, { row: 0, values: { merge: true } }] });
    expect(e.text).not.toMatch(/numbers differ/);
    expect(e.data.stats).toMatchObject({ pairs: 11 });
    await c.call("align_export", { project: "privacy" });
    const dir = join(root, "bilingual-aligner/privacy");
    const tmx = await readFile(join(dir, "aligned.tmx"), "utf8");
    expect(tmx.match(/<tu>/g)?.length).toBe(11);
    expect(tmx).toContain('<tuv xml:lang="zh-CN"><seg>茶铺小程序隐私政策本政策说明我们如何收集、使用和保护您的个人信息。</seg></tuv>');
    expect(tmx).toContain("for 3 years.");
    expect(await readFile(join(dir, "aligned.tsv"), "utf8")).toContain("我们不会收集您的身份证号码。\tWe do not collect your ID card number.");
    expect((await readFile(join(dir, "aligned.xlsx"))).subarray(0, 2).toString()).toBe("PK");
    await readFile(join(dir, "aligned.html"), "utf8");
  }, 60_000);
});
