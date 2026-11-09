import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createTypstMcpServer } from "#t/adapters/server.ts";
import { TypstSession } from "#t/app/session.ts";
import { STATE_URI, type SessionState } from "#t/contract.ts";
import { pdfjsDataDir } from "#t/pdf/extract.ts";
import { locateTypst } from "#t/typst/locate.ts";

/** 用本机安装的 typst 跑一遍主要流程；没有安装时跳过。TYPST_TEST_BINARY 指定其他版本（兼容性检查）。 */
const toolchain = await locateTypst({ shell: false, setting: process.env.TYPST_TEST_BINARY || undefined });
const available = toolchain.state === "ready";

const MAIN = `#set page(width: 12cm, height: 10cm)
= Introduction
Typst is a *markup-based* typesetting system with _emphasis_ and math such as $a^2 + b^2 = c^2$.

#include "chapters/one.typ"
`;
const CHAPTER = `= Chapter
#text(fill: blue)[Colored words] stay findable even when #emph[markup] sits between them.
`;

describe.skipIf(!available)(`real Typst ${toolchain.version ?? ""}`, () => {
  let workspace: string;
  let session: TypstSession;
  let client: Client;
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: any[]; structuredContent?: any };
    return { ...result, text: result.content[0]!.text as string };
  };
  const state = async (): Promise<SessionState> => JSON.parse(((await client.readResource({ uri: STATE_URI })).contents[0] as { text: string }).text);
  const write = async (path: string, text: string) => {
    await new Promise((done) => setTimeout(done, 20));
    await writeFile(join(workspace, path), text);
  };

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), "typst-real-"));
    await mkdir(join(workspace, "chapters"));
    await writeFile(join(workspace, "main.typ"), MAIN);
    await writeFile(join(workspace, "chapters/one.typ"), CHAPTER);
    session = new TypstSession({ workspaceRoot: workspace, dataDir: join(workspace, ".data"), pdfjsDataDir: pdfjsDataDir(), typstPath: toolchain.path });
    const server = createTypstMcpServer({ session, assetRoot: workspace, pdfjsDataDir: pdfjsDataDir() });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test", version: "1" });
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  });

  afterAll(async () => {
    await session.close();
    await client.close();
  });

  it("compiles, reports errors with hints, and recovers", async () => {
    expect((await call("check")).text).toMatch(/^main\.typ compiled successfully in [\d.]+ ms — \d+ pages?\./);
    await write("main.typ", `${MAIN}#let a = 1\n#let b = 2\n#a-b\n`);
    const failed = await call("check");
    expect(failed.text).toContain("error: unknown variable: a-b");
    expect(failed.text).toMatch(/at main\.typ:8:1\n  \| #a-b\n  hint: if you meant to use subtraction/);
    await write("main.typ", MAIN);
    expect((await call("check")).text).toContain("compiled successfully");
  });

  it("follows edits to included files and reports traces", async () => {
    await write("chapters/one.typ", `${CHAPTER}#let f(x) = x.foo()\n#f(1)\n`);
    const failed = await call("check");
    expect(failed.text).toMatch(/error: type integer has no method `foo`\n  at chapters\/one\.typ:3:\d+/);
    expect(failed.text).toMatch(/from chapters\/one\.typ:4:\d+: error occurred in this call of function `f`/);
    await write("chapters/one.typ", CHAPTER);
    expect((await call("check")).text).toContain("compiled successfully");
  });

  it("maps between rendered text and markup", async () => {
    const located = await call("locate_source", { text: "Colored words stay findable even when markup sits between them." });
    expect(located.structuredContent.matches[0]).toMatchObject({ file: "chapters/one.typ", line: 2 });
    const math = await call("locate_source", { text: "with emphasis and math such as a2 + b2 = c2" });
    expect(math.structuredContent.matches[0]).toMatchObject({ file: "main.typ", line: 3 });
    const shown = await call("show", { file: "main.typ", line: 3, comment: "markup line" });
    expect(shown.text).toMatch(/^Highlighted h1 on page 1: “Typst is a markup-based typesetting system/);
    expect((await state()).highlights[0]!.rects.length).toBeGreaterThan(0);
  });

  it("renders PNG pages and exports a PDF", async () => {
    const rendered = await call("render_pages", { pages: "1", ppi: 50 });
    const image = rendered.content.find((part) => part.type === "image");
    expect(Buffer.from(image.data, "base64").subarray(1, 4).toString()).toBe("PNG");
    const exported = await call("export_pdf", { path: "build/out.pdf" });
    expect(exported.text).toMatch(/^Wrote build\/out\.pdf \(\d+ pages?, \d+ KB\)\./);
    expect((await readFile(join(workspace, "build/out.pdf"))).subarray(0, 5).toString()).toBe("%PDF-");
  });
});
