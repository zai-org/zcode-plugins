import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createDocumentStore } from "#excalidraw/adapters/store.ts";
import { makeScene } from "#excalidraw/domain/scene.ts";
import type { DocumentStore } from "#excalidraw/contract.ts";

const resources: Array<{ root: string; store?: DocumentStore }> = [];
afterEach(async () => {
  const completed = resources.splice(0);
  for (const resource of completed) await resource.store?.close();
  for (const root of new Set(completed.map((resource) => resource.root)))
    await rm(root, { recursive: true, force: true });
});
describe("document persistence", () => {
  it("persists renames atomically with revision and idempotency checks", async () => {
    const root = await mkdtemp(join(tmpdir(), "excalidraw-rename-"));
    const store = createDocumentStore(root);
    resources.push({ root, store });
    const original = await store.create("Old title", makeScene([{ id: "box" }]), "one");
    const input = {
      id: "one",
      expectedRevision: 1,
      operationId: "rename",
      title: "  New title  ",
      scene: original.scene,
    };
    const renamed = await store.commit(input);
    expect(renamed).toMatchObject({
      id: "one",
      title: "New title",
      revision: 2,
      scene: original.scene,
    });
    expect(await store.commit(input)).toEqual(renamed);
    await expect(store.commit({ ...input, title: "Different" })).rejects.toMatchObject({
      code: "operation_conflict",
    });
    await expect(store.commit({ ...input, operationId: "stale" })).rejects.toMatchObject({
      code: "revision_conflict",
    });
    await expect(
      store.commit({ ...input, operationId: "blank", expectedRevision: 2, title: "  " }),
    ).rejects.toMatchObject({ code: "invalid_title" });
    expect((await store.list())[0]).toMatchObject({ title: "New title", revision: 2 });
    await store.close();
    const reopened = createDocumentStore(root);
    resources.push({ root, store: reopened });
    expect(await reopened.read("one")).toEqual(renamed);
    const edited = await reopened.commit({
      id: "one",
      expectedRevision: 2,
      operationId: "edit",
      scene: original.scene,
    });
    expect(edited.title).toBe("New title");
  });

  it("migrates existing documents without discarding content or idempotency records", async () => {
    const root = await mkdtemp(join(tmpdir(), "excalidraw-migration-"));
    const resource: { root: string; store?: DocumentStore } = { root };
    resources.push(resource);
    const scene = makeScene([{ id: "box" }]);
    const db = new DatabaseSync(join(root, "documents.sqlite"));
    db.exec(
      "CREATE TABLE documents (id TEXT PRIMARY KEY, title TEXT NOT NULL, revision INTEGER NOT NULL, scene TEXT NOT NULL, updatedAt INTEGER NOT NULL, agentRevision INTEGER, beforeAgent TEXT); CREATE TABLE operations (documentId TEXT, operationId TEXT, hash TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(documentId, operationId));",
    );
    db.prepare("INSERT INTO documents VALUES (?,?,?,?,?,?,?)").run(
      "legacy",
      "旧画板",
      7,
      JSON.stringify(scene),
      1,
      7,
      JSON.stringify(scene),
    );
    db.prepare("INSERT INTO operations VALUES (?,?,?,?)").run("legacy", "old-op", "hash", "{}");
    db.close();
    resource.store = createDocumentStore(root);
    expect(await resource.store.read("legacy")).toMatchObject({
      title: "旧画板",
      revision: 7,
      scene,
    });
    await resource.store.close();
    const migrated = new DatabaseSync(join(root, "documents.sqlite"), { readOnly: true });
    try {
      expect(
        migrated
          .prepare("PRAGMA table_info(documents)")
          .all()
          .map((row) => row.name),
      ).not.toContain("beforeAgent");
      expect(
        migrated
          .prepare("PRAGMA table_info(documents)")
          .all()
          .map((row) => row.name),
      ).not.toContain("agentRevision");
      expect(migrated.prepare("SELECT count(*) AS count FROM operations").get()?.count).toBe(1);
    } finally {
      migrated.close();
    }
  });

  it("persists undo as a regular new revision and keeps conflict/idempotency checks", async () => {
    const root = await mkdtemp(join(tmpdir(), "excalidraw-edits-"));
    const store = createDocumentStore(root);
    resources.push({ root, store });
    const original = await store.create("diagram", makeScene([{ id: "box" }]), "one");
    const update = {
      id: "one",
      expectedRevision: 1,
      operationId: "edit",
      operations: [{ type: "update" as const, id: "box", changes: { backgroundColor: "red" } }],
    };
    const edited = await store.apply(update);
    expect(await store.apply(update)).toEqual(edited);
    await expect(
      store.commit({ id: "one", expectedRevision: 1, operationId: "stale", scene: original.scene }),
    ).rejects.toMatchObject({ code: "revision_conflict" });
    const undone = await store.commit({
      id: "one",
      expectedRevision: 2,
      operationId: "undo",
      scene: original.scene,
    });
    expect(undone.revision).toBe(3);
    expect(undone.scene).toEqual(original.scene);
    await store.close();
    const reopened = createDocumentStore(root);
    resources.push({ root, store: reopened });
    expect(await reopened.read("one")).toEqual(undone);
  });
});
