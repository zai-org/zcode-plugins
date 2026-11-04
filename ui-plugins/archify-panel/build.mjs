import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = dirname(fileURLToPath(import.meta.url));

await mkdir(join(root, 'dist', 'ui'), { recursive: true });

await build({
  entryPoints: [join(root, 'src', 'server', 'main.ts')],
  outfile: join(root, 'dist', 'server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: false,
  logLevel: 'info',
});

const ui = await build({
  entryPoints: [join(root, 'src', 'ui', 'main.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: true,
  write: false,
  logLevel: 'info',
});

const bundle = ui.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = await readFile(join(root, 'src', 'ui', 'panel.css'), 'utf8');
const shell = await readFile(join(root, 'src', 'ui', 'shell.html'), 'utf8');
const html = shell
  .replace('/*ARCHIFY_PANEL_CSS*/', () => css)
  .replace('/*ARCHIFY_PANEL_BUNDLE*/', () => bundle);

await writeFile(join(root, 'dist', 'ui', 'panel.html'), html, 'utf8');
console.log(`面板已生成：dist/ui/panel.html（${html.length} 字节）`);
