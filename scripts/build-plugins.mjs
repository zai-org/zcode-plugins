import { cp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { readPluginCatalog, validateLocalMcpPaths } from "./plugin-catalog.mjs";
import { buildLocalMarketplace } from "./build-local-marketplace.mjs";

async function runScript(script, plugin) {
  await new Promise((accept, reject) => {
    const child = spawn(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["run", script], {
      cwd: plugin.source,
      stdio: "inherit",
      shell: process.platform === "win32",
      env: { ...process.env, ZCODE_PLUGIN_INSTALL_DIR: plugin.installed },
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? accept() : reject(new Error(`${plugin.entry.name}: ${script} failed (${code})`)),
    );
  });
}

export async function buildPlugins(root) {
  const { plugins } = await readPluginCatalog(root);
  for (const plugin of plugins) {
    if (!plugin.pkg) continue;
    // 完成标记先清除、最后写入，避免打包接受构建中断或资源复制失败的产物。
    const completion = join(plugin.installed, "dist/build-info.json");
    await rm(join(plugin.installed, "dist"), { recursive: true, force: true });
    try {
      await rm(join(plugin.source, "dist"), { recursive: true, force: true });
      await runScript("build", plugin);
      await cp(join(plugin.source, "dist"), join(plugin.installed, "dist"), {
        recursive: true,
        dereference: true,
        filter: (path) => path !== join(plugin.source, "dist/build-info.json"),
      });
      if (plugin.pkg.scripts.stage) await runScript("stage", plugin);
      await validateLocalMcpPaths(plugin.installed, plugin.manifest);
      await writeFile(
        completion,
        JSON.stringify({ name: plugin.entry.name, version: plugin.manifest.version }) + "\n",
      );
    } catch (error) {
      await rm(completion, { force: true });
      throw error;
    }
    process.stdout.write(`Staged ${plugin.entry.name}@${plugin.manifest.version}\n`);
  }
  return buildLocalMarketplace(root);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  process.stdout.write(`Local marketplace ready: ${await buildPlugins(root)}\n`);
}
