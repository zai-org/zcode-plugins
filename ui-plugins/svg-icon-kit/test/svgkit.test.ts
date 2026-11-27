import { cp, mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";
import { cleanSvg, component, componentName, kebab, parseXml, prefixIds, serialize, sprite } from "../src/svg.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const O = { mode: "auto" as const, precision: 2, square: true, keepTitle: false };

describe("svg", () => {
  it("parses and serialises", () => {
    const d = parseXml(`<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "y">]><svg a='1' b="&amp;&lt;"><g/><text>R&amp;D</text><style><![CDATA[.a{fill:red}]]></style></svg>`);
    expect(serialize(d.children[0] as never)).toBe(`<svg a="1" b="&amp;&lt;"><g/><text>R&amp;D</text><style><![CDATA[.a{fill:red}]]></style></svg>`);
  });
  it("cleans editor output and makes it currentColor", () => {
    const src = `<svg xmlns:inkscape="x" xmlns="http://www.w3.org/2000/svg" width="24px" height="24" id="svg8" inkscape:version="1"><metadata/><g id="l"><path id="p" style="fill:#333;stroke:none;-inkscape-font-specification:x" d="M 1.23456,2 L 3,4"/></g></svg>`;
    const c = cleanSvg(src, O);
    expect(serialize(c.svg)).toBe(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M 1.23,2 L 3,4" fill="currentColor" stroke="none"/></svg>`);
    expect(c.notes).toContain("viewBox added from width/height");
    expect(c.colors).toEqual(["#333333"]);
    const d = (x: string) => /d="([^"]*)"/.exec(serialize(cleanSvg(`<svg viewBox="0 0 1 1"><path d="${x}"/></svg>`, { ...O, mode: "keep" }).svg))![1];
    expect(d("c1.74 0 3.41.81 4.5 2.09")).toBe("c1.74 0 3.41.81 4.5 2.09");
    expect(d("M1 3.999.5 2")).toBe("M1 4 .5 2");
    expect(d("M0.25 0.0001.5")).toBe("M.25 0 .5");
  });
  it("keeps multi-colour icons, removes unsafe bits, pads to square", () => {
    const c = cleanSvg(`<svg viewBox="0 0 20 10"><path fill="red" onclick="x()" d="M0 0"/><path fill="#00f" d="M1 1"/><script>x()</script></svg>`, O);
    expect(c.applied).toBe("keep");
    expect(c.viewBox).toBe("0 -5 20 20");
    expect(serialize(c.svg)).not.toMatch(/onclick|script/);
    expect(c.removed).toEqual(expect.arrayContaining(["<script> (unsafe)", "on* handlers (unsafe)"]));
    const r = cleanSvg(`<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>`, { ...O, mode: "recolor", recolor: "#2563EB" });
    expect(serialize(r.svg)).toContain(`fill="#2563EB"`);
  });
  it("prefixes ids for the sprite and converts to JSX", () => {
    const c = cleanSvg(`<svg viewBox="0 0 24 24" xmlns:xlink="x"><defs><linearGradient id="a"><stop stop-color="#fff"/></linearGradient></defs><rect fill="url(#a)" stroke-width="2" xlink:href="#a"/></svg>`, { ...O, mode: "keep" });
    const sp = sprite([{ id: "icon-star", svg: c.svg }]);
    expect(sp).toContain(`<symbol id="icon-star" viewBox="0 0 24 24"><defs><linearGradient id="icon-star-a">`);
    expect(sp).toContain(`fill="url(#icon-star-a)"`);
    expect(serialize(prefixIds(c.svg, "z"))).toContain(`href="#z-a"`);
    const jsx = component("star", c.svg, true, 24);
    expect(jsx).toContain("export function IconStar(");
    expect(jsx).toContain(`strokeWidth="2"`);
    expect(jsx).toContain(`stopColor="#fff"`);
    expect(kebab("icons/Star Badge.svg")).toBe("star-badge");
    expect(kebab("arrowLeft.svg")).toBe("arrow-left");
    expect(kebab("购物车.svg")).toBe("");
    expect(componentName("1-arrow")).toBe("Icon1Arrow");
  });
});

