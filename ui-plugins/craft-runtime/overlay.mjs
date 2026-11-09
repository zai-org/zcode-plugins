import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "./assets.mjs";
const runtime = dirname(fileURLToPath(import.meta.url));
export async function overlayDigest(name) {
  const files = ["prepare-automation.py", "rust/bridge.rs.in", "rust/fs.rs",
    "prepare-fonts.py", "rust/fonts.rs", "fonts/manifest.txt", "fonts/provenance.json",
    "fonts/LXGWWenKai-Regular.ttf", "fonts/OFL-LXGWWenKai.txt",
    ...(name === "photocraft" ? ["rust/photo.rs"] : name === "pdfcraft" ? ["rust/pdf.rs.in"] : [])];
  return sha256(Buffer.concat(await Promise.all(files.map(async (file) =>
    Buffer.concat([Buffer.from(`${file}\0`), await readFile(join(runtime, file))])))));
}
