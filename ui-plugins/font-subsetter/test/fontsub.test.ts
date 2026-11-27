import { cp, mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as fontkit from "fontkit";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { collect, headingText, stripCodeComments, unicodeRange, visibleText } from "../src/chars.ts";
import { sfntToWoff, subsetFont, woffToSfnt } from "../src/hb.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const SANS = join(HERE, "samples/官网/fonts/NotoSansSC-Regular-demo.otf");

describe("text scanning", () => {
  it("keeps visible text and drops comments and markup", () => {
    const code = 'a = "http://x//y"; // 注释\nb /* 块 */ c', st = stripCodeComments(code);
    expect(st.length).toBe(code.length);
    expect(st).toContain('"http://x//y"');
    expect(st).not.toMatch(/注|块/);
    expect(st.split("\n")[1].trim()).toBe("b         c");
    const html = visibleText("a.html", '<p title="提示">正文<!-- 旧文案 --></p><script>// 脚本注释\nalert("好")</script>');
    expect(html).toContain("提示");
    expect(html).toContain("正文");
    expect(html).toContain("好");
    expect(html).not.toContain("旧");
    expect(html).not.toContain("脚本");
    expect(html.length).toBe('<p title="提示">正文<!-- 旧文案 --></p><script>// 脚本注释\nalert("好")</script>'.length);
    expect(headingText("a.md", "# 关于我们\n正文")).toEqual(["关于我们"]);
    const { chars, commentOnly } = collect({ "s/a.js": "// 注释\nconst t = '你好';" }, { skipComments: true });
    expect(chars["你"]).toEqual({ n: 1, at: "s/a.js:2" });
    expect(chars["注"]).toBeUndefined();
    expect(commentOnly).toBe(2);
    expect(unicodeRange([0x4e01, 0x4e00, 0x4e02, 0x3002])).toBe("U+3002, U+4E00-4E02");
  });
});

describe("subsetting", () => {
  it("subsets a CFF font and round-trips WOFF", async () => {
    const buf = new Uint8Array(await readFile(SANS));
    const out = await subsetFont(join(HERE, ".."), buf, 0, [..."山间茶铺"].map((c) => c.codePointAt(0)!));
    expect(out.length).toBeLessThan(buf.length / 10);
    const f = fontkit.create(Buffer.from(out)) as unknown as { hasGlyphForCodePoint(cp: number): boolean };
    expect(f.hasGlyphForCodePoint("茶".codePointAt(0)!)).toBe(true);
    expect(f.hasGlyphForCodePoint("龙".codePointAt(0)!)).toBe(false);
    const woff = sfntToWoff(out);
    expect(Buffer.from(woff.subarray(0, 4)).toString()).toBe("wOFF");
    const back = fontkit.create(Buffer.from(woffToSfnt(woff))) as unknown as { hasGlyphForCodePoint(cp: number): boolean; numGlyphs: number };
    expect(back.hasGlyphForCodePoint("铺".codePointAt(0)!)).toBe(true);
    expect(back.numGlyphs).toBe((f as unknown as { numGlyphs: number }).numGlyphs);
  }, 30_000);
});

describe("tools", () => {
  it("finds fonts and pages, flags missing characters and exports", async () => {
    const root = await mkdtemp(join(tmpdir(), "fontsub-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("fontsub_open", { inputs: ["官网"], project: "site" });
    expect(o.text).toMatch(/2 font\(s\)/);
    expect(o.text).toMatch(/not in Noto Sans CJK SC: 焙 \(官网\/about\.md:4\), 萃 \(官网\/menu\.json:7\)/);
    expect(o.text).toMatch(/only in comments/);
    expect(o.text).toMatch(/not in Noto Serif CJK SC/);
    await c.call("fontsub_edit", { project: "site", set: [{ row: 1, values: { use: "headings" } }], settings: { formats: "woff2,woff,ttf", unicodeRange: true } });
    const st = await c.call("fontsub_status", { project: "site" });
    expect(st.text).not.toMatch(/not in Noto Serif CJK SC/);
    expect(st.data.stats).toMatchObject({ fonts: 2, sources: 4 });
    await c.call("fontsub_export", { project: "site" });
    const dir = join(root, "font-subsetter/site");
    const files = (await readdir(dir)).sort();
    expect(files).toEqual(["NotoSansCJKSC-Regular.otf", "NotoSansCJKSC-Regular.woff", "NotoSansCJKSC-Regular.woff2", "NotoSerifCJKSC-Bold.otf", "NotoSerifCJKSC-Bold.woff", "NotoSerifCJKSC-Bold.woff2", "chars.txt", "fonts.css", "preview.png", "report.md"]);
    const css = await readFile(join(dir, "fonts.css"), "utf8");
    expect(css).toMatch(/font-family: "Noto Serif CJK SC";[\s\S]*font-weight: 700;/);
    expect(css).toMatch(/unicode-range: U\+20-7E/);
    const chars = await readFile(join(dir, "chars.txt"), "utf8");
    expect(chars).toContain("茶");
    expect(chars).not.toContain("积");
    expect(chars).not.toContain("狂");
    const w2 = await readFile(join(dir, "NotoSansCJKSC-Regular.woff2"));
    expect(w2.subarray(0, 4).toString()).toBe("wOF2");
    expect(w2.length).toBeLessThan(120 * 1024);
    const serif = fontkit.create(await readFile(join(dir, "NotoSerifCJKSC-Bold.otf"))) as unknown as { hasGlyphForCodePoint(cp: number): boolean };
    expect(serif.hasGlyphForCodePoint("约".codePointAt(0)!)).toBe(true);
    expect(serif.hasGlyphForCodePoint("龙".codePointAt(0)!)).toBe(false);
    expect((await readFile(join(dir, "preview.png"))).subarray(1, 4).toString()).toBe("PNG");
  }, 120_000);
});
