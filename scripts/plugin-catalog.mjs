import { access, readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function optionalJson(path) {
  try {
    return await readJson(path);
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

export async function readPluginCatalog(root) {
  const marketplace = await readJson(join(root, "marketplace.json"));
  const plugins = [];
  const names = new Set();
  for (const entry of marketplace.plugins) {
    const { name } = entry;
    if (
      typeof name !== "string" ||
      !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(name) ||
      names.has(name) ||
      entry.source !== `./plugins/${name}`
    )
      throw new Error(`${name}: duplicate name or invalid local marketplace source`);
    names.add(name);
    const installed = join(root, "plugins", name);
    const source = join(root, "ui-plugins", name);
    const manifest = await readJson(join(installed, ".zcode-plugin/plugin.json"));
    if (manifest.name !== name || !manifest.version || manifest.version !== entry.version)
      throw new Error(`${name}: marketplace/install version or name mismatch`);
    const pkg = await optionalJson(join(source, "package.json"));
    if (
      pkg &&
      (pkg.version !== manifest.version ||
        typeof pkg.scripts?.build !== "string" ||
        !pkg.scripts.build.trim())
    )
      throw new Error(`${name}: source/install version mismatch or missing build script`);
    plugins.push({ entry, manifest, installed, source, pkg });
  }
  return { marketplace, plugins };
}

export function pluginPath(installed, path) {
  const destination = resolve(installed, path);
  const rel = relative(installed, destination);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new Error(`Plugin path escapes installation: ${path}`);
  return destination;
}

export async function readMcpServers(installed, manifest) {
  async function resolveDeclaration(declaration) {
    if (typeof declaration === "string") {
      const contents = await readJson(pluginPath(installed, declaration));
      return contents.mcpServers ?? contents;
    }
    if (Array.isArray(declaration)) {
      const servers = {};
      for (const item of declaration) Object.assign(servers, await resolveDeclaration(item));
      return servers;
    }
    return declaration ?? {};
  }
  if (manifest.mcpServers !== undefined) return resolveDeclaration(manifest.mcpServers);
  const defaults = await optionalJson(join(installed, ".mcp.json"));
  return defaults?.mcpServers ?? defaults ?? {};
}

export async function validateLocalMcpPaths(installed, manifest) {
  const prefix = "${ZCODE_PLUGIN_ROOT}/";
  for (const server of Object.values(await readMcpServers(installed, manifest))) {
    for (const value of [server.command, ...(server.args ?? [])]) {
      if (typeof value !== "string" || !value.startsWith(prefix)) continue;
      const path = value.slice(prefix.length);
      if (path.includes("${")) continue;
      await access(pluginPath(installed, path));
    }
  }
}

export async function validateBuiltPlugin(plugin) {
  if (!plugin.pkg) return;
  const { entry, installed, manifest } = plugin;
  const built = await readJson(join(installed, "dist/build-info.json"));
  if (built.name !== entry.name || built.version !== manifest.version)
    throw new Error(`${entry.name}: incomplete or outdated build; run pnpm build`);
  await validateLocalMcpPaths(installed, manifest);
}
