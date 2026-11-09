import { fileURLToPath } from "node:url";
import {
  LIMITS,
  ZoteroError,
  libraryPrefix,
  type Annotation,
  type AttachmentInfo,
  type CollectionNode,
  type CollectionsDoc,
  type ItemDetail,
  type ItemList,
  type ItemQuery,
  type ItemSummary,
  type LibraryId,
  type LibraryInfo,
  type NoteInfo,
  type SavedSearch,
} from "#z/contract.ts";
import { htmlToText, parseAnnotation, summarize, type RawItem } from "#z/domain/items.ts";
import type { ZoteroClient } from "#z/zotero/client.ts";

interface RawCollection {
  key: string;
  version: number;
  meta?: { numItems?: number; numCollections?: number };
  data: { key: string; name: string; parentCollection: string | false };
}
interface RawSearch {
  key: string;
  data: { key: string; name: string };
}
interface RawGroup {
  id: number;
  data?: { name?: string; libraryEditing?: string };
  meta?: { numItems?: number };
}

const enc = encodeURIComponent;

/** 只读访问：把本地 API 的 JSON 整理成 contract 里的结构。按库版本缓存集合与注释。 */
export class Library {
  private collectionsCache = new Map<LibraryId, CollectionsDoc>();
  private annotationCache = new Map<LibraryId, { version: number; annotations: RawItem[]; parents: Map<string, RawItem> }>();
  private fieldsCache = new Map<string, Set<string>>();
  private versions = new Map<LibraryId, number>();

  constructor(readonly client: ZoteroClient) {}

  versionOf(library: LibraryId): number {
    return this.versions.get(library) ?? 0;
  }

  private noteVersion(library: LibraryId, header: string | null) {
    const version = Number(header);
    if (Number.isFinite(version) && version > 0) this.versions.set(library, version);
  }

  /** 库的当前版本。since 未变时 Zotero 回 304，代价很小。 */
  async checkVersion(library: LibraryId): Promise<{ version: number; changed: boolean }> {
    const since = this.versions.get(library);
    const response = await this.client.get(`${libraryPrefix(library)}/items/top?limit=1&format=keys`, {
      headers: since ? { "If-Modified-Since-Version": String(since) } : {},
    });
    if (response.status === 304) return { version: since!, changed: false };
    this.noteVersion(library, response.headers.get("last-modified-version"));
    return { version: this.versionOf(library), changed: since !== this.versionOf(library) };
  }

  async libraries(): Promise<LibraryInfo[]> {
    const { data: groups } = await this.client.getJson<RawGroup[]>("/api/users/0/groups");
    const user: LibraryInfo = { id: "user", name: "My Library", type: "user", editable: true, version: this.versions.get("user") };
    return [
      user,
      ...groups.map((group) => ({
        id: `g${group.id}`,
        name: group.data?.name ?? `Group ${group.id}`,
        type: "group" as const,
        editable: group.data?.libraryEditing !== "admins",
        version: this.versions.get(`g${group.id}`),
      })),
    ];
  }

