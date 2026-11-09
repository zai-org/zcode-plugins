import { parentPort, workerData } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DiagramError, type Diagram, type Commit, type Operation } from "#excalidraw/contract.ts";
import { validId, validateScene, applyOperations } from "#excalidraw/domain/scene.ts";

await mkdir(workerData.root, { recursive: true });
// Node 内置 SQLite 只有同步 API；放在 worker，事务锁等待不会阻塞 MCP/宿主主循环。
const db = new DatabaseSync(join(workerData.root, "documents.sqlite"));
db.exec(`PRAGMA busy_timeout=5000;
  CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, title TEXT NOT NULL, revision INTEGER NOT NULL,
  scene TEXT NOT NULL, updatedAt INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS operations (documentId TEXT, operationId TEXT, hash TEXT NOT NULL,
  result TEXT NOT NULL, PRIMARY KEY(documentId, operationId));`);

// 编辑统一交给画板历史；迁移只移除旧专用恢复点，保留文档、版本和重试记录。
db.exec("BEGIN IMMEDIATE");
try {
  const columns = db.prepare("PRAGMA table_info(documents)").all();
  for (const column of ["agentRevision", "beforeAgent"]) {
    if (columns.some((item) => item.name === column))
      db.exec(`ALTER TABLE documents DROP COLUMN ${column}`);
  }
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}

type Row = {
  id: string;
  title: string;
  revision: number;
  scene: string;
  updatedAt: number;
};
function row(id: string): Row {
  validId(id);
  const result = db.prepare("SELECT * FROM documents WHERE id=?").get(id) as Row | undefined;
  if (!result) throw new DiagramError("not_found", "Diagram not found");
  return result;
}
function diagram(r: Row): Diagram {
  return {
    id: r.id,
    title: r.title,
    revision: r.revision,
    scene: JSON.parse(r.scene),
    updatedAt: r.updatedAt,
  };
}
function mutate(method: string, args: Commit & { operations?: Operation[] }): Diagram {
  validId(args.id);
  validId(args.operationId);
  const hash = createHash("sha256").update(JSON.stringify({ method, args })).digest("hex");
  db.exec("BEGIN IMMEDIATE");
  try {
    const previous = db
      .prepare("SELECT hash,result FROM operations WHERE documentId=? AND operationId=?")
      .get(args.id, args.operationId) as { hash: string; result: string } | undefined;
    if (previous) {
      if (previous.hash !== hash)
        throw new DiagramError("operation_conflict", "Operation id reused with different input");
      db.exec("COMMIT");
      return JSON.parse(previous.result);
    }
    const current = row(args.id);
    if (current.revision !== args.expectedRevision)
      throw new DiagramError(
        "revision_conflict",
        `Expected revision ${args.expectedRevision}; current revision ${current.revision}`,
      );
    const scene = JSON.stringify(
      method === "apply"
        ? applyOperations(JSON.parse(current.scene), args.operations!)
        : validateScene(args.scene),
    );
    const revision = current.revision + 1;
    const title = args.title === undefined ? current.title : args.title.trim();
    if (!title || title.length > 200)
      throw new DiagramError("invalid_title", "Title must contain 1 to 200 characters");
    const updatedAt = Date.now();
    db.prepare("UPDATE documents SET scene=?,title=?,revision=?,updatedAt=? WHERE id=?").run(
      scene,
      title,
      revision,
      updatedAt,
      current.id,
    );
    const result = diagram({ ...current, scene, title, revision, updatedAt });
    db.prepare("INSERT INTO operations VALUES (?,?,?,?)").run(
      args.id,
      args.operationId,
      hash,
      JSON.stringify(result),
    );
    // 幂等记录保留最近 32 次提交，限制大画布产生的持久化增量。
    db.prepare(
      "DELETE FROM operations WHERE documentId=? AND rowid NOT IN (SELECT rowid FROM operations WHERE documentId=? ORDER BY rowid DESC LIMIT 32)",
    ).run(args.id, args.id);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
parentPort!.on("message", ({ id, method, args }) => {
  try {
    let result: unknown;
    if (method === "create") {
      const docId = args.id ?? randomUUID();
      validId(docId);
      const title = String(args.title).trim().slice(0, 200) || "Untitled";
      const scene = validateScene(args.scene);
      db.prepare("INSERT INTO documents(id,title,revision,scene,updatedAt) VALUES (?,?,1,?,?)").run(
        docId,
        title,
        JSON.stringify(scene),
        Date.now(),
      );
      result = diagram(row(docId));
    } else if (method === "read") result = diagram(row(args.id));
    else if (method === "list")
      result = db
        .prepare(
          "SELECT id,title,revision,updatedAt FROM documents ORDER BY updatedAt DESC LIMIT 100",
        )
        .all();
    else if (method === "commit" || method === "apply") result = mutate(method, args);
    else if (method === "close") db.close();
    else throw new DiagramError("unknown_method", "Unknown store request");
    parentPort!.postMessage({ id, result });
  } catch (error) {
    parentPort!.postMessage({
      id,
      error: {
        code: error instanceof DiagramError ? error.code : "storage_error",
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
});
