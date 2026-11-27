// 仅测试使用：通过内存传输连接 server，像 Agent 一样调用工具。
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export async function connect(server: McpServer) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args }, undefined, { timeout: 300_000 })) as any;
    if (r.isError) throw Object.assign(new Error(r.content?.[0]?.text ?? "tool error"), { code: r.structuredContent?.error?.code });
    return { text: r.content?.[0]?.text as string, data: r.structuredContent as any };
  };
  return { client, call };
}
