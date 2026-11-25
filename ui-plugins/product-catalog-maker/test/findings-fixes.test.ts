import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mkclient } from "./_mkclient.ts";

describe("TEST-FINDINGS #9: project_save warns about bad referenced files", () => {
  it("lists an empty table and a fake logo, and nothing for good files", async () => {
    const { root, call, text } = await mkclient("pcm-");
    writeFileSync(join(root, "空.csv"), "");
    writeFileSync(join(root, "logo.png"), "not a png");
    writeFileSync(join(root, "商品.csv"), "名称,价格\n茶杯,19\n");
    const bad = await call("project_save", { path: "秋季", project: { table: "空.csv", imageDir: ".", style: { logo: "logo.png" } } });
    expect(bad.isError, text(bad)).toBeFalsy();
    expect(bad.structuredContent.warnings).toEqual(["Table 空.csv is empty (0 bytes)", "Logo logo.png does not look like a .png file"]);
    const good = await call("project_save", { path: "冬季", project: { table: "商品.csv", imageDir: "." } });
    expect(good.structuredContent.warnings).toEqual([]);
  });
});