describe("tools", () => {
  it("opens a folder, edits and exports", async () => {
    const root = await mkdtemp(join(tmpdir(), "svgkit-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const r0 = await c.call("svgkit_open", { inputs: ["icons"], project: "t" });
    const rows = r0.data.rows as Record<string, unknown>[];
    expect(rows.map((r) => r.name)).toEqual(["heart", "home", "search", "settings", "star-badge"]);
    expect(rows.map((r) => String(r.notes).split(";")[0])).toEqual(["→ currentColor", "→ currentColor", "→ currentColor", "→ currentColor", "colours kept"]);
    expect(rows[0].viewBox).toBe("0 -1 20 20");
    expect(rows[1].colors).toBe("#333333");
    expect(r0.data.stats).toMatchObject({ icons: 5, currentColor: 4, kept: 1 });
    expect(Number(r0.data.stats.after)).toBeLessThan(Number(r0.data.stats.before) * 0.8);
    // 重名报错
    await c.call("svgkit_edit", { project: "t", set: [{ row: 1, values: { name: "heart" } }] });
    const r1 = await c.call("svgkit_status", { project: "t" });
    expect(JSON.stringify(r1.data.issues)).toContain("used twice");
    await expect(c.call("svgkit_export", { project: "t" })).rejects.toThrow(/used twice/);
    await c.call("svgkit_edit", { project: "t", set: [{ row: 1, values: { name: "house" } }, { row: 0, values: { recolor: "#E11D48" } }, { row: 3, values: { include: false } }] });
    const r2 = await c.call("svgkit_export", { project: "t" });
    expect(r2.data.issues ?? []).toEqual([]);
    const out = join(root, "svg-icon-kit", "t");
    expect((await readdir(join(out, "optimized"))).sort()).toEqual(["heart.svg", "house.svg", "search.svg", "star-badge.svg"]);
    expect(String(await readFile(join(out, "optimized/heart.svg")))).toBe(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -1 20 20"><path fill="#E11D48" d="M10 17.5 8.55 16.2C3.4 11.5 0 8.4 0 4.6 0 1.5 2.4 0 5.5 0c1.74 0 3.41.81 4.5 2.09C11.09.81 12.76 0 14.5 0 17.58 0 20 1.5 20 4.6c0 3.8-3.4 6.9-8.55 11.6z"/></svg>\n`);
    const spr = String(await readFile(join(out, "sprite.svg")));
    expect(spr.match(/<symbol /g)).toHaveLength(4);
    expect(spr).toContain(`<symbol id="icon-house" viewBox="0 0 24 24"><path d="M 12,3.2 L 2.4,11.6 h 3 v 9.2 h 5 v -6 h 3.2 v 6 h 5 V 11.6 H 21.6 Z" fill="currentColor" stroke="none"/></symbol>`);
    expect(spr).toContain(`<symbol id="icon-search" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"`);
    expect(spr).toContain(`id="icon-star-badge-a"`);
    expect((await readdir(join(out, "components"))).sort()).toEqual(["IconHeart.tsx", "IconHouse.tsx", "IconSearch.tsx", "IconStarBadge.tsx", "index.ts"]);
    expect(String(await readFile(join(out, "components/IconSearch.tsx")))).toContain(`strokeLinecap="round"`);
    const html = String(await readFile(join(out, "index.html")));
    expect(html).toContain(`<use href="#icon-house"/>`);
    expect(html).not.toContain("settings");
    expect(String(await readFile(join(out, "icons.csv")))).toContain("house,icon-house,IconHouse,icons/home.svg,currentColor,0 0 24 24");
  });
});
