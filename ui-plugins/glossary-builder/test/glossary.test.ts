import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { findPairs } from "../src/terms.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("pairs", () => {
  it("reads in-text translations", () => {
    expect(findPairs("会员积分（Loyalty Points）是奖励")).toEqual([{ zh: "会员积分", en: "Loyalty Points" }]);
    expect(findPairs("地址会提示改为到店自提（Pickup）")).toEqual([{ zh: "到店自提", en: "Pickup" }]);
    expect(findPairs("Use the Coupon (优惠券) here")).toEqual([{ zh: "优惠券", en: "Coupon" }]);
  });
});

describe("tools", () => {
  it("extracts terms, merges the old glossary and exports", async () => {
    const root = await mkdtemp(join(tmpdir(), "gl-"));
    await cp(join(HERE, "samples"), join(root, "work"), { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("glossary_open", { inputs: ["work/docs"], project: "tea" });
    const rows = o.data.rows as { term: string; translation: string }[];
    const tr = (t: string) => rows.find((r) => r.term === t)?.translation;
    expect(tr("会员积分")).toBe("Loyalty Points");
    expect(tr("优惠券")).toBe("Coupon");
    expect(tr("外卖配送")).toBe("Delivery");
    expect(tr("门店")).toBe("Store");
    expect(o.text).toMatch(/储值卡: the old glossary says “Prepaid Card” but the documents use “Stored Value Card”/);
    expect(rows.some((r) => r.term === "Loyalty Points")).toBe(false);
    const at = (t: string) => rows.findIndex((r) => r.term === t);
    const e = await c.call("glossary_edit", { project: "tea", set: [{ row: at("储值卡"), values: { 译文: "Stored Value Card" } }, { row: at("安全库存"), values: { translation: "Safety Stock", note: "按 7 天平均销量" } }], add: [{ term: "满减", translation: "Spend-and-save" }] });
    expect(e.text).not.toMatch(/old glossary says/);
    await c.call("glossary_export", { project: "tea" });
    const dir = join(root, "glossary-builder/tea");
    const tbx = await readFile(join(dir, "glossary.tbx"), "utf8");
    expect(tbx).toContain('<langSet xml:lang="zh"><tig><term>安全库存</term></tig></langSet>');
    expect(tbx).toContain("<term>Safety Stock</term>");
    expect(await readFile(join(dir, "glossary.csv"), "utf8")).toContain('"满减","Spend-and-save"');
    expect(await readFile(join(dir, "glossary.md"), "utf8")).toContain("| 储值卡 | Stored Value Card |");
    expect((await readFile(join(dir, "glossary.xlsx"))).subarray(0, 2).toString()).toBe("PK");
  }, 60_000);
});
