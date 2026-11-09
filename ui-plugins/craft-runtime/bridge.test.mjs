import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, mkdir, symlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EditorBridge } from "./bridge.mjs";
import { writeOutput } from "./automation.mjs";

const result = { content: [{ type: "text", text: "edited" }] };
test("commands require a live editor and operate once on the attached session", async () => {
  const b = new EditorBridge();
  assert.equal((await b.call("edit", {})).isError, true);
  const token = b.attach();
  assert.throws(() => b.attach(), /active panel/);
  const pending = b.call("edit", { x: 42 });
  const request = await b.poll(token);
  assert.deepEqual(request.arguments, { x: 42 });
  assert.equal(b.reply(token, request.id, result), true);
  assert.deepEqual(await pending, result);
  assert.equal(b.reply(token, request.id, result), false);
  b.close();
});
test("teardown releases pending calls and stale panels cannot answer new requests", async () => {
  const b = new EditorBridge();
  const first = b.attach();
  const pending = b.call("edit", {});
  await b.poll(first);
  b.close();
  assert.equal((await pending).isError, true);
  const second = b.attach();
  assert.notEqual(first, second);
  assert.throws(() => b.reply(first, "any", result), /expired/);
  b.close();
});
test("cancellation distinguishes queued and already dispatched operations", async () => {
  const b = new EditorBridge(); const token = b.attach();
  const abort = new AbortController();
  const pending = b.call("edit", {}, abort.signal);
  const request = await b.poll(token);
  abort.abort();
  assert.match((await pending).content[0].text, /may have completed/);
  assert.equal(b.reply(token, request.id, result), false);
  const cancelled = new AbortController(); cancelled.abort();
  assert.match((await b.call("edit", {}, cancelled.signal)).content[0].text, /before dispatch/);
  b.close();
});
test("timeout does not silently replay a dispatched mutation", async () => {
  const b = new EditorBridge({ timeout: 20 }); const token = b.attach();
  const pending = b.call("edit", {}); const request = await b.poll(token);
  assert.match((await pending).content[0].text, /may have completed/);
  assert.equal(b.requests.size, 0);
  assert.equal(b.reply(token, request.id, result), false); b.close();
});
test("workspace exports are atomic and reject traversal and symlink escape", async () => {
  const root = await mkdtemp(join(tmpdir(), "craft-export-"));
  const workspace = join(root, "workspace"); const outside = join(root, "outside");
  try {
    await mkdir(workspace); await mkdir(outside);
    await symlink(outside, join(workspace, "escape"));
    await assert.rejects(writeOutput(workspace, "../outside/bad.txt", Buffer.from("bad")), /inside the workspace/);
    await assert.rejects(writeOutput(workspace, "escape/bad.txt", Buffer.from("bad")), /inside the workspace/);
    await writeOutput(workspace, "nested/document.txt", Buffer.from("first"));
    await writeOutput(workspace, "nested/document.txt", Buffer.from("second"));
    assert.equal(await readFile(join(workspace, "nested/document.txt"), "utf8"), "second");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("exclusive batch exports do not overwrite an existing file", async () => {
  const root = await mkdtemp(join(tmpdir(), "craft-exclusive-"));
  try {
    await writeOutput(root,"layer.png",Buffer.from("first"),true);
    await assert.rejects(writeOutput(root,"layer.png",Buffer.from("second"),true),/EEXIST/);
    assert.equal(await readFile(join(root,"layer.png"),"utf8"),"first");
  } finally { await rm(root,{recursive:true,force:true}); }
});
