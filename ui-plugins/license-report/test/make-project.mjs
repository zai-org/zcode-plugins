// 生成样例 Node 项目（含 node_modules）：node test/make-project.mjs <目标文件夹>
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(process.argv[2] ?? ".", "web-app");
const MIT = (who) => `MIT License\n\nCopyright (c) 2024 ${who}\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction...\n`;
const pkgs = [
  { path: "node_modules/tiny-date", name: "tiny-date", version: "2.3.1", license: "MIT", file: MIT("Ada Chen"), author: "Ada Chen" },
  { path: "node_modules/@demo/ui-kit", name: "@demo/ui-kit", version: "1.0.4", license: "Apache 2.0", file: "\n                                 Apache License\n                           Version 2.0, January 2004\n", repository: "github:demo/ui-kit" },
  { path: "node_modules/gpl-chart", name: "gpl-chart", version: "0.9.0", license: "GPL-3.0-only", file: "GNU GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007\n" },
  { path: "node_modules/weak-lib", name: "weak-lib", version: "5.1.0", licenses: [{ type: "MPL-2.0" }] },
  { path: "node_modules/dual-lib", name: "dual-lib", version: "3.0.0", license: "(MIT OR Apache-2.0)" },
  { path: "node_modules/mystery-lib", name: "mystery-lib", version: "0.0.7", file: MIT("Mystery Person") },
  { path: "node_modules/no-license", name: "no-license", version: "1.2.0" },
  { path: "node_modules/tiny-date/node_modules/color-mix", name: "color-mix", version: "1.1.0", license: "ISC", file: "ISC License\n\nCopyright (c) 2023 Bo Li\n\nPermission to use, copy, modify, and/or distribute this software for any\npurpose with or without fee is hereby granted.\n" },
  { path: "node_modules/test-runner-x", name: "test-runner-x", version: "4.0.0", license: "MIT", file: MIT("Runner Team") },
];
mkdirSync(root, { recursive: true });
writeFileSync(join(root, "package.json"), JSON.stringify({ name: "web-app", version: "1.0.0", private: true, dependencies: { "tiny-date": "^2.3.0", "@demo/ui-kit": "^1.0.0", "gpl-chart": "^0.9.0", "weak-lib": "^5.0.0", "dual-lib": "^3.0.0", "mystery-lib": "0.0.7", "no-license": "^1.2.0" }, devDependencies: { "test-runner-x": "^4.0.0" } }, null, 2));
const lock = { name: "web-app", lockfileVersion: 3, packages: { "": { name: "web-app" } } };
for (const p of pkgs) {
  mkdirSync(join(root, p.path), { recursive: true });
  const { path, file, ...pj } = p;
  writeFileSync(join(root, path, "package.json"), JSON.stringify(pj, null, 2));
  if (file) writeFileSync(join(root, path, "LICENSE"), file);
  lock.packages[path] = { version: p.version, ...(p.name === "test-runner-x" ? { dev: true } : {}) };
}
writeFileSync(join(root, "package-lock.json"), JSON.stringify(lock, null, 2));
