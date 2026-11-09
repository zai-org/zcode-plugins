import { call, host } from "#ui/host.ts";
import { askPath } from "#ui/web/dialog.ts";
import { openDocument } from "#ui/web/tabs.ts";
import type { DesignRef } from "#openpencil/contract.ts";

export async function openFileFromPath(path: string) {
  const result = await call<{ document: DesignRef }>("open_design", { path });
  await openDocument(result.document);
}
export async function openFileDialog() {
  const result = await call<{ documents: Array<{ path: string }> }>("list_designs");
  const path = await askPath(
    host().locale?.startsWith("zh") ? "打开工作区设计稿" : "Open workspace design",
    "",
    result.documents.map((doc) => doc.path),
  );
  if (path) await openFileFromPath(path);
}
export const importFileDialog = openFileDialog;
