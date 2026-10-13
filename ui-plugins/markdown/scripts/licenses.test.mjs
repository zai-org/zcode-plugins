import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectLicenses } from "./licenses.mjs";

const temporary = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

it("copies license text and version metadata without exposing build paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "markdown-license-"));
  temporary.push(root);
  const pkg = join(root, "node_modules/example");
  await mkdir(pkg, { recursive: true });
  await writeFile(join(pkg, "package.json"), JSON.stringify({ name: "example", version: "1.0.0", license: "MIT" }));
  await writeFile(join(pkg, "index.js"), "export {};");
  const output = join(root, "licenses");
  const inputs = [{ inputs: { "node_modules/example/index.js": {} } }];
  await expect(collectLicenses(root, output, inputs)).rejects.toThrow("Missing license text");
  await writeFile(join(pkg, "LICENSE"), "Example license text\n");
  await collectLicenses(root, output, inputs);
  expect(await readFile(join(output, "example@1.0.0/LICENSE"), "utf8")).toBe("Example license text\n");
  const index = await readFile(join(output, "packages.json"), "utf8");
  expect(index).not.toContain(root);
  expect(JSON.parse(index)).toEqual([{ name: "example", version: "1.0.0", license: "MIT", files: ["LICENSE"] }]);
});
