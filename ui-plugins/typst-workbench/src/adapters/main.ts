// 必须最先导入：之后加载的模块（pdf.js）不能写 stdout。
import "#t/adapters/console.ts";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createTypstMcpServer } from "#t/adapters/server.ts";
import { TypstSession } from "#t/app/session.ts";
import { pdfjsDataDir } from "#t/pdf/extract.ts";

// stdout 只走 MCP 协议；诊断写 stderr。
const log = (line: string) => process.stderr.write(`[typst-workbench] ${line}\n`);

const here = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(process.env.ZCODE_WORKSPACE_ROOT || process.cwd());
// 宿主未替换的 ${...} 占位符视为未设置。
const setting = (value: string | undefined) => (value?.trim() && !value.includes("${") ? value.trim() : undefined);
const pdfjs = pdfjsDataDir(join(here, "pdfjs"));

const session = new TypstSession({
  workspaceRoot,
  dataDir: setting(process.env.ZCODE_PLUGIN_DATA) ?? null,
  typstPath: setting(process.env.TYPST_WORKBENCH_TYPST),
  pdfjsDataDir: pdfjs,
  log,
});
const server = createTypstMcpServer({ session, assetRoot: join(here, "ui"), pdfjsDataDir: pdfjs, log });

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await session.close().catch(() => undefined);
  await server.close().catch(() => undefined);
  process.exit(0);
}
// 任何方式退出都不留下 typst watch。
process.on("exit", () => session.killNow());
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
process.stdin.once("end", () => void shutdown());
await server.connect(new StdioServerTransport());
