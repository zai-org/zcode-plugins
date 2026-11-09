import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { CHUNK_BYTES, chunk, createAssetReader, readWorkspaceFile, sha256 } from "./assets.mjs";
import { normalizeWasm } from "./normalize-wasm.mjs";

test("WASM path cleanup changes data bytes only without moving sections or offsets", () => {
  const path = Buffer.from("/Users/example/.cargo/source.rs");
  const header = Buffer.from("0061736d01000000", "hex");
  const custom = Buffer.concat([Buffer.from([0, path.length]), path]);
  const data = Buffer.concat([Buffer.from([11, path.length]), path]);
  const input = Buffer.concat([header, custom, data]);
  const output = normalizeWasm(input, ["/Users/example"]);
  assert.equal(output.length, input.length);
  assert.deepEqual(output.subarray(0, header.length + custom.length), input.subarray(0, header.length + custom.length));
  assert.ok(!output.subarray(header.length + custom.length).includes("/Users/example"));
  assert.ok(output.includes("/.cargo/source.rs"));
  assert.throws(() => normalizeWasm(Buffer.from("not wasm")));
});

test("large binary resources round-trip below the host's serialized 8 MiB limit", () => {
  const input = Buffer.alloc(CHUNK_BYTES * 4 + 19);
  for (let i = 0; i < input.length; i++) input[i] = (i * 13) % 251;
  const pieces = [];
  for (let i = 0; i < 5; i++) {
    const blob = chunk(input, String(i)).toString("base64");
    assert.ok(Buffer.byteLength(JSON.stringify({ contents: [{ uri: "ui://craft/asset/id/0", mimeType: "application/octet-stream", blob }] })) < 8 * 1024 * 1024);
    pieces.push(Buffer.from(blob, "base64"));
  }
  assert.deepEqual(Buffer.concat(pieces), input);
  for (const bad of ["-1", "01", "NaN", "1.5", "5", "999999999999999999999"])
    assert.throws(() => chunk(input, bad));
  assert.equal(chunk(Buffer.alloc(0), "0").length, 0);
});

test("workspace opens reject traversal and symlink escapes without changing files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "craft-files-"));
  try {
    const workspace = join(directory, "workspace");
    await mkdir(workspace);
    await writeFile(join(workspace, "hello.txt"), "hello");
    await writeFile(join(directory, "outside.txt"), "outside");
    await symlink(join(directory, "outside.txt"), join(workspace, "link.txt"));
    assert.equal((await readWorkspaceFile(workspace, "hello.txt")).bytes.toString(), "hello");
    await assert.rejects(readWorkspaceFile(workspace, "../outside.txt"), /inside/);
    await assert.rejects(readWorkspaceFile(workspace, "link.txt"), /inside/);
    await assert.rejects(readWorkspaceFile(workspace, "."), /regular file/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("asset reader rejects tampering, unknown assets and decompression overflow", async () => {
  const directory = await mkdtemp(join(tmpdir(), "craft-assets-"));
  try {
    const bytes = Buffer.from("application bytes");
    const id = sha256(bytes);
    await writeFile(join(directory, id + ".gz"), gzipSync(bytes));
    const asset = { id, sha256: id, bytes: bytes.length };
    assert.deepEqual(await createAssetReader(directory, [asset])(id), bytes);
    await assert.rejects(createAssetReader(directory, [asset])("../../secret"), /Unknown/);
    await writeFile(join(directory, id + ".gz"), gzipSync(Buffer.alloc(10000)));
    await assert.rejects(createAssetReader(directory, [asset])(id));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
