import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createZoteroMcpServer } from "#z/adapters/server.ts";
import { ZoteroSession } from "#z/app/session.ts";
import { pdfjsDataDir } from "#z/pdf/extract.ts";

// stdout 只走 MCP 协议；诊断写 stderr。
const log = (line: string) => process.stderr.write(`[zotero] ${line}\n`);

const here = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(process.env.ZCODE_WORKSPACE_ROOT || process.cwd());
// 宿主未替换的 ${...} 占位符视为未设置。
const setting = (value: string | undefined) => (value?.trim() && !value.includes("${") ? value.trim() : undefined);
const dataDir = setting(process.env.ZCODE_PLUGIN_DATA);
const DEFAULT_URL = "http://127.0.0.1:23119";
// 写入 key 会随请求发送，所以只连接本机的 Zotero。
function zoteroUrl(value: string | undefined): string {
  if (!value?.trim()) return DEFAULT_URL;
  try {
    const url = new URL(value.trim());
    if (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return url.origin;
  } catch {
    // 落到下面的提示。
  }
  log(`ignoring Zotero address ${JSON.stringify(value)}: only http://127.0.0.1:<port> or http://localhost:<port> is allowed`);
  return DEFAULT_URL;
}
const baseUrl = zoteroUrl(setting(process.env.ZOTERO_URL));
const pdfjs = pdfjsDataDir(join(here, "pdfjs"));
if (!pdfjs) log("pdf.js data (CMaps, fonts) not found; text from some CJK PDFs may be missing");

const session = new ZoteroSession({
  baseUrl,
  // “始终允许”的 key 存在插件私有数据目录（权限 0600）；没有数据目录时只存在内存中。
  keyFile: dataDir ? join(dataDir, "local-api-keys.json") : null,
  workspaceRoot,
  pdfjsDataDir: pdfjs,
  log,
});
const server = createZoteroMcpServer({ session, assetRoot: join(here, "ui"), pdfjsDataDir: pdfjs, log });

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  session.close();
  await server.close().catch(() => undefined);
  process.exit(0);
}
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
process.stdin.once("end", () => void shutdown());
await server.connect(new StdioServerTransport());
