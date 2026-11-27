import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";
import { backIndex, fit, GRIDS, PAGES, plan, slots, tsvCell } from "../src/cards.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("layout", () => {
  it("mirrors backs so they line up when printed double-sided", () => {
    const g = GRIDS["3x3"];
    expect(Array.from({ length: 9 }, (_, i) => backIndex(i, g, "long"))).toEqual([2, 1, 0, 5, 4, 3, 8, 7, 6]);
    expect(Array.from({ length: 9 }, (_, i) => backIndex(i, g, "short"))).toEqual([6, 7, 8, 3, 4, 5, 0, 1, 2]);
    const sl = slots(PAGES.A4, g, 10);
    // 正面第 0 张在左上；长边翻转后，它的背面在右上 → 透过纸看同一位置
    expect(sl[backIndex(0, g, "long")].x + sl[0].x + sl[0].w).toBeCloseTo(PAGES.A4[0], 5);
    expect(sl[backIndex(0, g, "short")].y + sl[0].y + sl[0].h).toBeCloseTo(PAGES.A4[1], 5);
  });
  it("plans pages and fits text", () => {
    expect(plan(10, GRIDS["2x4"], true).map((p) => `${p.side}:${p.cards.length}`)).toEqual(["front:8", "back:8", "front:2", "back:2"]);
    const wrap = (t: string, size: number, w: number) => { const per = Math.max(1, Math.floor(w / (size * 0.6))); const out: string[] = []; for (let i = 0; i < t.length; i += per) out.push(t.slice(i, i + per)); return out; };
    expect(fit("hello", 200, 100, 30, 7, wrap)).toMatchObject({ size: 30, lines: ["hello"], overflow: false });
    expect(fit("x".repeat(60), 100, 40, 30, 7, wrap).size).toBeLessThan(30);
    expect(fit("x".repeat(2000), 50, 20, 30, 7, wrap).overflow).toBe(true);
    expect(tsvCell("a\tb\nc")).toBe("a b<br>c");
  });
});

describe("tools", () => {
  it("makes cards, the Anki file and the CSV", async () => {
    const root = await mkdtemp(join(tmpdir(), "cards-"));
    await cp(join(HERE, "samples"), join(root, "词表"), { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("flashcards_open", { inputs: ["词表/words.xlsx"], project: "u3", settings: { deck: "英语 Unit 3" } });
    expect(o.data.stats).toEqual({ cards: 12, pages: 4, perPage: 8 });
    expect((o.data.rows as Record<string, unknown>[])[0]).toMatchObject({ front: "harvest", reading: "/ˈhɑːrvɪst/", back: "n. 收获；收成  v. 收割", tags: "Unit3" });
    await c.call("flashcards_edit", { project: "u3", set: [{ row: 11, values: { 打印: false } }, { row: 0, values: { 背面: "n. 收获\nv. 收割" } }], settings: { grid: "3x3" } });
    const e = await c.call("flashcards_status", { project: "u3" });
    expect(e.data.stats).toEqual({ cards: 11, pages: 4, perPage: 9 });
    await c.call("flashcards_export", { project: "u3" });
    const out = join(root, "flashcard-maker", "u3");
    const pdf = await PDFDocument.load(await readFile(join(out, "flashcards.pdf")));
    expect(pdf.getPageCount()).toBe(4);
    const tsv = String(await readFile(join(out, "anki.tsv"))).split("\n");
    expect(tsv.slice(0, 4)).toEqual(["#separator:tab", "#html:true", "#tags column:3", "#deck:英语 Unit 3"]);
    expect(tsv[4]).toBe("harvest<br><small>/ˈhɑːrvɪst/</small>\tn. 收获<br>v. 收割<br><i>The tea harvest begins in April.</i>\tUnit3");
    expect(tsv.filter((l) => l && !l.startsWith("#"))).toHaveLength(11);
    const csv = String(await readFile(join(out, "cards.csv")));
    expect(csv).toContain("fragrant");
    expect(csv).not.toContain("He took a sip");
  }, 60_000);
  it("reads a plain text list and flags problems", async () => {
    const root = await mkdtemp(join(tmpdir(), "cards-"));
    await writeFile(join(root, "w.txt"), "# 生词\n苹果\tapple\n香蕉 - banana\n苹果 = apple (again)\n只有正面\n");
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("flashcards_open", { inputs: ["w.txt"], project: "t", settings: { reverse: true, duplex: false } });
    const rows = o.data.rows as Record<string, unknown>[];
    expect(rows.map((r) => [r.front, r.back])).toEqual([["苹果", "apple"], ["香蕉", "banana"], ["苹果", "apple (again)"], ["只有正面", ""]]);
    const msgs = (o.data.issues as { message: string }[]).map((i) => i.message).join("\n");
    expect(msgs).toMatch(/“苹果” is also card 1/);
    expect(msgs).toMatch(/“只有正面” has no back/);
    expect(o.data.summary).toMatch(/fronts then backs/);
    expect(o.data.stats.pages).toBe(2);
  });
});
