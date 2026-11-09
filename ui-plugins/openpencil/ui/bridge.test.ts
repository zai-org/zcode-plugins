import { afterEach, describe, expect, it, vi } from "vitest";
import { connectBridge, type BridgeSession } from "#ui/bridge.ts";
import { BRIDGE_COMMANDS } from "#openpencil/contract.ts";

class Socket {
  static OPEN = 1;
  static latest: Socket;
  readyState = 1;
  onmessage?: (event: { data: string }) => void;
  send = vi.fn();
  close = vi.fn();
  constructor() {
    Socket.latest = this;
  }
  request(id: string, command: string, args: object) {
    this.onmessage?.({ data: JSON.stringify({ type: "request", id, command, args }) });
  }
}
function session(id: string): BridgeSession {
  return {
    editor: {
      graph: {
        getPages: () => [{ id: "page", name: "Page" }],
        getNode: () => ({ name: "Page", type: "CANVAS" }),
      },
    },
    state: { currentPageId: "page", selectedIds: new Set() },
    documents: {
      current: { value: { id, path: `${id}.fig`, name: id } },
      onExternalChange: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as BridgeSession;
}
afterEach(() => vi.unstubAllGlobals());
describe("多标签 MCP 路由", () => {
  it("文档列表只标记当前标签为 active", async () => {
    vi.stubGlobal("WebSocket", Socket);
    const a = session("a"),
      b = session("b");
    const bridge = connectBridge({
      getSession: () => b,
      listSessions: () => [a, b],
      openDocument: vi.fn(),
      endpoint: { url: "ws://localhost", token: "test" },
      onConnection: vi.fn(),
    });
    Socket.latest.request("1", "list_documents", {});
    await vi.waitFor(() => expect(Socket.latest.send).toHaveBeenCalled());
    const response = JSON.parse(Socket.latest.send.mock.calls[0][0]);
    expect(
      response.result.documents.map((doc: { id: string; active: boolean }) => [doc.id, doc.active]),
    ).toEqual([
      ["a", false],
      ["b", true],
    ]);
    bridge.disconnect();
  });
  it("串行处理外部变更，显式目标不随用户切换标签而改变", async () => {
    vi.stubGlobal("WebSocket", Socket);
    const a = session("a"),
      b = session("b");
    let active = a;
    let release!: () => void;
    vi.mocked(a.documents.onExternalChange).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const bridge = connectBridge({
      getSession: (id) => (id === "a" ? a : id === "b" ? b : active),
      listSessions: () => [a, b],
      openDocument: vi.fn(),
      endpoint: { url: "ws://localhost", token: "test" },
      onConnection: vi.fn(),
    });
    Socket.latest.request("1", BRIDGE_COMMANDS.externalChange, { documentId: "a", revision: 2 });
    await vi.waitFor(() => expect(a.documents.onExternalChange).toHaveBeenCalledTimes(1));
    active = b;
    Socket.latest.request("2", BRIDGE_COMMANDS.externalChange, { documentId: "a", revision: 3 });
    expect(a.documents.onExternalChange).toHaveBeenCalledTimes(1);
    release();
    await vi.waitFor(() => expect(Socket.latest.send).toHaveBeenCalledTimes(2));
    expect(a.documents.onExternalChange).toHaveBeenNthCalledWith(2, 3);
    expect(b.documents.onExternalChange).not.toHaveBeenCalled();
    bridge.disconnect();
  });
});
