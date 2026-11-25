import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mkclient } from "./_mkclient.ts";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");

describe("TEST-FINDINGS #8: save_output needs a real model", () => {
  it("rejects missing, empty and damaged models and empty data without writing anything", async () => {
    const { root, call, text } = await mkclient("p3d-");
    mkdirSync(join(root, "模型"));
    writeFileSync(join(root, "模型/空.glb"), "");
    writeFileSync(join(root, "模型/坏.glb"), randomBytes(2048));
    for (const [model, code] of [["模型/不存在.glb", "not_found"], ["模型/空.glb", "bad_model"], ["模型/坏.glb", "bad_model"]]) {
      const r = await call("save_output", { settings: { model }, name: "front.png", data: PNG.toString("base64") });
      expect(r.isError, model).toBe(true);
      expect(text(r)).toContain(code);
    }
    expect(existsSync(join(root, "showcase"))).toBe(false);
  });
});
