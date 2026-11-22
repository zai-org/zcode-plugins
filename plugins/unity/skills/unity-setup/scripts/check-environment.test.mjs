import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { rejectExplicitCli, resolveBareCli } from './resolve-cli.mjs';

// 不在测试中执行假 CLI：当前沙箱会挂起新建可执行文件的 exec，
// 因此这里只校验解析结果；执行路径由脚本只 spawn 解析出的绝对路径保证。
// Windows 上假 CLI 是不可执行的占位 .exe：一旦被误执行，spawn 报的不是 ENOENT，用例同样失败。
const isWindows = process.platform === 'win32';
const platform = process.platform;
const script = fileURLToPath(new URL('./check-environment.mjs', import.meta.url));

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'unity-env-'));
  const project = join(root, 'project');
  const trusted = join(root, 'trusted-bin');
  mkdirSync(join(project, 'Assets'), { recursive: true });
  mkdirSync(join(project, 'ProjectSettings'), { recursive: true });
  mkdirSync(trusted);
  writeFileSync(join(project, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 6000.3.26f1\n');
  return { root, project, trusted };
}

function fakeCli(dir) {
  const file = join(dir, isWindows ? 'unity.exe' : 'unity');
  writeFileSync(file, isWindows ? 'not a real executable\n' : '#!/bin/sh\necho 1.0.0-test\n');
  if (!isWindows) chmodSync(file, 0o755);
  return file;
}

// 子进程只换 PATH，保留其余环境（Windows 上 Node 依赖 SystemRoot 等变量）。
// Windows 环境变量名不区分大小写，先去掉所有大小写形式的 PATH，避免重复键。
function runScript(args, path) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH'));
  const result = spawnSync(process.execPath, [script, ...args], {
    env: { ...env, PATH: path },
    encoding: 'utf8',
    timeout: 20000,
  });
  return JSON.parse(result.stdout);
}

test('PATH 中项目目录内的同名可执行文件被跳过，选用可信目录的候选', () => {
  const paths = fixture();
  fakeCli(paths.project);
  const trustedUnity = fakeCli(paths.trusted);
  const env = { PATH: [paths.project, paths.trusted].join(delimiter) };

  assert.equal(resolveBareCli('unity', { project: paths.project, env, platform }), trustedUnity);
  rmSync(paths.root, { recursive: true, force: true });
});

test('经符号链接指向项目内文件的候选同样被拒绝', (t) => {
  const paths = fixture();
  const inProject = fakeCli(paths.project);
  try {
    symlinkSync(inProject, join(paths.trusted, isWindows ? 'unity.exe' : 'unity'));
  } catch (error) {
    rmSync(paths.root, { recursive: true, force: true });
    // Windows 未开启开发者模式时，普通账户不能创建文件符号链接。
    if (error.code === 'EPERM') return t.skip('当前账户不能创建符号链接');
    throw error;
  }
  const env = { PATH: paths.trusted };

  assert.equal(resolveBareCli('unity', { project: paths.project, env, platform }), null);
  rmSync(paths.root, { recursive: true, force: true });
});

test('相对 PATH 项被忽略', () => {
  const paths = fixture();
  fakeCli(paths.project);
  const env = { PATH: ['relative-bin', '.'].join(delimiter) };

  assert.equal(resolveBareCli('unity', { project: paths.project, env, platform }), null);
  rmSync(paths.root, { recursive: true, force: true });
});

test('项目内名称以 .. 开头的目录仍视为项目内', () => {
  const paths = fixture();
  const dotted = join(paths.project, '..tools');
  mkdirSync(dotted);
  fakeCli(dotted);
  const env = { PATH: dotted };

  assert.equal(resolveBareCli('unity', { project: paths.project, env, platform }), null);
  rmSync(paths.root, { recursive: true, force: true });
});

// Windows 命名规则只依赖 platform 参数，在任何系统上都能验证。
test('Windows 只认 .com/.exe：跳过排在前面的 .cmd 包装脚本，带 .exe 的名称按原名查找', () => {
  const paths = fixture();
  const shims = join(paths.root, 'shims');
  mkdirSync(shims);
  for (const file of [join(shims, 'unity.cmd'), join(shims, 'unity.bat'), join(paths.trusted, 'unity.exe')]) {
    writeFileSync(file, 'placeholder\n');
    chmodSync(file, 0o755);
  }
  const env = { PATH: [shims, paths.trusted].join(delimiter), PATHEXT: '.COM;.EXE;.BAT;.CMD' };
  const expected = join(paths.trusted, 'unity.exe');

  assert.equal(resolveBareCli('unity', { project: paths.project, env, platform: 'win32' }), expected);
  assert.equal(resolveBareCli('unity.exe', { project: paths.project, env, platform: 'win32' }), expected);
  assert.equal(resolveBareCli('UNITY.EXE', { project: paths.project, env: { PATH: shims }, platform: 'win32' }), null);
  rmSync(paths.root, { recursive: true, force: true });
});

test('脚本在唯一候选位于项目内时不执行 CLI，报告 ENOENT', () => {
  const paths = fixture();
  fakeCli(paths.project);
  const report = runScript(['--project', paths.project], paths.project);

  assert.equal(report.cli.ok, false);
  assert.equal(report.cli.error, 'ENOENT');
  rmSync(paths.root, { recursive: true, force: true });
});

// Windows 的实际攻击方式：同名文件放在项目根目录（spawn 的工作目录），根本不在 PATH 中。
// 修复前以裸名 spawn，libuv 会先在工作目录中找到并执行它。
test('工作目录（项目根）中的同名文件不在 PATH 中时不被执行', () => {
  const paths = fixture();
  fakeCli(paths.project);
  const report = runScript(['--project', paths.project], paths.trusted);

  assert.equal(report.cli.ok, false);
  assert.equal(report.cli.error, 'ENOENT');
  rmSync(paths.root, { recursive: true, force: true });
});

test('显式路径必须是绝对路径且不在项目内', () => {
  const paths = fixture();
  const inProject = fakeCli(paths.project);
  const trustedUnity = fakeCli(paths.trusted);
  const relativePath = join('.', 'unity');

  assert.equal(rejectExplicitCli(relativePath, { project: paths.project, platform }), 'ERELATIVE');
  assert.equal(rejectExplicitCli(inProject, { project: paths.project, platform }), 'EINPROJECT');
  assert.equal(rejectExplicitCli(trustedUnity, { project: paths.project, platform }), null);

  const report = runScript(['--project', paths.project, '--cli', inProject], paths.trusted);
  assert.equal(report.cli.ok, false);
  assert.equal(report.cli.error, 'EINPROJECT');
  rmSync(paths.root, { recursive: true, force: true });
});
