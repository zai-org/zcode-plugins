import { ref } from "vue";
import { getSession, openDocument } from "#ui/web/tabs.ts";
import { host, call } from "#ui/host.ts";
import { connectBridge, type Bridge } from "#ui/bridge.ts";
import { selectionContext } from "#ui/app/context.ts";
import type { BridgeEndpoint, DesignRef } from "#openpencil/contract.ts";
import { sessions } from "#ui/web/document-io.ts";
import { getTabsSnapshot } from "#upstream-tabs";

export const connected = ref(false);
export const notice = ref("");
export const chinese = ref(false);
let bridge: Bridge | null = null;
export function text(zh: string, en: string) {
  return chinese.value ? zh : en;
}
async function context() {
  const session = getSession();
  if (!session.documents.current.value && !(await session.editor.saveFigFile())) return null;
  return selectionContext(session.editor, session.state, session.documents.current.value!, bridge);
}
export async function addToContext() {
  const selection = await context();
  if (!selection) return;
  await host().updateModelContext({
    content: [{ type: "text", text: selection.text }],
    structuredContent: selection.structuredContent,
  });
  notice.value = text("已添加到对话上下文", "Added to conversation context");
}
export async function askZcode(prompt: string) {
  const selection = await context();
  if (!selection) return;
  await host().sendFollowUpMessage({
    prompt: `${prompt}\n\n${selection.text}\nUse the OpenPencil MCP tools on document_id ${selection.structuredContent.document.id}. Inspect the selection first and preserve unrelated nodes.`,
    structuredContent: selection.structuredContent,
  });
  notice.value = text("已发送给 ZCode", "Sent to ZCode");
}
export async function codegen() {
  await askZcode(
    "Generate code for this design selection using the workspace stack. Inspect the selected nodes and export JSX and PNG through the OpenPencil tools to verify the implementation.",
  );
}
export async function connect() {
  const status = await call<{ document: DesignRef | null; bridge: BridgeEndpoint }>(
    "get_design_status",
  );
  const output = host().toolOutput as { document?: DesignRef } | undefined;
  if (output?.document ?? status.document)
    await openDocument((output?.document ?? status.document)!);
  bridge = connectBridge({
    getSession,
    openDocument,
    listSessions: () =>
      getTabsSnapshot().map((tab) => ({
        editor: tab.store,
        state: tab.store.state,
        documents: sessions.get(tab.store.state)!,
      })),
    endpoint: status.bridge,
    onConnection: (value) => {
      connected.value = value;
    },
  });
  window.__openpencilPanel = {
    get editor() {
      return getSession().editor;
    },
    get state() {
      return getSession().state;
    },
    get documents() {
      return getSession().documents;
    },
    get canvasReady() {
      return Boolean(getSession().editor.renderer);
    },
    get bridgeConnected() {
      return connected.value;
    },
    openPath: async (path: string) => {
      const result = await call<{ document: DesignRef }>("open_design", { path });
      await openDocument(result.document);
    },
    addToContext,
    askZcode,
    codegen,
    flush: () => getSession().documents.save(),
  };
}
export function disconnect() {
  bridge?.disconnect();
  for (const tab of getTabsSnapshot()) sessions.get(tab.store.state)?.flush();
}
