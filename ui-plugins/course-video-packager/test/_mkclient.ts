import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.ts";

export async function mkclient(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const server = createServer({ workspaceRoot: root, assetRoot: join(import.meta.dirname, "../dist") } as any);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "t", version: "1" });
  await client.connect(b);
  const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as any;
  const text = (r: any) => (r.content ?? []).map((c: any) => c.text ?? "").join(" ");
  return { root, call, text };
}
