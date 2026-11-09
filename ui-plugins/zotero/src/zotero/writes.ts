import { createHash } from "node:crypto";
import { LIMITS, ZoteroError, libraryPrefix, type LibraryId } from "#z/contract.ts";
import type { RawItem } from "#z/domain/items.ts";
import { httpError, type ZoteroClient } from "#z/zotero/client.ts";
import type { Library } from "#z/zotero/library.ts";

interface MultiWriteResult {
  successful?: Record<string, { key: string; version: number; data?: Record<string, unknown> }>;
  success?: Record<string, string>;
  unchanged?: Record<string, string>;
  failed?: Record<string, { code: number; message: string; data?: unknown }>;
}

const enc = encodeURIComponent;

/** 经授权的写入。所有方法在失败时抛出 ZoteroError，不留下半成品以外的副作用。 */
export class Writer {
  constructor(
    private readonly client: ZoteroClient,
    private readonly library: Library,
  ) {}

  /** 批量创建对象（条目 / 笔记 / 附件 / 注释 / 集合），返回按输入顺序的 key。 */
  async create(libraryId: LibraryId, kind: "items" | "collections", objects: Record<string, unknown>[]): Promise<string[]> {
    if (!objects.length) return [];
    const keys: string[] = [];
    for (let index = 0; index < objects.length; index += LIMITS.writeBatch) {
      const batch = objects.slice(index, index + LIMITS.writeBatch);
      const response = await this.client.write("POST", `${libraryPrefix(libraryId)}/${kind}`, {
        body: JSON.stringify(batch),
        contentType: "application/json",
        headers: { "Zotero-Write-Token": randomToken() },
      });
      if (response.status !== 200) throw httpError(response, `Creating ${kind}`);
      const result = response.json as MultiWriteResult;
      const failed = Object.entries(result.failed ?? {});
      if (failed.length) {
        const [position, failure] = failed[0]!;
        throw new ZoteroError(
          "write_failed",
          `Zotero rejected ${kind === "items" ? "item" : "collection"} ${Number(position) + index + 1}: ${failure.message} (HTTP ${failure.code})`,
        );
      }
      for (let position = 0; position < batch.length; position++) {
        const key = result.successful?.[String(position)]?.key ?? result.success?.[String(position)] ?? result.unchanged?.[String(position)];
        if (!key) throw new ZoteroError("write_failed", `Zotero did not report a key for ${kind} ${position + 1}.`);
        keys.push(key);
      }
    }
    this.library.invalidate(libraryId);
    return keys;
  }

  /**
   * 修改条目：update 根据当前数据计算补丁（并发修改时以最新版本重试一次）。
   * update 返回 null 表示没有需要修改的内容。
   */
  async patchItem(
    libraryId: LibraryId,
    key: string,
    update: (current: RawItem) => Record<string, unknown> | null,
  ): Promise<{ changed: boolean; item: RawItem }> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const current = await this.library.raw(libraryId, key);
      const patch = update(current);
      if (!patch || !Object.keys(patch).length) return { changed: false, item: current };
      const response = await this.client.write("PATCH", `${libraryPrefix(libraryId)}/items/${enc(key)}`, {
        body: JSON.stringify(patch),
        contentType: "application/json",
        headers: { "If-Unmodified-Since-Version": String(current.version) },
      });
      if (response.status === 412 && attempt === 0) continue;
      if (response.status !== 204 && response.status !== 200) throw httpError(response, `Updating item ${key}`);
      this.library.invalidate(libraryId);
      return { changed: true, item: await this.library.raw(libraryId, key) };
    }
    throw new ZoteroError("version_conflict", `Item ${key} kept changing in Zotero; try again.`);
  }

  async deleteItems(libraryId: LibraryId, keys: string[]): Promise<void> {
    for (let index = 0; index < keys.length; index += 50) {
      const batch = keys.slice(index, index + 50);
      const { version } = await this.library.checkVersion(libraryId);
      const response = await this.client.write("DELETE", `${libraryPrefix(libraryId)}/items?itemKey=${batch.map(enc).join(",")}`, {
        headers: { "If-Unmodified-Since-Version": String(version) },
      });
      if (response.status !== 204) throw httpError(response, "Deleting items");
    }
    this.library.invalidate(libraryId);
  }

  async deleteCollections(libraryId: LibraryId, keys: string[]): Promise<void> {
    const { version } = await this.library.checkVersion(libraryId);
    const response = await this.client.write("DELETE", `${libraryPrefix(libraryId)}/collections?collectionKey=${keys.map(enc).join(",")}`, {
      headers: { "If-Unmodified-Since-Version": String(version) },
    });
    if (response.status !== 204) throw httpError(response, "Deleting collections");
    this.library.invalidate(libraryId);
  }

  /**
   * 为条目附加 PDF：创建附件条目，再走本地 API 的三步上传（授权 → 传字节 → 登记）。
   * 上传失败时删除刚建的附件条目，避免留下没有文件的附件。
   */
  async attachFile(
    libraryId: LibraryId,
    parentKey: string | null,
    file: { bytes: Uint8Array; filename: string; contentType: string; title: string; url?: string },
  ): Promise<string> {
    const [attachmentKey] = await this.create(libraryId, "items", [
      {
        itemType: "attachment",
        ...(parentKey ? { parentItem: parentKey } : {}),
        linkMode: file.url ? "imported_url" : "imported_file",
        title: file.title,
        contentType: file.contentType,
        filename: file.filename,
        ...(file.url ? { url: file.url, accessDate: new Date().toISOString().replace(/\.\d+Z$/, "Z") } : {}),
        tags: [],
        relations: {},
      },
    ]);
    try {
      await this.uploadFile(libraryId, attachmentKey!, file);
    } catch (error) {
      await this.deleteItems(libraryId, [attachmentKey!]).catch(() => undefined);
      throw error;
    }
    return attachmentKey!;
  }

  private async uploadFile(libraryId: LibraryId, attachmentKey: string, file: { bytes: Uint8Array; filename: string; contentType: string }) {
    const md5 = createHash("md5").update(file.bytes).digest("hex");
    const path = `${libraryPrefix(libraryId)}/items/${enc(attachmentKey)}/file`;
    const form = new URLSearchParams({
      md5,
      filename: file.filename,
      filesize: String(file.bytes.length),
      mtime: String(Date.now()),
      contentType: file.contentType,
    });
    const authorize = await this.client.write("POST", path, {
      body: form.toString(),
      contentType: "application/x-www-form-urlencoded",
      headers: { "If-None-Match": "*" },
    });
    if (authorize.status !== 200) throw httpError(authorize, "Authorizing the file upload");
    const grant = authorize.json as { exists?: number; url?: string; uploadKey?: string } | undefined;
    if (grant?.exists) return;
    if (!grant?.url || !grant.uploadKey) throw new ZoteroError("write_failed", "Zotero did not return an upload URL.");
    const sent = await this.client.upload(grant.url, file.bytes, file.contentType);
    if (sent.status !== 201 && sent.status !== 200 && sent.status !== 204) throw httpError(sent, "Uploading the file");
    const register = await this.client.write("POST", path, {
      body: new URLSearchParams({ upload: grant.uploadKey }).toString(),
      contentType: "application/x-www-form-urlencoded",
      headers: { "If-None-Match": "*" },
    });
    if (register.status !== 204 && register.status !== 200) throw httpError(register, "Registering the uploaded file");
  }
}

function randomToken() {
  return createHash("sha1").update(`${Date.now()}:${Math.random()}`).digest("hex").slice(0, 32);
}
