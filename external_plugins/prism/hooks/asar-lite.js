#!/usr/bin/env node
// Zero-dependency fallback for the subset of @electron/asar the Prism hook
// needs: extractFile, extractAll, createPackageWithOptions. Marketplace
// installs ship no node_modules, so the hook falls back to this when the
// library is unavailable. The algorithms mirror @electron/asar 4.3.1
// (MIT): Chromium pickle framing, SHA-256 whole-file + 4MB-block integrity,
// duplicate-content offset sharing, and the unpacked-file sidecar directory.
// Output is byte-identical to the library for the same input tree; verified
// against the real app archive before shipping. The unpack option supports
// the glob subset the plugin uses ("**", "*", "?", "{a,b}", matchBase);
// "unpackDir" and "ordering" are not supported.
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PAYLOAD_UNIT = 64;
const BLOCK_SIZE = 4 * 1024 * 1024;
const UINT32_MAX = 2 ** 32 - 1;
const SYMLINK_MAX_DEPTH = 40;

// ---- pickle framing (port of lib/pickle.js, write subset) ----

class Pickle {
  constructor() {
    this.headerSize = 4;
    this.capacity = 0;
    this.header = Buffer.alloc(0);
    this.writeOffset = 0;
    this.resize(PAYLOAD_UNIT);
    this.setPayloadSize(0);
  }
  static alignInt(i, alignment) {
    return i + ((alignment - (i % alignment)) % alignment);
  }
  resize(newCapacity) {
    newCapacity = Pickle.alignInt(newCapacity, PAYLOAD_UNIT);
    const grown = Buffer.alloc(this.headerSize + newCapacity);
    this.header.copy(grown, 0, 0, this.headerSize + this.writeOffset);
    this.header = grown;
    this.capacity = newCapacity;
  }
  setPayloadSize(payloadSize) {
    this.header.writeUInt32LE(payloadSize, 0);
  }
  writeBytes(data, length) {
    const dataLength = Pickle.alignInt(length, 4);
    const newSize = this.writeOffset + dataLength;
    if (newSize > this.capacity) this.resize(Math.max(this.capacity * 2, newSize));
    this.header.write(data, this.headerSize + this.writeOffset, length);
    const endOffset = this.headerSize + this.writeOffset + length;
    this.header.fill(0, endOffset, endOffset + dataLength - length);
    this.setPayloadSize(newSize);
    this.writeOffset = newSize;
  }
  writeUInt32(value) {
    const newSize = this.writeOffset + 4;
    if (newSize > this.capacity) this.resize(Math.max(this.capacity * 2, newSize));
    this.header.writeUInt32LE(value, this.headerSize + this.writeOffset);
    this.setPayloadSize(newSize);
    this.writeOffset = newSize;
  }
  writeString(value) {
    const length = Buffer.byteLength(value, "utf8");
    this.writeUInt32(length);
    this.writeBytes(value, length);
  }
  toBuffer() {
    return this.header.slice(0, this.headerSize + this.writeOffset);
  }
}

// ---- glob matching subset for the unpack option ----

function expandBraces(pattern) {
  const open = pattern.indexOf("{");
  if (open === -1) return [pattern];
  let depth = 0;
  let close = -1;
  for (let i = open; i < pattern.length; i++) {
    if (pattern[i] === "{") depth++;
    else if (pattern[i] === "}" && --depth === 0) {
      close = i;
      break;
    }
  }
  if (close === -1) return [pattern];
  const out = [];
  for (const alt of pattern.slice(open + 1, close).split(",")) {
    for (const rest of expandBraces(pattern.slice(close + 1))) {
      out.push(pattern.slice(0, open) + alt + rest);
    }
  }
  return out;
}

function globToRegExpSource(pattern) {
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        // "**" spans segments; a full "**/" component also matches zero dirs
        if (pattern[i + 2] === "/" && (i === 0 || pattern[i - 1] === "/")) {
          source += "(?:[^/]*/)*";
          i += 2;
        } else {
          source += ".*";
          i += 1;
        }
      } else {
        source += "[^/]*";
      }
    } else if (c === "?") {
      source += "[^/]";
    } else {
      source += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return source;
}

// minimatch(filename, pattern, { matchBase: true }) equivalent
function minimatchMatch(filename, pattern) {
  for (const p of expandBraces(pattern)) {
    const source = globToRegExpSource(p);
    if (new RegExp("^" + source + "$").test(filename)) return true;
    if (!p.includes("/") && new RegExp("(^|/)" + source + "$").test(filename)) return true;
  }
  return false;
}

// ---- integrity (port of lib/integrity.js, buffer path) ----

