import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { assignRoleColors, layoutOf, PALETTE } from "../src/badge.ts";
import { connect } from "../src/kit/testing.ts";
import { createServer, parseRoleColors } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("helpers", () => {
  it("assigns role colours", () => {
    expect(parseRoleColors("嘉宾=#b45309, Speaker: #7C3AED, bad=red")).toEqual({ 嘉宾: "#b45309", Speaker: "#7C3AED" });
    expect(assignRoleColors(["嘉宾", "讲师", "嘉宾", ""], { 讲师: "#123456" })).toEqual({ 嘉宾: PALETTE[0], 讲师: "#123456" });
  });
  it("fits badges on A4", () => {
    expect(layoutOf("100x70").per).toBe(8);
    expect(layoutOf("90x120").per).toBe(4);
    expect(layoutOf("86x54").per).toBe(10);
  });
});

describe("badge tools", () => {
  it("makes badges and tent cards", async () => {
    const root = await mkdtemp(join(tmpdir(), "badge-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("badge_open", { inputs: ["attendees.xlsx", "logo.png"], project: "e", settings: { event: "2026 青禾产品大会", eventSub: "11月28日 · 福州" } });
    expect(o.data.stats).toMatchObject({ badges: 10, perPage: 8, pages: 2, roles: 4 });
    expect(o.text).toContain("10 badges");
    const rows = o.data.rows as Record<string, unknown>[];
    expect(rows[1]).toMatchObject({ name: "Daniel Moreau", org: "Atelier Nord", role: "讲师", code: "A002" });
    await c.call("badge_edit", { project: "e", settings: { qr: "code", sort: "role" }, set: [{ row: 9, values: { include: false } }] });
    await c.call("badge_export", { project: "e" });
    const bp = join(root, "name-badge-maker/e/badges.pdf");
    const doc = await PDFDocument.load(await readFile(bp));
    expect(doc.getPageCount()).toBe(2);
    const txt = execFileSync("pdftotext", ["-layout", bp, "-"]).toString();
    expect(txt).toContain("2026 青禾产品大会");
    expect(txt).toContain("Atelier Nord");
    expect(txt).toContain("工作人员");
    expect(txt).not.toContain("孙悦");
    const tp = join(root, "name-badge-maker/e/tent-cards.pdf");
    const tents = await PDFDocument.load(await readFile(tp));
    expect(tents.getPageCount()).toBe(9);
    const { width, height } = tents.getPage(0).getSize();
    expect(width).toBeGreaterThan(height);
    expect(execFileSync("pdftotext", [tp, "-"]).toString()).toContain("林晓雯");
  });
});
