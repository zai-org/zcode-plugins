/**
 * 与面板、Skill、宿主共享的常量与类型。
 * 改动这里的 URI / 上限时同步 ui/、skills/design/SKILL.md 及本模块 CONTRACT.md。
 */
export const PLUGIN_NAME = "openpencil";
export const SURFACE_ID = "design";
export const PANEL_URI = "ui://openpencil/panel.html";
export const ASSET_URI_PREFIX = "ui://openpencil/assets/";
export const DESIGN_URI_PREFIX = "ui://openpencil/design/";
/** 宿主 `mcp/uiReadResource` 单次 8 MiB；blob 以 base64 传输，5 MiB 原始字节 ≈ 6.7 MiB。 */
export const DESIGN_CHUNK_BYTES = 5 * 1024 * 1024;
export const MAX_DESIGN_BYTES = 48 * 1024 * 1024;
export const MAX_ASSET_BYTES = 16 * 1024 * 1024;
export const DEFAULT_DESIGNS_DIR = "designs";
export const DESIGN_FORMATS = ["fig", "pen"] as const;
export type DesignFormat = (typeof DESIGN_FORMATS)[number];
/** 文档权威：面板未连接时磁盘文件是权威（file），面板注册后浏览器里的活文档是权威（live）。 */
export type DocumentOwner = "file" | "live";
export interface DesignDocument {
  id: string;
  /** 工作区相对路径（posix 分隔）。 */
  path: string;
  name: string;
  format: DesignFormat;
  /** 每次成功写盘或检测到外部修改 +1；面板保存必须带上它做过期检测。 */
  revision: number;
  byteLength: number;
  hash: string;
  owner: DocumentOwner;
  dirty: boolean;
  externalChange: boolean;
}
export interface DesignRef {
  id: string;
  path: string;
  name: string;
  revision: number;
  owner: DocumentOwner;
  uri: string;
}
export interface BridgeEndpoint {
  url: string;
  token: string;
}
/** server → 面板 的自定义命令，复用上游 WebSocket 桥的 request / response 信封（`command` 字段）。 */
export const BRIDGE_COMMANDS = {
  openDocument: "zcode.open_document",
  externalChange: "zcode.external_change",
} as const;
export class DesignError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DesignError";
  }
}
export const designRef = (doc: DesignDocument): DesignRef => ({
  id: doc.id,
  path: doc.path,
  name: doc.name,
  revision: doc.revision,
  owner: doc.owner,
  uri: `${DESIGN_URI_PREFIX}${doc.id}`,
});
export function designFormatOf(path: string): DesignFormat {
  const ext = path.toLowerCase().split(".").pop();
  if (ext === "fig" || ext === "pen") return ext;
  throw new DesignError("invalid_format", "设计稿只支持 .fig 与 .pen 文件");
}
