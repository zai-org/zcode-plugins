import { mkdtempSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Workspace } from "../src/kit/workspace.ts";
import { readTable } from "../src/kit/table.ts";

// 回归测试：空的、损坏的 .xlsx 给出可读的 bad_xlsx，而不是 JSZip 原始报错（TEST-FINDINGS #4）
describe("damaged xlsx", () => {
  const root = mkdtempSync(join(tmpdir(), "badxlsx-"));
  writeFileSync(join(root, "空.xlsx"), "");
  writeFileSync(join(root, "坏 文件.xlsx"), randomBytes(4096));
  writeFileSync(join(root, "旧格式.xlsx"), Buffer.from("D0CF11E0A1B11AE1", "hex"));
  const ws = new Workspace(root);
  for (const f of ["空.xlsx", "坏 文件.xlsx", "旧格式.xlsx"])
    it(`explains ${f}`, async () => {
      const e = await readTable(ws, f).then(() => null, (x) => x);
      expect(e).toMatchObject({ code: "bad_xlsx" });
      expect(String(e.message)).toContain(f);
      expect(String(e.message)).not.toMatch(/jszip|central directory|Corrupted zip/i);
    });
});
