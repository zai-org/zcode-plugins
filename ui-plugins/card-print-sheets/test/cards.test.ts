import { cp, mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { cardSize, grid, imageSize } from "../src/img.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("layout", () => {
  it("reads sizes and fits cards on paper", async () => {
    expect(cardSize("custom", "60x90")).toEqual([60, 90]);
    expect(cardSize("custom", "60 by 90")).toBeNull();
    const g = grid(210, 297, 69, 94, 0, 5);
    expect([g.cols, g.rows]).toEqual([2, 3]);
    expect(grid(210, 297, 63, 88, 0, 5).cols).toBe(3);
    const png = new Uint8Array(await readFile(join(HERE, "samples/卡牌/back.png")));
    expect(imageSize(png)).toEqual({ w: 815, h: 1110, type: "png" });
    const jpg = new Uint8Array(await readFile(join(HERE, "samples/卡牌/cards/05-治疗药水.jpg")));
    expect(imageSize(jpg)).toEqual({ w: 815, h: 1110, type: "jpg" });
  });
});

describe("tools", () => {
  it("lays out a deck", async () => {
    const root = await mkdtemp(join(tmpdir(), "cards-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("cards_open", { inputs: ["卡牌"], project: "deck" });
    console.log(o.text);
    expect(o.text).toMatch(/card image “06-暗影刺客.png” isn't in the folder/);
    expect(o.text).toMatch(/04-雷鸟.png is 300×410 px — only \d+ dpi/);
    expect(o.text).toMatch(/03-森林守卫.png looks like it has no bleed/);
    expect(o.text).toMatch(/Found a back image back.png/);
    const e = await c.call("cards_edit", { project: "deck", remove: [5], settings: { back: "back.png", duplex: "long", title: "元素对决" } });
    expect(e.text).not.toMatch(/isn't in the folder/);
    const st = await c.call("cards_status", { project: "deck" });
    console.log(st.text.split("\n").slice(0, 6).join("\n"));
    expect(st.text).toMatch(/14 card\(s\) of 63×88 mm \(\+3 mm bleed\) on 3 A4 sheet\(s\), 2×3 per sheet, double-sided/);
    await c.call("cards_export", { project: "deck" });
    expect((await readdir(join(root, "card-print-sheets/deck"))).sort()).toEqual(["backs.pdf", "card-list.csv", "print-sheets.pdf"]);
    expect(await readFile(join(root, "card-print-sheets/deck/card-list.csv"), "utf8")).toMatch(/火焰龙,3,back.png/);
    await c.call("cards_edit", { project: "deck", settings: { duplex: "none" } });
    const off = await c.call("cards_status", { project: "deck" });
    expect(off.text).not.toMatch(/no back/);
  }, 120_000);
});
