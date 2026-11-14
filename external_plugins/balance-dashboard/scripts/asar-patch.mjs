#!/usr/bin/env node
/**
 * Minimal, dependency-free app.asar entry-line patcher.
 *
 * It only appends/removes the balance-dashboard loader line in
 * `out/main/index.js`; every other file is stream-copied byte-for-byte.
 * The asar layout follows Electron's pickle format (same approach as the
 * token-usage statusbar plugin), including per-file offsets and integrity.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const ENTRY = "/out/main/index.js";
const ALIGN = 4;
const BLOCK = 4 * 1024 * 1024;
const RUNTIME_DIR =
  (process.env.BALANCE_RUNTIME_DIR && process.env.BALANCE_RUNTIME_DIR.trim()) ||
  path.join(os.homedir(), ".zcode", "balance-dashboard", "runtime");
const LOADER_PATH = path.join(RUNTIME_DIR, "sidebar", "inject-main.cjs");
const STAGE_SUFFIX = ".balance-dashboard.tmp";

const INJECT_LINE = `\n;import(${JSON.stringify(pathToFileURL(LOADER_PATH).href)}).then(() => null, (e) => console.error("[balance-dashboard] load failed", e));`;
const INJECT_RE =
  /\n;import\("file:[^"]*inject-main\.cjs"\)\.then\(\(\) => null, \(e\) => console\.error\("\[balance-dashboard\] load failed", e\)\);?/g;

export function injectionLine(loaderPath = LOADER_PATH) {
  return `\n;import(${JSON.stringify(pathToFileURL(loaderPath).href)}).then(() => null, (e) => console.error("[balance-dashboard] load failed", e));`;
}

function readHeader(fd) {
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  const a = head.readUInt32LE(0);
  const b = head.readUInt32LE(4);
  const c = head.readUInt32LE(8);
  const d = head.readUInt32LE(12);
  if (a !== 4) throw new Error(`not an asar archive (prefix ${a})`);
  if (d <= 0 || d > 64 * 1024 * 1024) throw new Error(`invalid asar header length ${d}`);
  const json = Buffer.alloc(d);
  fs.readSync(fd, json, 0, d, 16);
  const header = JSON.parse(json.toString("utf8"));
  return { header, base: 8 + b, headerLength: d, headerBlock: c };
}

function iterFiles(node, prefix = "") {
  const out = [];
  for (const [name, child] of Object.entries(node.files || {})) {
    const p = `${prefix}/${name}`;
    if (child && typeof child === "object" && child.files) out.push(...iterFiles(child, p));
    else out.push({ path: p, node: child });
  }
  return out;
}

function integrityOf(data) {
  const hash = crypto.createHash("sha256").update(data).digest("hex");
  const blocks = [];
  if (data.length === 0) {
    // Electron's asar writer records one empty block for zero-length files.
    blocks.push(hash);
  } else {
    for (let i = 0; i < data.length; i += BLOCK) {
      blocks.push(crypto.createHash("sha256").update(data.subarray(i, i + BLOCK)).digest("hex"));
    }
  }
  return { algorithm: "SHA256", hash, blockSize: BLOCK, blocks };
}

function readEntry(asarPath) {
  const fd = fs.openSync(asarPath, "r");
  try {
    const { header, base } = readHeader(fd);
    const entry = iterFiles(header).find((item) => item.path === ENTRY);
    if (!entry) throw new Error(`asar is missing ${ENTRY}`);
    const data = Buffer.alloc(entry.node.size);
    fs.readSync(fd, data, 0, data.length, base + Number(entry.node.offset));
    return { header, base, entry: { ...entry, data } };
  } finally {
    fs.closeSync(fd);
  }
}

export function inspectAsar(asarPath) {
  const fd = fs.openSync(asarPath, "r");
  try {
    const { header, base } = readHeader(fd);
    const files = iterFiles(header);
    const entry = files.find((item) => item.path === ENTRY);
    if (!entry) throw new Error(`asar is missing ${ENTRY}`);
    const data = Buffer.alloc(entry.node.size);
    fs.readSync(fd, data, 0, data.length, base + Number(entry.node.offset));
    const text = data.toString("utf8");
    INJECT_RE.lastIndex = 0;
    return {
      asarPath,
      fileCount: files.length,
      entrySize: data.length,
      hasBalanceLine: INJECT_RE.test(text),
      hasZusageLine: /\[zusage\] load failed/.test(text),
    };
  } finally {
    INJECT_RE.lastIndex = 0;
    fs.closeSync(fd);
  }
}

/**
 * Rebuild an asar with one replaced file.
 *
 * Critical invariant: `node.offset` is the SOURCE offset until the copy loop
 * finishes. The new offsets are kept separately, otherwise every file after a
 * size-changing replacement is read from the wrong place and the archive looks
 * structurally valid while its contents are shifted.
 */
