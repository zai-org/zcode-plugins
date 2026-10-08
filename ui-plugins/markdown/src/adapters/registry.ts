// 文档注册表是 revision 的唯一所有者；按规范化路径串行读写，避免并发保存越过 CAS。
import { createHash } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, isAbsolute, sep } from "node:path";
import { MarkdownError, WATCH_DEBOUNCE_MS, type PatchOp, type DocumentRef } from "../contract.ts";
import { readWorkspaceFile, writeWorkspaceFile } from "./files.ts";

export interface OpenDocument {
  id: string;
  path: string;
  revision: number;
  hash: string;
  externalChange: boolean;
  watcher?: FSWatcher;
  timer?: ReturnType<typeof setTimeout>;
  poller?: ReturnType<typeof setInterval>;
}
export type ChangeListener = (id: string) => void;
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

export class DocumentRegistry {
  private readonly documents = new Map<string, OpenDocument>();
  private readonly listeners = new Set<ChangeListener>();
  private readonly operations = new Map<string, Promise<unknown>>();
  constructor(
    private readonly workspace: string,
    private readonly notifyChange: ChangeListener = () => {},
  ) {}

  onChange(listener: ChangeListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit(id: string) {
    for (const listener of this.listeners) listener(id);
    this.notifyChange(id);
  }
  get(id: string) {
    return this.documents.get(id);
  }
  list() {
    return [...this.documents.values()];
  }
  static idFor(path: string) {
    return `m${sha256(path).slice(0, 12)}`;
  }
  private tracked(doc: OpenDocument) {
    if (this.documents.get(doc.id) !== doc)
      throw new MarkdownError("unknown_document", `Document is closed: ${doc.id}`);
  }
  private serial<T>(id: string, run: () => Promise<T>): Promise<T> {
    const operation = (this.operations.get(id) ?? Promise.resolve()).catch(() => {}).then(run);
    this.operations.set(id, operation);
    const cleanup = () => {
      if (this.operations.get(id) === operation) this.operations.delete(id);
    };
    void operation.then(cleanup, cleanup);
    return operation;
  }
  private normalize(path: string) {
    const rel = relative(this.workspace, resolve(this.workspace, path));
    if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`))
      throw new MarkdownError("path_outside_workspace", "Path is outside this workspace");
    return rel;
  }
  async open(
    inputPath: string,
    content?: string,
    create = false,
  ): Promise<{ doc: OpenDocument; content: string; created: boolean }> {
    const path = this.normalize(inputPath);
    const id = DocumentRegistry.idFor(path);
    return this.serial(id, async () => {
      const existing = this.documents.get(id);
      // new_document 必须拒绝重名，不能因为已打开就伪报创建成功。
      if (create) await writeWorkspaceFile(this.workspace, path, content ?? "", false);
      const text = create
        ? (content ?? "")
        : (await readWorkspaceFile(this.workspace, path)).content;
      if (existing) {
        this.acceptDisk(existing, text);
        return { doc: existing, content: text, created: create };
      }
      const doc: OpenDocument = {
        id,
        path,
        revision: 1,
        hash: sha256(text),
        externalChange: false,
      };
      this.documents.set(id, doc);
      this.watchDocument(doc);
      return { doc, content: text, created: create };
    });
  }
  private acceptDisk(doc: OpenDocument, content: string) {
    const hash = sha256(content);
    if (hash === doc.hash) return;
    doc.hash = hash;
    doc.revision += 1;
    doc.externalChange = true;
    this.emit(doc.id);
  }
  private async current(doc: OpenDocument) {
    this.tracked(doc);
    const { content } = await readWorkspaceFile(this.workspace, doc.path);
    this.tracked(doc);
    this.acceptDisk(doc, content);
    return content;
  }
  read(doc: OpenDocument): Promise<string> {
    return this.serial(doc.id, async () => {
      const content = await this.current(doc);
      doc.externalChange = false;
      return content;
    });
  }
  private checkRevision(doc: OpenDocument, expected?: number) {
    if (expected !== undefined && expected !== doc.revision)
      throw new MarkdownError(
        "revision_conflict",
        `Document changed: expected revision ${doc.revision}`,
      );
  }
  private async write(doc: OpenDocument, content: string) {
    this.tracked(doc);
    await writeWorkspaceFile(this.workspace, doc.path, content, true);
    doc.hash = sha256(content);
    doc.revision += 1;
    doc.externalChange = false;
    this.emit(doc.id);
    return this.ref(doc);
  }
  save(doc: OpenDocument, content: string, expectedRevision: number): Promise<DocumentRef> {
    return this.serial(doc.id, async () => {
      // fs.watch 防抖期间磁盘已经可能变化；比较 revision 前必须同步读取磁盘事实。
      await this.current(doc);
      this.checkRevision(doc, expectedRevision);
      return this.write(doc, content);
    });
  }
  forceSave(doc: OpenDocument, content: string): Promise<DocumentRef> {
    return this.serial(doc.id, () => this.write(doc, content));
  }
  reload(doc: OpenDocument): Promise<{ ref: DocumentRef; content: string }> {
    return this.serial(doc.id, async () => {
      this.tracked(doc);
      const { content } = await readWorkspaceFile(this.workspace, doc.path);
      doc.hash = sha256(content);
      doc.revision += 1;
      doc.externalChange = false;
      this.emit(doc.id);
      return { ref: this.ref(doc), content };
    });
  }
  patch(doc: OpenDocument, ops: PatchOp[], expectedRevision?: number) {
    return this.serial(doc.id, async () => {
      let content = await this.current(doc);
      this.checkRevision(doc, expectedRevision);
      let replacements = 0;
      for (const op of ops) {
        if (!op.find) throw new MarkdownError("invalid_input", "find must not be empty");
        const replace = () => {
          replacements += 1;
          return op.replace;
        };
        // 回调返回字面量，避免 $& / $$ 等 Markdown 内容被 String.replace 当替换模板展开。
        content = op.all ? content.replaceAll(op.find, replace) : content.replace(op.find, replace);
      }
      if (!replacements)
        throw new MarkdownError("no_matches", "None of the find patterns matched the document");
      const ref = await this.write(doc, content);
      return { ref, content, replacements };
    });
  }
  close(id: string) {
    const doc = this.documents.get(id);
    if (!doc) throw new MarkdownError("unknown_document", `Unknown document id ${id}`);
    doc.watcher?.close();
    if (doc.timer) clearTimeout(doc.timer);
    if (doc.poller) clearInterval(doc.poller);
    this.documents.delete(id);
  }
  ref(doc: OpenDocument): DocumentRef {
    return { id: doc.id, path: doc.path, revision: doc.revision, bytes: -1 };
  }
  private watchDocument(doc: OpenDocument) {
    const dir = join(this.workspace, dirname(doc.path));
    // macOS/网络盘可能漏发 fs.watch；只轮询元信息，变化时才读取正文。
    // 首次检查也读一次，覆盖 watcher 注册与第一次系统事件之间的窗口。
    let stamp = "";
    let checking = false;
    doc.poller = setInterval(async () => {
      if (checking || this.documents.get(doc.id) !== doc) return;
      checking = true;
      try {
        const info = await stat(join(this.workspace, doc.path));
        const next = `${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
        if (next !== stamp) {
          await this.serial(doc.id, () => this.current(doc));
          stamp = next;
        }
      } catch {
        // 暂时移走/替换中的文件保留草稿，之后继续检查。
      } finally {
        checking = false;
      }
    }, 1500);
    doc.poller.unref();
    try {
      doc.watcher = watch(dir, { recursive: false });
      doc.watcher.on("change", (_event, filename) => {
        if (filename && basename(String(filename)) !== basename(doc.path)) return;
        if (doc.timer) clearTimeout(doc.timer);
        doc.timer = setTimeout(() => {
          void this.serial(doc.id, () => this.current(doc)).catch(() => {});
        }, WATCH_DEBOUNCE_MS);
      });
      doc.watcher.on("error", (error) =>
        process.stderr.write(`markdown: watcher error: ${String(error)}\n`),
      );
    } catch (error) {
      process.stderr.write(`markdown: watch failed: ${String(error)}\n`);
    }
  }
}
