import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mkclient } from "./_mkclient.ts";

describe("TEST-FINDINGS #9: template_save warns about bad referenced files", () => {
  it("still saves, but lists missing / empty / wrong-format files under Check:", async () => {
    const { root, call, text } = await mkclient("pff-");
    writeFileSync(join(root, "空 报名表.pdf"), "");
    writeFileSync(join(root, "名单.csv"), randomBytes(64).fill(0));
    writeFileSync(join(root, "好.pdf"), "%PDF-1.4\n%%EOF\n");
    writeFileSync(join(root, "好.csv"), "姓名\n张三\n");
    const fields = [{ id: "name", kind: "acro", name: "name", source: "{姓名}" }];
    const bad = await call("template_save", { path: "冬季班", template: { pdf: "空 报名表.pdf", roster: "名单.csv", fields } });
    expect(bad.isError, text(bad)).toBeFalsy();
    expect(text(bad)).toContain("Check:");
    expect(bad.structuredContent.warnings).toEqual(["PDF 空 报名表.pdf is empty (0 bytes)", "Roster 名单.csv does not look like a .csv file"]);
    const missing = await call("template_save", { path: "x", template: { pdf: "不存在.pdf", roster: "好.csv", fields } });
    expect(missing.structuredContent.warnings).toEqual(["PDF 不存在.pdf not found"]);
    const good = await call("template_save", { path: "y", template: { pdf: "好.pdf", roster: "好.csv", fields } });
    expect(good.structuredContent.warnings).toEqual([]);
    expect(text(good)).not.toContain("Check:");
  });
});
