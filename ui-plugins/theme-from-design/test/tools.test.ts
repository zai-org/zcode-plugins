import { cp, mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { unzipSync } from "fflate";
import { beforeAll, describe, expect, it } from "vitest";
import { makeEngine } from "../src/liquid.ts";
import { createServer } from "../src/server.ts";
import { skeleton } from "../src/skeleton.ts";
import { Theme, builtinCheck, renderPreview } from "../src/theme.ts";

// 虚构品牌 Hearth & Bean 的设计稿（samples/theme/hearth-bean-home.png）和“Agent 按设计稿写的” sections（samples/theme/agent）。
const SAMPLES = process.env.THEME_SAMPLES ?? "/workspace/zcode-new-plugins/samples/theme";
let workspace: string;
let client: Client;
const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args }, undefined, { timeout: 300_000 })) as any;
const theme = (extra: Record<string, string> = {}) => new Theme(new Map(Object.entries({ ...skeleton({ name: "T" }), ...extra })));

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "theme-"));
  await cp(SAMPLES, join(workspace, "design"), { recursive: true });
  const server = createServer({ workspaceRoot: workspace, assetRoot: join(import.meta.dirname, "../dist") });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: "t", version: "1" });
  await client.connect(b);
});

describe("skeleton, checks and preview", () => {
  it("the skeleton passes the built-in checks and renders every template", () => {
    const t = theme();
    expect(builtinCheck(t)).toEqual([]);
    for (const tpl of ["index", "product", "collection", "page", "cart", "search", "404"]) {
      const r = renderPreview(t, tpl);
      expect(r.errors).toEqual([]);
      expect(r.html).toContain("<main id=\"MainContent\"");
    }
    const p = renderPreview(t, "product").html;
    expect(p).toContain("Linen Shirt");
    expect(p).toContain("$59.00");
    expect(p).toContain("Add to cart");
    expect(p).toMatch(/<style data-asset="base.css">\*,\*::before/);
    expect(renderPreview(t, "cart").html).toContain("$95.00");
    expect(renderPreview(t, "index", "zh-CN").html).toContain("购物车");
  });
  it("supports Shopify tags in liquidjs", () => {
    const files = new Map([["snippets/x.liquid", "[{{ v }}]"]]);
    const e = makeEngine({ get: (p) => files.get(p), has: (p) => files.has(p), keys: () => files.keys() });
    expect(e.parseAndRenderSync("{% render 'x', v: 2 %}{% style %}a{color:red}{% endstyle %}{% schema %}{\"name\":\"x\"}{% endschema %}{{ 1999 | money }}")).toBe("[2]<style data-shopify>a{color:red}</style>$19.99");
    expect(e.parseAndRenderSync("{% paginate items by 2 %}{{ paginate.pages }}{% endpaginate %}", { items: [1, 2, 3] })).toBe("2");
    expect(e.parseAndRenderSync("{% form 'product', p %}x{% endform %}")).toContain('action="/cart/add"');
  });
  it("finds schema, setting and template problems", () => {
    const bad = theme({
      "sections/promo.liquid": "<h2>{{ section.settings.title }}</h2>{% for block in section.blocks %}{{ block.settings.nope }}{% endfor %}\n{% schema %}{\"name\":\"A very long section name over 25\",\"settings\":[{\"type\":\"liquid\",\"id\":\"code\",\"label\":\"x\"},{\"type\":\"range\",\"id\":\"r\",\"label\":\"r\",\"min\":0,\"max\":1000,\"step\":1,\"default\":5},{\"type\":\"select\",\"id\":\"s\",\"label\":\"s\",\"options\":[{\"value\":\"a\",\"label\":\"A\"}],\"default\":\"b\"}],\"blocks\":[{\"type\":\"b\",\"name\":\"B\",\"settings\":[]}]}{% endschema %}",
      "templates/page.about.json": JSON.stringify({ sections: { m: { type: "missing-thing" }, p: { type: "promo", settings: { ghost: 1 }, blocks: { x: { type: "zzz" } }, block_order: ["x", "y"] } }, order: ["m", "p", "q"] }),
      "sections/broken.liquid": "{% if x %}",
    });
    const checks = builtinCheck(bad).map((i) => `${i.file}:${i.check}`);
    expect(checks).toEqual(expect.arrayContaining([
      "sections/promo.liquid:ValidSchema", "sections/promo.liquid:SettingType", "sections/promo.liquid:SettingDefault", "sections/promo.liquid:UndefinedSetting",
      "templates/page.about.json:MissingSection", "templates/page.about.json:UnknownSetting", "templates/page.about.json:UnknownBlock", "templates/page.about.json:ValidJSONTemplate",
      "sections/broken.liquid:LiquidSyntax",
    ]));
    expect(builtinCheck(bad).filter((i) => i.check === "SettingDefault")).toHaveLength(2);
  });
});

