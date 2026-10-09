#!/usr/bin/env node
// Canonical official-skill discovery + installation integrity for zcode-remotion.
// Pure logic over paths — expected skill names come exclusively from
// compatibility/remotion.json → skills.names.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROUTER_SKILL = 'remotion-best-practices';

export const userSkillDirs = (home = homedir()) =>
  [join(home, '.zcode', 'skills'), join(home, '.agents', 'skills')];

export const projectSkillDir = (projectRoot) => join(projectRoot, '.zcode', 'skills');

export const loadExpectedSkillNames = () =>
  JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'compatibility', 'remotion.json'), 'utf8')).skills.names;

const listInstalled = (dir) => {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((name) => name.startsWith('remotion-') && existsSync(join(dir, name, 'SKILL.md')));
  } catch {
    return [];
  }
};

function inspectCandidate(dir, expected) {
  const installed = new Set(listInstalled(dir));
  const presentExpected = expected.filter((n) => installed.has(n));
  const missing = expected.filter((n) => !installed.has(n));
  return {
    dir,
    expected: expected.length,
    found: presentExpected.length,
    missing,
    extra: [...installed].filter((n) => !expected.includes(n)),
    complete: presentExpected.length === expected.length,
    hasInstall: presentExpected.length > 0,
  };
}

// mode:
//   auto    — project → user scope, strict priority; first scope with any
//             expected skill is the detected installation.
//   project — inspect only <projectRoot>/.zcode/skills.
//   global  — inspect ~/.zcode/skills and ~/.agents/skills as two
//             representations of one logical user scope; never union them.
export function inspectSkillInstall({ mode = 'auto', projectRoot = null, home = homedir(), expectedSkillNames } = {}) {
  if (!['auto', 'project', 'global'].includes(mode)) {
    throw new Error(`unknown mode: ${mode}`);
  }
  if (mode === 'project' && !projectRoot) {
    throw new Error('projectRoot is required in project mode');
  }

  const expected = expectedSkillNames ?? loadExpectedSkillNames();
  let candidates;

  if (mode === 'project') {
    candidates = [{ scope: 'project', dir: projectSkillDir(projectRoot) }];
  } else if (mode === 'global') {
    candidates = userSkillDirs(home).map((dir) => ({ scope: 'user', dir }));
  } else {
    candidates = [
      { scope: 'project', dir: projectSkillDir(projectRoot) },
      ...userSkillDirs(home).map((dir) => ({ scope: 'user', dir })),
    ];
  }

  if (mode === 'global') {
    const inspected = candidates.map((c) => ({ ...c, ...inspectCandidate(c.dir, expected) }));
    const withInstall = inspected.filter((r) => r.hasInstall);
    if (withInstall.length === 0) return absent('global', expected);
    const complete = withInstall.find((r) => r.complete);
    const best = complete ?? withInstall.reduce((a, b) => (b.found > a.found ? b : a));
    return { mode, scope: 'user', ...pick(best) };
  }

  for (const c of candidates) {
    const r = inspectCandidate(c.dir, expected);
    if (r.hasInstall) return { mode, scope: c.scope, ...pick(r) };
  }
  return absent(mode, expected);

  function pick(r) {
    return { dir: r.dir, expected: r.expected, found: r.found, missing: r.missing, extra: r.extra, complete: r.complete };
  }
  function absent(m, exp) {
    return { mode: m, scope: 'none', dir: null, expected: exp.length, found: 0, missing: [], extra: [], complete: false };
  }
}

// CLI: node skill-paths.mjs [--global | --project <dir>] [--home <dir>]
// Exit codes: 0 complete · 1 incomplete · 2 absent · 64 usage error.
if (process.argv[1] && process.argv[1].endsWith('skill-paths.mjs')) {
  const args = process.argv.slice(2);
  const KNOWN = new Set(['--global', '--project', '--home']);
  const badFlag = args.find((a) => a.startsWith('--') && !KNOWN.has(a));
  const projectIdx = args.indexOf('--project');
  const wantsGlobal = args.includes('--global');
  const projectArg = projectIdx !== -1 ? args[projectIdx + 1] : undefined;

  if (badFlag) {
    console.error(`skill-paths: unknown option ${badFlag}\nusage: node skill-paths.mjs [--global | --project <dir>] [--home <dir>]`);
    process.exit(64);
  }
  if (wantsGlobal && projectIdx !== -1) {
    console.error('skill-paths: --global and --project are mutually exclusive\nusage: node skill-paths.mjs [--global | --project <dir>] [--home <dir>]');
    process.exit(64);
  }
  if (projectIdx !== -1 && (projectArg === undefined || projectArg.startsWith('--'))) {
    console.error('skill-paths: --project requires a directory argument');
    process.exit(64);
  }
  const homeIdx = args.indexOf('--home');
  if (homeIdx !== -1 && (args[homeIdx + 1] === undefined || args[homeIdx + 1].startsWith('--'))) {
    console.error('skill-paths: --home requires a directory argument');
    process.exit(64);
  }

  const mode = wantsGlobal ? 'global' : projectIdx !== -1 ? 'project' : 'auto';
  const result = inspectSkillInstall({
    mode,
    projectRoot: mode === 'global' ? null : projectArg ?? process.cwd(),
    home: homeIdx !== -1 ? args[homeIdx + 1] : homedir(),
  });

  console.log(`mode: ${result.mode}`);
  console.log(`scope: ${result.scope}`);
  if (result.scope === 'none') {
    console.log('Official Remotion skills: not installed');
    console.log(`Repair: remotion-setup${mode === 'project' ? ' --project' : ''}`);
  } else {
    console.log(`dir: ${result.dir}`);
    console.log(`Official Remotion skills: ${result.found}/${result.expected} present`);
    console.log(`status: ${result.complete ? 'COMPLETE' : 'INCOMPLETE'}`);
    if (result.missing.length) console.log(`Missing:\n${result.missing.map((n) => `- ${n}`).join('\n')}`);
    if (result.extra.length) console.log(`Extra (upstream topology may have changed):\n${result.extra.map((n) => `- ${n}`).join('\n')}`);
    console.log(result.complete
      ? 'Repair: none needed (use remotion-update to keep them current)'
      : `Repair: remotion-setup${result.scope === 'project' ? ' --project' : ''} (repairs the detected scope — never a different one)`);
  }
  process.exit(result.scope === 'none' ? 2 : result.complete ? 0 : 1);
}
