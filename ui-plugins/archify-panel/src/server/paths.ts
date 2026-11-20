import { createHash } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = dirname(fileURLToPath(import.meta.url));

/** 从模块位置向上找插件根目录，兼容 src/server 与 dist 两种布局 */
function findPluginRoot(): string {
  let current = moduleDir;
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(join(current, 'vendor', 'archify', 'bin', 'archify.mjs'))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error('找不到 vendor/archify，插件目录不完整');
}

export const pluginRoot = findPluginRoot();
export const archifyRoot = join(pluginRoot, 'vendor', 'archify');
export const archifyCli = join(archifyRoot, 'bin', 'archify.mjs');
export const assetRoot = join(pluginRoot, 'dist', 'ui');

export const workspaceRoot = realpathSync(
  resolve(process.env.ZCODE_WORKSPACE_ROOT || process.cwd()),
);

export const artifactRoot = join(workspaceRoot, '.archify-panel');

/** 插件私有数据目录按工作区隔离，避免不同项目的图互相串味 */
export const dataRoot = (() => {
  const base = process.env.ZCODE_PLUGIN_DATA || join(homedir(), '.zcode', 'plugin-data', 'archify-panel');
  const key = process.env.ZCODE_WORKSPACE_IDENTITY?.trim() || workspaceRoot;
  return join(base, createHash('sha256').update(key).digest('hex'));
})();
