import { SceneGraph } from "@open-pencil/scene-graph";
import { exportFigFile, parseFigFile } from "@open-pencil/core/io";
import { parsePenFile } from "@open-pencil/pen";

/** 空文档：一页、无节点。上游 exportFigFile 不传 CanvasKit 时跳过缩略图渲染。 */
export async function createEmptyFig(): Promise<Uint8Array> {
  return exportFigFile(new SceneGraph());
}
export interface NodeSummary {
  id: string;
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  children: number;
  text?: string;
}
export interface DesignSummary {
  pages: Array<{ id: string; name: string; nodeCount: number; topLevel: NodeSummary[] }>;
  totalNodes: number;
}
function summarize(graph: SceneGraph, maxTopLevel: number): DesignSummary {
  let totalNodes = 0;
  const count = (id: string): number => {
    const node = graph.getNode(id);
    if (!node) return 0;
    return 1 + node.childIds.reduce((n, child) => n + count(child), 0);
  };
  const pages = graph.getPages().map((page) => {
    const nodeCount = page.childIds.reduce((n, id) => n + count(id), 0);
    totalNodes += nodeCount;
    const topLevel = page.childIds.slice(0, maxTopLevel).map((id): NodeSummary => {
      const node = graph.getNode(id)!;
      const summary: NodeSummary = {
        id: node.id,
        name: node.name,
        type: node.type,
        x: Math.round(node.x),
        y: Math.round(node.y),
        width: Math.round(node.width),
        height: Math.round(node.height),
        children: node.childIds.length,
      };
      if (node.type === "TEXT" && typeof (node as { text?: string }).text === "string")
        summary.text = (node as { text?: string }).text!.slice(0, 120);
      return summary;
    });
    return { id: page.id, name: page.name, nodeCount, topLevel };
  });
  return { pages, totalNodes };
}
/** 面板未开时给模型"看懂稿子"用：解析 .fig 全部页面，输出页面与顶层节点摘要。 */
export async function describeFig(bytes: Uint8Array, maxTopLevel = 60): Promise<DesignSummary> {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const graph = await parseFigFile(buffer as ArrayBuffer, { populate: "all" });
  return summarize(graph, maxTopLevel);
}
/** `.pen`（pencil.dev JSON）只读导入后序列化为 .fig。 */
export async function penToFig(text: string): Promise<Uint8Array> {
  return exportFigFile(parsePenFile(text));
}
