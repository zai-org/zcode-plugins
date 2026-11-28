import { cp, mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";
import { localToUtc, offsetAt, parseDate, parseTime, parseTz } from "../src/trip.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("time zones and parsing", () => {
  it("converts local times through each zone", () => {
    const sh = parseTz("上海")!, tk = parseTz("Asia/Tokyo")!;
    const dep = localToUtc("2026-12-18", 8 * 60 + 55, sh), arr = localToUtc("2026-12-18", 12 * 60 + 50, tk);
    expect((arr - dep) / 60000).toBe(175);
    expect(parseTz("UTC+5:30")).toEqual({ kind: "fixed", min: 330 });
    expect(parseTz("Mars/Base")).toBeNull();
    const ny = parseTz("纽约")!;
    expect(offsetAt(ny, Date.parse("2026-07-01T12:00:00Z"))).toBe(-240);
    expect(offsetAt(ny, Date.parse("2026-12-01T12:00:00Z"))).toBe(-300);
    expect(new Date(localToUtc("2026-03-08", 12 * 60, ny)).toISOString()).toBe("2026-03-08T16:00:00.000Z");
  });
  it("reads dates and times", () => {
    expect(parseDate("2026/12/5")).toBe("2026-12-05");
    expect(parseDate("12月19日", 2026)).toBe("2026-12-19");
    expect(parseDate("2026-02-30")).toBeNull();
    expect(parseTime("07:10 +1")).toEqual({ min: 430, plus: 1 });
    expect(parseTime("8点半")).toEqual({ min: 510, plus: 0 });
    expect(parseTime("19:3O")).toBeNull();
    expect(parseTime("")).toBeUndefined();
  });
});

describe("tools", () => {
  it("checks a Tokyo/Osaka trip, fixes it and exports", async () => {
    const root = await mkdtemp(join(tmpdir(), "trip-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("trip_open", { inputs: ["东京大阪"], project: "jp" });
    expect(o.text).toMatch(/13 item\(s\) over 6 day\(s\) \(2026-12-18 → 2026-12-23\), 2 flight\(s\), 4 night\(s\) booked of 5/);
    expect(o.text).toMatch(/#0 MU523 .* has no arrival time zone .* #3 .* is in 东京/);
    expect(o.text).toMatch(/#4 teamLab Planets \(10:30\) overlaps #3/);
    expect(o.text).toMatch(/Nowhere to stay on the night of 2026-12-21/);
    expect(o.text).toMatch(/#7 新干线.*no booking reference/);
    expect(o.text).toMatch(/can't read the start time “19:3O”/);
    expect(o.text).toMatch(/#12 MU516 .*only 1h30 between the end of #11 黑门市场/);
    expect(o.text).toContain("新干线 希望号 东京 → 新大阪 @ 东京站");

    await c.call("trip_edit", { project: "jp", set: [
      { row: 0, values: { endTz: "东京" } }, { row: 4, values: { start: "13:30", end: "15:30" } }, { row: 8, values: { date: "2026-12-21" } },
      { row: 10, values: { start: "19:30" } }, { row: 11, values: { end: "12:00" } }, { row: 7, values: { ref: "JR-E 4471" } },
    ], settings: { title: "东京大阪 6 日", travellers: "陈晓、王磊" } });
    const st = await c.call("trip_status", { project: "jp" });
    expect(st.text).toMatch(/5 night\(s\) booked of 5/);
    expect(st.text).not.toMatch(/overlaps|Nowhere|has no arrival|can't read|only 1h/);
    const rows = st.data.rows as Record<string, string>[];
    expect(rows[0]._dur).toBe("2h55");
    expect(rows[12]._dur).toBe("2h55");
    expect(rows[1]._home).toBe("13:00");
    expect(rows[2]._dur).toBe("3 晚");

    await c.call("trip_edit", { project: "jp", set: [{ row: 12, values: { endTz: "Asia/Tokyo", end: "13:20" } }] });
    expect((await c.call("trip_status", { project: "jp" })).text).toMatch(/#12 MU516 .*arrives 13:20 UTC\+9 before it departs 14:30 UTC\+9/);
    await c.call("trip_edit", { project: "jp", set: [{ row: 12, values: { endTz: "上海", end: "16:25" } }] });

    await c.call("trip_export", { project: "jp" });
    expect((await readdir(join(root, "travel-itinerary/jp"))).sort()).toEqual(["itinerary.ics", "itinerary.pdf", "itinerary.xlsx"]);
    const ics = await readFile(join(root, "travel-itinerary/jp/itinerary.ics"), "utf8");
    expect(ics).toContain("DTSTART:20261218T005500Z");
    expect(ics).toContain("DTEND:20261218T035000Z");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261218\r\nDTEND;VALUE=DATE:20261221");
    expect(ics).toContain("TRIGGER:-PT180M");
    expect(ics.match(/BEGIN:VEVENT/g)!.length).toBe(13);
  }, 120_000);
});
