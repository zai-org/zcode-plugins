import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { BOT, parseLine, refHost } from "../src/parse.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("parse", () => {
  it("reads combined and common lines", () => {
    const r = parseLine('1.2.3.4 - - [26/Nov/2026:18:05:09 +0800] "GET /a?x=1 HTTP/1.1" 404 512 "https://www.google.com/x" "Mozilla/5.0"')!;
    expect(r).toMatchObject({ ip: "1.2.3.4", day: "2026-11-26", hour: 18, method: "GET", path: "/a", status: 404, bytes: 512, ua: "Mozilla/5.0" });
    expect(refHost(r.ref, "")).toBe("google.com");
    expect(refHost("https://shop.example/p", "shop.example")).toBe("(internal)");
    expect(parseLine('5.6.7.8 - frank [01/Jan/2026:00:00:00 -0700] "POST /login HTTP/1.0" 200 -')).toMatchObject({ bytes: 0, ref: "", ua: "" });
    expect(parseLine("nonsense")).toBeUndefined();
    expect(BOT.test("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe(true);
    expect(BOT.test("Mozilla/5.0 (iPhone)")).toBe(false);
  });
});

describe("tools", () => {
  it("reads plain and gzipped logs, filters bots, exports report", async () => {
    const root = await mkdtemp(join(tmpdir(), "logs-"));
    await cp(join(HERE, "samples"), join(root, "srv"), { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("logs_open", { inputs: ["srv/logs"], project: "nov", settings: { site: "teashop.example" } });
    const all = o.data.stats.requests + o.data.stats.bots;
    expect(all).toBe(971);
    expect(o.data.issues.some((i: { message: string }) => /1 line\(s\) could not be read/.test(i.message))).toBe(true);
    expect(o.data.stats.errors5xx).toBeGreaterThan(0);
    const withBots = await c.call("logs_edit", { project: "nov", settings: { bots: true, from: "2026-11-26" } });
    expect(withBots.data.stats.requests).toBe(521);
    const rows = withBots.data.rows as Record<string, unknown>[];
    const js = rows.findIndex((r) => r.path === "/static/app.js");
    const st = await c.call("logs_edit", { project: "nov", set: [{ row: js, values: { include: false } }] });
    expect(st.data.stats.requests).toBe(521 - (rows[js].hits as number));
    await c.call("logs_export", { project: "nov" });
    const html = await readFile(join(root, "log-analyzer/nov/access-report.html"), "utf8");
    expect(html).toContain("/wp-login.php");
    expect(html).not.toContain("<td>/static/app.js</td>");
    const refs = await readFile(join(root, "log-analyzer/nov/referrers.csv"), "utf8");
    expect(refs).toContain("(internal)");
    expect(refs).toContain("baidu.com");
  }, 60_000);
});
