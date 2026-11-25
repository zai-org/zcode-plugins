import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { looksLikeText, readDoc } from "../src/docs.ts";

const DIST = join(import.meta.dirname, "../dist");
const enc = (s: string) => new TextEncoder().encode(s);

describe("TEST-FINDINGS #7: binary files named .md/.txt are rejected", () => {
  it("flags binary and wrongly-encoded bytes, accepts real CJK text", async () => {
    const bin = new Uint8Array(randomBytes(4096));
    await expect(readDoc("报告.md", bin, DIST)).rejects.toMatchObject({ code: "bad_text" });
    const gbk = new Uint8Array(Buffer.from("c4e3bac3cac0bde7".repeat(50), "hex")); // “你好世界” in GBK
    await expect(readDoc("报告.txt", gbk, DIST)).rejects.toMatchObject({ code: "bad_text" });
    const ok = enc("# 能源简报\n\n电池储能装机翻了一番，达到 16 GW [2]。😀\n");
    expect(looksLikeText(ok, new TextDecoder().decode(ok))).toBe(true);
    const d = await readDoc("报告.md", ok, DIST);
    expect(d.blocks.some((b) => b.text.includes("16 GW"))).toBe(true);
    expect((await readDoc("空.md", new Uint8Array(), DIST)).blocks).toEqual([]);
  });
});
