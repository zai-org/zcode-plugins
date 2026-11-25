import { writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mkclient } from "./_mkclient.ts";

describe("TEST-FINDINGS #9: project_save warns about bad photos", () => {
  it("lists empty and fake photos, and nothing for a real JPG", async () => {
    const { root, call, text } = await mkclient("pps-");
    writeFileSync(join(root, "空.jpg"), "");
    writeFileSync(join(root, "假.png"), "hello");
    copyFileSync(join(import.meta.dirname, "fixtures/perfume.jpg"), join(root, "香水 图.jpg"));
    const r = await call("project_save", { path: "批次", project: { images: [{ path: "空.jpg" }, { path: "假.png" }, { path: "香水 图.jpg" }] } });
    expect(r.isError, text(r)).toBeFalsy();
    expect(r.structuredContent.warnings).toEqual(["Photo 空.jpg is empty (0 bytes)", "Photo 假.png does not look like a .png file"]);
  });
});
