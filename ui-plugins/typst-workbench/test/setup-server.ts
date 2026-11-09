// 设置页测试用的 server：与 adapters/main.ts 相同，但 Typst 的查找结果取自 TYPST_TEST_TOOLCHAIN 指向的 JSON 文件，
// 测试脚本改写该文件即可模拟“未安装 → Agent 装好”。
import "#t/adapters/console.ts";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createTypstMcpServer } from "#t/adapters/server.ts";
import { TypstSession } from "#t/app/session.ts";
import type { HostFacts, Toolchain } from "#t/contract.ts";
import { pdfjsDataDir } from "#t/pdf/extract.ts";

// 页面与 pdf.js 数据取自已构建的 dist/。
const here = process.env.TYPST_TEST_DIST ?? dirname(fileURLToPath(import.meta.url));
const file = process.env.TYPST_TEST_TOOLCHAIN!;
const pdfjs = pdfjsDataDir(join(here, "pdfjs"));
const session = new TypstSession({
  workspaceRoot: resolve(process.env.ZCODE_WORKSPACE_ROOT || process.cwd()),
  dataDir: process.env.ZCODE_PLUGIN_DATA ?? null,
  pdfjsDataDir: pdfjs,
  locate: async () => JSON.parse(await readFile(file, "utf8")).toolchain as Toolchain,
  facts: async () => JSON.parse(await readFile(file, "utf8")).facts as HostFacts,
  log: (line) => process.stderr.write(`[typst-setup-test] ${line}\n`),
});
const server = createTypstMcpServer({ session, assetRoot: join(here, "ui"), pdfjsDataDir: pdfjs });
process.on("exit", () => session.killNow());
process.stdin.once("end", () => void session.close().then(() => process.exit(0)));
await server.connect(new StdioServerTransport());
