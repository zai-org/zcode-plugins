import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";
import { contrast, nearestPassing, parseColor, required, toHex } from "../src/wcag.ts";
import { guessPairs, parseCss, resolveAll } from "../src/tokens.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("wcag", () => {
  it("parses colours, computes ratios and finds the nearest passing colour", () => {
    expect(parseColor("#abc")).toEqual([170, 187, 204, 1]);
    expect(parseColor("rgb(255 0 0 / 50%)")).toEqual([255, 0, 0, 0.5]);
    expect(parseColor("hsl(0, 0%, 100%)")!.slice(0, 3).map(Math.round)).toEqual([255, 255, 255]);
    expect(parseColor("white")).toEqual([255, 255, 255, 1]);
    expect(parseColor("var(--x)")).toBe(null);
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrast([0x76, 0x76, 0x76], [255, 255, 255])).toBeCloseTo(4.54, 2);
    expect(required("normal", "AA")).toBe(4.5);
    expect(required("large", "AAA")).toBe(4.5);
    expect(required("ui", "AAA")).toBe(3);
    const fix = nearestPassing([0xa8, 0xa2, 0x9e], [255, 255, 255], 4.505)!;
    expect(contrast(fix, [255, 255, 255])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(fix, [255, 255, 255])).toBeLessThan(4.7);
    expect(toHex(nearestPassing([0x57, 0x53, 0x4e], [0x1c, 0x19, 0x17], 4.505)!)).toMatch(/^#[89a]/);
  });
  it("reads CSS variables, rules and references and guesses pairs", () => {
    const p = parseCss("a.css", ":root{--bg:#fff;--text:#777;--btn-bg:var(--brand);--brand:#0a7;--btn-text:#fff}\n.x{color:red;background:#000 url(a.png)}\n$ink: #333;");
    expect(p.decls.map((d) => d.name)).toEqual(["$ink", "--bg", "--text", "--btn-bg", "--brand", "--btn-text"]);
    expect(p.rules).toMatchObject([{ selector: ".x", fg: "red", bg: "#000 url(a.png)" }]);
    const { resolveExpr } = resolveAll(p.decls);
    expect(resolveExpr(":root", "var(--btn-bg)")).toMatchObject({ color: [0, 170, 119, 1], origin: { name: "--brand" } });
    expect(resolveExpr(":root", "#000 url(a.png)").color).toEqual([0, 0, 0, 1]);
    expect(guessPairs(["--bg", "--text", "--btn-bg", "--btn-text", "--brand"])).toEqual([["--text", "--bg"], ["--btn-text", "--btn-bg"]]);
  });
});

describe("tools", () => {
  it("checks tokens, fixes failing pairs and writes fixed copies", async () => {
    const root = await mkdtemp(join(tmpdir(), "cc-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const r0 = await c.call("contrast_open", { inputs: ["theme"], project: "t" });
    const rows = r0.data.rows as Record<string, unknown>[];
    const at = (scope: string, fg: string, bg: string) => rows.findIndex((r) => r.scope === scope && r.fg === fg && r.bg === bg);
    const list = rows.map((r) => `${r.scope} ${r.fg} / ${r.bg} ${r.ratio} ${r.result} ${r.fix}`);
    expect(list).toContain(":root --color-text-muted / --color-bg 2.52:1 ✗ < 4.5:1 fg");
    expect(list).toContain(":root --color-on-primary / --color-primary 2.80:1 ✗ < 4.5:1 bg");
    expect(list).toContain(".dark --color-text / --color-bg 16.03:1 ✓ AA none");
    expect(at(":root", "#FACC15", "var(--color-surface)")).toBeGreaterThanOrEqual(0);
    expect(at("tokens", "color.heading", "color.page")).toBeGreaterThanOrEqual(0);
    expect(r0.data.stats).toMatchObject({ failing: 7, pairs: 11 });
    expect(JSON.stringify(r0.data.issues)).toContain("not in a variable");
    // 链接色改成自定颜色；徽章不修
    await c.call("contrast_edit", { project: "t", set: [{ row: at(":root", "--color-link", "--color-bg"), values: { 自定颜色: "#1D4ED8" } }, { row: at(":root", "#FACC15", "var(--color-surface)"), values: { fix: "none" } }] });
    const r1 = await c.call("contrast_status", { project: "t" });
    expect(r1.data.stats).toMatchObject({ afterFixes: 2 });
    const rr = r1.data.rows as Record<string, unknown>[];
    expect(JSON.stringify(r1.data.issues)).toContain("give that theme its own value");
    expect(String(rr[at(":root", "--button-text", "--button-bg")].after)).toMatch(/^#ffffff \/ #[0-9a-f]{6} → 4\.5\d:1 ✓$/);
    await c.call("contrast_export", { project: "t" });
    const out = join(root, "color-contrast-checker", "t");
    const css = String(await readFile(join(out, "fixed/theme/tokens.css")));
    expect(css).toContain("--color-link: #1D4ED8;");
    expect(css).not.toContain("--color-text-muted: #A8A29E;");
    expect(css).toMatch(/--color-primary: #[0-9A-F]{6};/);
    expect(css).not.toContain("--color-primary: #F97316;");
    expect(css).toContain("--button-bg: var(--color-primary);");
    expect(css).toContain("color: #FACC15;");
    const json = JSON.parse(String(await readFile(join(out, "fixed/theme/tokens.json"))));
    expect(json.color.body.$value).toBe("{color.heading}");
    expect(contrast(parseColor(json.color.heading.$value)!.slice(0, 3) as never, [250, 250, 250])).toBeGreaterThanOrEqual(4.5);
    const md = String(await readFile(join(out, "contrast-report.md")));
    expect(md).toContain("`--color-link` (:root, theme/tokens.css): #3B82F6 → **#1d4ed8**");
    expect(String(await readFile(join(out, "contrast-report.csv")))).toContain("rule .badge-warning");
  });
});