  async collections(library: LibraryId): Promise<CollectionsDoc> {
    const { version } = await this.checkVersion(library);
    const cached = this.collectionsCache.get(library);
    if (cached && cached.version === version) return cached;
    const prefix = libraryPrefix(library);
    const [{ data: collections }, { data: searches }] = await Promise.all([
      this.client.getJson<RawCollection[]>(`${prefix}/collections`),
      this.client.getJson<RawSearch[]>(`${prefix}/searches`),
    ]);
    const doc: CollectionsDoc = {
      library,
      version,
      collections: collections
        .map(
          (raw): CollectionNode => ({
            key: raw.key,
            name: raw.data.name,
            parent: raw.data.parentCollection || null,
            numItems: raw.meta?.numItems ?? 0,
            numCollections: raw.meta?.numCollections ?? 0,
          }),
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
      searches: searches.map((raw): SavedSearch => ({ key: raw.key, name: raw.data.name })).sort((a, b) => a.name.localeCompare(b.name)),
    };
    this.collectionsCache.set(library, doc);
    return doc;
  }

  /** 集合 key 或名称（大小写不敏感，可写成 "父/子" 路径）到 key。 */
  async resolveCollection(library: LibraryId, ref: string): Promise<CollectionNode> {
    const { collections } = await this.collections(library);
    const byKey = collections.find((node) => node.key === ref);
    if (byKey) return byKey;
    const path = ref.split("/").map((part) => part.trim().toLowerCase()).filter(Boolean);
    const matches = collections.filter((node) => {
      let current: CollectionNode | undefined = node;
      for (let index = path.length - 1; index >= 0; index--) {
        if (!current || current.name.toLowerCase() !== path[index]) return false;
        current = current.parent ? collections.find((other) => other.key === current!.parent) : undefined;
      }
      return true;
    });
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1)
      throw new ZoteroError("invalid_input", `Several collections are named "${ref}": ${matches.map((node) => node.key).join(", ")}. Use a key.`);
    throw new ZoteroError("not_found", `No collection "${ref}". Call list_collections to see the collections.`);
  }

  /** 集合及其所有子集合的 key。 */
  async collectionTree(library: LibraryId, key: string): Promise<string[]> {
    const { collections } = await this.collections(library);
    const keys = [key];
    for (let index = 0; index < keys.length; index++)
      for (const node of collections) if (node.parent === keys[index]) keys.push(node.key);
    return keys;
  }

