import { readdir, readFile, lstat } from "node:fs/promises";
import { join } from "node:path";
import { copyright, guessFromText, licenseField, normalize } from "./licenses.ts";

export interface Pkg { name: string; version: string; license: string; source: string; path: string; homepage: string; copyright: string; licenseText: string; dev: boolean | null; direct: boolean }

const LICENSE_FILE = /^(licen[cs]e|copying|unlicense)(\.(md|txt|markdown|mit|bsd|apache))?$/i;

async function readJson(p: string) {
  try { const st = await lstat(p); if (!st.isFile()) return undefined; return JSON.parse(await readFile(p, "utf8")); } catch { return undefined; }
}

async function licenseFile(dir: string) {
  try {
    for (const e of await readdir(dir, { withFileTypes: true })) if (e.isFile() && LICENSE_FILE.test(e.name)) return await readFile(join(dir, e.name), "utf8");
  } catch { /* none */ }
  return "";
}

export async function scan(root: string, limit = 5000) {
  const rootPkg = await readJson(join(root, "package.json"));
  if (!rootPkg) throw new Error("No package.json in this folder — pick the project's root folder.");
  const deps = new Set(Object.keys(rootPkg.dependencies ?? {}).concat(Object.keys(rootPkg.optionalDependencies ?? {}), Object.keys(rootPkg.peerDependencies ?? {})));
  const devDeps = new Set(Object.keys(rootPkg.devDependencies ?? {}));
  const lock = await readJson(join(root, "package-lock.json"));
  const lockPkgs: Record<string, { version?: string; license?: string; dev?: boolean; devOptional?: boolean }> = lock?.packages ?? {};
  const found = new Map<string, Pkg>();
  const visit = async (dir: string, rel: string, depth: number) => {
    if (depth > 12 || found.size >= limit) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue; // 符号链接（pnpm 顶层）不跟随，真实目录在 .pnpm 里
      if (e.name === ".bin" || e.name === ".cache") continue;
      if (e.name === ".pnpm") { for (const s of await readdir(join(dir, e.name), { withFileTypes: true }).catch(() => [])) if (s.isDirectory()) await visit(join(dir, e.name, s.name, "node_modules"), `${rel}/${e.name}/${s.name}/node_modules`, depth + 1); continue; }
      if (e.name.startsWith("@")) { for (const s of await readdir(join(dir, e.name), { withFileTypes: true }).catch(() => [])) if (s.isDirectory()) await pkg(join(dir, e.name, s.name), `${rel}/${e.name}/${s.name}`, depth); continue; }
      if (e.name.startsWith(".")) continue;
      await pkg(join(dir, e.name), `${rel}/${e.name}`, depth);
    }
  };
  const pkg = async (dir: string, rel: string, depth: number) => {
    const pj = await readJson(join(dir, "package.json"));
    if (pj?.name && pj.version) {
      const key = `${pj.name}@${pj.version}`;
      if (!found.has(key)) {
        const text = await licenseFile(dir);
        let lic = licenseField(pj);
        let source = lic ? "package.json" : "";
        if (!lic && text) { lic = guessFromText(text); source = lic ? "LICENSE file" : ""; }
        const lp = lockPkgs[rel.replace(/^\//, "")];
        if (!lic && lp?.license) { lic = lp.license; source = "lockfile"; }
        const repo = typeof pj.repository === "string" ? pj.repository : pj.repository?.url ?? "";
        found.set(key, { name: pj.name, version: pj.version, license: normalize(lic), source: source || "none", path: rel.replace(/^\//, ""), homepage: String(pj.homepage || repo || "").replace(/^git\+/, "").replace(/^github:/, "https://github.com/"), copyright: copyright(text) || (typeof pj.author === "string" ? `Copyright (c) ${pj.author}` : pj.author?.name ? `Copyright (c) ${pj.author.name}` : ""), licenseText: text, dev: lp ? Boolean(lp.dev) : devDeps.has(pj.name) && !deps.has(pj.name) ? true : deps.has(pj.name) ? false : null, direct: deps.has(pj.name) || devDeps.has(pj.name) });
      }
    }
    await visit(join(dir, "node_modules"), `${rel}/node_modules`, depth + 1);
  };
  await visit(join(root, "node_modules"), "node_modules", 0);
  if (!found.size && lock) {
    for (const [path, lp] of Object.entries(lockPkgs)) {
      if (!path) continue;
      const name = path.split("node_modules/").pop()!;
      const key = `${name}@${lp.version}`;
      if (!found.has(key)) found.set(key, { name, version: lp.version ?? "", license: normalize(lp.license ?? ""), source: lp.license ? "lockfile" : "none", path, homepage: "", copyright: "", licenseText: "", dev: Boolean(lp.dev), direct: deps.has(name) || devDeps.has(name) });
    }
  }
  return { project: `${rootPkg.name ?? "project"}${rootPkg.version ? `@${rootPkg.version}` : ""}`, packages: [...found.values()].sort((a, b) => a.name.localeCompare(b.name, "en") || a.version.localeCompare(b.version)), fromLock: !found.size ? false : ![...found.values()].some((p) => p.path.includes("node_modules/") && p.source !== "lockfile") };
}