function repackAsar(asarPath, dstPath, replacements) {
  const srcFd = fs.openSync(asarPath, "r");
  try {
    const { header, base } = readHeader(srcFd);
    const copy = JSON.parse(JSON.stringify(header));
    const entries = iterFiles(copy);
    const missing = [...replacements.keys()].filter((p) => !entries.some((item) => item.path === p));
    if (missing.length) throw new Error(`asar paths not found: ${missing.join(", ")}`);
    for (const { path: p, node } of entries) {
      if (node.unpacked && replacements.has(p)) {
        throw new Error(`cannot replace unpacked asar entry: ${p}`);
      }
    }

    // Immutable snapshot of the source layout. This is the fix for the
    // 2026-11-13 corruption: never read from a rewritten offset.
    const originalOffsets = new Map(
      entries.map(({ path: p, node }) => [p, Number(node.offset)]),
    );
    const newOffsets = new Map();
    let offset = 0;
    for (const { path: p, node } of entries) {
      if (node.unpacked) continue;
      if (replacements.has(p)) {
        const data = replacements.get(p);
        node.size = data.length;
        node.integrity = integrityOf(data);
      }
      newOffsets.set(p, offset);
      offset += Number(node.size);
    }
    for (const { path: p, node } of entries) {
      if (!node.unpacked) node.offset = String(newOffsets.get(p));
    }

    const headerBytes = Buffer.from(JSON.stringify(copy), "utf8");
    const d = headerBytes.length;
    const c = Math.ceil((d + 4) / ALIGN) * ALIGN;
    const b = c + 4;
    const prefix = Buffer.alloc(16);
    prefix.writeUInt32LE(4, 0);
    prefix.writeUInt32LE(b, 4);
    prefix.writeUInt32LE(c, 8);
    prefix.writeUInt32LE(d, 12);

    const dstFd = fs.openSync(dstPath, "w");
    try {
      fs.writeSync(dstFd, prefix, 0, 16);
      fs.writeSync(dstFd, headerBytes, 0, headerBytes.length);
      const pad = Buffer.alloc(c - d - 4);
      if (pad.length) fs.writeSync(dstFd, pad, 0, pad.length);

      const chunk = Buffer.alloc(1024 * 1024);
      for (const { path: p, node } of entries) {
        if (node.unpacked) continue;
        if (replacements.has(p)) {
          const data = replacements.get(p);
          fs.writeSync(dstFd, data, 0, data.length);
          continue;
        }
        let remaining = Number(node.size);
        let srcOffset = base + originalOffsets.get(p);
        while (remaining > 0) {
          const size = Math.min(chunk.length, remaining);
          fs.readSync(srcFd, chunk, 0, size, srcOffset);
          fs.writeSync(dstFd, chunk, 0, size);
          srcOffset += size;
          remaining -= size;
        }
      }
      fs.fsyncSync(dstFd);
    } finally {
      fs.closeSync(dstFd);
    }
    return { fileCount: entries.length, headerLength: d };
  } finally {
    fs.closeSync(srcFd);
  }
}

/**
 * Fully validate an asar: header layout, contiguous offsets, bounds, and the
 * SHA-256 (plus block hashes) of every entry against the header's integrity.
 * This is intentionally expensive; it is the gate before any file replacement.
 */
