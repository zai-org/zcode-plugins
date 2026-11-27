import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync, strFromU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";
import { findDue, findOwner, parseNotes } from "../src/parse.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("parse", () => {
  it("resolves due dates against the meeting date", () => {
    const D = "2026-11-18"; // 周三
    expect(findDue("周五前修复", D)[0]).toBe("2026-11-20");
    expect(findDue("周三前", D)[0]).toBe("2026-11-25");
    expect(findDue("下周一前发群里", D)[0]).toBe("2026-11-23");
    expect(findDue("本周日", D)[0]).toBe("2026-11-22");
    expect(findDue("11月22日前交付", D)[0]).toBe("2026-11-22");
    expect(findDue("1月5日", D)[0]).toBe("2027-01-05");
    expect(findDue("月底前", D)[0]).toBe("2026-11-30");
    expect(findDue("三天内", D)[0]).toBe("2026-11-21");
    expect(findDue("by Friday", D)[0]).toBe("2026-11-20");
    expect(findDue("next Tuesday", D)[0]).toBe("2026-11-24");
    expect(findDue("tomorrow", D)[0]).toBe("2026-11-19");
    expect(findDue("before Dec 3", D)[0]).toBe("2026-12-03");
    expect(findDue("due 2026-12-15", D)[0]).toBe("2026-12-15");
    expect(findDue("先看看", D)[0]).toBe("");
  });
  it("finds owners", () => {
    const n = ["王强", "李娜", "Bob"];
    expect(findOwner("@王强 修 bug", n)).toBe("王强");
    expect(findOwner("负责人：李娜", n)).toBe("李娜");
    expect(findOwner("Bob, can you send it?", n, "Alice")).toBe("Bob");
    expect(findOwner("I'll update the changelog", n, "Carol")).toBe("Carol");
    expect(findOwner("Dana will draft the post", n)).toBe("Dana");
    expect(findOwner("跟法务确认", n)).toBe("");
  });
  it("sorts a transcript into items", () => {
    const p = parseNotes([{ path: "a.txt", text: "Sync 2026-12-02\nAlice: Agenda: release, hiring.\nBob: Build is green.\nAlice: Decision: ship Thursday.\nCarol: I'll update the changelog by tomorrow.\nBob: Do we need a flag?" }]);
    expect(p.header).toMatchObject({ title: "Sync 2026-12-02", date: "2026-12-02", attendees: ["Alice", "Bob", "Carol"] });
    expect(p.items.map((i) => `${i.kind}:${i.owner}:${i.due}`)).toEqual(["agenda::", "agenda::", "note::", "decision::", "action:Carol:2026-12-03", "question::"]);
  });
});

describe("tools", () => {
  it("builds minutes from Markdown notes and exports DOCX, MD, ICS and CSV", async () => {
    const root = await mkdtemp(join(tmpdir(), "minutes-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const r0 = await c.call("minutes_open", { inputs: ["meetings"], project: "t" });
    expect(r0.data.stats).toMatchObject({ attendees: 4, agenda: 3, decisions: 3, actions: 5, dated: 4, unowned: 1, questions: 1 });
    const rows = r0.data.rows as Record<string, unknown>[];
    const acts = rows.filter((r) => r.kind === "action").map((r) => `${r.owner}|${r.due}|${r.text}`);
    expect(acts).toEqual(["王强|2026-11-20|王强 周五前修复两个阻塞 bug", "李娜|2026-11-22|李娜 11月22日前交付第二版设计稿的切图", "陈晓|2026-11-23|陈晓负责整理退款自动回复模板，下周一前发群里", "||跟法务确认引导文案", "张伟|2026-11-30|张伟 月底前复盘 11 月版本"]);
    expect(JSON.stringify(r0.data.issues)).toContain("has no owner");
    const legal = rows.findIndex((r) => r.text === "跟法务确认引导文案");
    await c.call("minutes_edit", { project: "t", set: [{ row: legal, values: { owner: "李娜", due: "2026-11-24" } }], add: [{ kind: "action", text: "预订下次周会会议室", owner: "陈晓", due: "2026-11-24" }] });
    await c.call("minutes_edit", { project: "t", settings: { icsTime: "09:30" } });
    const r1 = await c.call("minutes_export", { project: "t" });
    expect(r1.data.issues ?? []).toEqual([]);
    const out = join(root, "meeting-minutes", "t");
    const md = String(await readFile(join(out, "minutes.md")));
    expect(md).toContain("# 产品周会 — 会议纪要");
    expect(md).toContain("- **参会人**: 张伟、李娜、王强、陈晓");
    expect(md).toContain("1. 上线日期延后到 11 月 25 日（周二）");
    expect(md).toContain("| 4 | 跟法务确认引导文案 | 李娜 | 2026-11-24 |");
    expect(md).toContain("### 客服工单积压\n\n- 积压 340 单，主要是退款咨询");
    expect(md).toContain("## 待定问题\n\n- 引导文案需要法务确认吗？");
    const docx = unzipSync(new Uint8Array(await readFile(join(out, "minutes.docx"))));
    const xml = strFromU8(docx["word/document.xml"]);
    expect(xml).toContain("产品周会 — 会议纪要");
    expect(xml).toContain("预订下次周会会议室");
    expect(xml.match(/<w:tr>|<w:tr /g)?.length).toBe(7);
    const ics = String(await readFile(join(out, "actions.ics")));
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(6);
    expect(ics).toContain("DTSTART:20261120T093000\r\nDTEND:20261120T100000");
    expect(ics).toContain("SUMMARY:王强: 王强 周五前修复两个阻塞 bug");
    expect(ics.split("\r\n").every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
    expect(String(await readFile(join(out, "actions.csv")))).toContain("跟法务确认引导文案,李娜,2026-11-24,产品周会,2026-11-18");
  });
  it("reads an English transcript", async () => {
    const root = await mkdtemp(join(tmpdir(), "minutes-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const r0 = await c.call("minutes_open", { inputs: ["calls/standup.txt"], project: "e" });
    expect(r0.data.stats).toMatchObject({ attendees: 3, agenda: 2, decisions: 2, actions: 3, dated: 3, questions: 1 });
    expect(JSON.stringify(r0.data.issues)).toContain("Dana isn't in the attendee list");
    await c.call("minutes_export", { project: "e", formats: ["md", "ics"] });
    const md = String(await readFile(join(root, "meeting-minutes", "e", "minutes.md")));
    expect(md).toContain("# Weekly sync, Dec 2 2026 — Minutes");
    expect(md).toContain("| 1 | I'll update the changelog by tomorrow. | Carol | 2026-12-03 |");
    expect(md).not.toContain("Sure.");
    const ics = String(await readFile(join(root, "meeting-minutes", "e", "actions.ics")));
    expect(ics).toContain("DTSTART;VALUE=DATE:20261207\r\nDTEND;VALUE=DATE:20261208");
  });
});
