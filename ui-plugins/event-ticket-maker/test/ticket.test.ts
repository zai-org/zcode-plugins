import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { ALPHABET, makeCode, normalizeCode } from "../src/ticket.ts";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("codes", () => {
  it("makes unique codes with a check character", () => {
    const taken = new Set<string>();
    const codes = Array.from({ length: 300 }, () => makeCode("QH26", taken));
    expect(new Set(codes).size).toBe(300);
    for (const c of codes) {
      expect(c).toMatch(/^QH26-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
      expect(normalizeCode(c.toLowerCase()).valid).toBe(true);
      const last = c[c.length - 1];
      const wrong = c.slice(0, -1) + ALPHABET[(ALPHABET.indexOf(last) + 1) % 32];
      expect(normalizeCode(wrong).valid).toBe(false);
    }
  });
});

describe("ticket tools", () => {
  it("issues tickets, keeps codes and reads scans", async () => {
    const root = await mkdtemp(join(tmpdir(), "ticket-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("ticket_open", { inputs: ["guests.csv"], project: "g", settings: { event: "青禾产品发布会", date: "2026-11-28 14:00", venue: "福州海峡会展中心 3 号厅", prefix: "qh26" } });
    expect(o.data.stats).toMatchObject({ tickets: 8, checkedIn: 0 });
    expect(o.text).toContain("8 tickets");
    const rows = o.data.rows as Record<string, unknown>[];
    const codes = rows.map((r) => String(r.code));
    expect(codes[0]).toMatch(/^QH26-/);
    // 重新打开：票号不变
    const again = await c.call("ticket_open", { inputs: ["guests.csv"], project: "g2", settings: { prefix: "QH26" } });
    expect((again.data.rows as Record<string, unknown>[]).map((r) => r.code)).toEqual(codes);
    // 扫码记录
    const stranger = makeCode("QH26", new Set(codes));
    const typo = codes[3].slice(0, -1) + ALPHABET[(ALPHABET.indexOf(codes[3].slice(-1)) + 1) % 32];
    await writeFile(join(root, "scans.csv"), `code,time\n${codes[0]},14:02\n${codes[1].toLowerCase()},14:05\n${codes[0]},14:20\n${stranger},14:21\n${typo},14:22\n`);
    await writeFile(join(root, "door2.txt"), `${codes[5]}\n`);
    const s = await c.call("ticket_open", { inputs: ["guests.csv", "scans.csv", "door2.txt"], project: "g", settings: { event: "青禾产品发布会", prefix: "QH26" } });
    expect(s.data.stats).toMatchObject({ tickets: 8, checkedIn: 3, scans: 6, unknown: 2 });
    const issues = JSON.stringify(s.data.issues);
    expect(issues).toContain(`${stranger} isn't on the guest list`);
    expect(issues).toContain("isn't a valid ticket code");
    expect(issues).toContain(`${codes[0]} was scanned more than once`);
    const srows = s.data.rows as Record<string, unknown>[];
    expect(srows[0]).toMatchObject({ checkedIn: true, checkedAt: "14:02" });
    // 手动签到
    await c.call("ticket_edit", { project: "g", set: [{ row: 6, values: { checkedIn: true, checkedAt: "14:30" } }] });
    const ex = await c.call("ticket_export", { project: "g" });
    expect(ex.text).toContain(`tickets/${codes[2]}-陈思.pdf`);
    const tp = join(root, "event-ticket-maker/g/tickets.pdf");
    expect((await PDFDocument.load(await readFile(tp))).getPageCount()).toBe(3);
    const txt = execFileSync("pdftotext", ["-layout", tp, "-"]).toString();
    expect(txt).toContain("青禾产品发布会");
    expect(txt).toContain(codes[7]);
    expect(txt).toContain("Daniel Moreau");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(join(root, "event-ticket-maker/g/checkin.xlsx"));
    const sum = wb.getWorksheet(2)!;
    const total = sum.getRow(sum.rowCount).values as unknown[];
    expect(total.slice(1)).toEqual(["合计 Total", 8, 4, 4]);
    // 手动签到留在台账里：同样的文件再打开，扫码不算重复
    const re = await c.call("ticket_open", { inputs: ["guests.csv", "scans.csv", "door2.txt"], project: "g3", settings: { prefix: "QH26" } });
    expect(re.data.stats).toMatchObject({ checkedIn: 4 });
    expect(JSON.stringify(re.data.issues).match(/more than once/g)).toHaveLength(1);
  });
});
