import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mkclient } from "./_mkclient.ts";

describe("TEST-FINDINGS #6: email_new with dir pointing at a file", () => {
  it("returns not_a_folder instead of EEXIST", async () => {
    const { root, call, text } = await mkclient("etb-file-");
    writeFileSync(join(root, "设计.pdf"), "x");
    for (const dir of ["设计.pdf", "设计.pdf/sub"]) {
      const r = await call("email_new", { name: `订单 ${dir.length}`, dir });
      expect(r.isError).toBe(true);
      expect(text(r)).toContain("not_a_folder");
      expect(text(r)).not.toMatch(/EEXIST|ENOTDIR|internal_error/);
    }
    const ok = await call("email_new", { name: "订单已发货", dir: "emails/中文 目录" });
    expect(ok.isError, text(ok)).toBeFalsy();
  });
});