describe("tools", () => {
  it("builds the Hearth & Bean theme from the design, checks it with theme-check and packages it", async () => {
    const r = await call("theme_new", { name: "Hearth & Bean", design: ["design/hearth-bean-home.png"], colors: { background: "#f6f1e7", text: "#2b2118", accent: "#2f5d50", accentText: "#ffffff", muted: "#7a6a58" }, fonts: { heading: "playfair_display_n7", body: "lora_n4" }, radius: 16 });
    expect(r.isError).toBeFalsy();
    expect(r.content[0].text).toMatch(/0 error\(s\), 0 warning\(s\) \(built-in checks \+ Shopify theme-check\)/);
    expect((await call("theme_new", { name: "Hearth & Bean" })).content[0].text).toMatch(/already has a theme/);

    const files: Record<string, string> = {};
    for (const d of ["sections", "templates", "assets"]) for (const f of await readdir(join(workspace, "design/agent", d))) if (!f.startsWith("broken")) files[`${d}/${f}`] = await readFile(join(workspace, "design/agent", d, f), "utf8");
    const en = JSON.parse(await readFile(join(workspace, "themes/hearth-bean/locales/en.default.json"), "utf8"));
    en.newsletter = { email: "Email address", subscribe: "Subscribe", thanks: "Thanks for subscribing!" };
    files["locales/en.default.json"] = JSON.stringify(en, null, 2);
    const w = await call("theme_write", { files });
    expect(w.content[0].text).toMatch(/Built-in checks pass/);

    // theme-check 发现 zh-CN 缺翻译
    const c1 = await call("theme_check", {});
    expect(c1.content[0].text).toMatch(/theme-check MatchingTranslations\] The translation for 'newsletter.email' is missing/);
    expect((await call("theme_package", {})).content[0].text).toMatch(/Fix them first/);
    const zh = JSON.parse(await readFile(join(workspace, "themes/hearth-bean/locales/zh-CN.json"), "utf8"));
    zh.newsletter = { email: "邮箱地址", subscribe: "订阅", thanks: "感谢订阅！" };
    await call("theme_write", { files: { "locales/zh-CN.json": JSON.stringify(zh, null, 2) } });

    // 写坏一个 section：语法、设置类型、未定义设置
    const broken = await call("theme_write", { files: { "sections/broken-promo.liquid": await readFile(join(workspace, "design/agent/sections/broken-promo.liquid"), "utf8") } });
    expect(broken.content[0].text).toMatch(/LiquidSyntax.*not closed/);
    expect(broken.content[0].text).toMatch(/setting type “liquid”/);
    expect(broken.content[0].text).toMatch(/section.settings.title is not defined/);
    const c2 = await call("theme_check", {});
    expect(c2.content[0].text).toMatch(/theme-check LiquidHTMLSyntaxError/);
    await call("theme_write", { delete: ["sections/broken-promo.liquid"] });
    expect((await call("theme_write", { files: { "../evil.liquid": "x" } })).content[0].text).toMatch(/theme files live in/);

    const c3 = await call("theme_check", {});
    expect(c3.content[0].text).toMatch(/^0 error\(s\), 0 warning\(s\)/);
    const pv = await call("theme_preview", { template: "index" });
    expect(pv.structuredContent.errors).toEqual([]);
    for (const s of ["Coffee worth slowing down for", "Direct trade", "This week&#39;s roasts", "Join the roast list", "button--secondary", "--color-accent: #2f5d50", "Playfair Display"]) expect(pv.structuredContent.html).toContain(s);

    const pk = await call("theme_package", {});
    expect(pk.isError).toBeFalsy();
    const zip = unzipSync(new Uint8Array(await readFile(join(workspace, "themes/hearth-bean.zip"))));
    const names = Object.keys(zip);
    expect(names).toEqual(expect.arrayContaining(["layout/theme.liquid", "config/settings_schema.json", "templates/index.json", "sections/hero-split.liquid", "sections/header-group.json", "locales/zh-CN.json", "assets/custom.css"]));
    expect(names.every((n) => !n.startsWith("themes/") && !n.startsWith("."))).toBe(true);
    const settings = JSON.parse(new TextDecoder().decode(zip["config/settings_schema.json"]));
    expect(settings[0]).toMatchObject({ name: "theme_info", theme_name: "Hearth & Bean" });
  });
});
