import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { prepareUpstream, pluginRoot, run } from "./upstream.mjs";

const root = await prepareUpstream();
const source = JSON.parse(await readFile(join(root, "tsconfig.json"), "utf8"));
const paths = Object.fromEntries(
  Object.entries(source.compilerOptions.paths).map(([key, values]) => [
    key,
    values.map((value) => resolve(root, value)),
  ]),
);
Object.assign(paths, {
  "#ui/*": [join(pluginRoot, "ui/*")],
  "#openpencil/*": [join(pluginRoot, "src/*")],
  "#upstream-tabs": [join(root, "src/app/tabs/index.ts")],
  "@/app/document/io": [join(pluginRoot, "ui/web/document-io.ts")],
  "@/app/shell/menu/files": [join(pluginRoot, "ui/web/files.ts")],
  "@/app/shell/menu/navigation": [join(pluginRoot, "ui/web/navigation.ts")],
  "@/app/tabs": [join(pluginRoot, "ui/web/tabs.ts")],
  "@/router": [join(pluginRoot, "ui/web/router.ts")],
  "*": [join(root, "node_modules/*")],
  culori: [join(root, "node_modules/@types/culori/index.d.ts")],
  "opentype.js": [join(root, "node_modules/@types/opentype.js/index.d.ts")],
  "@open-pencil/dom-css/*": [join(root, "packages/dom-css/src/*")],
  "@open-pencil/mcp/discovery": [join(root, "packages/mcp/src/transport/discovery.ts")],
});
for (const name of ["kiwi", "fig"]) {
  paths[`@open-pencil/${name}`] = [join(root, `packages/${name}/src/index.ts`)];
  paths[`@open-pencil/${name}/*`] = [join(root, `packages/${name}/src/*`)];
}
const config = join(root, "tsconfig.zcode.json");
await writeFile(
  config,
  JSON.stringify({
    compilerOptions: {
      ...source.compilerOptions,
      noUnusedLocals: false,
      noUnusedParameters: false,
      paths,
      types: ["vite/client", "node"],
    },
    include: [
      join(pluginRoot, "ui/web/**/*.ts"),
      join(pluginRoot, "ui/web/**/*.vue"),
      join(root, "src/**/*.d.ts"),
      join(root, "packages/dom-css/src/postcss-value-parser.d.ts"),
    ],
  }),
);
const require = createRequire(join(root, "package.json"));
await run(
  process.execPath,
  [require.resolve("vue-tsc/bin/vue-tsc.js"), "--noEmit", "-p", config],
  root,
);