function getFileIntegrityFromBuffer(data) {
  const hash = crypto.createHash("SHA256").update(data).digest("hex");
  const blocks = [];
  for (let offset = 0; offset < data.length; offset += BLOCK_SIZE) {
    const end = Math.min(offset + BLOCK_SIZE, data.length);
    blocks.push(crypto.createHash("SHA256").update(data.subarray(offset, end)).digest("hex"));
  }
  if (data.length === 0) {
    blocks.push(crypto.createHash("SHA256").update(data).digest("hex"));
  }
  return { algorithm: "SHA256", hash, blockSize: BLOCK_SIZE, blocks };
}

// ---- crawl (replaces the glob listing in lib/crawlfs.js) ----
// Mirrors glob's behavior as configured by createPackageWithOptions
// (dot: true, no symlink descent): every descendant of src (the root itself
// excluded), default lexicographic sort, nothing inside symlinked dirs.

function crawlSync(dir) {
  const out = [];
  const links = [];
  const walk = (base) => {
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      const full = path.join(base, entry.name);
      if (entry.isSymbolicLink()) {
        out.push(full);
        links.push(full);
      } else if (entry.isDirectory()) {
        out.push(full);
        walk(full);
      } else {
        out.push(full);
      }
    }
  };
  walk(dir);
  out.sort();
  if (!links.length) return out;
  // drop entries that live inside a symlinked directory (crawlfs.js filter)
  return out.filter((filename) => {
    for (const link of links) {
      if (filename !== link && filename.startsWith(link + path.sep)) return false;
    }
    return true;
  });
}

// ---- filesystem header (port of lib/filesystem.js, build + lookup subset) ----

class Filesystem {
  constructor(src) {
    this.src = path.resolve(src);
    this.header = { files: {} };
    this.headerSize = 0;
    this.offset = BigInt(0);
    this.contentOffsets = new Map();
  }
  searchNodeFromPath(p) {
    const rel = path.relative(this.src, p);
    if (!rel) return this.header;
    let json = this.header;
    for (const dir of path.dirname(rel).split(path.sep)) {
      if (dir !== ".") {
        if (!json.files[dir]) json.files[dir] = { files: {} };
        json = json.files[dir];
      }
    }
    const name = path.basename(rel);
    if (!json.files[name]) json.files[name] = {};
    return json.files[name];
  }
  insertDirectory(p, shouldUnpack) {
    const node = this.searchNodeFromPath(p);
    if (shouldUnpack) node.unpacked = shouldUnpack;
    if (!node.files) node.files = {};
  }
  insertFile(p, shouldUnpack, stat) {
    const dirNode = this.searchNodeFromPath(path.dirname(p));
    const node = this.searchNodeFromPath(p);
    if (shouldUnpack || dirNode.unpacked) {
      node.size = stat.size;
      node.unpacked = true;
      node.integrity = getFileIntegrityFromBuffer(fs.readFileSync(p));
      return false;
    }
    const size = stat.size;
    if (size > UINT32_MAX) throw new Error(p + ": file size can not be larger than 4.2GB");
    const executable = process.platform !== "win32" && (stat.mode & 0o100) !== 0;
    const integrity = getFileIntegrityFromBuffer(fs.readFileSync(p));
    const sharedOffset = this.contentOffsets.get(integrity.hash);
    node.size = size;
    node.offset = sharedOffset === undefined ? this.offset.toString() : sharedOffset;
    if (executable) node.executable = true;
    node.integrity = integrity;
    if (sharedOffset !== undefined) return true;
    this.contentOffsets.set(integrity.hash, node.offset);
    this.offset += BigInt(size);
    return false;
  }
  insertLink(p, shouldUnpack) {
    const parentPath = fs.realpathSync(path.dirname(p));
    const symlink = fs.readlinkSync(p);
    const src = fs.realpathSync(this.src);
    const target = path.resolve(parentPath, symlink);
    const link = path.relative(src, target);
    if (path.isAbsolute(link) || path.normalize(link).startsWith("..")) {
      throw new Error(p + ': file "' + link + '" links out of the package');
    }
    const node = this.searchNodeFromPath(p);
    const dirNode = this.searchNodeFromPath(path.dirname(p));
    if (shouldUnpack || dirNode.unpacked) node.unpacked = true;
    node.link = link;
  }
  listFiles() {
    const files = [];
    const fill = (basePath, metadata) => {
      if (!metadata.files) return;
      for (const name of Object.keys(metadata.files)) {
        const fullPath = path.join(basePath, name);
        files.push(fullPath);
        fill(fullPath, metadata.files[name]);
      }
    };
    fill("/", this.header);
    return files;
  }
  getNode(p, followLinks, depth, visited) {
    followLinks = followLinks !== false;
    depth = depth || 0;
    visited = visited || new Set();
    let json = this.header;
    for (const dir of path.dirname(p).split(path.sep)) {
      if (dir !== ".") json = json.files[dir];
    }
    const name = path.basename(p);
    const node = name ? json.files[name] : json;
    if (node && "link" in node && followLinks) {
      const resolvedPath = path.join(node.link, name);
      if (visited.has(resolvedPath)) {
        throw new Error('"' + p + '": circular symlink detected at "' + resolvedPath + '"');
      }
      if (depth >= SYMLINK_MAX_DEPTH) {
        throw new Error('"' + p + '": too many levels of symbolic links (>' + SYMLINK_MAX_DEPTH + ")");
      }
      visited.add(resolvedPath);
      return this.getNode(resolvedPath, followLinks, depth + 1, visited);
    }
    return node;
  }
  getFile(p, followLinks, depth, visited) {
    followLinks = followLinks !== false;
    depth = depth || 0;
    visited = visited || new Set();
    const info = this.getNode(p, followLinks, depth, visited);
    if (!info) throw new Error('"' + p + '" was not found in this archive');
    if ("link" in info && followLinks) {
      if (visited.has(info.link)) {
        throw new Error('"' + p + '": circular symlink detected at "' + info.link + '"');
      }
      if (depth >= SYMLINK_MAX_DEPTH) {
        throw new Error('"' + p + '": too many levels of symbolic links (>' + SYMLINK_MAX_DEPTH + ")");
      }
      visited.add(info.link);
      return this.getFile(info.link, followLinks, depth + 1, visited);
    }
    return info;
  }
}