export function validateAsar(asarPath, options = {}) {
  const fd = fs.openSync(asarPath, "r");
  let entryText = null;
  try {
    const stat = fs.fstatSync(fd);
    const { header, base, headerLength, headerBlock } = readHeader(fd);
    if (headerBlock !== Math.ceil((headerLength + 4) / ALIGN) * ALIGN) {
      throw new Error(`invalid asar header alignment (d=${headerLength}, c=${headerBlock})`);
    }
    if (base !== 12 + headerBlock) {
      throw new Error(`invalid asar data base (base=${base}, c=${headerBlock})`);
    }
    const entries = iterFiles(header).filter(({ node }) => !node.unpacked);
    let expectedOffset = 0;
    let entryCount = 0;
    for (const { path: p, node } of entries) {
      const off = Number(node.offset);
      const size = Number(node.size);
      if (!Number.isInteger(off) || !Number.isInteger(size) || off < 0 || size < 0) {
        throw new Error(`invalid offset/size for ${p}`);
      }
      if (off !== expectedOffset) {
        throw new Error(`non-contiguous offset for ${p}: ${off} != ${expectedOffset}`);
      }
      if (size > 64 * 1024 * 1024) throw new Error(`unreasonable entry size for ${p}: ${size}`);
      if (base + off + size > stat.size) throw new Error(`entry out of bounds: ${p}`);
      const data = Buffer.alloc(size);
      if (size > 0) fs.readSync(fd, data, 0, size, base + off);
      if (node.integrity && typeof node.integrity === "object") {
        const actual = integrityOf(data);
        if (node.integrity.hash && actual.hash !== node.integrity.hash) {
          throw new Error(`integrity hash mismatch: ${p}`);
        }
        if (Array.isArray(node.integrity.blocks)) {
          if (actual.blocks.length !== node.integrity.blocks.length) {
            throw new Error(`integrity block count mismatch: ${p}`);
          }
          for (let i = 0; i < actual.blocks.length; i += 1) {
            if (actual.blocks[i] !== node.integrity.blocks[i]) {
              throw new Error(`integrity block mismatch: ${p} [${i}]`);
            }
          }
        }
      }
      if (p === ENTRY) entryText = data.toString("utf8");
      expectedOffset += size;
      entryCount += 1;
    }
    if (base + expectedOffset !== stat.size) {
      throw new Error(
        `asar length mismatch: header end ${base + expectedOffset}, file size ${stat.size}`,
      );
    }
    const hasBalanceLine = entryText ? /\[balance-dashboard\] load failed/.test(entryText) : false;
    const hasZusageLine = entryText ? /\[zusage\] load failed/.test(entryText) : false;
    if (options.expectBalance !== undefined && hasBalanceLine !== options.expectBalance) {
      throw new Error(
        `injection marker mismatch: expected balance=${options.expectBalance}, got ${hasBalanceLine}`,
      );
    }
    if (options.expectZusage !== undefined && hasZusageLine !== options.expectZusage) {
      throw new Error(
        `zusage marker mismatch: expected ${options.expectZusage}, got ${hasZusageLine}`,
      );
    }
    return {
      ok: true,
      asarPath,
      fileCount: entryCount,
      entrySize: entryText ? Buffer.byteLength(entryText) : 0,
      hasBalanceLine,
      hasZusageLine,
      size: stat.size,
    };
  } finally {
    fs.closeSync(fd);
  }
}

export const BACKUP_SUFFIX = ".balance-dashboard.bak";

export function backupPathOf(asarPath) {
  return `${asarPath}${BACKUP_SUFFIX}`;
}

export function restoreBackup(asarPath) {
  const backup = backupPathOf(asarPath);
  if (!fs.existsSync(backup)) throw new Error(`backup not found: ${backup}`);
  const check = validateAsar(backup);
  fs.copyFileSync(backup, asarPath);
  return { status: "restored", asarPath, backup, ...check };
}

export function replaceAsarWithBackup(stagePath, asarPath, options = {}) {
  const stageCheck = validateAsar(stagePath, options.stageOptions || {});
  const backup = backupPathOf(asarPath);
  try {
    fs.unlinkSync(backup);
  } catch {
    // no previous backup
  }
  try {
    fs.linkSync(asarPath, backup);
  } catch {
    fs.copyFileSync(asarPath, backup);
  }
  try {
    fs.renameSync(stagePath, asarPath);
    const postCheck = validateAsar(asarPath, options.postOptions || {});
    return { backup, stageCheck, postCheck };
  } catch (error) {
    try {
      fs.copyFileSync(backup, asarPath);
    } catch {
      // leave the backup for manual restoration
    }
    throw error;
  }
}

