import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

export interface CodeIssue { file: string; line?: number; col?: number; message: string; severity: "error" | "warning"; source: "typescript" | "esbuild" | "render" | "check" }

/** 用 TypeScript 在内存里做类型检查（strict + react-jsx），React 类型来自随插件附带的 @types/react。 */
export function typecheck(files: Record<string, string>, typesRoot: string): CodeIssue[] {
  const vfs = new Map<string, string>();
  for (const [p, s] of Object.entries(files)) vfs.set(`/kit/${p}`, s);
  vfs.set("/kit/__ambient.d.ts", 'declare module "*.css";\ndeclare module "*.svg" { const src: string; export default src; }\ndeclare module "*.png" { const src: string; export default src; }\n');
  const disk = (dir: string, prefix: string) => { for (const f of readdirSync(dir)) if (f.endsWith(".d.ts") || f === "package.json") vfs.set(`${prefix}/${f}`, readFileSync(join(dir, f), "utf8")); };
  disk(join(typesRoot, "react"), "/node_modules/@types/react");
  disk(join(typesRoot, "csstype"), "/node_modules/csstype");
  const libDir = join(typesRoot, "ts-lib");
  const options: ts.CompilerOptions = {
    strict: true, noEmit: true, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"], types: [], skipLibCheck: true, allowImportingTsExtensions: true, noUnusedLocals: false, isolatedModules: true, esModuleInterop: true,
  };
  const read = (f: string) => vfs.get(f) ?? (f.startsWith("/lib/") ? (() => { try { return readFileSync(join(libDir, f.slice(5)), "utf8"); } catch { return undefined; } })() : undefined);
  const host: ts.CompilerHost = {
    getSourceFile: (f, v) => { const s = read(f); return s === undefined ? undefined : ts.createSourceFile(f, s, v, true); },
    getDefaultLibFileName: () => "/lib/lib.d.ts", getDefaultLibLocation: () => "/lib", writeFile: () => undefined, getCurrentDirectory: () => "/kit",
    getCanonicalFileName: (f) => f, useCaseSensitiveFileNames: () => true, getNewLine: () => "\n",
    fileExists: (f) => read(f) !== undefined, readFile: read,
    directoryExists: (d) => [...vfs.keys()].some((k) => k.startsWith(d.endsWith("/") ? d : `${d}/`)) || d === "/lib",
    getDirectories: () => [],
  };
  const roots = [...vfs.keys()].filter((f) => f.startsWith("/kit/") && /\.tsx?$/.test(f));
  const program = ts.createProgram(roots, options, host);
  return ts.getPreEmitDiagnostics(program).filter((d) => !d.file || d.file.fileName.startsWith("/kit/")).map((d) => {
    const pos = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : undefined;
    return { file: d.file ? d.file.fileName.slice(5) : "", line: pos ? pos.line + 1 : undefined, col: pos ? pos.character + 1 : undefined, message: ts.flattenDiagnosticMessageText(d.messageText, "\n"), severity: d.category === ts.DiagnosticCategory.Error ? "error" : "warning", source: "typescript" } as CodeIssue;
  });
}
