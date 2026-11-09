import { cp, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const source = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const installed = process.env.ZCODE_PLUGIN_INSTALL_DIR;
if (!installed) throw new Error("Run pnpm build from the repository root");

// 只复制服务端明确 external 的运行依赖闭包，并解引用 pnpm 链接，保证离开仓库后可运行。
async function runtimePackage(name, resolver, destination, seen) {
  if (seen.has(name)) return;
  seen.add(name);
  const manifest = resolver.resolve(`${name}/package.json`);
  const directory = dirname(manifest);
  const pkg = JSON.parse(await readFile(manifest, "utf8"));
  await cp(directory, join(destination, name), {
    recursive: true,
    dereference: true,
    filter: (path) => !relative(directory, path).split(/[\\/]/).includes("node_modules"),
  });
  for (const dependency of Object.keys(pkg.dependencies ?? {}))
    await runtimePackage(dependency, createRequire(manifest), destination, seen);
}
const resolver = createRequire(join(source, "package.json"));
const upstream = createRequire(resolver.resolve("@open-pencil/core/package.json"));
const seen = new Set();
for (const dependency of ["css-tree", "canvaskit-wasm"])
  await runtimePackage(dependency, upstream, join(installed, "dist/node_modules"), seen);