// ---- archive read (port of lib/disk.js read paths) ----

function readArchiveHeaderSync(archivePath) {
  const fd = fs.openSync(archivePath, "r");
  let size;
  let headerBuf;
  try {
    const archiveSize = fs.fstatSync(fd).size;
    const sizeBuf = Buffer.alloc(8);
    if (fs.readSync(fd, sizeBuf, 0, 8, null) !== 8) throw new Error("Unable to read header size");
    size = sizeBuf.readUInt32LE(4);
    if (size < 0 || size > archiveSize - 8) {
      throw new Error(
        "Header size " + size + " exceeds archive size " + archiveSize + ". The archive is corrupted.",
      );
    }
    headerBuf = Buffer.alloc(size);
    if (fs.readSync(fd, headerBuf, 0, size, null) !== size) throw new Error("Unable to read header");
  } finally {
    fs.closeSync(fd);
  }
  // header pickle: 4-byte size field, then the uint32 string length, then JSON
  const stringLength = headerBuf.readUInt32LE(4);
  const header = JSON.parse(headerBuf.slice(8, 8 + stringLength).toString());
  if (!header || typeof header !== "object" || !header.files) {
    throw new Error('Invalid archive header at "' + archivePath + '"');
  }
  return { header, headerSize: size };
}

function readFilesystem(archivePath) {
  const { header, headerSize } = readArchiveHeaderSync(archivePath);
  const filesystem = new Filesystem(archivePath);
  filesystem.header = header;
  filesystem.headerSize = headerSize;
  return filesystem;
}

function ensureWithin(container, filePath) {
  const resolvedContainer = path.resolve(container);
  const resolvedPath = path.resolve(resolvedContainer, filePath);
  if (!resolvedPath.startsWith(resolvedContainer + path.sep) && resolvedPath !== resolvedContainer) {
    throw new Error(
      'Path "' + filePath + '" resolves to "' + resolvedPath + '" which is outside "' + resolvedContainer + '"',
    );
  }
  return resolvedPath;
}

function extractFileSync(filesystem, filename, info) {
  if (info.size <= 0) return Buffer.alloc(0);
  if (info.unpacked) {
    const unpackedDir = filesystem.src + ".unpacked";
    return fs.readFileSync(ensureWithin(unpackedDir, filename));
  }
  const fileOffset = parseInt(info.offset);
  if (Number.isNaN(fileOffset) || fileOffset < 0 || !Number.isSafeInteger(fileOffset)) {
    throw new Error("Invalid file offset in archive header: " + info.offset);
  }
  const offset = 8 + filesystem.headerSize + fileOffset;
  const buffer = Buffer.alloc(info.size);
  const fd = fs.openSync(filesystem.src, "r");
  try {
    fs.readSync(fd, buffer, 0, info.size, offset);
  } finally {
    fs.closeSync(fd);
  }
  return buffer;
}

// ---- public API (the surface the Prism hook uses) ----

function extractFile(archivePath, filename, followLinks) {
  const filesystem = readFilesystem(archivePath);
  const fileInfo = filesystem.getFile(filename, followLinks);
  if (fileInfo && ("link" in fileInfo || "files" in fileInfo)) {
    throw new Error("Expected to find file at: " + filename + " but found a directory or link");
  }
  return extractFileSync(filesystem, filename, fileInfo);
}

