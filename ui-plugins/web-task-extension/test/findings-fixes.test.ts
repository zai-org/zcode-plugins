import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIELD_NAME } from "../src/task.ts";
import { mkclient } from "./_mkclient.ts";

describe("DRYRUN #29: Chinese column names in extract.fields", () => {
  it("accepts CJK/Latin names with and without the u flag, rejects punctuation and over-long names", () => {
    const noU = new RegExp(FIELD_NAME.source);
    const withU = new RegExp(FIELD_NAME.source, "u");
    for (const ok of ["书名", "价格", "Price", "库存 数量", "評価", "가격", "item_id", "名称-2"]) { expect(noU.test(ok), ok).toBe(true); expect(withU.test(ok), ok).toBe(true); }
    for (const bad of ["", "价格{{x}}", "a/b", "名".repeat(41), "😀"]) expect(noU.test(bad), bad).toBe(false);
  });
  it("ext_new builds an extension with 书名/价格 columns", async () => {
    const { root, call, text } = await mkclient("wte-");
    const r = await call("ext_new", {
      name: "图书价格导出",
      sites: ["https://books.toscrape.com/*"],
      steps: [
        { action: "open", url: "https://books.toscrape.com/" },
        { action: "extract", selector: "article.product_pod", fields: { 书名: "h3 a@title", 价格: ".price_color" } },
        { action: "download", format: "csv" },
      ],
    });
    expect(r.isError, text(r)).toBeFalsy();
    const out = r.structuredContent?.saved?.out ?? r.structuredContent?.out;
    const task = JSON.parse(readFileSync(join(root, out, "task.json"), "utf8"));
    expect(Object.keys(task.steps[1].fields)).toEqual(["书名", "价格"]);
  });
});
