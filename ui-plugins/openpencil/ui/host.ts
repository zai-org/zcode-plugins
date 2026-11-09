import { getClient, type PluginClient, type ToolResult } from "./client.ts";
import { ASSET_URI_PREFIX, DESIGN_URI_PREFIX, DesignError } from "#openpencil/contract.ts";

declare global {
  interface Window {
    __openpencilPanel?: unknown;
  }
}
export const host = (): PluginClient => getClient();
/** 统一把工具错误转成 DesignError（code 来自 structuredContent.error）。 */
export async function call<T = any>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = (await host().callTool(name, args)) as ToolResult<any>;
  if (result.isError || result.structuredContent?.error) {
    const error = result.structuredContent?.error;
    const firstText = (result.content?.[0] as { text?: string } | undefined)?.text;
    throw new DesignError(
      error?.code ?? "tool_failed",
      error?.message ?? firstText ?? `${name} failed`,
    );
  }
  return result.structuredContent as T;
}
export async function readText(uri: string): Promise<string> {
  const result = await host().readResource(uri);
  const item = result.contents[0];
  const text = item && "text" in item ? item.text : undefined;
  if (typeof text !== "string") throw new DesignError("empty_resource", `资源为空：${uri}`);
  return text;
}
export async function readBlob(uri: string): Promise<Uint8Array> {
  const result = await host().readResource(uri);
  const item = result.contents[0];
  const blob = item && "blob" in item ? item.blob : undefined;
  if (typeof blob !== "string") throw new DesignError("empty_resource", `资源为空：${uri}`);
  return base64ToBytes(blob);
}
export const assetText = (name: string) => readText(`${ASSET_URI_PREFIX}${name}`);
export const assetBlob = (name: string) => readBlob(`${ASSET_URI_PREFIX}${name}`);
/** 设计稿字节：先读 meta 拿分片数，再并行拉分片拼接。 */
export async function readDesignBytes(
  documentId: string,
): Promise<{ bytes: Uint8Array; meta: any }> {
  const meta = JSON.parse(await readText(`${DESIGN_URI_PREFIX}${documentId}/meta`));
  const chunks = await Promise.all(
    Array.from({ length: meta.chunkCount as number }, (_, i) =>
      readBlob(`${DESIGN_URI_PREFIX}${documentId}/chunk-${i}`),
    ),
  );
  const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return { bytes, meta };
}
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step)
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + step) as unknown as number[]);
  return btoa(binary);
}
/**
 * 宿主全局（theme / locale / toolOutput）变化。`subscribe` 是别名固定成员，与 `plugin:change` 事件同源，
 * 只挂一处即可（此前两处都挂会让 listener 每次触发两遍）。
 */
export function onHostGlobals(listener: () => void): () => void {
  return host().subscribe(listener);
}
