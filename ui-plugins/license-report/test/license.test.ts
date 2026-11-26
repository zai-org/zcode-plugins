import { execFileSync } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { category, guessFromText, normalize } from "../src/licenses.ts";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("licenses", () => {
  it("normalizes and classifies", () => {
    expect(normalize("Apache 2.0")).toBe("Apache-2.0");
    expect(normalize("(MIT OR Apache-2.0)")).toBe("(MIT OR Apache-2.0)");
    expect(normalize("mit or gplv3")).toBe("(MIT OR GPL-3.0)");
    expect(category("(MIT OR GPL-3.0)")).toBe("permissive");
    expect(category("(MIT AND GPL-3.0)")).toBe("strong-copyleft");
    expect(category("LGPL-2.1-or-later")).toBe("weak-copyleft");
    expect(category("AGPL-3.0-only")).toBe("strong-copyleft");
    expect(category("SEE LICENSE IN LICENSE.md")).toBe("proprietary");
    expect(category("")).toBe("unknown");
    expect(guessFromText("Redistribution and use in source and binary forms ... Neither the name")).toBe("BSD-3-Clause");
  });
});

describe("license tools", () => {
  it("scans node_modules and exports", async () => {
    const root = await mkdtemp(join(tmpdir(), "lic-"));
    execFileSync(process.execPath, [join(HERE, "make-project.mjs"), root]);
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("licenses_open", { inputs: ["web-app"], project: "w" });
    const rows = o.data.rows as Record<string, unknown>[];
    expect(rows.map((r) => r.name)).toEqual(["@demo/ui-kit", "color-mix", "dual-lib", "gpl-chart", "mystery-lib", "no-license", "test-runner-x", "tiny-date", "weak-lib"]);
    expect(rows[0]).toMatchObject({ license: "Apache-2.0", _category: "permissive", kind: "direct" });
    expect(rows[1]).toMatchObject({ license: "ISC", kind: "transitive" });
    expect(rows.find((r) => r.name === "mystery-lib")).toMatchObject({ license: "MIT", source: "LICENSE file" });
    expect(rows.find((r) => r.name === "weak-lib")).toMatchObject({ license: "MPL-2.0", _category: "weak copyleft" });
    expect(rows.find((r) => r.name === "test-runner-x")!.kind).toBe("direct · dev");
    expect(o.data.stats).toMatchObject({ packages: 8, review: 2, copyleft: 1, unknown: 1 });
    const nl = rows.findIndex((r) => r.name === "no-license");
    const gpl = rows.findIndex((r) => r.name === "gpl-chart");
    const ed = await c.call("licenses_edit", { project: "w", set: [{ row: nl, values: { license: "BSD-2-Clause", note: "checked repo" } }, { row: gpl, values: { reviewed: true, note: "server-side only" } }] });
    expect(ed.data.stats.review).toBe(0);
    expect((ed.data.rows as Record<string, unknown>[])[nl].source).toBe("edited");
    await c.call("licenses_export", { project: "w" });
    const notices = await readFile(join(root, "license-report/w/THIRD_PARTY_NOTICES.txt"), "utf8");
    expect(notices).toContain("tiny-date 2.3.1\nLicense: MIT\nCopyright (c) 2024 Ada Chen");
    expect(notices).toContain("Permission is hereby granted");
    expect(notices).not.toContain("test-runner-x");
    expect((await readFile(join(root, "license-report/w/license-report.xlsx"))).length).toBeGreaterThan(4000);
  });
});
