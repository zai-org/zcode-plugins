import { watch } from "vue";
import * as upstream from "#upstream-tabs";
import { sessions } from "#ui/web/document-io.ts";
import { call } from "#ui/host.ts";
export * from "#upstream-tabs";

export async function closeTab(id: string) {
  const tab = upstream.getTabById(id);
  if (!tab) return;
  const documents = sessions.get(tab.store.state)!;
  // 上游直接销毁标签；嵌入后必须等工作区保存成功，取消或冲突都保留草稿。
  if (documents.isDirty() || (!documents.current.value && tab.store.undo.canUndo)) {
    if (!(await tab.store.saveFigFile())) return;
  }
  upstream.closeTab(id);
}
export function useTabsStore() {
  return { ...upstream.useTabsStore(), closeTab };
}
watch(upstream.activeTab, (tab) => {
  const doc = tab && sessions.get(tab.store.state)?.current.value;
  if (doc)
    void call("report_panel_state", { documentId: doc.id, live: true, active: true }).catch(
      console.error,
    );
});

export function getSession(documentId?: string) {
  const tab = documentId
    ? upstream
        .getTabsSnapshot()
        .find((item) => sessions.get(item.store.state)?.current.value?.id === documentId)
    : upstream.activeTab.value;
  if (!tab) throw new Error(`Document is not open: ${documentId ?? "active"}`);
  return { editor: tab.store, state: tab.store.state, documents: sessions.get(tab.store.state)! };
}

const opening = new Map<string, Promise<void>>();
export function openDocument(target: { id: string }): Promise<void> {
  const existing = upstream
    .getTabsSnapshot()
    .find((tab) => sessions.get(tab.store.state)?.current.value?.id === target.id);
  if (existing) {
    upstream.switchTab(existing.id);
    return Promise.resolve();
  }
  const pending = opening.get(target.id);
  if (pending) return pending;
  const promise = (async () => {
    const active = upstream.activeTab.value;
    const reusable =
      active &&
      !active.store.state.loading &&
      !sessions.get(active.store.state)?.current.value &&
      !active.store.undo.canUndo;
    const tab = reusable ? active : upstream.createTab();
    const documents = sessions.get(tab.store.state)!;
    // 第一次载入尚未绑定 documentId，第二次打开不能把这个标签误认作空白页。
    tab.store.state.loading = true;
    try {
      const doc = await documents.load(target);
      tab.store.state.documentName = doc.name;
    } catch (error) {
      documents.error.value = String(error);
      throw error;
    } finally {
      tab.store.state.loading = false;
    }
  })().finally(() => opening.delete(target.id));
  opening.set(target.id, promise);
  return promise;
}
