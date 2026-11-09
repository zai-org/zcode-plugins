import { Worker } from "node:worker_threads";
import { DiagramError, type DocumentStore } from "#excalidraw/contract.ts";
declare const __WORKER_FILE__: string;

export function createDocumentStore(root: string): DocumentStore {
  const file = typeof __WORKER_FILE__ === "undefined" ? "./store-worker.ts" : __WORKER_FILE__;
  const worker = new Worker(new URL(file, import.meta.url), { workerData: { root } });
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  let seq = 0;
  let closed = false;
  const rejectAll = (error: Error) => {
    for (const item of pending.values()) item.reject(error);
    pending.clear();
    closed = true;
  };
  worker.on("message", (message) => {
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id);
    if (message.error) item.reject(new DiagramError(message.error.code, message.error.message));
    else item.resolve(message.result);
  });
  worker.on("error", rejectAll);
  worker.on("exit", () => rejectAll(new DiagramError("store_closed", "Document store closed")));
  const request = <T>(method: string, args: unknown): Promise<T> =>
    new Promise((resolve, reject) => {
      if (closed) {
        reject(new DiagramError("store_closed", "Document store closed"));
        return;
      }
      const id = ++seq;
      pending.set(id, { resolve: (value) => resolve(value as T), reject });
      worker.postMessage({ id, method, args });
    });
  return {
    create: (title, scene, id) => request("create", { title, scene, id }),
    read: (id) => request("read", { id }),
    list: () => request("list", {}),
    commit: (input) => request("commit", input),
    apply: (input) => request("apply", input),
    async close() {
      if (closed) return;
      try {
        await request("close", {});
      } finally {
        closed = true;
        await worker.terminate();
      }
    },
  };
}
