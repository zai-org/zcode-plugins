import "./kit/console.ts";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.ts";

const here = dirname(fileURLToPath(import.meta.url));
const setting = (value: string | undefined) => (value?.trim() && !value.includes("${") ? value.trim() : undefined);
const server = createServer({
  workspaceRoot: resolve(process.env.ZCODE_WORKSPACE_ROOT || process.cwd()),
  assetRoot: here,
  fontPath: setting(process.env.FORM_FILL_FONT),
  log: (line) => process.stderr.write(`[pdf-form-batch-fill] ${line}\n`),
});
process.stdin.once("end", () => process.exit(0));
await server.connect(new StdioServerTransport());
