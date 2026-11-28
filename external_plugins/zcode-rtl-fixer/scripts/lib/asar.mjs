// Minimal, dependency-free ASAR reader/writer/patcher.
//
// Format (electron/asar, verified against ZCode's archive):
//   bytes [0..3]  uint32 = 4            (outer pickle: payload size)
//   bytes [4..7]  uint32 = headerSize   (bytes of the header pickle that follows)
//   bytes [8..11] uint32 = jsonLen      (inner pickle: string length)
//   bytes [12..]  JSON header string + zero padding to 4-byte alignment
//   file data region begins at dataBase = 8 + headerSize
// Offsets in the header are relative to dataBase, stored as decimal strings.

import fs from 'node:fs';
import { createHash } from 'node:crypto';

const BLOCK_SIZE = 4 * 1024 * 1024; // 4 MiB, matches electron/asar

/** Read and parse the header of an existing asar archive. */
export function readHeader(asarPath) {
  const fd = fs.openSync(asarPath, 'r');
  try {
    const sizeBuf = Buffer.alloc(16);
    const got = fs.readSync(fd, sizeBuf, 0, 16, 0);
    if (got < 16) throw new Error('asar too small: ' + asarPath);
    const outerPrefix = sizeBuf.readUInt32LE(0);
    const headerSize = sizeBuf.readUInt32LE(4);
    const jsonLen = sizeBuf.readUInt32LE(12);
    if (outerPrefix !== 4 || jsonLen <= 0 || headerSize < jsonLen) {
      throw new Error(`not a valid asar (outer=${outerPrefix}, headerSize=${headerSize}, jsonLen=${jsonLen})`);
    }
    const jsonBuf = Buffer.alloc(jsonLen);
    fs.readSync(fd, jsonBuf, 0, jsonLen, 16);
    const header = JSON.parse(jsonBuf.toString('utf8'));
    return { header, headerSize, jsonLen, dataBase: 8 + headerSize, fileSize: fs.fstatSync(fd).size };
  } finally {
    fs.closeSync(fd);
  }
}

/** Serialize a header object into on-disk pickle bytes (Chromium Pickle format). */
export function encodeHeader(header) {
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const headerSize = (8 + json.length + 3) & ~3; // pickle: payloadSize + stringLen + json, 4-byte aligned
  const out = Buffer.alloc(8 + headerSize);
  out.writeUInt32LE(4, 0);              // outer pickle: payload size
  out.writeUInt32LE(headerSize, 4);     // outer pickle: header pickle size
  out.writeUInt32LE(headerSize - 4, 8); // header pickle: payload size (stringLen + json + pad)
  out.writeUInt32LE(json.length, 12);   // header pickle: string length
  json.copy(out, 16);
  return { buf: out, dataBase: 8 + headerSize };
}

/** Walk header.files into a flat ordered list: [{ relPath, node, isDir, isLink }]. */
function flatten(files, prefix = '', acc = []) {
  for (const name of Object.keys(files).sort()) {
    const node = files[name];
    const rel = prefix ? prefix + '/' + name : name;
    if (node.files) {
      acc.push({ relPath: rel, node, isDir: true });
      flatten(node.files, rel, acc);
    } else if (node.link !== undefined) {
      acc.push({ relPath: rel, node, isLink: true });
    } else {
      acc.push({ relPath: rel, node, isDir: false });
    }
  }
  return acc;
}

function lookup(files, rel) {
  let node = { files };
  for (const p of rel.split('/')) {
    if (!node.files || !node.files[p]) return null;
    node = node.files[p];
  }
  return node;
}

/** electron/asar style integrity for a buffer. */
export function computeIntegrity(buf) {
  const hash = createHash('sha256').update(buf).digest('hex');
  const blocks = [];
  for (let i = 0; i < buf.length; i += BLOCK_SIZE) {
    blocks.push(createHash('sha256').update(buf.subarray(i, i + BLOCK_SIZE)).digest('hex'));
  }
  return { algorithm: 'SHA256', hash, blockSize: BLOCK_SIZE, blocks };
}

function cloneHeaderTree(files) {
  const out = {};
  for (const [k, v] of Object.entries(files)) {
    if (v.files) out[k] = { files: cloneHeaderTree(v.files) };
    else out[k] = { ...v };
  }
  return out;
}

function setNodeAt(tree, rel, node) {
  const parts = rel.split('/');
  let cur = tree;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur[parts[i]]) cur[parts[i]] = { files: {} };
    cur = cur[parts[i]].files;
  }
  cur[parts[parts.length - 1]] = node;
}

/**
 * Lay out all entries with a given dataBase, producing a full header object
 * plus the resulting header length. Pure: no I/O.
 */
