import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";
import { display, generate, hasBorrow, hasCarry, parseExpr, parseOps, parseRange, PRESETS, solve } from "../src/gen.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("generator", () => {
  it("checks carrying and borrowing", () => {
    expect([hasCarry(37, 48), hasCarry(32, 41), hasCarry(95, 5), hasBorrow(92, 56), hasBorrow(98, 56), hasBorrow(100, 1)]).toEqual([true, false, true, true, false, true]);
  });
  it("follows each preset's rules and is repeatable", () => {
    const g1 = generate(PRESETS.g1a.p, 50, 3);
    expect(g1).toHaveLength(50);
    expect(g1.every((p) => (p.op === "+" ? p.a + p.b <= 20 : p.a - p.b >= 0 && p.a <= 20))).toBe(true);
    const nc = generate(PRESETS.g1b.p, 40, 3);
    expect(nc.every((p) => (p.op === "+" ? !hasCarry(p.a, p.b) && p.a + p.b <= 100 : !hasBorrow(p.a, p.b)))).toBe(true);
    const c = generate(PRESETS.g2a.p, 40, 3);
    expect(c.every((p) => (p.op === "+" ? hasCarry(p.a, p.b) : hasBorrow(p.a, p.b) && p.a >= p.b))).toBe(true);
    const tt = generate(PRESETS.g2b.p, 40, 3);
    expect(tt.every((p) => (p.op === "×" ? p.a <= 9 && p.b <= 9 : p.a % p.b === 0 && p.a / p.b <= 9))).toBe(true);
    const rem = generate(PRESETS.g2c.p, 30, 3);
    expect(rem.every((p) => p.op === "÷" && p.a % p.b > 0 && p.a % p.b < p.b)).toBe(true);
    expect(generate(PRESETS.g3a.p, 20, 9)).toEqual(generate(PRESETS.g3a.p, 20, 9));
    expect(generate(PRESETS.g3a.p, 20, 9)).not.toEqual(generate(PRESETS.g3a.p, 20, 10));
    expect(new Set(generate(PRESETS.g2a.p, 60, 1).map((p) => `${p.a}${p.op}${p.b}`)).size).toBe(60);
  });
  it("parses and displays problems", () => {
    expect(parseOps("加减×/")).toEqual(["+", "-", "×", "÷"]);
    expect(parseRange("20～5", [1, 2])).toEqual([5, 20]);
    expect(parseExpr("37 + 48 =")).toEqual({ a: 37, op: "+", b: 48, blank: "answer" });
    expect(parseExpr("□+15=40")).toEqual({ a: 25, op: "+", b: 15, blank: "a" });
    expect(parseExpr("50-□=18")).toEqual({ a: 50, op: "-", b: 32, blank: "b" });
    expect(parseExpr("84/9")).toMatchObject({ a: 84, op: "÷", b: 9 });
    expect(solve({ a: 84, op: "÷", b: 9 })).toEqual({ value: 9, rem: 3 });
    expect(display({ a: 84, op: "÷", b: 9, blank: "answer" }, true).text).toBe("84 ÷ 9 = 9……3");
    expect(display({ a: 25, op: "+", b: 15, blank: "a" }, false).text).toBe("□ + 15 = 40");
    expect(solve({ a: 1, op: "÷", b: 0 }).error).toBe("division by zero");
  });
});

describe("tools", () => {
  it("generates a sheet, keeps edited problems and exports", async () => {
    const root = await mkdtemp(join(tmpdir(), "math-"));
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("math_open", { inputs: [], project: "w1", settings: { title: "二年级口算 第 1 周" } });
    expect(o.data.stats).toMatchObject({ problems: 60, locked: 0 });
    const first = (o.data.rows as Record<string, unknown>[]).map((r) => r.problem);
    await c.call("math_edit", { project: "w1", set: [{ row: 0, values: { 第一个数: 99, 第二个数: 1, 运算: "+" } }] });
    const r = await c.call("math_edit", { project: "w1", settings: { seed: 2 } });
    const rows = r.data.rows as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({ locked: true, problem: "99 + 1 =", answer: "100" });
    expect(rows.slice(1).map((x) => x.problem)).not.toEqual(first.slice(1));
    const z = await c.call("math_edit", { project: "w1", set: [{ row: 1, values: { op: "÷", b: 0 } }] });
    expect(z.data.issues.some((i: { level: string; message: string }) => i.level === "error" && /division by zero/.test(i.message))).toBe(true);
    await expect(c.call("math_export", { project: "w1" })).rejects.toThrow(/errors/);
    await c.call("math_edit", { project: "w1", set: [{ row: 1, values: { b: 4, a: 36 } }], settings: { layout: "vertical", columns: 5 } });
    await c.call("math_export", { project: "w1" });
    const out = join(root, "math-worksheet", "w1");
    for (const f of ["worksheet.pdf", "answers.pdf"]) expect((await PDFDocument.load(await readFile(join(out, f)))).getPageCount()).toBeGreaterThanOrEqual(1);
    const csv = String(await readFile(join(out, "problems.csv"))).trim().split(/\r?\n/);
    expect(csv).toHaveLength(61);
    expect(csv[1]).toBe("1,99 + 1 =,100");
    expect(csv[2]).toBe("2,36 ÷ 4 =,9");
  }, 60_000);
  it("reads a problem list and the custom options", async () => {
    const root = await mkdtemp(join(tmpdir(), "math-"));
    await cp(join(HERE, "samples"), join(root, "题"), { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("math_open", { inputs: ["题/problems.txt"], project: "own" });
    expect((o.data.rows as Record<string, unknown>[]).map((r) => r.problem)).toEqual(["37 + 48 =", "92 - 56 =", "7 × 8 =", "63 ÷ 9 =", "□ + 15 = 40", "50 - □ = 18"]);
    expect(o.data.issues.some((i: { message: string }) => /Skipped lines.*foo/.test(i.message))).toBe(true);
    const g = await c.call("math_open", { inputs: [], project: "narrow", settings: { preset: "custom", ops: "+", rangeA: "1-3", rangeB: "1-3", maxResult: 10, count: 30 } });
    expect(g.data.stats.problems).toBe(30);
    expect(g.data.issues.some((i: { message: string }) => /repeats/.test(i.message))).toBe(true);
  });
});
