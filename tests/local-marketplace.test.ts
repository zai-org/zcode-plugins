import { afterEach, expect, it } from "vitest";
import { access, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLocalMarketplace } from "../scripts/build-local-marketplace.mjs";
import { buildPlugins } from "../scripts/build-plugins.mjs";

const temporary: string[] = [];
const name = "my-canvas";
const skill = "my-skill";
const version = "0.1.0";
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function json(path: string, value: unknown) {
  await writeFile(path, JSON.stringify(value));
}
async function readJson(path: string) {
  return JSON.parse(await readFile(path, "utf8"));
}
async function addPlugin(root: string, plugin: string, compiled = false) {
  const installed = join(root, "plugins", plugin);
  await mkdir(join(installed, ".zcode-plugin"), { recursive: true });
  await json(join(installed, ".zcode-plugin/plugin.json"), {
    name: plugin,
    version,
    ...(compiled
      ? { mcpServers: { app: { command: "node", args: ["${ZCODE_PLUGIN_ROOT}/dist/app.cjs"] } } }
      : {}),
  });
  await writeFile(join(installed, "README.md"), plugin);
  if (compiled) {
    const source = join(root, "ui-plugins", plugin);
    await mkdir(source, { recursive: true });
    await json(join(source, "package.json"), {
      name: plugin,
      version,
      scripts: { build: "node build.cjs", stage: "node stage.cjs" },
    });
    await writeFile(
      join(source, "build.cjs"),
      `const fs = require('node:fs'); fs.mkdirSync('dist', {recursive:true}); fs.writeFileSync('dist/app.cjs', 'module.exports = {};');`,
    );
    await writeFile(
      join(source, "stage.cjs"),
      `require('node:fs').writeFileSync(require('node:path').join(process.env.ZCODE_PLUGIN_INSTALL_DIR, 'extra.txt'), 'staged');`,
    );
    await mkdir(join(installed, "dist"));
    await json(join(installed, "dist/build-info.json"), { name: plugin, version });
    await writeFile(join(installed, "dist/app.cjs"), "module.exports = {};");
  }
  return { name: plugin, version, source: `./plugins/${plugin}`, description: plugin };
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "local-marketplace-"));
  temporary.push(root);
  await json(join(root, "marketplace.json"), {
    name: "my-plugins-official",
    description: "My catalogue",
    owner: { name: "Developer" },
    plugins: [await addPlugin(root, name, true), await addPlugin(root, skill)],
  });
  return root;
}

it("copies all ordinary and UI entries portably without requiring a bundled development skill", async () => {
  const root = await fixture();
  const original = await readFile(join(root, "marketplace.json"), "utf8");
  const output = await buildLocalMarketplace(root);
  const moved = `${root}-copied`;
  temporary.push(moved);
  await cp(output, moved, { recursive: true });
  await rm(output, { recursive: true });
  const manifest = await readJson(join(moved, "marketplace.json"));
  expect(manifest).toEqual({ ...JSON.parse(original), name: "my-plugins-local" });
  for (const entry of manifest.plugins) {
    expect((await readJson(join(moved, entry.source, ".zcode-plugin/plugin.json"))).name).toBe(
      entry.name,
    );
  }
  await expect(access(join(moved, "plugins", name, "dist/app.cjs"))).resolves.toBeUndefined();
  await expect(access(join(moved, "ui-plugins"))).rejects.toThrow();
  expect(await readFile(join(root, "marketplace.json"), "utf8")).toBe(original);
});

it.each([
  [`plugins/${name}/dist/build-info.json`, null],
  [`plugins/${name}/dist/app.cjs`, null],
  [`plugins/${name}/dist/build-info.json`, { name, version: "0.0.0" }],
  [`plugins/${name}/dist/build-info.json`, { name: "wrong", version }],
  [`plugins/${name}/.zcode-plugin/plugin.json`, { name, version: "0.0.0" }],
  [`plugins/${skill}/.zcode-plugin/plugin.json`, { name: "wrong", version }],
  [`ui-plugins/${name}/package.json`, { version: "0.0.0", scripts: { build: "node build.cjs" } }],
])(
  "rejects incomplete or mismatched %s and preserves the previous snapshot",
  async (path, value) => {
    const root = await fixture();
    const output = await buildLocalMarketplace(root);
    await writeFile(join(output, "sentinel"), "previous snapshot");
    if (value === null) await rm(join(root, path));
    else await json(join(root, path), value);
    await expect(buildLocalMarketplace(root)).rejects.toThrow();
    expect(await readFile(join(output, "sentinel"), "utf8")).toBe("previous snapshot");
  },
);

