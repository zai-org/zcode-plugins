import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { LIMITS, TypstError, type Diagnostic } from "#t/contract.ts";
import { parseDiagnostics } from "#t/typst/diagnostics.ts";
import { run } from "#t/typst/locate.ts";

export interface OneshotOptions {
  typst: string;
  cwd: string;
  main: string;
  env?: NodeJS.ProcessEnv;
  toFile?: (path: string) => string;
  timeoutMs?: number;
}

export interface CompileResult {
  ok: boolean;
  diagnostics: Diagnostic[];
}

/** 一次性 `typst compile`；失败时带回诊断。 */
async function compile(options: OneshotOptions, output: string, extra: string[]): Promise<CompileResult> {
  const result = await run(options.typst, ["compile", options.main, output, ...extra], {
    cwd: options.cwd,
    env: options.env,
    timeoutMs: options.timeoutMs ?? LIMITS.oneshotTimeoutMs,
  });
  if (result.timedOut) throw new TypstError("timeout", `typst compile did not finish within ${Math.round((options.timeoutMs ?? LIMITS.oneshotTimeoutMs) / 1000)} s.`);
  const diagnostics = parseDiagnostics(result.stderr, options.toFile);
  if (result.code !== 0 && !diagnostics.some((entry) => entry.severity === "error"))
    diagnostics.push({ severity: "error", message: (result.stderr || result.stdout).trim().slice(0, 500) || `typst exited with code ${result.code}`, location: null, hints: [], trace: [] });
  return { ok: result.code === 0, diagnostics };
}

/** 把指定页渲染为 PNG。pages 为 1 起的页码。 */
export async function renderPages(
  options: OneshotOptions & { scratch: string },
  pages: number[],
  ppi: number,
): Promise<CompileResult & { images: { page: number; png: Uint8Array }[] }> {
  const dir = await mkdtemp(join(options.scratch, "render-"));
  try {
    const result = await compile(options, join(dir, "page-{p}.png"), ["--pages", pages.join(","), "--ppi", String(ppi)]);
    if (!result.ok) return { ...result, images: [] };
    const images: { page: number; png: Uint8Array }[] = [];
    for (const name of await readdir(dir)) {
      const match = /^page-(\d+)\.png$/.exec(name);
      if (match) images.push({ page: Number(match[1]), png: new Uint8Array(await readFile(join(dir, name))) });
    }
    images.sort((a, b) => a.page - b.page);
    return { ...result, images };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** 导出 PDF 到 output（调用方已检查路径在工作区内）。 */
export async function exportPdf(options: OneshotOptions, output: string, extra: { pdfStandard?: string; pages?: string }): Promise<CompileResult> {
  const args: string[] = [];
  if (extra.pdfStandard) args.push("--pdf-standard", extra.pdfStandard);
  if (extra.pages) args.push("--pages", extra.pages);
  return compile(options, output, args);
}
