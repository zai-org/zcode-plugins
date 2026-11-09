#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir, platform, release, arch } from 'node:os';
import { resolve, join } from 'node:path';

const args = process.argv.slice(2);
let project = process.cwd();
let cli = 'unity';
for (let i = 0; i < args.length; i++) {
  if (!['--project', '--cli'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) {
    console.error('Usage: node check-environment.mjs [--project PATH] [--cli EXECUTABLE]');
    process.exit(2);
  }
  const key = args[i++];
  if (key === '--project') project = resolve(args[i]);
  else cli = args[i];
}

function probe(commandArgs) {
  const result = spawnSync(cli, commandArgs, {
    cwd: existsSync(project) ? project : process.cwd(),
    encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024,
    shell: false, windowsHide: true,
    env: { ...process.env, UNITY_NO_PAGER: '1', UNITY_NON_INTERACTIVE: '1' },
  });
  return {
    ok: !result.error && result.status === 0,
    exitCode: result.status,
    error: result.error?.code ?? null,
    stdout: result.stdout?.trim() ?? '',
    stderr: result.stderr?.trim() ?? '',
  };
}

const os = platform();
const home = homedir();
const roots = os === 'darwin'
  ? ['/Applications/Unity/Hub/Editor', join(home, 'Applications/Unity/Hub/Editor')]
  : os === 'win32'
    ? [join(process.env.ProgramFiles || 'C:\\Program Files', 'Unity', 'Hub', 'Editor'), join(home, 'Unity', 'Hub', 'Editor')]
    : [join(home, 'Unity', 'Hub', 'Editor')];
const editorHints = [];
for (const root of roots) {
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const executable = join(root, entry.name, ...(os === 'darwin'
        ? ['Unity.app', 'Contents', 'MacOS', 'Unity']
        : ['Editor', os === 'win32' ? 'Unity.exe' : 'Unity']));
      if (existsSync(executable)) editorHints.push({ version: entry.name, executable });
    }
  } catch (error) {
    if (error.code !== 'ENOENT') editorHints.push({ root, error: error.code });
  }
}

let editorVersion = null;
let projectError = null;
try {
  editorVersion = readFileSync(join(project, 'ProjectSettings', 'ProjectVersion.txt'), 'utf8')
    .match(/^m_EditorVersion:\s*(\S+)/m)?.[1] ?? null;
} catch (error) { projectError = error.code; }
const validProject = Boolean(editorVersion && existsSync(join(project, 'Assets')));
const pipelineCompatible = editorVersion ? Number.parseInt(editorVersion, 10) >= 6000 : null;
const version = probe(['--version']);
const checks = {};
if (version.ok) {
  checks.command = probe(['command', '--help']);
  checks.editors = probe(['editors', '-i', '--format', 'json']);
  if (validProject) {
    checks.pipeline = probe(['pipeline', 'list']);
    checks.status = probe(['status']);
  }
}

console.log(JSON.stringify({
  system: { platform: os, release: release(), arch: arch() },
  cli: { executable: cli, ...version },
  project: { path: project, valid: validProject, editorVersion, pipelineCompatible, readError: projectError },
  standardLocationEditors: editorHints,
  checks,
  nextSteps: [
    ...(!version.ok ? ['Locate or install official Unity CLI; CLI failure does not prove the Editor is missing.'] : []),
    ...(!validProject ? ['Select a Unity project root, or create a project before configuring Pipeline.'] : []),
    ...(pipelineCompatible === false ? ['This project is older than Unity 6. Do not silently upgrade it for Pipeline.'] : []),
    'Inspect installed Editors and Pipeline output, then verify the intended project with a read-only CLI Editor query.',
  ],
  connectionVerified: false,
}, null, 2));
process.exitCode = !version.ok || !validProject || pipelineCompatible !== true || !checks.command?.ok ? 1 : 0;
