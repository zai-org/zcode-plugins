import { cp, mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { findSecrets, highlight, parseRanges } from "../src/highlight.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("highlight", () => {
  it("tokenizes code and finds secrets", () => {
    const [l] = highlight('const x = "hi"; // note', "ts");
    expect(l.map((t) => t.k)).toEqual(["keyword", "plain", "punct", "plain", "string", "punct", "plain", "comment"]);
    const py = highlight('def f():\n    """doc\n    more"""\n    return 1', "py");
    expect(py[1].at(-1)!.k).toBe("comment");
    expect(py[2][0].k).toBe("comment");
    expect(py[3].find((t) => t.t === "1")!.k).toBe("number");
    expect(parseRanges("3,5-7")).toEqual(new Set([3, 5, 6, 7]));
    expect(parseRanges("5-3")).toBeUndefined();
    expect(findSecrets('const API_KEY = "sk-live_9fK2mQx7Lr4Tz8Wb1Nc6Vd3";')).toEqual(["an API key (sk-…)"]);
    expect(findSecrets("const n = 1;")).toEqual([]);
  });
});

describe("tools", () => {
  it("flags a secret, masks it and exports images", async () => {
    const root = await mkdtemp(join(tmpdir(), "codeimg-"));
    await cp(join(HERE, "samples"), join(root, "src"), { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("codeimg_open", { inputs: ["src/pay.ts", "src/report.py"], project: "share" });
    expect(o.text).toMatch(/Line 4 of pay\.ts looks like it contains an API key/);
    expect(o.text).toMatch(/long line\(s\) wrap/);
    await c.call("codeimg_edit", { project: "share", set: [{ row: 0, values: { 起始行: 3, 结束行: 17, 高亮行: "13-16", 标题: "verify.ts" } }], add: [{ file: "src/pay.ts", from: 19, to: 23 }], settings: { redact: true, theme: "dracula" } });
    const st = await c.call("codeimg_status", { project: "share" });
    expect(st.text).toMatch(/masked in the image/);
    expect(st.data.stats).toMatchObject({ images: 3, lines: 15 + 16 + 5 });
    await c.call("codeimg_export", { project: "share" });
    const dir = join(root, "code-snippet-image/share");
    expect((await readdir(dir)).sort()).toEqual(["pay_ts-L19-23.png", "pay_ts-L19-23.svg", "pay_ts-L3-17.png", "pay_ts-L3-17.svg", "report_py.png", "report_py.svg"]);
    const svg = await readFile(join(dir, "pay_ts-L3-17.svg"), "utf8");
    expect(svg).toContain("#282a36");
    expect(svg).not.toContain("9fK2mQx7");
    expect((await readFile(join(dir, "report_py.png"))).subarray(1, 4).toString()).toBe("PNG");
  }, 60_000);
});
