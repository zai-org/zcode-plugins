import { describe, expect, it, vi } from "vitest";
import { createEditorController } from "#excalidraw/app/editor.ts";
import type { Diagram } from "#excalidraw/contract.ts";

const doc = (id = "one", revision = 1): Diagram => ({
  id,
  revision,
  title: id,
  updatedAt: 1,
  scene: { elements: [], appState: { viewBackgroundColor: `#00000${revision}` }, files: {} },
});

describe("editor history boundaries", () => {
  it("waits for pending saves before closing and can reopen the saved document", async () => {
    let loaded = doc();
    let finishCommit: () => void = () => {};
    const editor = createEditorController({
      read: async () => loaded,
      commit: async (input) => {
        await new Promise<void>((resolve) => {
          finishCommit = resolve;
        });
        loaded = { ...loaded, revision: 2, scene: input.scene };
        return loaded;
      },
      onScene: vi.fn(),
      onState: vi.fn(),
    });
    await editor.open("one");
    editor.edit(doc("one", 2).scene);
    const closing = editor.close();
    expect(editor.state().document?.id).toBe("one");
    finishCommit();
    await closing;
    expect(editor.state()).toEqual({ document: null, dirty: false, saving: false, error: null });
    await editor.open("one");
    expect(editor.state().document).toMatchObject({ revision: 2, scene: doc("one", 2).scene });
  });

  it("does not reopen an in-flight read after the current document is closed", async () => {
    let finishRead: (value: Diagram) => void = () => {};
    const read = vi.fn(async () => doc());
    const editor = createEditorController({
      read,
      commit: vi.fn(),
      onScene: vi.fn(),
      onState: vi.fn(),
    });
    await editor.open("one");
    read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        }),
    );
    const opening = editor.open("two");
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    await editor.close();
    finishRead(doc("two"));
    await opening;
    expect(editor.state().document).toBeNull();
  });

  it("saves a rename queued during an edit without resetting the scene or losing the title", async () => {
    let loaded = doc();
    let finishCommit: () => void = () => {};
    const onScene = vi.fn();
    const commit = vi.fn(async (input) => {
      if (input.expectedRevision === 1)
        await new Promise<void>((resolve) => {
          finishCommit = resolve;
        });
      loaded = {
        ...loaded,
        revision: loaded.revision + 1,
        scene: input.scene,
        title: input.title ?? loaded.title,
      };
      return loaded;
    });
    const editor = createEditorController({
      read: async () => loaded,
      commit,
      onScene,
      onState: vi.fn(),
    });
    await editor.open("one");
    const scene = doc("one", 2).scene;
    editor.edit(scene);
    const renamed = editor.rename("New title");
    finishCommit();
    await renamed;
    expect(editor.state()).toMatchObject({
      document: { title: "New title", revision: 3, scene },
      dirty: false,
      saving: false,
    });
    expect(commit).toHaveBeenCalledTimes(2);
    expect(onScene).toHaveBeenCalledTimes(1);
    await editor.rename("  New title  ");
    expect(commit).toHaveBeenCalledTimes(2);
  });

  it("initializes only on document changes; ignores duplicate and older revisions", async () => {
    let current = doc();
    const onScene = vi.fn();
    const editor = createEditorController({
      read: async () => current,
      commit: vi.fn(),
      onScene,
      onState: vi.fn(),
    });
    await editor.open("one");
    expect(onScene).toHaveBeenLastCalledWith(current.scene, "reset");
    current = doc("one", 2);
    await editor.open("one");
    expect(onScene).toHaveBeenLastCalledWith(current.scene, "update");
    await editor.open("one");
    current = doc();
    await editor.open("one");
    expect(onScene).toHaveBeenCalledTimes(2);
    current = doc("two");
    await editor.open("two");
    expect(onScene).toHaveBeenLastCalledWith(current.scene, "reset");
  });

  it("does not replace edits made while a document read is in flight", async () => {
    let loaded = doc();
    let finishRead: (value: Diagram) => void = () => {};
    const read = vi.fn(async () => loaded);
    const onScene = vi.fn();
    const editor = createEditorController({
      read,
      onScene,
      onState: vi.fn(),
      commit: async (input) => (loaded = { ...doc("one", 3), scene: input.scene }),
    });
    await editor.open("one");
    read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        }),
    );
    const refresh = editor.open("one");
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    editor.edit(doc("one", 3).scene);
    await editor.flush();
    finishRead(doc("one", 2));
    await refresh;
    expect(editor.state().document?.revision).toBe(3);
    expect(onScene).toHaveBeenCalledTimes(1);
  });

  it("keeps conflicted drafts until explicitly discarded", async () => {
    const onScene = vi.fn();
    const editor = createEditorController({
      read: async () => doc(),
      onScene,
      onState: vi.fn(),
      commit: async () => {
        throw new Error("revision_conflict");
      },
    });
    await editor.open("one");
    editor.edit(doc("one", 2).scene);
    await expect(editor.flush()).rejects.toThrow("revision_conflict");
    await expect(editor.open("one")).rejects.toThrow("revision_conflict");
    await expect(editor.close()).rejects.toThrow("revision_conflict");
    expect(editor.state().document?.id).toBe("one");
    expect(editor.scene()).toEqual(doc("one", 2).scene);
    await editor.open("one", true);
    expect(editor.state().dirty).toBe(false);
    expect(onScene).toHaveBeenLastCalledWith(doc().scene, "reset");
  });

  it("keeps a failed rename unsaved when the same title is submitted again", async () => {
    const editor = createEditorController({
      read: async () => doc(),
      onScene: vi.fn(),
      onState: vi.fn(),
      commit: async () => {
        throw new Error("revision_conflict");
      },
    });
    await editor.open("one");
    await expect(editor.rename("New title")).rejects.toThrow("revision_conflict");
    await expect(editor.rename("New title")).rejects.toThrow("revision_conflict");
    expect(editor.state()).toMatchObject({
      document: { title: "one" },
      dirty: true,
      error: "revision_conflict",
    });
    await editor.open("one", true);
    expect(editor.state().dirty).toBe(false);
  });
});
