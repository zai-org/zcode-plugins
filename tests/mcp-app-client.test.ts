import { afterEach, describe, expect, it, vi } from "vitest";
import type { App } from "@modelcontextprotocol/ext-apps";
import { createClient as excalidraw } from "../ui-plugins/excalidraw/ui/client";
import { createClient as openpencil } from "../ui-plugins/openpencil/ui/client";

afterEach(() => vi.unstubAllGlobals());

describe.each([
  ["Excalidraw", excalidraw],
  ["OpenPencil", openpencil],
] as const)("%s page connection", (_name, createClient) => {
  function setup(capability = true) {
    const browser = Object.assign(new EventTarget(), { parent: {} });
    vi.stubGlobal("window", browser);
    const app = {
      connect: vi.fn(async () => {}),
      getHostContext: () => ({ theme: "dark", "zcode/widgetState": { documentId: "saved" } }),
      getHostCapabilities: () => ({ experimental: capability ? { "zcode/widgetState": {} } : {} }),
      request: vi.fn(async () => ({})),
      callServerTool: vi.fn(async () => ({ content: [], structuredContent: { ok: true } })),
      readServerResource: vi.fn(async () => ({ contents: [] })),
      ontoolresult: undefined as App["ontoolresult"],
      ontoolinput: undefined as App["ontoolinput"],
      ontoolcancelled: undefined as App["ontoolcancelled"],
    };
    return { app, client: createClient(app as unknown as App) };
  }

  it("connects once for concurrent loader/UI calls and retains the first result", async () => {
    const { app, client } = setup();
    app.connect.mockImplementationOnce(async () => {
      app.ontoolinput?.({ arguments: { id: "initial" } });
      app.ontoolresult?.({ content: [], structuredContent: { id: "initial" } });
    });
    await Promise.all([
      client.ready(),
      client.readResource("ui://test/assets"),
      client.callTool("read"),
    ]);
    expect(app.connect).toHaveBeenCalledTimes(1);
    expect(client.toolInput).toEqual({ id: "initial" });
    expect(client.toolOutput).toEqual({ id: "initial" });
    expect(client.widgetState).toEqual({ documentId: "saved" });
    expect(client.theme).toBe("dark");
  });

  it("keeps session state in the host extension and delivers cancellation", async () => {
    const { app, client } = setup();
    await client.setWidgetState({ documentId: "next" });
    expect(client.widgetState).toEqual({ documentId: "next" });
    expect(app.request.mock.calls[0]?.[0]).toEqual({
      method: "ui/set-widget-state",
      params: { widgetState: { documentId: "next" } },
    });
    app.ontoolcancelled?.({ reason: "stopped" });
    expect(client.toolCancelled).toEqual({ reason: "stopped" });
  });

  it("rejects missing capabilities without replacing restored state", async () => {
    const { app, client } = setup(false);
    await expect(client.setWidgetState({ documentId: "next" })).rejects.toThrow("does not support");
    expect(app.request).not.toHaveBeenCalled();
    expect(client.widgetState).toEqual({ documentId: "saved" });
  });

  it("preserves a failed handshake without opening another connection", async () => {
    const { app, client } = setup();
    app.connect.mockRejectedValueOnce(new Error("handshake failed"));
    await expect(client.ready()).rejects.toThrow("handshake failed");
    await expect(client.callTool("read")).rejects.toThrow("handshake failed");
    expect(app.connect).toHaveBeenCalledTimes(1);
    expect(app.callServerTool).not.toHaveBeenCalled();
  });
});
