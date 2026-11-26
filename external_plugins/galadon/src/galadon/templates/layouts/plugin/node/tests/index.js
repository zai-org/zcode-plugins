// Node 22+ treats a positional `--test` path as a file, not a directory, so
// `node --test tests/` resolves this module. Import every sibling test file so
// package.json keeps the documented `node --test tests/` script on both old and
// current Node.
import { readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const directory = fileURLToPath(new URL(".", import.meta.url));
for (const file of readdirSync(directory).sort()) {
  if (file.endsWith(".test.js")) {
    await import(pathToFileURL(`${directory}${file}`).href);
  }
}
