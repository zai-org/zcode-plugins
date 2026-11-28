import { cp, mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { formatBase, nice, parseIng, parseQty, roundCount, stepMinutes } from "../src/recipe.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("parsing", () => {
  it("reads amounts", () => {
    expect(parseQty("1 1/2")).toBe(1.5);
    expect(parseQty("1½")).toBe(1.5);
    expect(parseQty("两")).toBe(2);
    expect(parseQty("十二")).toBe(12);
    expect(parseQty("适量")).toBeUndefined();
    expect(parseQty("两三")).toBeNull();
  });
  it("reads ingredient lines", () => {
    expect(parseIng("- 五花肉 500 g（切块）")).toMatchObject({ item: "五花肉", qty: "500", unit: "g", note: "切块" });
    expect(parseIng("- 冰糖 30g")).toMatchObject({ item: "冰糖", qty: "30", unit: "g" });
    expect(parseIng("- 盐 半茶匙")).toMatchObject({ item: "盐", qty: "半", unit: "茶匙" });
    expect(parseIng("- 1 1/2 cups all-purpose flour")).toMatchObject({ item: "all-purpose flour", qty: "1 1/2", unit: "cups" });
    expect(parseIng("- 3 tbsp butter, melted")).toMatchObject({ item: "butter", qty: "3", unit: "tbsp", note: "melted" });
    expect(parseIng("- 2 large eggs")).toMatchObject({ item: "large eggs", qty: "2", unit: "" });
  });
  it("rounds and formats", () => {
    expect(nice(2.25)).toBe("2 1/4");
    expect(roundCount(4.5, "鸡蛋")).toBe(5);
    expect(roundCount(2.6, "葱")).toBe(2.5);
    expect(formatBase(750, "mass", "metric", true)).toBe("750 克");
    expect(formatBase(45, "vol", "metric", true)).toBe("3 汤匙");
    expect(formatBase(360, "vol", "us", false)).toBe("1 1/2 cup");
    expect(stepMinutes(["焯水 5 分钟", "炖 50 分钟", "rest 1 hour"])).toBe(115);
  });
});

describe("tools", () => {
  it("scales three recipes into one shopping list", async () => {
    const root = await mkdtemp(join(tmpdir(), "rc-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("recipe_open", { inputs: ["recipes"], project: "party" });
    expect(o.text).toMatch(/3 recipe\(s\)/);
    expect(o.text).toMatch(/番茄炒蛋: the recipe doesn't say how many it serves/);
    expect(o.text).toMatch(/红烧肉: “生抽” is listed twice/);
    expect(o.text).toMatch(/unknown unit “tspn”/);
    expect(o.text).toMatch(/八角 isn't mentioned in the steps/);
    expect(o.text).toMatch(/vanilla extract isn't mentioned in the steps/);
    expect(o.text).not.toMatch(/食用油 isn't mentioned/);
    expect(o.text).toContain("红烧肉 · 五花肉 500 g → 500 g (切 3 厘米方块)");
    const rows = (await c.call("recipe_status", { project: "party" })).data.rows as Record<string, string>[];
    const at = (rec: string, item: string) => rows.findIndex((r) => r.recipe === rec && r.item === item);
    const hdr = (rec: string) => rows.findIndex((r) => r._type === "菜谱" && r.recipe === rec);
    await c.call("recipe_edit", { project: "party", set: [
      { row: hdr("红烧肉"), values: { servings: 6 } }, { row: hdr("番茄炒蛋"), values: { base: 2, servings: 6 } }, { row: hdr("Fluffy Pancakes"), values: { servings: 6 } },
      { row: at("Fluffy Pancakes", "baking powder"), values: { unit: "tsp" } }, { row: at("红烧肉", "生抽"), values: { qty: "3" } },
    ], settings: { system: "metric", pantry: "盐、食用油", title: "周六家宴" } });
    const dup = (await c.call("recipe_status", { project: "party" })).data.rows as Record<string, string>[];
    const second = dup.findIndex((r, i) => r.recipe === "红烧肉" && r.item === "生抽" && i !== at("红烧肉", "生抽"));
    await c.call("recipe_edit", { project: "party", set: [{ row: second, values: { include: false } }] });
    const st = await c.call("recipe_status", { project: "party" });
    expect(st.text).not.toMatch(/doesn't say|listed twice|unknown unit/);
    const r2 = st.data.rows as Record<string, string>[];
    expect(r2[at("红烧肉", "五花肉")]._scaled).toBe("750 克");
    expect(r2[at("红烧肉", "生抽")]._scaled).toBe("4 1/2 汤匙");
    expect(r2[at("番茄炒蛋", "鸡蛋")]._scaled).toBe("9 个");
    expect(r2[at("Fluffy Pancakes", "all-purpose flour")]._scaled).toBe("540 ml");
    expect(r2[at("Fluffy Pancakes", "large eggs")]._scaled).toBe("3");
    expect(st.text).toMatch(/shopping list \d+ item\(s\), 2 already at home/);
    await c.call("recipe_export", { project: "party" });
    expect((await readdir(join(root, "recipe-scaler/party"))).sort()).toEqual(["recipe-cards.pdf", "recipes-scaled.md", "shopping-list.csv", "shopping-list.pdf"]);
    const csv = await readFile(join(root, "recipe-scaler/party/shopping-list.csv"), "utf8");
    expect(csv).toMatch(/肉禽蛋,鸡蛋,12 个,(Fluffy Pancakes、番茄炒蛋|番茄炒蛋、Fluffy Pancakes)/);
    expect(csv).toMatch(/调料,盐,.*,是/);
    expect(csv).toMatch(/蔬菜水果,葱,6 根/);
  }, 120_000);
});