it("reflects arbitrary additions, removals, version updates and stale output removal", async () => {
  const root = await fixture();
  const output = await buildLocalMarketplace(root);
  const catalogue = await readJson(join(root, "marketplace.json"));
  catalogue.plugins = [await addPlugin(root, "another-author-panel", true)];
  catalogue.plugins[0].version = "0.2.0";
  for (const path of [
    "plugins/another-author-panel/.zcode-plugin/plugin.json",
    "ui-plugins/another-author-panel/package.json",
    "plugins/another-author-panel/dist/build-info.json",
  ]) {
    const content = await readJson(join(root, path));
    await json(join(root, path), { ...content, version: "0.2.0" });
  }
  await json(join(root, "marketplace.json"), catalogue);
  await buildLocalMarketplace(root);
  expect((await readJson(join(output, "marketplace.json"))).plugins).toEqual(catalogue.plugins);
  await expect(access(join(output, "plugins", name))).rejects.toThrow();
});

it("preserves metadata and remaps only dependencies on this marketplace", async () => {
  const root = await fixture();
  const catalogue = await readJson(join(root, "marketplace.json"));
  const dependencies = [skill, `${skill}@my-plugins-official`, "external@third-party"];
  catalogue.plugins[0].dependencies = dependencies;
  catalogue.allowCrossMarketplaceDependenciesOn = ["third-party", "my-plugins-official"];
  await json(join(root, "marketplace.json"), catalogue);
  const path = join(root, "plugins", name, ".zcode-plugin/plugin.json");
  await json(path, { ...(await readJson(path)), dependencies });
  const output = await buildLocalMarketplace(root, { name: "custom-local", output: "dist/custom" });
  const expected = [skill, `${skill}@custom-local`, "external@third-party"];
  expect((await readJson(join(output, "marketplace.json"))).plugins[0].dependencies).toEqual(
    expected,
  );
  expect(
    (await readJson(join(output, "marketplace.json"))).allowCrossMarketplaceDependenciesOn,
  ).toEqual(["third-party", "custom-local"]);
  expect(
    (await readJson(join(output, "plugins", name, ".zcode-plugin/plugin.json"))).dependencies,
  ).toEqual(expected);
  expect((await readJson(path)).dependencies).toEqual(dependencies);
});

it.each(["plugins", "dist", "dist/nested/source", "../outside"])(
  "rejects unsafe output %s",
  async (output) => {
    await expect(buildLocalMarketplace(await fixture(), { output })).rejects.toThrow(
      /direct child/,
    );
  },
);

it("dispatches declared build and stage scripts for registered arbitrary names only", async () => {
  const root = await fixture();
  const unregistered = join(root, "ui-plugins", "not-registered");
  await mkdir(unregistered);
  await json(join(unregistered, "package.json"), { scripts: { build: "exit 1" } });
  await writeFile(join(root, "plugins", name, "dist/stale.js"), "old");
  await buildPlugins(root);
  const output = join(root, "dist/local-marketplace/plugins", name);
  expect(await readFile(join(output, "extra.txt"), "utf8")).toBe("staged");
  await expect(access(join(output, "dist/stale.js"))).rejects.toThrow();
  expect(await readJson(join(output, "dist/build-info.json"))).toEqual({ name, version });
}, 15000);

it("failed staging cannot leave a valid completion marker or replace the previous local source", async () => {
  const root = await fixture();
  const output = await buildLocalMarketplace(root);
  await writeFile(join(output, "sentinel"), "previous snapshot");
  await writeFile(join(root, "ui-plugins", name, "stage.cjs"), "process.exit(1);");
  await expect(buildPlugins(root)).rejects.toThrow(/stage/);
  await expect(access(join(root, "plugins", name, "dist/build-info.json"))).rejects.toThrow();
  expect(await readFile(join(output, "sentinel"), "utf8")).toBe("previous snapshot");
}, 15000);

it("copy failures preserve the previous snapshot", async () => {
  const root = await fixture();
  const output = await buildLocalMarketplace(root);
  await writeFile(join(output, "sentinel"), "previous snapshot");
  await symlink(join(root, "missing"), join(root, "plugins", skill, "broken-link"));
  await expect(buildLocalMarketplace(root)).rejects.toThrow();
  expect(await readFile(join(output, "sentinel"), "utf8")).toBe("previous snapshot");
});

it("resolves MCP declarations from files without assuming the server filename", async () => {
  const root = await fixture();
  const installed = join(root, "plugins", name);
  const manifestPath = join(installed, ".zcode-plugin/plugin.json");
  const manifest = await readJson(manifestPath);
  await json(join(installed, ".mcp.json"), { mcpServers: manifest.mcpServers });
  manifest.mcpServers = [".mcp.json"];
  await json(manifestPath, manifest);
  await buildLocalMarketplace(root);
  await rm(join(installed, "dist/app.cjs"));
  await expect(buildLocalMarketplace(root)).rejects.toThrow();
});