export function buildPatchedAsar({ asarPath, loaderPath = LOADER_PATH, stagePath }) {
  const sourceCheck = validateAsar(asarPath);
  const { entry } = readEntry(asarPath);
  const text = entry.data.toString("utf8");
  const stripped = text.replace(INJECT_RE, "");
  const line = injectionLine(loaderPath);
  const hadZusage = /\[zusage\] load failed/.test(text);
  if (text.includes(line) || stripped + line === text) {
    return { status: "already", asarPath, entrySize: entry.data.length, hasZusageLine: hadZusage };
  }
  const newEntry = Buffer.from(stripped + line, "utf8");
  const stage = stagePath || `${asarPath}${STAGE_SUFFIX}`;
  const tmp = `${stage}.stage-${process.pid}`;
  try {
    repackAsar(asarPath, tmp, new Map([[ENTRY, newEntry]]));
    const check = validateAsar(tmp, { expectBalance: true, expectZusage: hadZusage });
    fs.renameSync(tmp, stage);
    return { status: "patched", stagePath: stage, sourceCheck, ...check, asarPath };
  } catch (error) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ignore
    }
    throw error;
  }
}

export function buildUnpatchedAsar({ asarPath, stagePath }) {
  const sourceCheck = validateAsar(asarPath);
  const { entry } = readEntry(asarPath);
  const text = entry.data.toString("utf8");
  INJECT_RE.lastIndex = 0;
  if (!INJECT_RE.test(text)) {
    INJECT_RE.lastIndex = 0;
    return { status: "already-clean", asarPath, sourceCheck };
  }
  INJECT_RE.lastIndex = 0;
  const stripped = text.replace(INJECT_RE, "");
  const hadZusage = /\[zusage\] load failed/.test(text);
  const stage = stagePath || `${asarPath}${STAGE_SUFFIX}`;
  const tmp = `${stage}.stage-${process.pid}`;
  try {
    repackAsar(asarPath, tmp, new Map([[ENTRY, Buffer.from(stripped, "utf8")]]));
    const check = validateAsar(tmp, { expectBalance: false, expectZusage: hadZusage });
    fs.renameSync(tmp, stage);
    return { status: "unpatched", stagePath: stage, sourceCheck, ...check, asarPath };
  } catch (error) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ignore
    }
    throw error;
  }
}

export function replaceAsar(stagePath, asarPath) {
  return replaceAsarWithBackup(stagePath, asarPath);
}

export function findAppAsar(explicit) {
  if (explicit) return explicit;
  if (process.env.ZCODE_ASAR) return process.env.ZCODE_ASAR;
  const candidates = [];
  const add = (p) => p && candidates.push(p);
  if (process.platform === "win32") {
    add(path.join(process.env.ProgramFiles || "C:\\Program Files", "ZCode", "resources", "app.asar"));
    add(path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "ZCode", "resources", "app.asar"));
    add(path.join(process.env.LOCALAPPDATA || "", "Programs", "ZCode", "resources", "app.asar"));
    add("D:\\Program Files\\ZCode\\resources\\app.asar");
    add("D:\\ZCode\\resources\\app.asar");
  } else if (process.platform === "darwin") {
    add("/Applications/ZCode.app/Contents/Resources/app.asar");
  } else {
    add("/opt/ZCode/resources/app.asar");
    add(path.join(process.cwd(), "resources", "app.asar"));
  }
  return candidates.find((p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  }) || null;
}

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const command = process.argv[2] || "check";
  const asar = findAppAsar(argValue("--asar"));
  if (!asar) {
    console.error("app.asar not found; pass --asar <path>");
    process.exit(2);
  }
  try {
    if (command === "check") {
      console.log(JSON.stringify(inspectAsar(asar), null, 2));
    } else if (command === "validate") {
      console.log(JSON.stringify(validateAsar(asar), null, 2));
    } else if (command === "patch") {
      const result = buildPatchedAsar({ asarPath: asar, loaderPath: argValue("--loader") || LOADER_PATH });
      console.log(JSON.stringify(result, null, 2));
    } else if (command === "unpatch") {
      const result = buildUnpatchedAsar({ asarPath: asar });
      console.log(JSON.stringify(result, null, 2));
    } else if (command === "finalize") {
      const stage = argValue("--stage");
      if (!stage) throw new Error("--stage is required");
      const result = replaceAsarWithBackup(stage, asar);
      console.log(JSON.stringify({ status: "replaced", asar, stage, ...result }, null, 2));
    } else if (command === "restore") {
      console.log(JSON.stringify(restoreBackup(asar), null, 2));
    } else {
      throw new Error(`unknown command: ${command}`);
    }
  } catch (error) {
    console.error(error.stack || error.message || String(error));
    process.exit(1);
  }
}
