import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeAll, describe, expect, it } from "vitest";
import { compile, contrast, fill, plainText, starter, varsOf } from "../src/email.ts";
import { createServer } from "../src/server.ts";

// 虚构品牌 Hearth & Bean 的发货通知设计稿和按它写的 MJML（samples/email）。
const SAMPLES = process.env.EMAIL_SAMPLES ?? "/workspace/zcode-new-plugins/samples/email";
let workspace: string;
let client: Client;
const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args }, undefined, { timeout: 300_000 })) as any;
const sample = (f: string) => readFile(join(SAMPLES, "agent", f), "utf8");

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "email-"));
  await cp(SAMPLES, join(workspace, "设计"), { recursive: true });
  const server = createServer({ workspaceRoot: workspace, assetRoot: join(import.meta.dirname, "../dist") });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: "t", version: "1" });
  await client.connect(b);
});

describe("compile and checks", () => {
  it("compiles the order-shipped template cleanly", async () => {
    const c = await compile(await sample("order-shipped.mjml"));
    expect(c.issues).toEqual([]);
    expect(c.html).toMatch(/<table[^>]+role="presentation"/);
    expect(c.html).toContain('<meta name="color-scheme" content="light dark">');
    expect(c.html).toMatch(/style="[^"]*font-family:Georgia, serif/);
    expect(c.bytes).toBeLessThan(30_000);
    expect(c.vars).toEqual(expect.arrayContaining(["first_name", "order_number", "tracking_url", "unsubscribe_url"]));
    expect(c.preview).toContain("{{order_number}}");
  });
  it("flags the problems in the first draft", async () => {
    const c = await compile(await sample("first-draft.mjml"));
    const got = c.issues.map((i) => `${i.severity}:${i.check}${i.line ? `@${i.line}` : ""}`);
    expect(got).toEqual(expect.arrayContaining(["error:mjml@9", "warning:width@2", "warning:preheader", "warning:dark-mode", "warning:alt@5", "error:image@5", "warning:contrast@6", "warning:link@7", "warning:image@8", "warning:width@8", "info:unsubscribe"]));
  });
  it("detects Gmail clipping", async () => {
    const big = `<mjml><mj-head><mj-preview>x</mj-preview></mj-head><mj-body><mj-section><mj-column>${"<mj-text>Lorem ipsum dolor sit amet, consectetur adipiscing elit. </mj-text>".repeat(240)}</mj-column></mj-section></mj-body></mjml>`;
    const c = await compile(big);
    expect(c.bytes).toBeGreaterThan(102 * 1024);
    expect(c.issues.some((i) => i.check === "size" && i.severity === "error")).toBe(true);
  });
  it("fills variables, makes plain text and measures contrast", async () => {
    expect(varsOf("{{a}} {{ b.c }} {{a}}")).toEqual(["a", "b.c"]);
    expect(fill("<p>{{name}} & {{x}}</p>", { name: "Tom <T>" })).toEqual({ html: "<p>Tom &lt;T&gt; & {{x}}</p>", missing: ["x"] });
    const c = await compile(await sample("order-shipped.mjml"));
    const t = plainText(c.html);
    expect(t).toContain("Your coffee is on its way");
    expect(t).toContain("Track your package [{{tracking_url}}]");
    expect(t).not.toContain("arriving {{delivery_date}}"); // preheader hidden text removed
    expect(t).not.toMatch(/<|guji\.png/);
    expect(contrast("#ffffff", "#2f5d50")!).toBeGreaterThan(4.5);
    expect(contrast("#b9b9b9", "#ffffff")!).toBeLessThan(2.1);
    expect((await compile(starter("Welcome"))).issues.filter((i) => i.severity !== "info")).toEqual([]);
  });
});

describe("tools", () => {
  it("creates, rewrites from the design, previews and exports", async () => {
    const n = await call("email_new", { name: "Order shipped", design: ["设计/order-shipped-design.png"] });
    expect(n.isError).toBeFalsy();
    expect(n.structuredContent.email).toMatchObject({ slug: "order-shipped", dir: "emails/order-shipped" });
    const d = await call("email_write", { mjml: await sample("first-draft.mjml") });
    expect(d.content[0].text).toMatch(/images\/logo\.png is a local path/);
    expect(d.content[0].text).toMatch(/No sample value for \{\{order_no\}\}/);
    expect((await call("email_export", {})).content[0].text).toMatch(/Fix these first/);
    const w = await call("email_write", { mjml: await sample("order-shipped.mjml"), data: JSON.parse(await sample("order-shipped.data.json")) });
    expect(w.content[0].text).toMatch(/0 error\(s\), 0 warning\(s\)/);
    expect(w.structuredContent.html).toContain("Hi Mia, good news — order #HB-10482");
    expect(w.structuredContent.preheader).toBe("Order #HB-10482 is on its way — arriving Friday, March 13");
    const e = await call("email_export", {});
    expect(e.isError).toBeFalsy();
    const html = await readFile(join(workspace, "emails/order-shipped/export/order-shipped.html"), "utf8");
    expect(html).toContain("{{first_name}}");
    const txt = await readFile(join(workspace, "emails/order-shipped/export/order-shipped.txt"), "utf8");
    expect(txt).toMatch(/Unsubscribe \[\{\{unsubscribe_url\}\}\]/);
    const prev = await readFile(join(workspace, "emails/order-shipped/export/order-shipped.preview.html"), "utf8");
    expect(prev).toContain("https://tracking.example.com/HB-10482");
    expect((await call("email_new", { name: "Order shipped" })).content[0].text).toMatch(/already exists/);
    expect((await call("email_check", { email: "nope" })).content[0].text).toMatch(/No template “nope”/);
  });
});
