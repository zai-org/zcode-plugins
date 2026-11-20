import { accessSync, constants, existsSync, realpathSync, statSync } from 'node:fs';
import { delimiter, isAbsolute, join, relative, sep } from 'node:path';

// 在 PATH 中解析裸名 CLI（ZP-20261111-16）。
// Windows 上 libuv 会先在工作目录（即用户项目）中查找裸名，所以裸名绝不能直接交给 spawn。
// 项目目录内的候选（包括经符号链接指向项目内的文件）不可执行；相对 PATH 项也被忽略。
// 返回绝对路径，调用方必须用该绝对路径执行，不能再把裸名交给 spawn 去解析。
export function resolveBareCli(name, { project, env = process.env, platform = process.platform }) {
  const projectRoot = projectRootOf(project, platform);
  const candidateNames = platform === 'win32' ? windowsCandidateNames(name) : [name];
  for (const dir of (env.PATH || '').split(delimiter)) {
    if (!dir || !isAbsolute(dir)) continue;
    for (const candidateName of candidateNames) {
      const candidate = join(dir, candidateName);
      if (!isExecutableFile(candidate)) continue;
      if (isInside(normalize(realpathSync(candidate), platform), projectRoot)) continue;
      return candidate;
    }
  }
  return null;
}

// 与修复前 spawn（libuv）在 Windows 上实际能启动的范围一致：只认 .com、.exe，不按 PATHEXT 扩大。
// .cmd/.bat 不经过 shell 时会被新版 Node 拒绝（CVE-2024-27980），选中它们会把可用环境误报为找不到 CLI。
// 名称已带 .com/.exe 时按原名查找（例如 --cli unity.exe），不再追加扩展名。
function windowsCandidateNames(name) {
  return /\.(com|exe)$/i.test(name) ? [name] : [`${name}.com`, `${name}.exe`];
}

// 显式传入的路径（ZP-20261111-16）：参数可能由模型按仓库内容填写，因此同样不能指向项目内。
// 相对路径会按 spawn 的工作目录（用户项目）解析，一律拒绝。返回 null 表示允许，否则返回拒绝原因。
export function rejectExplicitCli(file, { project, platform = process.platform }) {
  if (!isAbsolute(file)) return 'ERELATIVE';
  if (existsSync(file) && isInside(normalize(realpathSync(file), platform), projectRootOf(project, platform))) {
    return 'EINPROJECT';
  }
  return null;
}

function projectRootOf(project, platform) {
  return normalize(existsSync(project) ? realpathSync(project) : project, platform);
}

function isExecutableFile(file) {
  try {
    if (!statSync(file).isFile()) return false;
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// macOS 与 Windows 的文件系统默认不区分大小写，比较前统一大小写避免大小写变体绕过
function normalize(file, platform) {
  return platform === 'linux' ? file : file.toLowerCase();
}

// 只把 ".." 本身或 "../" 开头视为在外：项目内名为 "..foo" 的目录也属于项目。
function isInside(child, parent) {
  const rel = relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}
