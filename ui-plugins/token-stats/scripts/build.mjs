import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { writeNotices } from "./licenses.mjs";

const root = new URL("../", import.meta.url);
process.chdir(fileURLToPath(root));
await mkdir("dist", { recursive: true });
const [node, view] = await Promise.all([
  build({
    entryPoints: ["src/extension.ts", "src/server.ts"],
    outdir: "dist",
    outExtension: { ".js": ".mjs" },
    bundle: true,
    metafile: true,
    platform: "node",
    format: "esm",
    target: "node24",
    banner: {
      js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
    },
  }),
  build({
    entryPoints: ["src/view.ts"],
    write: false,
    bundle: true,
    metafile: true,
    platform: "browser",
    format: "iife",
    target: "es2022",
    minify: true,
  }),
]);
const html = await readFile("src/view.html", "utf8");
const script = view.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const bundled = html.replace("<!-- view-script -->", () => `<script>${script}</script>`);
await Promise.all([
  writeFile("dist/view.html", bundled),
  writeFile("dist/details.html", bundled.replace("<html ", '<html data-presentation="details" ')),
]);

await writeNotices([node.metafile, view.metafile], "dist/THIRD_PARTY_NOTICES.txt");
