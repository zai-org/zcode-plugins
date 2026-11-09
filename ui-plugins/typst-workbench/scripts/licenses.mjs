import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

// 从实际参与打包的模块收集许可证，避免只列直接依赖而漏掉 Canvas/SDK 的传递依赖。
export async function writeNotices(metafiles, destination) {
  const packages = new Map();
  for (const input of metafiles.flatMap((meta) => Object.keys(meta.inputs))) {
    if (!input.includes("node_modules/")) continue;
    let directory = dirname(resolve(input));
    while (directory.includes("node_modules")) {
      try {
        const pkg = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
        if (pkg.name) {
          packages.set(directory, pkg);
          break;
        }
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      directory = dirname(directory);
    }
  }
  const notices = [];
  const seen = new Set();
  for (const [directory, pkg] of [...packages].sort((a, b) => a[1].name.localeCompare(b[1].name))) {
    const key = `${pkg.name}@${pkg.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const files = (await readdir(directory)).filter((name) =>
      /^(license|copying|notice)([.-]|$)/i.test(name),
    );
    const texts = await Promise.all(files.map((file) => readFile(join(directory, file), "utf8")));
    if (!texts.length) throw new Error(`Missing license for bundled dependency ${key}`);
    notices.push(
      `${key} — ${typeof pkg.license === "string" ? pkg.license : JSON.stringify(pkg.license)}\n${texts.join("\n\n")}`,
    );
  }
  await writeFile(destination, notices.join("\n\n----------------------------------------\n\n"));
}
