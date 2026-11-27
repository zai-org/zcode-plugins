import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { countLines, gitignoreMatcher, LANGS } from "../src/count.ts";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("count", () => {
  it("splits code, comment and blank lines", () => {
    const ts = "// a\nconst x = 1; // trailing\n\n/* block\n still */ const y = 2;\n/** doc */\n";
    expect(countLines(ts, LANGS[".ts"])).toMatchObject({ lines: 6, code: 2, comment: 3, blank: 1 });
    const py = '"""doc\nmore\n"""\nimport os\n# c\n\nprint(1)\n';
    expect(countLines(py, LANGS[".py"])).toMatchObject({ lines: 7, code: 2, comment: 4, blank: 1 });
    expect(countLines("", LANGS[".ts"]).lines).toBe(0);
  });
  it("matches .gitignore patterns", () => {
    const g = gitignoreMatcher("# c\ncoverage/\n*.generated.ts\n/out\ndocs/**/*.md\n!keep.ts\n");
    expect(g.test("coverage/x.js")).toBe(true);
    expect(g.test("src/api.generated.ts")).toBe(true);
    expect(g.test("out/a.js")).toBe(true);
    expect(g.test("src/out/a.js")).toBe(false);
    expect(g.test("docs/a/b.md")).toBe(true);
    expect(g.test("src/app.ts")).toBe(false);
    expect(g.negations).toBe(1);
  });
});

describe("tools", () => {
  it("opens a project folder, excludes files and exports reports", async () => {
    const root = await mkdtemp(join(tmpdir(), "codestats-"));
    await cp(join(HERE, "samples"), join(root, "p"), { recursive: true });
    await writeFile(join(root, "p/tea-shop/src/api/client.generated.ts"), "export const a = 1;\n".repeat(500));
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("codestats_open", { inputs: ["p/tea-shop"], project: "shop" });
    const rows = o.data.rows as Record<string, unknown>[];
    expect(rows.some((r) => String(r.path).includes("generated"))).toBe(false);
    expect(o.data.issues.some((i: { message: string }) => /skipped by .gitignore/.test(i.message))).toBe(true);
    const min = rows.findIndex((r) => String(r.path).endsWith("tinylib.min.js"));
    expect(rows[min].include).toBe(false);
    const orders = rows.find((r) => String(r.path).endsWith("orders.ts"))!;
    expect(orders).toMatchObject({ language: "TypeScript", comment: 6, blank: 3 });
    const before = o.data.stats.code as number;
    await c.call("codestats_edit", { project: "shop", settings: { exclude: "scripts/" } });
    const st = await c.call("codestats_status", { project: "shop" });
    expect(st.data.stats.code).toBeLessThan(before);
    expect(st.data.stats.languages).toBe(3);
    const x = await c.call("codestats_export", { project: "shop" });
    expect(x.text).toMatch(/code-stats\.html/);
    const html = await readFile(join(root, "code-stats/shop/code-stats.html"), "utf8");
    expect(html).toContain("TypeScript");
    expect(html).not.toContain("import_products.py");
    const csv = await readFile(join(root, "code-stats/shop/languages.csv"), "utf8");
    expect(csv.split("\r\n")[1]).toMatch(/^TypeScript,3,/);
  }, 60_000);
});
