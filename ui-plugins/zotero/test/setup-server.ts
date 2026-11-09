// 设置页测试用的 server：与 adapters/main.ts 相同，但 Zotero 的安装情况与本机事实取自 ZOTERO_TEST_SETUP 指向的 JSON 文件，
// “打开 Zotero”只记录调用（测试脚本随后自己在该端口启动假 Zotero）。
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createZoteroMcpServer } from "#z/adapters/server.ts";
import { ZoteroSession } from "#z/app/session.ts";
import type { HostFacts, ZoteroInstall } from "#z/contract.ts";
import { pdfjsDataDir } from "#z/pdf/extract.ts";

// 页面与 pdf.js 数据取自已构建的 dist/。
const here = process.env.ZOTERO_TEST_DIST ?? dirname(fileURLToPath(import.meta.url));
const file = process.env.ZOTERO_TEST_SETUP!;
const setup = async () => JSON.parse(await readFile(file, "utf8")) as { app: ZoteroInstall; facts: HostFacts };
const pdfjs = pdfjsDataDir(join(here, "pdfjs"));
const session = new ZoteroSession({
  baseUrl: process.env.ZOTERO_URL,
  workspaceRoot: resolve(process.env.ZCODE_WORKSPACE_ROOT || process.cwd()),
  pdfjsDataDir: pdfjs,
  facts: async () => (await setup()).facts,
  findApp: async () => (await setup()).app,
  launchApp: async () => "/Applications/Zotero.app",
  log: (line) => process.stderr.write(`[zotero-setup-test] ${line}\n`),
});
const server = createZoteroMcpServer({ session, assetRoot: join(here, "ui"), pdfjsDataDir: pdfjs });
process.stdin.once("end", () => {
  session.close();
  process.exit(0);
});
await server.connect(new StdioServerTransport());
