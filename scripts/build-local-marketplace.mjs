import { cp, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { readPluginCatalog, validateBuiltPlugin } from "./plugin-catalog.mjs";

function remapDependencies(value, original, local) {
  return {
    ...value,
    ...(value.dependencies
      ? {
          dependencies: value.dependencies.map((dependency) =>
            dependency.endsWith(`@${original}`)
              ? `${dependency.slice(0, -original.length)}${local}`
              : dependency,
          ),
        }
      : {}),
  };
}

export async function buildLocalMarketplace(root, options = {}) {
  root = resolve(root);
  const dist = join(root, "dist");
  const output = resolve(root, options.output ?? "dist/local-marketplace");
  if (dirname(output) !== dist || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(basename(output)))
    throw new Error("Local marketplace output must be a named direct child of dist/");
  const { marketplace, plugins } = await readPluginCatalog(root);
  const name = options.name ?? `${marketplace.name.replace(/-official$/, "")}-local`;
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(name) || name === "zcode-plugins-official")
    throw new Error(`Invalid or reserved local marketplace name: ${name}`);
  for (const plugin of plugins) await validateBuiltPlugin(plugin);
  await mkdir(dist, { recursive: true });
  const staging = await mkdtemp(join(dist, ".local-marketplace-"));
  try {
    for (const plugin of plugins) {
      const destination = join(staging, "plugins", plugin.entry.name);
      await cp(plugin.installed, destination, { recursive: true, dereference: true });
      // 本地市场名称改变后，显式指向本市场的依赖也必须指向同一份本地快照。
      if (plugin.manifest.dependencies)
        await writeFile(
          join(destination, ".zcode-plugin/plugin.json"),
          JSON.stringify(remapDependencies(plugin.manifest, marketplace.name, name), null, 2) +
            "\n",
        );
    }
    const local = {
      ...marketplace,
      name,
      ...(marketplace.allowCrossMarketplaceDependenciesOn
        ? {
            allowCrossMarketplaceDependenciesOn:
              marketplace.allowCrossMarketplaceDependenciesOn.map((allowed) =>
                allowed === marketplace.name ? name : allowed,
              ),
          }
        : {}),
      plugins: plugins.map(({ entry }) => remapDependencies(entry, marketplace.name, name)),
    };
    await writeFile(join(staging, "marketplace.json"), JSON.stringify(local, null, 2) + "\n");
    // 校验和复制全部完成后才替换旧快照，构建失败时继续保留原测试源。
    await rm(output, { recursive: true, force: true });
    await rename(staging, output);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: { name: { type: "string" }, output: { type: "string" } },
  });
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  process.stdout.write(`Local marketplace ready: ${await buildLocalMarketplace(root, values)}\n`);
}
