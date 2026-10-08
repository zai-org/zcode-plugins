/** Split transport payloads without dropping bytes at UTF-8 boundaries. */
export function utf8Chunks(bytes, size = 4 * 1024 * 1024) {
  if (!Number.isInteger(size) || size < 4) throw new Error("Chunk size must be at least 4");
  const chunks = [];
  for (let offset = 0; offset < bytes.length;) {
    let end = Math.min(offset + size, bytes.length);
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end -= 1;
    chunks.push(bytes.subarray(offset, end).toString("utf8"));
    offset = end;
  }
  return chunks;
}
