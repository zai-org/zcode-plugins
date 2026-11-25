import { posix } from "node:path";
import type { Plugin } from "esbuild-wasm";
import type { CodeIssue } from "./compile.ts";

type Esbuild = typeof import("esbuild-wasm");
let esb: Promise<Esbuild> | undefined;
/** esbuild-wasm：插件包里附带 wasm 版本，不依赖用户电脑上的原生 esbuild。 */
export const esbuild = () => (esb ??= import("esbuild-wasm").then((m) => (m as unknown as { default?: Esbuild }).default ?? m));

const REACT: Record<string, string> = {
  react: "module.exports = globalThis.__dc.React;",
  "react/jsx-runtime": "module.exports = globalThis.__dc.JSX;",
  "react-dom": "module.exports = globalThis.__dc.DOM;",
  "react-dom/client": "module.exports = globalThis.__dc.DOMClient;",
};

function vfsPlugin(files: Record<string, string>, mode: "ssr" | "browser"): Plugin {
  const find = (p: string) => [p, `${p}.tsx`, `${p}.ts`, `${p}.jsx`, `${p}.js`, `${p}/index.tsx`, `${p}/index.ts`].find((c) => c in files);
  return {
    name: "kit-vfs",
    setup(b) {
      b.onResolve({ filter: /.*/ }, (args) => {
        if (args.path in REACT) return mode === "ssr" ? { path: args.path, external: true } : { path: args.path, namespace: "react-global" };
        if (args.kind === "entry-point") return { path: args.path, namespace: "kit" };
        if (args.path.startsWith(".") || args.path.startsWith("/")) {
          const base = args.path.startsWith("/") ? args.path.slice(1) : posix.join(posix.dirname(args.importer), args.path);
          const hit = find(posix.normalize(base));
          if (!hit) return { errors: [{ text: `Cannot find “${args.path}” (from ${args.importer}).` }] };
          return { path: hit, namespace: "kit" };
        }
        return { errors: [{ text: `Package “${args.path}” is not available — components may import only react, react-dom and files in the kit.` }] };
      });
      b.onLoad({ filter: /.*/, namespace: "react-global" }, (a) => ({ contents: REACT[a.path], loader: "js" }));
      b.onLoad({ filter: /.*/, namespace: "kit" }, (a) => {
        const ext = posix.extname(a.path).slice(1);
        if (ext === "css") return mode === "ssr" ? { contents: "", loader: "js" } : { contents: files[a.path], loader: "css", resolveDir: "/" };
        return { contents: files[a.path], loader: (ext === "ts" ? "ts" : ext === "jsx" ? "jsx" : ext === "js" ? "js" : "tsx") as "tsx", resolveDir: "/" };
      });
    },
  };
}
const toIssues = (msgs: { text: string; location?: { file: string; line: number; column: number } | null }[], severity: "error" | "warning"): CodeIssue[] =>
  msgs.map((m) => ({ file: m.location?.file ?? "", line: m.location?.line, col: m.location ? m.location.column + 1 : undefined, message: m.text, severity, source: "esbuild" }));

async function run(files: Record<string, string>, entry: string, mode: "ssr" | "browser") {
  const e = await esbuild();
  try {
    const r = await e.build({
      entryPoints: [entry], bundle: true, write: false, outdir: "/out", format: mode === "ssr" ? "cjs" : "iife", platform: mode === "ssr" ? "node" : "browser",
      jsx: "automatic", target: "es2020", minify: mode === "browser", logLevel: "silent", plugins: [vfsPlugin(files, mode)], define: { "process.env.NODE_ENV": '"production"' },
    });
    const js = r.outputFiles.find((f) => f.path.endsWith(".js"))?.text ?? "";
    const css = r.outputFiles.find((f) => f.path.endsWith(".css"))?.text ?? "";
    return { js, css, issues: toIssues(r.warnings, "warning") };
  } catch (err) {
    const f = err as { errors?: { text: string; location?: { file: string; line: number; column: number } | null }[]; message: string };
    return { js: "", css: "", issues: f.errors?.length ? toIssues(f.errors, "error") : [{ file: "", message: f.message, severity: "error" as const, source: "esbuild" as const }] };
  }
}

export function ssrEntry(names: string[]) {
  return names.map((n, i) => `import * as M${i} from "./src/${n}";`).join("\n") + `\nexport const mods = { ${names.map((n, i) => `${JSON.stringify(n)}: M${i}`).join(", ")} };\n`;
}
export function catalogEntry(names: string[], title: string) {
  return `import { createRoot } from "react-dom/client";
import { useState } from "react";
${names.map((n, i) => `import * as M${i} from "./src/${n}";`).join("\n")}
const comps: { name: string; mod: any }[] = [${names.map((n, i) => `{ name: ${JSON.stringify(n)}, mod: M${i} }`).join(", ")}];
function App() {
  const [dark, setDark] = useState(false);
  return (
    <div className={"dc-catalog" + (dark ? " dc-dark" : "")}>
      <header className="dc-head"><h1>${title.replace(/[<>{}"]/g, "")}</h1><label><input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} /> Dark background</label></header>
      <nav className="dc-nav">{comps.map((c) => <a key={c.name} href={"#" + c.name}>{c.name}</a>)}</nav>
      {comps.map((c) => (
        <section key={c.name} id={c.name} className="dc-comp">
          <h2>{c.name}</h2>
          <div className="dc-examples">{(c.mod.examples ?? []).map((e: any) => <figure key={e.name}><div className="dc-stage">{e.render()}</div><figcaption>{e.name}</figcaption></figure>)}</div>
        </section>
      ))}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
`;
}
export const bundleSsr = (files: Record<string, string>, names: string[]) => run({ ...files, "__ssr.tsx": ssrEntry(names) }, "__ssr.tsx", "ssr");
export const bundleCatalog = (files: Record<string, string>, names: string[], title: string) => run({ ...files, "__catalog.tsx": catalogEntry(names, title) }, "__catalog.tsx", "browser");
