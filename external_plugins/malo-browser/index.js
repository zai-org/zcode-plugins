import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export const name = "malo-browser";
export const inject = ["skills"];

export function apply(ctx) {
  // DSH host 在运行期提供 @deepseek-ai/dsh-skill-filesystem（optional peer）；
  // Electron 应用上下文装不了它，所以只在 apply 里解析，不做顶层 import。
  const { apply: applySkillFilesystem } = createRequire(import.meta.url)(
    "@deepseek-ai/dsh-skill-filesystem",
  );
  applySkillFilesystem(ctx, {
    providerName: name,
    includeDefaultRoots: false,
    bundledSkillDir: fileURLToPath(new URL("./skills/", import.meta.url)),
    watch: false,
  });
  return ctx;
}

// `electron .` 同样以本文件为应用入口（package.json main）；
// 真正的应用主进程转发到编译产物，其 CJS 语义由 out/package.json 钉住。
if (process.type === "browser") {
  await import(new URL("./out/main/index.js", import.meta.url).href);
}
