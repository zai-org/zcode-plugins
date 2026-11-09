import { randomUUID } from "node:crypto";

export const failure = (text) => ({ isError: true, content: [{ type: "text", text }] });

// The MCP server owns request identity. A single live panel owns the document session.
export class EditorBridge {
  constructor({ timeout = 120000, lease = 45000 } = {}) {
    this.timeout = timeout;
    this.lease = lease;
    this.requests = new Map();
    this.preparing = 0;
  }
  attach() {
    if (this.token && Date.now() - this.seen < this.lease)
      throw new Error("This editor already has an active panel. Close it before opening another.");
    this.close("Editor reconnected; inspect document state before retrying");
    this.token = randomUUID();
    this.seen = Date.now();
    return this.token;
  }
  check(token) {
    if (!token || token !== this.token) throw new Error("Editor connection expired; reopen the panel");
    this.seen = Date.now();
  }
  async call(name, args, signal, prepare = async () => ({})) {
    if (!this.token || Date.now() - this.seen > this.lease)
      return failure("Open this plugin's editor with open_editor first, then retry after it is ready.");
    if (this.requests.size + this.preparing >= 32) return failure("Editor is busy; wait for pending operations");
    const token = this.token;
    let prepared;
    this.preparing++;
    try { prepared = await prepare(); } finally { this.preparing--; }
    if (signal?.aborted) return failure("Cancelled before dispatch");
    if (this.token !== token) return failure("Editor changed before dispatch; retry in the intended panel");
    return new Promise((resolve) => {
      const id = randomUUID();
      const request = { id, name, arguments: args, ...prepared };
      const finish = (result) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        this.requests.delete(id);
        resolve(result);
      };
      const abort = () => finish(failure(item.dispatched
        ? "Cancelled while executing; the operation may have completed. Inspect the document before retrying."
        : "Cancelled before dispatch; document unchanged."));
      const timer = setTimeout(() => finish(failure(item.dispatched
        ? "Editor reply timed out; the operation may have completed. Inspect before retrying."
        : "Editor did not receive the operation before timeout; document unchanged.")), this.timeout);
      const item = { request, finish, dispatched: false };
      this.requests.set(id, item);
      signal?.addEventListener("abort", abort, { once: true });
      this.wake?.();
    });
  }
  async poll(token) {
    this.check(token);
    if (this.polling) throw new Error("An editor poll is already pending");
    this.polling = true;
    try {
      if (![...this.requests.values()].some((item) => !item.dispatched)) {
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 20000);
          this.wake = () => { clearTimeout(timer); resolve(); };
        });
      }
      this.check(token);
      const item = [...this.requests.values()].find((value) => !value.dispatched);
      if (!item) return null;
      item.dispatched = true;
      return item.request;
    } finally { this.polling = false; this.wake = null; }
  }
  reply(token, id, result) {
    this.check(token);
    const item = this.requests.get(id);
    if (!item?.dispatched) return false; // Late/duplicate replies never repeat an edit.
    if (!result || !Array.isArray(result.content)) throw new Error("Invalid editor result");
    item.finish(result);
    return true;
  }
  close(reason = "Editor closed; inspect saved work before retrying") {
    this.token = null;
    for (const item of this.requests.values()) item.finish(failure(reason));
    this.wake?.();
  }
}
