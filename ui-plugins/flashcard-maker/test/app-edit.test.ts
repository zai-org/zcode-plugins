import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp, resolveColumnKey, type AppDef } from "../src/kit/app.ts";
import { connect } from "../src/kit/testing.ts";

// 回归测试：<x>_edit 的 set.values 用列标题（如“月薪”）也要能改到对应的列；认不出的列名要明确警告，不能悄悄忽略。
const cols = [
  { key: "c0", label: ["姓名", "Name"] as [string, string] },
  { key: "c1", label: ["月薪", "Monthly Salary"] as [string, string], type: "number" as const },
  { key: "c2", label: ["合计", "Total"] as [string, string], readOnly: true },
];
const def: AppDef = {
  name: "edit-test", version: "0.0.1", prefix: "et", title: ["测试", "Test"], openDescription: "test",
  inputs: { exts: [".csv"], min: 0, max: 1, label: ["", ""] },
  settings: [],
  columns: () => cols,
  newRow: () => ({ c0: "", c1: 0, c2: 0 }),
  load: async () => ({ rows: [{ c0: "张三", c1: 8000, c2: 0 }, { c0: "李四", c1: 9000, c2: 0 }] }),
  compute: (p) => ({ rows: p.rows, issues: [], summary: `${p.rows.length} rows`, stats: {} }),
  exports: [{ id: "none", label: ["无", "None"], description: "nothing", run: async () => [] }],
};

describe("edit by column label", () => {
  it("resolves keys, labels and loose labels", () => {
    expect(resolveColumnKey(cols, "c1")).toBe("c1");
    expect(resolveColumnKey(cols, "月薪")).toBe("c1");
    expect(resolveColumnKey(cols, " 月 薪 ")).toBe("c1");
    expect(resolveColumnKey(cols, "monthly salary")).toBe("c1");
    expect(resolveColumnKey(cols, "Name")).toBe("c0");
    expect(resolveColumnKey(cols, "奖金")).toBeUndefined();
    expect(resolveColumnKey(cols, "hidden", { hidden: 1 })).toBe("hidden");
  });
  it("edits through the tool and warns about unknown keys", async () => {
    const root = mkdtempSync(join(tmpdir(), "edit-"));
    const c = await connect(createApp(def, { workspaceRoot: root, assetRoot: root }).server);
    await c.call("et_open", { inputs: [], project: "p" });
    const e = await c.call("et_edit", { project: "p", set: [{ row: 0, values: { 月薪: "12000", " monthly salary ": 1 } }, { row: 1, values: { 姓名: "王五", 奖金: 500, Total: 1 } }], add: [{ Name: "赵六", 月薪: 7000, foo: 1 }] });
    const rows = e.data.rows as Record<string, unknown>[];
    expect(rows[0].c1).toBe(1);
    expect(rows[1]).toMatchObject({ c0: "王五", c1: 9000, c2: 0 });
    expect(rows[1]).not.toHaveProperty("奖金");
    expect(rows[2]).toMatchObject({ c0: "赵六", c1: 7000 });
    expect(rows[2]).not.toHaveProperty("foo");
    expect(e.text).toContain("Warning: ignored unknown column(s) “奖金”, “foo”");
    expect(e.text).toContain("c1 (月薪 / Monthly Salary)");
    expect(e.text).toContain("c2 is calculated and cannot be edited.");
  });
});
