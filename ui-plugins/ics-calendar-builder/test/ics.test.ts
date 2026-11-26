import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildIcs, fold, localToUtc, parseReminders, parseRepeat, vtimezone } from "../src/ics.ts";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("parsing", () => {
  it("understands repeats", () => {
    expect(parseRepeat("每周")).toBe("FREQ=WEEKLY");
    expect(parseRepeat("每两周")).toBe("FREQ=WEEKLY;INTERVAL=2");
    expect(parseRepeat("每周一三五")).toBe("FREQ=WEEKLY;BYDAY=MO,WE,FR");
    expect(parseRepeat("工作日")).toBe("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
    expect(parseRepeat("每月")).toBe("FREQ=MONTHLY");
    expect(parseRepeat("every 2 weeks on mon and thu")).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH");
    expect(parseRepeat("不重复")).toBe("");
    expect(parseRepeat("偶尔")).toBeNull();
  });
  it("understands reminders", () => {
    expect(parseReminders("15分钟, 1小时，提前2天, 30m, 1h")).toEqual([15, 60, 2880, 30, 60]);
    expect(parseReminders("早点")).toBeNull();
  });
  it("folds long lines by bytes", () => {
    const line = `DESCRIPTION:${"中文".repeat(40)}`;
    const f = fold(line).split("\r\n");
    for (const l of f) expect(Buffer.byteLength(l)).toBeLessThanOrEqual(75);
    expect(f.map((l, i) => (i ? l.slice(1) : l)).join("")).toBe(line);
  });
  it("writes daylight saving transitions", () => {
    const v = vtimezone("America/New_York", 2026, 2026).join("\n");
    expect(v).toContain("BEGIN:DAYLIGHT\nDTSTART:20260308T020000\nTZOFFSETFROM:-0500\nTZOFFSETTO:-0400");
    expect(v).toContain("BEGIN:STANDARD\nDTSTART:20261101T020000\nTZOFFSETFROM:-0400\nTZOFFSETTO:-0500");
    expect(vtimezone("Asia/Shanghai", 2026, 2027).join("\n")).toContain("TZOFFSETTO:+0800");
    expect(new Date(localToUtc("America/New_York", "2026-07-01", 9 * 60)).toISOString()).toBe("2026-07-01T13:00:00.000Z");
  });
  it("writes all-day and past-midnight events", () => {
    const ics = buildIcs([{ title: "A, B", date: "2027-01-01", endDate: "2027-01-03", start: "", end: "", allDay: true, location: "", desc: "", reminders: [], rrule: "", category: "", url: "" }, { title: "Night", date: "2026-12-31", endDate: "", start: "22:00", end: "02:00", allDay: false, location: "", desc: "", reminders: [30], rrule: "", category: "", url: "" }], { calName: "t", tz: "Asia/Shanghai", stamp: "20261125T000000Z" });
    expect(ics).toContain("DTSTART;VALUE=DATE:20270101\r\nDTEND;VALUE=DATE:20270104");
    expect(ics).toContain("SUMMARY:A\\, B");
    expect(ics).toContain("DTEND;TZID=Asia/Shanghai:20270101T020000");
    expect(ics).toContain("TRIGGER:-PT30M");
  });
});

describe("ics tools", () => {
  it("builds the calendar", async () => {
    const root = await mkdtemp(join(tmpdir(), "ics-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("ics_open", { inputs: ["events.xlsx"], project: "e", settings: { calName: "青禾 12 月日程" } });
    expect(o.data.stats).toMatchObject({ events: 8, allDay: 3, repeating: 5, reminders: 6 });
    expect(o.text).toContain("8 events");
    const rows = o.data.rows as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({ title: "产品周会", date: "2026-12-01", start: "10:00", end: "11:00", repeat: "每周二" });
    const bad = await c.call("ics_edit", { project: "e", set: [{ row: 1, values: { repeat: "偶尔" } }] });
    expect(JSON.stringify(bad.data.issues)).toContain("isn't understood");
    await c.call("ics_edit", { project: "e", settings: { reminder: "10分钟" }, set: [{ row: 1, values: { repeat: "每周一三五" } }] });
    const ex = await c.call("ics_export", { project: "e" });
    expect(ex.text).toContain("events/2026-12-18-年终总结会.ics");
    const ics = await readFile(join(root, "ics-calendar-builder/e/青禾 12 月日程.ics"), "utf8");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(8);
    expect(ics).toContain("X-WR-CALNAME:青禾 12 月日程");
    expect(ics).toContain("RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20270126T155900Z");
    expect(ics).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=12");
    expect(ics).toContain("DTSTART;TZID=Asia/Shanghai:20261218T140000\r\nDTEND;TZID=Asia/Shanghai:20261218T150000");
    expect(ics).toContain("TRIGGER:-P1D");
    expect(ics).toContain("DTSTART;VALUE=DATE:20270101\r\nDTEND;VALUE=DATE:20270104");
    expect(ics).toContain("DTEND;TZID=Asia/Shanghai:20270101T020000");
    expect(ics.match(/TRIGGER:-PT10M/g)).toHaveLength(2);
    expect(ics.split("\r\n").every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
    const html = await readFile(join(root, "ics-calendar-builder/e/schedule.html"), "utf8");
    expect(html).toContain("2026 年 12 月");
    expect(html).toContain("↻ 每周 一三五，共 12 次");
  });
});
