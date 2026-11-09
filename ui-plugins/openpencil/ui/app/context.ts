import type { Editor, EditorState } from "@open-pencil/core/editor";
import { PLUGIN_NAME, type DesignRef } from "#openpencil/contract.ts";
import type { Bridge } from "#ui/bridge.ts";

/** 宿主 updateModelContext 文本上限 16 KiB；留余量。 */
const MAX_CONTEXT_CHARS = 12_000;

export interface MenuItem {
  label: string;
  action?: () => void;
  disabled?: boolean;
  separator?: boolean;
  testId?: string;
}

/** 选区摘要：右键“添加到对话上下文 / 让 ZCode 修改 / 生成代码”共用；结构化部分给模型直接取 id。 */
export function selectionContext(
  editor: Editor,
  state: EditorState,
  doc: DesignRef,
  bridge: Bridge | null,
) {
  const nodes = (bridge?.selectionSummary() ?? []).map((n) => {
    const node = editor.graph.getNode(n.id);
    const text = node?.type === "TEXT" ? (node as { text?: string }).text : undefined;
    return {
      ...n,
      x: Math.round(node?.x ?? 0),
      y: Math.round(node?.y ?? 0),
      ...(typeof text === "string" ? { text: text.slice(0, 200) } : {}),
    };
  });
  const page = editor.graph.getNode(state.currentPageId);
  const structuredContent = {
    plugin: PLUGIN_NAME,
    document: { id: doc.id, path: doc.path, revision: doc.revision },
    page: { id: state.currentPageId, name: page?.name ?? "" },
    selection: nodes,
  };
  const lines = nodes.map(
    (n) =>
      `- ${n.type} "${n.name}" id=${n.id} ${n.width}×${n.height} at (${n.x}, ${n.y})${n.text ? ` text="${n.text}"` : ""}`,
  );
  let text =
    `Design selection in ${doc.path} (page "${page?.name ?? ""}", document_id ${doc.id}): ${nodes.length} node(s).\n` +
    lines.join("\n");
  if (text.length > MAX_CONTEXT_CHARS) text = `${text.slice(0, MAX_CONTEXT_CHARS)}\n…`;
  return { text, structuredContent };
}
