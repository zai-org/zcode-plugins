import { watch, type FSWatcher } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, extname } from "node:path";
import {
  DesignError,
  MAX_DESIGN_BYTES,
  designFormatOf,
  type DesignDocument,
  type DocumentOwner,
} from "#openpencil/contract.ts";
import {
  readWorkspaceBytes,
  resolveWorkspacePath,
  workspaceRelative,
  writeWorkspaceBytes,
} from "#openpencil/adapters/files.ts";

export interface DesignRegistryOptions {
  workspaceRoot: string;
  createEmptyFig: () => Promise<Uint8Array>;
  onExternalChange?: (doc: DesignDocument) => void;
  /** 外部修改检测的去抖（ms）。 */
  watchDebounceMs?: number;
}
interface Record_ {
  doc: DesignDocument;
  absPath: string;
  watcher: FSWatcher | null;
  timer: ReturnType<typeof setTimeout> | null;
}
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export const documentIdForPath = (relativePath: string) =>
  `d${createHash("sha256").update(relativePath).digest("hex").slice(0, 12)}`;

/**
 * 文档登记表：path ↔ id ↔ revision ↔ owner。单权威：任一时刻只有 file 或 live 一个 owner，
 * revision 只做过期检测（保存时 expectedRevision ≠ 当前值 → revision_conflict，草稿留在面板里不覆盖）。
 */
export function createDesignRegistry(options: DesignRegistryOptions) {
  const records = new Map<string, Record_>();
  let activeId: string | null = null;
  const debounce = options.watchDebounceMs ?? 250;

  function require(id: string): Record_ {
    const record = records.get(id);
    if (!record) throw new DesignError("document_not_found", `未登记的设计稿 ${id}`);
    return record;
  }
  async function readCurrent(record: Record_) {
    const { bytes } = await readWorkspaceBytes(
      options.workspaceRoot,
      record.doc.path,
      MAX_DESIGN_BYTES,
    );
    return bytes;
  }
  function startWatching(record: Record_) {
    if (record.watcher) return;
    const file = basename(record.absPath);
    try {
      record.watcher = watch(dirname(record.absPath), { persistent: false }, (_event, name) => {
        if (name && name !== file) return;
        if (record.timer) clearTimeout(record.timer);
        record.timer = setTimeout(() => {
          record.timer = null;
          void checkExternalChange(record);
        }, debounce);
      });
    } catch {
      // 目录被删或平台不支持 watch：退化为只在 open/save 时校验哈希。
      record.watcher = null;
    }
  }
  async function checkExternalChange(record: Record_) {
    const bytes = await readCurrent(record).catch(() => null);
    if (!bytes) return;
    const hash = sha256(bytes);
    if (hash === record.doc.hash) return;
    // 别人（git checkout、其它编辑器）改了文件：revision +1 让面板下一次保存撞上 revision_conflict，
    // 由用户在面板里选择"以我的为准 / 重新加载"，绝不静默覆盖任何一方。
    record.doc.hash = hash;
    record.doc.byteLength = bytes.length;
    record.doc.revision += 1;
    record.doc.externalChange = true;
    options.onExternalChange?.({ ...record.doc });
  }

  async function open(pathInput: string): Promise<DesignDocument> {
    const format = designFormatOf(pathInput);
    const { path: absPath, bytes } = await readWorkspaceBytes(
      options.workspaceRoot,
      pathInput,
      MAX_DESIGN_BYTES,
    );
    const path = await workspaceRelative(options.workspaceRoot, absPath);
    const id = documentIdForPath(path);
    const hash = sha256(bytes);
    const existing = records.get(id);
    if (existing) {
      if (existing.doc.hash !== hash) await checkExternalChange(existing);
      return { ...existing.doc };
    }
    const record: Record_ = {
      doc: {
        id,
        path,
        name: basename(path, extname(path)),
        format,
        revision: 1,
        byteLength: bytes.length,
        hash,
        owner: "file",
        dirty: false,
        externalChange: false,
      },
      absPath,
      watcher: null,
      timer: null,
    };
    records.set(id, record);
    startWatching(record);
    return { ...record.doc };
  }
  async function create(pathInput: string): Promise<DesignDocument> {
    if (designFormatOf(pathInput) !== "fig")
      throw new DesignError("invalid_format", "新建设计稿必须是 .fig 路径");
    const bytes = await options.createEmptyFig();
    await writeWorkspaceBytes(options.workspaceRoot, pathInput, bytes, false);
    return open(pathInput);
  }
  async function readBytes(id: string): Promise<Uint8Array> {
    return readCurrent(require(id));
  }
  async function save(
    id: string,
    expectedRevision: number,
    bytes: Uint8Array,
  ): Promise<DesignDocument> {
    const record = require(id);
    if (record.doc.format !== "fig")
      throw new DesignError("invalid_format", ".pen 只读；请先用 convert_pen_to_fig 另存为 .fig");
    if (bytes.length > MAX_DESIGN_BYTES) throw new DesignError("file_too_large", "设计稿超过上限");
    if (record.doc.revision !== expectedRevision)
      throw new DesignError(
        "revision_conflict",
        `文件已变为 revision ${record.doc.revision}（期望 ${expectedRevision}）`,
      );
    await writeWorkspaceBytes(options.workspaceRoot, record.doc.path, bytes, true);
    record.doc.hash = sha256(bytes);
    record.doc.byteLength = bytes.length;
    record.doc.revision += 1;
    record.doc.dirty = false;
    record.doc.externalChange = false;
    return { ...record.doc };
  }
  function setOwner(id: string, owner: DocumentOwner, dirty = false): DesignDocument {
    const record = require(id);
    record.doc.owner = owner;
    record.doc.dirty = owner === "live" ? dirty : false;
    return { ...record.doc };
  }
  /** keep-mine：面板用当前 revision 重新保存（覆盖外部改动）；reload：面板重新读盘。两者都清 externalChange。 */
  function resolveConflict(id: string, strategy: "keep-mine" | "reload"): DesignDocument {
    const record = require(id);
    record.doc.externalChange = false;
    if (strategy === "reload") record.doc.dirty = false;
    return { ...record.doc };
  }
  return {
    open,
    create,
    readBytes,
    save,
    setOwner,
    resolveConflict,
    get: (id: string) => ({ ...require(id).doc }),
    has: (id: string) => records.has(id),
    list: () => [...records.values()].map((r) => ({ ...r.doc })),
    active: () => (activeId && records.has(activeId) ? { ...records.get(activeId)!.doc } : null),
    setActive(id: string) {
      require(id);
      activeId = id;
    },
    absolutePath: (id: string) => require(id).absPath,
    async resolveSiblingPath(id: string, relativeName: string) {
      const record = require(id);
      const dir = dirname(record.doc.path);
      return resolveWorkspacePath(
        options.workspaceRoot,
        `${dir === "." ? "" : `${dir}/`}${relativeName}`,
        true,
      );
    },
    close() {
      for (const record of records.values()) {
        record.watcher?.close();
        record.watcher = null;
        if (record.timer) clearTimeout(record.timer);
      }
    },
  };
}
export type DesignRegistry = ReturnType<typeof createDesignRegistry>;