  async items(library: LibraryId, query: ItemQuery): Promise<ItemList> {
    const prefix = libraryPrefix(library);
    const limit = Math.min(Math.max(query.limit ?? LIMITS.pageSize, 1), 500);
    const start = Math.max(query.start ?? 0, 0);
    if (query.keys?.length) {
      const raw = await this.itemsByKey(library, query.keys);
      const order = new Map(query.keys.map((key, index) => [key, index]));
      raw.sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0));
      return { library, version: this.versionOf(library), query, total: raw.length, items: raw.map(summarize) };
    }
    const params = new URLSearchParams();
    if (query.q) {
      params.set("q", query.q);
      params.set("qmode", query.mode ?? "titleCreatorYear");
    }
    if (query.tag) params.set("tag", query.tag);
    params.set("sort", query.sort ?? "dateModified");
    params.set("direction", query.direction ?? (query.sort === "title" || query.sort === "creator" ? "asc" : "desc"));
    params.set("start", String(start));
    params.set("limit", String(limit));
    let path: string;
    if (query.search) path = `${prefix}/searches/${enc(query.search)}/items`;
    else if (query.collection) path = `${prefix}/collections/${enc(query.collection)}/items/top`;
    else path = `${prefix}/items/top`;
    const { data, response } = await this.client.getJson<RawItem[]>(`${path}?${params}`);
    this.noteVersion(library, response.headers.get("last-modified-version"));
    // 已保存搜索可能返回子条目与注释；面板只列顶层条目。
    const items = data.filter((item) => item.data.itemType !== "annotation" && (!query.search || !item.data.parentItem));
    const total = Number(response.headers.get("total-results") ?? items.length);
    return { library, version: this.versionOf(library), query, total, items: items.map(summarize) };
  }

  async itemsByKey(library: LibraryId, keys: string[]): Promise<RawItem[]> {
    const prefix = libraryPrefix(library);
    const results: RawItem[] = [];
    for (let index = 0; index < keys.length; index += 50) {
      const batch = keys.slice(index, index + 50);
      const { data } = await this.client.getJson<RawItem[]>(`${prefix}/items?itemKey=${batch.map(enc).join(",")}`);
      results.push(...data);
    }
    return results;
  }

  async raw(library: LibraryId, key: string): Promise<RawItem> {
    // 单个对象的 Last-Modified-Version 是对象版本而不是库版本，所以这里不记录版本。
    const { data } = await this.client.getJson<RawItem>(`${libraryPrefix(library)}/items/${enc(key)}`).catch((error) => {
      if (error instanceof ZoteroError && error.code === "not_found")
        throw new ZoteroError("not_found", `No item with key ${key} in ${library === "user" ? "My Library" : `library ${library}`}.`);
      throw error;
    });
    return data;
  }

  async children(library: LibraryId, key: string): Promise<RawItem[]> {
    const { data } = await this.client.getJson<RawItem[]>(`${libraryPrefix(library)}/items/${enc(key)}/children`);
    return data;
  }

  async item(library: LibraryId, key: string): Promise<ItemDetail> {
    const raw = await this.raw(library, key);
    const children = raw.data.itemType === "attachment" || raw.data.itemType === "note" ? [] : await this.children(library, key);
    const { collections } = await this.collections(library);
    const names = new Map(collections.map((node) => [node.key, node.name]));
    const summary = summarize(raw);
    const attachments: AttachmentInfo[] = [];
    const notes: NoteInfo[] = [];
    const own = raw.data.itemType === "attachment" ? [raw] : raw.data.itemType === "note" ? [] : children;
    for (const child of own) {
      if (child.data.itemType === "attachment") attachments.push(attachmentInfo(child));
      else if (child.data.itemType === "note")
        notes.push({
          key: child.key,
          html: String(child.data.note ?? ""),
          excerpt: htmlToText(String(child.data.note ?? "")).slice(0, 400),
          dateModified: String(child.data.dateModified ?? ""),
        });
    }
    if (raw.data.itemType === "note")
      notes.push({
        key: raw.key,
        html: String(raw.data.note ?? ""),
        excerpt: htmlToText(String(raw.data.note ?? "")).slice(0, 400),
        dateModified: String(raw.data.dateModified ?? ""),
      });
    // PDF 优先，其次按标题。
    attachments.sort((a, b) => Number(b.isPdf) - Number(a.isPdf) || a.title.localeCompare(b.title));
    const skip = new Set([
      "key", "version", "itemType", "title", "creators", "abstractNote", "tags", "collections", "relations",
      "dateAdded", "dateModified", "parentItem", "note", "accessDate", "libraryCatalog",
    ]);
    const fields: Record<string, string> = {};
    for (const [name, value] of Object.entries(raw.data))
      if (!skip.has(name) && (typeof value === "string" || typeof value === "number") && String(value).trim()) fields[name] = String(value);
    return {
      ...summary,
      pdf: summary.pdf ?? (attachments.find((attachment) => attachment.isPdf) ? { key: attachments.find((attachment) => attachment.isPdf)!.key } : null),
      library,
      version: this.versionOf(library),
      itemVersion: raw.version,
      creators: (raw.data.creators as ItemDetail["creators"] | undefined) ?? [],
      fields,
      abstract: String(raw.data.abstractNote ?? ""),
      collections: ((raw.data.collections as string[] | undefined) ?? []).map((ckey) => ({ key: ckey, name: names.get(ckey) ?? ckey })),
      attachments,
      notes,
      parent: (raw.data.parentItem as string | undefined) ?? null,
    };
  }

  /**
   * 解析 key 为 PDF 附件：条目本身是 PDF 附件时直接返回，否则取其首个 PDF 子附件。
   * 返回 { item, attachment }，item 为父条目（独立附件时为附件自身）。
   */
  async resolvePdf(library: LibraryId, key: string): Promise<{ item: RawItem; attachment: RawItem }> {
    const raw = await this.raw(library, key);
    if (raw.data.itemType === "attachment") {
      if (raw.data.contentType !== "application/pdf")
        throw new ZoteroError("not_pdf", `Attachment ${key} is ${raw.data.contentType || "not a PDF"}; only PDFs can be read page by page.`);
      const parentKey = raw.data.parentItem as string | undefined;
      return { item: parentKey ? await this.raw(library, parentKey) : raw, attachment: raw };
    }
    if (raw.data.itemType === "annotation" || raw.data.itemType === "note")
      throw new ZoteroError("not_pdf", `${key} is a ${raw.data.itemType}, not an item with a PDF.`);
    const pdfs = (await this.children(library, key)).filter(
      (child) => child.data.itemType === "attachment" && child.data.contentType === "application/pdf" && child.data.linkMode !== "linked_url",
    );
    // Zotero 的“最佳附件”优先。
    const best = raw.links?.attachment?.href?.split("/").pop();
    const attachment = pdfs.find((child) => child.key === best) ?? pdfs[0];
    if (!attachment) throw new ZoteroError("not_pdf", `"${String(raw.data.title ?? key)}" (${key}) has no PDF attachment.`);
    return { item: raw, attachment };
  }

  /** 附件文件在本机的路径（只用 Zotero 报告的路径）。 */
  async filePath(library: LibraryId, attachmentKey: string): Promise<string> {
    const response = await this.client.get(`${libraryPrefix(library)}/items/${enc(attachmentKey)}/file/view/url`, { allow: [400] });
    if (response.status === 400) throw new ZoteroError("not_pdf", `${attachmentKey} is not a file attachment.`);
    const url = response.text.trim();
    if (!url.startsWith("file:")) throw new ZoteroError("file_missing", `Zotero has no local file for attachment ${attachmentKey}.`);
    return fileURLToPath(url);
  }

  /** Zotero 已索引的全文（整篇一个字符串，没有分页）。 */
  async indexedFulltext(library: LibraryId, attachmentKey: string): Promise<string | null> {
    const response = await this.client.get(`${libraryPrefix(library)}/items/${enc(attachmentKey)}/fulltext`, { allow: [404] });
    if (response.status === 404) return null;
    return String((response.json as { content?: string } | undefined)?.content ?? "") || null;
  }

  async annotations(library: LibraryId, attachmentKey: string): Promise<Annotation[]> {
    const { data } = await this.client.getJson<RawItem[]>(
      `${libraryPrefix(library)}/items/${enc(attachmentKey)}/children?itemType=annotation`,
    );
    return data.map(parseAnnotation).sort((a, b) => a.sortIndex.localeCompare(b.sortIndex));
  }

  /** 库内全部注释，附带附件与父条目（search_annotations 用）；按库版本缓存。 */
  async annotationIndex(library: LibraryId) {
    const { version } = await this.checkVersion(library);
    const cached = this.annotationCache.get(library);
    if (cached && cached.version === version) return cached;
    const prefix = libraryPrefix(library);
    const [{ data: annotations }, { data: attachments }] = await Promise.all([
      this.client.getJson<RawItem[]>(`${prefix}/items?itemType=annotation`),
      this.client.getJson<RawItem[]>(`${prefix}/items?itemType=attachment`),
    ]);
    const parents = new Map<string, RawItem>(attachments.map((item) => [item.key, item]));
    const topKeys = [...new Set(attachments.map((item) => item.data.parentItem as string | undefined).filter((key): key is string => !!key))];
    for (const item of await this.itemsByKey(library, topKeys)) parents.set(item.key, item);
    const entry = { version, annotations, parents };
    this.annotationCache.set(library, entry);
    return entry;
  }

  /** 条目类型允许的字段（写入前过滤无效字段）。 */
  async validFields(itemType: string): Promise<Set<string>> {
    const cached = this.fieldsCache.get(itemType);
    if (cached) return cached;
    const { data } = await this.client.getJson<{ field: string }[]>(`/api/itemTypeFields?itemType=${enc(itemType)}`);
    const fields = new Set(data.map((entry) => entry.field));
    this.fieldsCache.set(itemType, fields);
    return fields;
  }

  /** 导出为 bibtex / biblatex / ris / csljson 文本。 */
  async export(library: LibraryId, keys: string[], format: "bibtex" | "biblatex" | "ris" | "csljson"): Promise<string> {
    const prefix = libraryPrefix(library);
    const parts: string[] = [];
    const csl: unknown[] = [];
    for (let index = 0; index < keys.length; index += 50) {
      const batch = keys.slice(index, index + 50);
      const response = await this.client.get(`${prefix}/items?itemKey=${batch.map(enc).join(",")}&format=${format}`);
      if (format === "csljson") {
        const parsed = JSON.parse(response.text) as { items?: unknown[] } | unknown[];
        csl.push(...(Array.isArray(parsed) ? parsed : (parsed.items ?? [])));
      } else parts.push(stripLocalPaths(response.text).trim());
    }
    return format === "csljson" ? JSON.stringify(csl, null, 2) : parts.filter(Boolean).join("\n\n") + "\n";
  }

  /** 按 CSL 样式生成正文引用与参考文献条目（HTML 转纯文本）。 */
  async cite(library: LibraryId, keys: string[], style: string, locale?: string) {
    const prefix = libraryPrefix(library);
    const params = new URLSearchParams({ include: "citation,bib", style });
    if (locale) params.set("locale", locale);
    const entries: { key: string; citation: string; bib: string }[] = [];
    for (let index = 0; index < keys.length; index += 50) {
      const batch = keys.slice(index, index + 50);
      const { data } = await this.client.getJson<{ key: string; citation?: string; bib?: string }[]>(
        `${prefix}/items?itemKey=${batch.map(enc).join(",")}&${params}`,
      );
      const byKey = new Map(data.map((entry) => [entry.key, entry]));
      for (const key of batch) {
        const entry = byKey.get(key);
        if (!entry) throw new ZoteroError("not_found", `No item with key ${key}.`);
        entries.push({ key, citation: htmlToText(entry.citation ?? ""), bib: htmlToText(entry.bib ?? "") });
      }
    }
    return entries;
  }

  /** 顶层条目所在库内全部集合（含子集合）的条目 key。 */
  async collectionItemKeys(library: LibraryId, collection: string, recursive: boolean): Promise<string[]> {
    const prefix = libraryPrefix(library);
    const collections = recursive ? await this.collectionTree(library, collection) : [collection];
    const keys = new Set<string>();
    for (const key of collections) {
      const response = await this.client.get(`${prefix}/collections/${enc(key)}/items/top?format=keys`);
      for (const line of response.text.split("\n")) if (line.trim()) keys.add(line.trim());
    }
    return [...keys];
  }

  invalidate(library?: LibraryId) {
    if (library) {
      this.collectionsCache.delete(library);
      this.annotationCache.delete(library);
    } else {
      this.collectionsCache.clear();
      this.annotationCache.clear();
    }
  }
}

/** 去掉导出中指向本机存储的附件路径（BibTeX 的 file 字段、RIS 的 L1 行），避免写进共享的 .bib。 */
export function stripLocalPaths(text: string): string {
  return text
    .replace(/^[ \t]*file[ \t]*=[ \t]*\{.*\},?[ \t]*\r?\n/gim, "")
    .replace(/^L1  - .*\r?\n/gm, "");
}

export function attachmentInfo(raw: RawItem): AttachmentInfo {
  const contentType = String(raw.data.contentType ?? "");
  return {
    key: raw.key,
    title: String(raw.data.title || raw.data.filename || "Attachment"),
    contentType,
    linkMode: String(raw.data.linkMode ?? ""),
    ...(raw.data.filename ? { filename: String(raw.data.filename) } : {}),
    ...(raw.data.url ? { url: String(raw.data.url) } : {}),
    isPdf: contentType === "application/pdf" && raw.data.linkMode !== "linked_url",
    parent: (raw.data.parentItem as string | undefined) ?? null,
  };
}

export type { ItemSummary };
