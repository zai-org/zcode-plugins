// MCP 服务编排：能力声明 + 工具注册 + 资源注册。
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DocumentRegistry } from "./registry.ts";
import { RecentStore } from "./recent.ts";
import { registerResources } from "./resources.ts";
import { registerTools } from "./tools.ts";

export interface ServerContext {
  server: McpServer;
  registry: DocumentRegistry;
  workspaceRoot: string;
  /** 安装产物根（dist/），panel 与资产从这里读。 */
  assetRoot: string;
  /** 最近打开文档存储（插件数据目录，按工作区隔离）。 */
  recent: RecentStore;
}

export function registerServer(context: ServerContext) {
  registerTools(context);
  registerResources(context);
}
