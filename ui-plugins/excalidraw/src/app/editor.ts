import type { Commit, Diagram, Scene } from "#excalidraw/contract.ts";
import { validateScene } from "#excalidraw/domain/scene.ts";

export interface EditorState {
  document: Diagram | null;
  dirty: boolean;
  saving: boolean;
  error: string | null;
}
export function createEditorController(ports: {
  read(id: string): Promise<Diagram>;
  commit(input: Commit): Promise<Diagram>;
  onScene(scene: Scene, mode: "reset" | "update"): void;
  onState(state: EditorState): void;
}) {
  let document: Diagram | null = null;
  let draft: Scene | null = null;
  let draftTitle: string | null = null;
  let saving: Promise<void> | null = null;
  let error: string | null = null;
  let generation = 0;
  const state = (): EditorState => ({
    document,
    dirty: draft !== null || draftTitle !== null,
    saving: saving !== null,
    error,
  });
  const emit = () => ports.onState(state());
  const fingerprint = (scene: Scene) => JSON.stringify(scene);
  async function flush(): Promise<void> {
    if (saving) return saving;
    if (error) throw new Error(error);
    if ((!draft && draftTitle === null) || !document) return;
    const run = async () => {
      while ((draft || draftTitle !== null) && document) {
        const scene = draft ?? document.scene;
        const title = draftTitle;
        const written = await ports.commit({
          id: document.id,
          expectedRevision: document.revision,
          operationId: crypto.randomUUID(),
          scene,
          ...(title !== null ? { title } : {}),
        });
        document = written;
        if (draft && fingerprint(draft) === fingerprint(scene)) draft = null;
        if (draftTitle === title) draftTitle = null;
      }
    };
    saving = run()
      .catch((e) => {
        error = e instanceof Error ? e.message : String(e);
        throw e;
      })
      .finally(() => {
        saving = null;
        emit();
      });
    emit();
    return saving;
  }
  return {
    state,
    scene: () => draft ?? document?.scene ?? { elements: [], appState: {}, files: {} },
    async close() {
      const nextGeneration = ++generation;
      await flush();
      if (nextGeneration !== generation) return;
      document = null;
      draft = null;
      draftTitle = null;
      error = null;
      ports.onScene({ elements: [], appState: {}, files: {} }, "reset");
      emit();
    },
    async open(id: string, discard = false) {
      const nextGeneration = ++generation;
      // 丢弃只针对未接受的草稿；在途提交必须结束，避免旧 ACK 把新文档切回去。
      if (discard) await saving?.catch(() => {});
      else await flush();
      if (nextGeneration !== generation) return;
      const loaded = await ports.read(id);
      if (nextGeneration !== generation) return;
      // 读取期间也可能产生手动编辑；先等待其 ACK，不能用旧读取覆盖新内容或冲突草稿。
      if (!discard) await flush();
      if (nextGeneration !== generation) return;
      const sameDocument = document?.id === loaded.id;
      if (!discard && sameDocument && loaded.revision <= document!.revision) return;
      document = loaded;
      draft = null;
      draftTitle = null;
      error = null;
      ports.onScene(loaded.scene, sameDocument && !discard ? "update" : "reset");
      emit();
    },
    edit(raw: Scene) {
      if (!document) return;
      const scene = validateScene(raw);
      if (fingerprint(scene) === fingerprint(draft ?? document.scene)) return;
      draft = scene;
      emit();
      // 保存的正确性由 ACK 和版本承担；无需用 debounce 的时长猜测用户是否已经完成编辑。
      if (!error) void flush().catch(() => {});
    },
    async rename(title: string) {
      if (!document) throw new Error("No diagram is open");
      const trimmed = title.trim();
      if (!trimmed || trimmed.length > 200)
        throw new Error("Title must contain 1 to 200 characters");
      if (trimmed === (draftTitle ?? document.title)) return flush();
      draftTitle = trimmed;
      emit();
      await flush();
    },
    flush,
  };
}