function extractAll(archivePath, dest) {
  const filesystem = readFilesystem(archivePath);
  const filenames = filesystem.listFiles();
  const followLinks = process.platform === "win32";
  fs.mkdirSync(dest, { recursive: true });
  const archiveSize = fs.statSync(archivePath).size;
  const dataStart = 8 + filesystem.headerSize;
  const dataSize = archiveSize - dataStart;
  let dataBuf = null;
  if (dataSize > 0) {
    dataBuf = Buffer.alloc(dataSize);
    const fd = fs.openSync(archivePath, "r");
    try {
      fs.readSync(fd, dataBuf, 0, dataSize, dataStart);
    } finally {
      fs.closeSync(fd);
    }
  }
  const extractionErrors = [];
  for (const fullPath of filenames) {
    const filename = fullPath.substring(1);
    const destFilename = ensureWithin(dest, filename);
    const file = filesystem.getFile(filename, followLinks);
    if (file && file.files) {
      fs.mkdirSync(destFilename, { recursive: true });
    } else if (file && file.link !== undefined) {
      const linkSrcPath = path.dirname(path.join(dest, file.link));
      const relativePath = path.relative(path.dirname(destFilename), linkSrcPath);
      try {
        fs.unlinkSync(destFilename);
      } catch (_) {}
      if (path.relative(dest, linkSrcPath).startsWith("..")) {
        throw new Error(fullPath + ': file "' + file.link + '" links out of the package to "' + linkSrcPath + '"');
      }
      fs.symlinkSync(path.join(relativePath, path.basename(file.link)), destFilename);
    } else {
      try {
        let content;
        if (file.unpacked) {
          content = fs.readFileSync(path.join(filesystem.src + ".unpacked", filename));
        } else if (file.size <= 0) {
          content = Buffer.alloc(0);
        } else {
          const offset = parseInt(file.offset);
          content = dataBuf.subarray(offset, offset + file.size);
        }
        fs.writeFileSync(destFilename, content);
        if (file.executable) fs.chmodSync(destFilename, "755");
      } catch (e) {
        extractionErrors.push(e);
      }
    }
  }
  if (extractionErrors.length) {
    throw new Error(
      "Unable to extract some files:\n\n" + extractionErrors.map((error) => error.stack).join("\n\n"),
    );
  }
}

function createPackageWithOptions(src, dest, options) {
  src = path.normalize(src);
  dest = path.normalize(dest);
  options = options || {};
  const filesystem = new Filesystem(src);
  const files = [];
  const links = [];
  const shouldUnpackPath = (filename, unpack) => (unpack ? minimatchMatch(filename, unpack) : false);
  for (const filename of crawlSync(src)) {
    const stat = fs.lstatSync(filename);
    if (stat.isDirectory()) {
      filesystem.insertDirectory(filename, false);
    } else if (stat.isSymbolicLink()) {
      const shouldUnpack = shouldUnpackPath(filename, options.unpack);
      links.push({ filename, unpack: shouldUnpack });
      filesystem.insertLink(filename, shouldUnpack);
    } else {
      const shouldUnpack = shouldUnpackPath(filename, options.unpack);
      const duplicate = filesystem.insertFile(filename, shouldUnpack, stat);
      files.push({ filename, unpack: shouldUnpack, duplicate });
    }
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const headerPickle = new Pickle();
  headerPickle.writeString(JSON.stringify(filesystem.header));
  const sizePickle = new Pickle();
  sizePickle.writeUInt32(headerPickle.toBuffer().length);
  const out = fs.openSync(dest, "w");
  try {
    fs.writeSync(out, sizePickle.toBuffer());
    fs.writeSync(out, headerPickle.toBuffer());
    for (const file of files) {
      if (file.duplicate) continue;
      if (file.unpack) {
        const relname = path.relative(filesystem.src, file.filename);
        const targetFile = path.join(dest + ".unpacked", relname);
        fs.mkdirSync(path.dirname(targetFile), { recursive: true });
        fs.copyFileSync(file.filename, targetFile);
        fs.chmodSync(targetFile, fs.statSync(file.filename).mode);
      } else {
        const content = fs.readFileSync(file.filename);
        fs.writeSync(out, content);
      }
    }
    for (const link of links) {
      if (!link.unpack) continue;
      const relname = path.relative(filesystem.src, link.filename);
      const targetDir = path.join(dest + ".unpacked", path.dirname(relname));
      fs.mkdirSync(targetDir, { recursive: true });
      fs.symlinkSync(fs.readlinkSync(link.filename), path.join(dest + ".unpacked", relname));
    }
  } finally {
    fs.closeSync(out);
  }
}

module.exports = { extractFile, extractAll, createPackageWithOptions };
