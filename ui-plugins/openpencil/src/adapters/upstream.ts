import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, type RPCSender } from "@open-pencil/mcp";
import { DesignError, type BridgeEndpoint } from "#openpencil/contract.ts";

export interface UpstreamBridge {
  endpoint: BridgeEndpoint;
  /** 把一条 request 送进面板并等待回包；面板未连接时先等它注册（面板冷启动要拉 10 MiB 资源）。 */
  sendRPC: RPCSender;
  isConnected(): Promise<boolean>;
  waitForConnection(timeoutMs: number): Promise<boolean>;
  close(): Promise<void>;
}
export interface UpstreamBridgeOptions {
  dataDir: string;
  workspaceRoot: string;
  enableEval: boolean;
  /** 等面板注册的上限（ms），默认 30 s。 */
  connectTimeoutMs?: number;
}
export const PANEL_NOT_CONNECTED_MESSAGE =
  "设计稿面板未连接：请在侧栏打开“设计稿”面板（或先调用 open_design 让它自动打开），面板就绪后再重试；不要自动重试。";

/**
 * 进程内启动上游 `@open-pencil/mcp` 的 HTTP + WebSocket 桥（随机回环端口、token 鉴权），
 * 面板作为"浏览器端"主动连上来；我们的 MCP 工具经 `/rpc` 把请求代理进面板执行。
 * 发现文件与 Unix socket 一律指到插件私有目录，避免劫持用户桌面版 OpenPencil 的全局发现文件。
 */
export async function startUpstreamBridge(options: UpstreamBridgeOptions): Promise<UpstreamBridge> {
  process.env.OPENPENCIL_MCP_DISCOVERY_PATH = join(options.dataDir, "openpencil-mcp.json");
  // macOS 的 Unix socket 路径上限 104 字节，插件数据目录可能超长，socket 放系统临时目录。
  process.env.OPENPENCIL_MCP_SOCKET = join(
    tmpdir(),
    `zcode-op-${randomBytes(4).toString("hex")}.sock`,
  );
  const token = randomBytes(16).toString("hex");
  const handle = await startServer({
    withTcp: true,
    httpPort: 0,
    authToken: token,
    mcpRoot: options.workspaceRoot,
    enableEval: options.enableEval,
  });
  const base = `http://127.0.0.1:${handle.httpPort}`;
  const endpoint: BridgeEndpoint = { url: `ws://127.0.0.1:${handle.httpPort}`, token };
  const connectTimeoutMs = options.connectTimeoutMs ?? 30_000;

  async function isConnected(): Promise<boolean> {
    try {
      const res = await fetch(`${base}/health`);
      const json = (await res.json()) as { status?: string };
      return json.status === "ok";
    } catch {
      return false;
    }
  }
  async function waitForConnection(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      if (await isConnected()) return true;
      if (Date.now() >= deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  const sendRPC: RPCSender = async (body) => {
    if (!(await waitForConnection(connectTimeoutMs)))
      throw new DesignError("panel_not_connected", PANEL_NOT_CONNECTED_MESSAGE);
    const res = await fetch(`${base}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) {
      const message = typeof json?.error === "string" ? json.error : res.statusText;
      throw new DesignError(
        /not connected/i.test(message) ? "panel_not_connected" : "bridge_failed",
        /not connected/i.test(message) ? PANEL_NOT_CONNECTED_MESSAGE : message,
      );
    }
    return json;
  };
  return {
    endpoint,
    sendRPC,
    isConnected,
    waitForConnection,
    close: () => handle.close(),
  };
}
