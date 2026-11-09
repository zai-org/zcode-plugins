import { getClient, type ToolResult } from "./client.ts";
import {
  DiagramError,
  DOCUMENT_PREFIX,
  type Diagram,
  type DiagramRef,
} from "#excalidraw/contract.ts";

declare global {
  interface Window {
    __excalidrawFontSources: Map<FontFace, string>;
    __excalidrawPanel?: any;
  }
}
export async function call(name: string, args: Record<string, unknown> = {}): Promise<any> {
  const result = (await getClient().callTool(name, args)) as ToolResult<any>;
  if (result.isError || result.structuredContent?.error) {
    const error = result.structuredContent?.error;
    const firstText = (result.content?.[0] as { text?: string } | undefined)?.text;
    throw new DiagramError(
      error?.code ?? "tool_failed",
      error?.message ?? firstText ?? "Tool failed",
    );
  }
  return result.structuredContent;
}
export async function read(id: string): Promise<Diagram> {
  const result = await getClient().readResource(`${DOCUMENT_PREFIX}${id}`);
  if (!result.contents[0] || !("text" in result.contents[0]) || !result.contents[0].text)
    throw new Error("Document resource is empty");
  return JSON.parse(result.contents[0].text);
}
export function outputRef(allowLegacy = true): Pick<DiagramRef, "id" | "revision"> | null {
  const output = getClient().toolOutput as
    | { document?: DiagramRef; path?: unknown; revision?: unknown; error?: unknown }
    | undefined;
  if (!output || output.error) return null;
  if (output.document?.id) return output.document;
  if (!allowLegacy) return null;
  const input = getClient().toolInput;
  // 旧导出历史只有 path/revision，冷启动没有 widgetState；从匹配的导出输入取 ID，仍由资源读取恢复内容。
  // surface 的新输入可能先于结果到达，不能把任意新输入与上一份导出结果拼成文档引用。
  if (
    getClient().toolCancelled ||
    typeof input?.id !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(input.id) ||
    typeof input.path !== "string" ||
    !input.path ||
    typeof output.path !== "string" ||
    typeof output.revision !== "number" ||
    !Number.isSafeInteger(output.revision) ||
    output.revision < 1 ||
    input.expectedRevision !== output.revision
  )
    return null;
  const requested = input.path.replaceAll("\\", "/").replace(/^(\.\/)+/, "");
  const exported = output.path.replaceAll("\\", "/");
  const absolute = /^(\/|[A-Za-z]:)/.test(requested);
  if (exported !== requested && (absolute || !exported.endsWith(`/${requested}`))) return null;
  return { id: input.id, revision: output.revision };
}
