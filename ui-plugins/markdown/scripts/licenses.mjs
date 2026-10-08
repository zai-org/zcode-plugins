// Preserve complete license texts for packages actually included by esbuild.
import { cp, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export async function collectLicenses(root, output, metafiles) {
  const packages = new Map();
  for (const input of metafiles.flatMap((meta) => Object.keys(meta.inputs))) {
    if (!input.includes("node_modules/")) continue;
    let directory = dirname(await realpath(resolve(root, input)));
    while (dirname(directory) !== directory) {
      const pkg = await readFile(join(directory, "package.json"), "utf8")
        .then(JSON.parse)
        .catch((error) => {
          if (error.code === "ENOENT") return undefined;
          throw error;
        });
      if (pkg?.name && pkg?.version) {
        packages.set(`${pkg.name}@${pkg.version}`, { directory, pkg });
        break;
      }
      directory = dirname(directory);
    }
  }
  const index = [];
  for (const [id, { directory, pkg }] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
    const files = (await readdir(directory)).filter((file) => /^(licen[cs]e|notice|copying)(\.|$)/i.test(file));
    if (!files.length) throw new Error(`Missing license text for bundled package ${id}`);
    const destination = join(output, id.replaceAll("/", "__"));
    await mkdir(destination, { recursive: true });
    for (const file of files) await cp(join(directory, file), join(destination, file));
    index.push({ name: pkg.name, version: pkg.version, license: pkg.license, files });
  }
  await writeFile(join(output, "packages.json"), `${JSON.stringify(index, null, 2)}\n`);
}
