import { homedir } from "node:os";

export const normalization = "fixed-length-diagnostic-paths-v1";

// Rust file!()/panic messages retain build paths even after debug sections are stripped.
// Rewrite only the WASM data section and preserve byte lengths, data pointers and code.
export function normalizeWasm(input, prefixes = [homedir()]) {
  const bytes = Buffer.from(input);
  if (bytes.subarray(0, 8).toString("hex") !== "0061736d01000000") throw new Error("Invalid WASM module");
  const mappings = prefixes.filter((prefix) => prefix.length > 1).map((prefix) => {
    const from = Buffer.from(prefix);
    const label = Buffer.from(from.length >= 6 ? "/build" : "/b");
    const to = Buffer.alloc(from.length, 47);
    label.copy(to);
    return { from, to };
  });
  let offset = 8;
  while (offset < bytes.length) {
    const section = bytes[offset++];
    let size = 0, shift = 0, byte;
    do {
      if (offset >= bytes.length || shift > 28) throw new Error("Invalid WASM section size");
      byte = bytes[offset++]; size += (byte & 127) * 2 ** shift; shift += 7;
    } while (byte & 128);
    const end = offset + size;
    if (end > bytes.length) throw new Error("Truncated WASM section");
    if (section === 11) {
      for (const { from, to } of mappings) {
        let cursor = offset;
        while ((cursor = bytes.indexOf(from, cursor)) >= 0 && cursor + from.length <= end) {
          // Only directory prefixes, never arbitrary substrings of unrelated data.
          if (bytes[cursor + from.length] === 47 || bytes[cursor + from.length] === 92) to.copy(bytes, cursor);
          cursor += from.length;
        }
      }
    }
    offset = end;
  }
  return bytes;
}