function layoutWithBase(origHeader, entries, replacements, additions, dataBase) {
  const tree = cloneHeaderTree(origHeader.files);
  const offsets = new Map();
  let cursor = dataBase;
  for (const e of entries) {
    if (e.isDir || e.isLink) continue;
    const size = replacements.has(e.relPath) ? replacements.get(e.relPath).length : e.node.size;
    offsets.set(e.relPath, cursor);
    cursor += size;
  }
  for (const a of additions) {
    offsets.set(a.rel, cursor);
    cursor += a.buf.length;
  }
  // fill nodes — replaced/added entries already carry their final integrity,
  // so the header length computed here is exact.
  for (const e of entries) {
    if (e.isDir || e.isLink) continue;
    const size = replacements.has(e.relPath) ? replacements.get(e.relPath).length : e.node.size;
    const integrity = replacements.has(e.relPath) ? replacements.get(e.relPath).integrity : e.node.integrity;
    setNodeAt(tree, e.relPath, {
      size,
      offset: String(offsets.get(e.relPath) - dataBase),
      ...(integrity ? { integrity } : {}),
    });
  }
  for (const a of additions) {
    setNodeAt(tree, a.rel, { size: a.buf.length, offset: String(offsets.get(a.rel) - dataBase), integrity: a.buf.integrity });
  }
  const jsonLen = JSON.stringify({ files: tree }).length;
  // header pickle = 4 (payloadSize) + 4 (stringLen) + json, padded to 4 bytes
  return { tree, offsets, dataEnd: cursor, dataBaseForHeader: 8 + ((8 + jsonLen + 3) & ~3), jsonLen };
}

/**
 * Build a new asar from an existing one, replacing / adding entries.
 * Untouched entries keep their original bytes (streamed from the source)
 * and their original integrity metadata.
 *
 * @param {string} origPath source archive (left untouched)
 * @param {string} outPath  destination archive
 * @param {object} opts
 * @param {Object<string, Buffer>} [opts.replace] relPath -> new content
 * @param {Object<string, Buffer>} [opts.add]     relPath -> new content
 * @returns {{ dataBase: number, fileCount: number, totalSize: number }}
 */
export function buildPatchedAsar(origPath, outPath, { replace = {}, add = {} } = {}) {
  const { header, dataBase: origBase } = readHeader(origPath);
  const entries = flatten(header.files);

  for (const rel of Object.keys(replace)) {
    const node = lookup(header.files, rel);
    if (!node || node.files || node.link !== undefined) {
      throw new Error(`replace target not found (or not a file): ${rel}`);
    }
  }
  for (const rel of Object.keys(add)) {
    if (lookup(header.files, rel)) throw new Error(`add target already exists: ${rel}`);
  }

  const replacements = new Map();
  for (const [rel, buf] of Object.entries(replace)) {
    buf.integrity = computeIntegrity(buf);
    replacements.set(rel, buf);
  }
  const additions = Object.entries(add).map(([rel, buf]) => {
    buf.integrity = computeIntegrity(buf);
    return { rel, buf };
  });

  // fixed point: header length depends on decimal digit widths of offsets,
  // which depend on dataBase — converge in 1-3 iterations.
  let dataBase = origBase;
  let layout;
  for (let i = 0; i < 6; i++) {
    layout = layoutWithBase(header, entries, replacements, additions, dataBase);
    if (layout.dataBaseForHeader === dataBase) break;
    dataBase = layout.dataBaseForHeader;
  }
  if (layout.dataBaseForHeader !== dataBase) throw new Error('layout failed to converge');

  // stream the archive
  const outFd = fs.openSync(outPath, 'w');
  const origFd = fs.openSync(origPath, 'r');
  try {
    const chunk = Buffer.alloc(1024 * 1024);
    let cursor = dataBase;
    for (const e of entries) {
      if (e.isDir || e.isLink) continue;
      const repl = replacements.get(e.relPath);
      if (repl) {
        fs.writeSync(outFd, repl, 0, repl.length, cursor);
        cursor += repl.length;
        continue;
      }
      let remaining = e.node.size;
      let src = origBase + (e.node.offset !== undefined ? parseInt(e.node.offset, 10) : 0);
      while (remaining > 0) {
        const n = Math.min(chunk.length, remaining);
        fs.readSync(origFd, chunk, 0, n, src);
        fs.writeSync(outFd, chunk, 0, n, cursor);
        src += n;
        cursor += n;
        remaining -= n;
      }
    }
    for (const a of additions) {
      fs.writeSync(outFd, a.buf, 0, a.buf.length, cursor);
      cursor += a.buf.length;
    }

    // header: layoutWithBase already produced the exact final tree (offsets and
    // integrity included) and its dataBase matched the streaming layout.
    const { buf: headerBuf, dataBase: finalBase } = encodeHeader({ files: layout.tree });
    if (finalBase !== dataBase) throw new Error('header/dataBase mismatch after streaming');
    fs.writeSync(outFd, headerBuf, 0, headerBuf.length, 0);
    fs.ftruncateSync(outFd, cursor);
    return { dataBase, fileCount: entries.length + additions.length, totalSize: cursor };
  } finally {
    fs.closeSync(origFd);
    fs.closeSync(outFd);
  }
}

/** Read a single file out of an asar (for verification/tests). */
export function extractFile(asarPath, rel) {
  const { header, dataBase } = readHeader(asarPath);
  const node = lookup(header.files, rel);
  if (!node || node.files || node.link !== undefined) throw new Error('not a file entry: ' + rel);
  const buf = Buffer.alloc(node.size);
  const fd = fs.openSync(asarPath, 'r');
  try {
    fs.readSync(fd, buf, 0, node.size, dataBase + parseInt(node.offset, 10));
  } finally {
    fs.closeSync(fd);
  }
  return buf;
}
