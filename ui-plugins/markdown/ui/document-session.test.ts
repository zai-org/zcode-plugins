import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { DocumentSession, type DocumentPayload } from "./document-session.ts";
const doc = (id = "a", revision = 1, content = "original"): DocumentPayload => ({
  document: { id, path: `${id}.md`, revision },
  content,
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
function fixture() {
  let value = "";
  const state = { id: "", path: "", revision: 0, dirty: false, saving: false, conflict: false };
  const call = vi.fn(async (_name: string, _args: Record<string, unknown>) => doc("a", 2));
  const read = vi.fn(async (_id: string) => doc("a", 2, "external"));
  const changed = vi.fn();
  const session = new DocumentSession(state, {
    call,
    read,
    getText: () => value,
    setText: (text) => {
      value = text;
      session.edited();
    },
    changed,
    opened: vi.fn(),
  });
  return {
    state,
    call,
    read,
    session,
    changed,
    value: () => value,
    rawInput: (text: string) => {
      value = text;
    },
    type: (text: string) => {
      value = text;
      session.edited();
    },
  };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
it("drains typing that arrives during a slow save", async () => {
  const f = fixture();
  await f.session.open(async () => doc());
  const pending = deferred<DocumentPayload>();
  f.call.mockImplementationOnce(() => pending.promise).mockResolvedValueOnce(doc("a", 3));
  f.type("first");
  const saving = f.session.flush();
  f.type("last");
  await vi.advanceTimersByTimeAsync(1000);
  pending.resolve(doc("a", 2));
  expect(await saving).toBe(true);
  expect(f.call).toHaveBeenCalledTimes(2);
  expect(f.call.mock.calls[1][1]).toMatchObject({ content: "last", expectedRevision: 2 });
  expect(f.state.dirty).toBe(false);
});
it("saves the old draft before opening another document", async () => {
  const f = fixture();
  await f.session.open(async () => doc());
  f.type("draft");
  const pending = deferred<DocumentPayload>();
  f.call.mockImplementationOnce(() => pending.promise);
  const load = vi.fn(async () => doc("b"));
  const opening = f.session.open(load);
  expect(load).not.toHaveBeenCalled();
  pending.resolve(doc("a", 2));
  await opening;
  expect(f.state.id).toBe("b");
  expect(f.state.revision).toBe(1);
});
it("keeps a dirty draft and its base revision when the agent writes", async () => {
  const f = fixture();
  await f.session.open(async () => doc());
  f.type("draft");
  await f.session.receive(doc("a", 2, "external"));
  expect(f.value()).toBe("draft");
  expect(f.state.revision).toBe(1);
  expect(f.state.conflict).toBe(true);
  expect(await f.session.open(async () => doc("b"))).toBe(false);
});
it("retains conflict controls when resolution fails", async () => {
  const f = fixture();
  await f.session.open(async () => doc());
  f.type("draft");
  await f.session.refresh();
  f.call.mockRejectedValueOnce(new Error("offline"));
  expect(await f.session.resolve("overwrite")).toBe(false);
  expect(f.state.conflict).toBe(true);
  expect(f.state.dirty).toBe(true);
  expect(f.value()).toBe("draft");
});
it("ignores a stale resource read after switching", async () => {
  const f = fixture();
  await f.session.open(async () => doc());
  const pending = deferred<DocumentPayload>();
  f.read.mockImplementationOnce(() => pending.promise);
  const reading = f.session.refresh();
  await f.session.open(async () => doc("b"));
  pending.resolve(doc("a", 9, "late"));
  await reading;
  expect(f.state.id).toBe("b");
  expect(f.value()).toBe("original");
});
it("does not autosave while IME composition is in progress", async () => {
  const f = fixture();
  await f.session.open(async () => doc());
  f.session.composition(true);
  f.type("拼音");
  await vi.advanceTimersByTimeAsync(2000);
  expect(f.call).not.toHaveBeenCalled();
  f.session.composition(false);
  await vi.advanceTimersByTimeAsync(800);
  expect(f.call).toHaveBeenCalledTimes(1);
});
it("does not replay programmatic setValue as user input", async () => {
  const f = fixture();
  await f.session.open(async () => doc());
  await vi.advanceTimersByTimeAsync(2000);
  expect(f.call).not.toHaveBeenCalled();
  expect(f.state.dirty).toBe(false);
});
it("ignores earlier navigation responses", async () => {
  const f = fixture();
  const pending = deferred<DocumentPayload>();
  const first = f.session.open(() => pending.promise);
  await Promise.resolve();
  await f.session.open(async () => doc("b"));
  pending.resolve(doc("a"));
  await first;
  expect(f.state.id).toBe("b");
});

it("flushes actual text before the delayed editor callback", async () => {
  const f = fixture();
  await f.session.open(async () => doc());
  f.rawInput("typed before callback");
  await f.session.open(async () => doc("b"));
  expect(f.call.mock.calls[0][1]).toMatchObject({ id: "a", content: "typed before callback" });
  expect(f.state.id).toBe("b");
});
it("detects actual dirty text before applying a remote update", async () => {
  const f = fixture();
  await f.session.open(async () => doc());
  f.rawInput("pending input");
  await f.session.refresh();
  expect(f.state.conflict).toBe(true);
  expect(f.value()).toBe("pending input");
});
it("ignores a delayed old input callback after switching documents", async () => {
  const f = fixture();
  await f.session.open(async () => doc());
  await f.session.open(async () => doc("b"));
  f.session.edited();
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.call).not.toHaveBeenCalled();
  expect(f.state.dirty).toBe(false);
});
