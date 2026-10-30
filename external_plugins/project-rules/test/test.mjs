#!/usr/bin/env node
// Self-test for hooks/rules.js. No marketplace, no ZCode, no dependencies:
// spawns the hook with sample stdin payloads and asserts on stdout.
// Run: node test/test.mjs
import assert from 'assert';
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import { createRequire } from 'module';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(here, '..');
const hookScript = path.join(pluginRoot, 'hooks', 'rules.js');
const require = createRequire(import.meta.url);
const rules = require(hookScript);

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'project-rules-test-'));
let failures = 0;
let passes = 0;

async function test(name, fn) {
  try {
    await fn();
    passes += 1;
    console.log('ok - ' + name);
  } catch (err) {
    failures += 1;
    console.log('not ok - ' + name);
    console.log(String(err && err.stack ? err.stack : err).replace(/^/gm, '    '));
  }
}

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

let projectCounter = 0;
function makeProject(files) {
  projectCounter += 1;
  const dir = path.join(tmpRoot, 'project-' + projectCounter);
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeDataDir() {
  return fs.mkdtempSync(path.join(tmpRoot, 'data-'));
}

let sessionCounter = 0;
function newSession() {
  sessionCounter += 1;
  return 'session-' + sessionCounter;
}

function sessionStart(sessionId, project, source) {
  return {
    hookEventName: 'SessionStart',
    hook_event_name: 'SessionStart',
    sessionId,
    session_id: sessionId,
    cwd: project,
    source: source || 'startup',
  };
}

function preToolUse(sessionId, project, toolName, filePath) {
  const toolInput = filePath === undefined ? {} : { file_path: filePath };
  return {
    hookEventName: 'PreToolUse',
    hook_event_name: 'PreToolUse',
    sessionId,
    session_id: sessionId,
    cwd: project,
    toolName,
    tool_name: toolName,
    toolInput,
    tool_input: toolInput,
    toolCallId: 'call-' + Math.random().toString(16).slice(2),
  };
}

function hookEnv(project, dataDir) {
  const env = Object.assign({}, process.env);
  delete env.PROJECT_RULES_DEBUG;
  env.ZCODE_PLUGIN_ROOT = pluginRoot;
  env.ZCODE_PLUGIN_DATA = dataDir;
  env.ZCODE_PROJECT_DIR = project;
  return env;
}

function parseResult(status, stdout, stderr) {
  const result = { status, stdout, stderr, json: null, context: null };
  if (stdout.trim()) {
    result.json = JSON.parse(stdout);
    result.context = result.json.hookSpecificOutput.additionalContext;
  }
  return result;
}

function callHook(payload, project, dataDir, options) {
  const opts = options || {};
  const input = opts.raw !== undefined ? opts.raw : JSON.stringify(payload) + '\n';
  const child = spawnSync(process.execPath, [hookScript], {
    input,
    env: opts.env || hookEnv(project, dataDir),
    encoding: 'utf8',
    timeout: 15000,
  });
  return parseResult(child.status, child.stdout, child.stderr);
}

/** Spawns hooks that wait on stdin; release() feeds them all at once to force overlap. */
function spawnHeldHooks(count, payload, project, dataDir) {
  const children = [];
  const done = [];
  for (let i = 0; i < count; i += 1) {
    const child = spawn(process.execPath, [hookScript], { env: hookEnv(project, dataDir) });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    done.push(
      new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('close', (code) => resolve(parseResult(code, stdout, stderr)));
      })
    );
    children.push(child);
  }
  return {
    release() {
      const line = JSON.stringify(payload) + '\n';
      for (const child of children) child.stdin.end(line);
      return Promise.all(done);
    },
  };
}

function assertSilent(result) {
  assert.strictEqual(result.status, 0, 'exit code; stderr: ' + result.stderr);
  assert.strictEqual(result.stdout, '', 'expected no stdout, got: ' + result.stdout.slice(0, 300));
}

function assertContext(result, eventName) {
  assert.strictEqual(result.status, 0, 'exit code; stderr: ' + result.stderr);
  assert.ok(result.json, 'expected JSON on stdout');
  assert.strictEqual(result.json.hookSpecificOutput.hookEventName, eventName);
  assert.strictEqual(typeof result.context, 'string');
  return result.context;
}

const BASE_FILES = {
  'CLAUDE.md': '# Team notes\nCLAUDE-MARKER: use tabs for indentation.\n',
  '.zcode/rules/general.md': 'GENERAL-MARKER: always run the tests before finishing.\n',
  '.zcode/rules/typescript.md': '---\npaths: src/**/*.ts\n---\nTS-MARKER: prefer type aliases over interfaces.\n',
  '.zcode/rules/proto.md': '---\npaths: *.proto\n---\nPROTO-MARKER: never renumber protobuf fields.\n',
  '.zcode/rules/notes.txt': 'TXT-MARKER: not a rule file.\n',
  'src/app/main.ts': 'export {};\n',
};

// ---------------------------------------------------------------------------
// Unit tests: glob matcher, frontmatter, paths
// ---------------------------------------------------------------------------

function globMatches(glob, file) {
  return rules.matchesAny(file, rules.compileGlobs([glob]));
}

await test('glob: ** spans zero or more directories', () => {
  assert.ok(globMatches('src/**/*.ts', 'src/a.ts'));
  assert.ok(globMatches('src/**/*.ts', 'src/x/y/a.ts'));
  assert.ok(!globMatches('src/**/*.ts', 'lib/a.ts'));
  assert.ok(!globMatches('src/**/*.ts', 'src/a.tsx'));
  assert.ok(!globMatches('src/**/*.ts', 'src/a.ts.bak'));
  assert.ok(globMatches('**/test/**', 'test/a.js'));
  assert.ok(globMatches('**/test/**', 'x/test/y/z.js'));
  assert.ok(globMatches('**', 'any/file/at/all.txt'));
});

await test('glob: * and ? stay inside one path segment', () => {
  assert.ok(globMatches('src/*.ts', 'src/a.ts'));
  assert.ok(!globMatches('src/*.ts', 'src/a/b.ts'));
  assert.ok(globMatches('src/?.js', 'src/a.js'));
  assert.ok(!globMatches('src/?.js', 'src/ab.js'));
  assert.ok(!globMatches('a?b', 'a/b'));
});

await test('glob: slash-less patterns match the file name at any depth', () => {
  assert.ok(globMatches('*.proto', 'api.proto'));
  assert.ok(globMatches('*.proto', 'a/b/api.proto'));
  assert.ok(!globMatches('*.proto', 'api.proto.txt'));
  assert.ok(globMatches('Makefile', 'tools/Makefile'));
});

await test('glob: leading / or ./ anchors, trailing / means the whole directory', () => {
  assert.ok(globMatches('/README.md', 'README.md'));
  assert.ok(!globMatches('/README.md', 'docs/README.md'));
  assert.ok(globMatches('./README.md', 'README.md'));
  assert.ok(globMatches('docs/', 'docs/guide/intro.md'));
  assert.ok(!globMatches('docs/', 'src/docs.ts'));
});

await test('glob: {a,b} alternatives, including empty and nested ones', () => {
  assert.ok(globMatches('src/**/*.{ts,tsx}', 'src/a.tsx'));
  assert.ok(globMatches('src/**/*.{ts,tsx}', 'src/b/c.ts'));
  assert.ok(!globMatches('src/**/*.{ts,tsx}', 'src/b/c.js'));
  assert.ok(globMatches('*.ts{,x}', 'a.ts'));
  assert.ok(globMatches('*.ts{,x}', 'a.tsx'));
  assert.ok(globMatches('{src,lib/{a,b}}/*.js', 'lib/b/x.js'));
  assert.ok(rules.expandBraces('{a,b}{c,d}{e,f}{g,h}{i,j}{k,l}{m,n}').length <= 64);
});

await test('glob: regex metacharacters are literal', () => {
  assert.ok(globMatches('a.b+c(1)', 'a.b+c(1)'));
  assert.ok(!globMatches('a.b+c(1)', 'aXb+c(1)'));
  assert.ok(!globMatches('a.b+c(1)', 'a.bbc(1)'));
});

await test('glob: hostile patterns match in linear time; a rule keeps 32 globs of up to 256 chars', () => {
  const started = Date.now();
  // As backtracking RegExps these stalled for a minute or more.
  assert.ok(!globMatches('**/'.repeat(12) + 'x', 'a/'.repeat(25) + 'y'));
  assert.ok(globMatches('**/'.repeat(12) + 'y', 'a/'.repeat(25) + 'y'));
  assert.ok(!globMatches('*a'.repeat(12) + 'b', 'a'.repeat(60)));
  assert.ok(Date.now() - started < 200, 'took ' + (Date.now() - started) + ' ms');
  assert.strictEqual(rules.compileGlobs(new Array(40).fill('*.md')).length, 32);
  assert.strictEqual(rules.compileGlobs(['a'.repeat(257), 'b'.repeat(256)]).length, 1);
});

await test('braces: one pass keeps order, empty and nested options, unbalanced literals, the 64 cap', () => {
  assert.deepStrictEqual(rules.expandBraces('{a,b}{c,d}'), ['ac', 'ad', 'bc', 'bd']);
  assert.deepStrictEqual(rules.expandBraces('x{,y,{z,w}}'), ['x', 'xy', 'xz', 'xw']);
  assert.deepStrictEqual(rules.expandBraces('{a{b,c}'), ['{a{b,c}']);
  assert.deepStrictEqual(rules.expandBraces('a}b{c}'), ['a}bc']);
  assert.strictEqual(rules.expandBraces('{a,b}'.repeat(7)).length, 64);
});

await test('frontmatter: comma list, braces, quotes, inline and block lists, globs alias', () => {
  assert.deepStrictEqual(rules.parseRule('---\npaths: src/**/*.ts, *.proto\n---\nbody').paths, [
    'src/**/*.ts',
    '*.proto',
  ]);
  assert.deepStrictEqual(rules.parseRule('---\npaths: src/**/*.{ts,tsx}, lib/*.js\n---\nx').paths, [
    'src/**/*.{ts,tsx}',
    'lib/*.js',
  ]);
  assert.deepStrictEqual(rules.parseRule('---\npaths: ["a/**", \'b/*.md\']\n---\nx').paths, ['a/**', 'b/*.md']);
  assert.deepStrictEqual(
    rules.parseRule('---\ndescription: API rules\npaths:\n  - "src/api/**/*.ts"\n  - docs/api/\n---\nx').paths,
    ['src/api/**/*.ts', 'docs/api/']
  );
  assert.deepStrictEqual(rules.parseRule('---\nglobs: *.sql\nalwaysApply: false\n---\nx').paths, ['*.sql']);
  assert.deepStrictEqual(
    rules.parseRule('---\npaths: src/**/*.ts  # TypeScript only\nother:\n  - x\n---\nx').paths,
    ['src/**/*.ts']
  );
  assert.deepStrictEqual(rules.parseRule('---\npaths:\n  - lib/** # libraries\n  - "a#b"\n---\nx').paths, ['lib/**', 'a#b']);
});

await test('frontmatter: optional, BOM and CRLF tolerant, body excludes frontmatter', () => {
  const plain = rules.parseRule('Just a rule.\n');
  assert.deepStrictEqual(plain, { paths: [], body: 'Just a rule.' });
  const crlf = rules.parseRule('\ufeff---\r\npaths: *.go\r\n---\r\nGo rule.\r\n');
  assert.deepStrictEqual(crlf, { paths: ['*.go'], body: 'Go rule.' });
  assert.deepStrictEqual(rules.parseRule('---\npaths:\n---\nGlobal.').paths, []);
  assert.deepStrictEqual(rules.parseRule('---\n---\nEmpty frontmatter.'), { paths: [], body: 'Empty frontmatter.' });
  const midLine = rules.parseRule('---\npaths: a---b\nmore: x\n---\nBody.');
  assert.deepStrictEqual(midLine, { paths: ['a---b'], body: 'Body.' });
});

await test('frontmatter: an inline list with a trailing comment', () => {
  assert.deepStrictEqual(rules.parseRule('---\npaths: ["src/**"]  # api\n---\nx').paths, ['src/**']);
  assert.deepStrictEqual(rules.parseRule('---\npaths: [a/*.ts, "b]c"] # see [docs]\n---\nx').paths, ['a/*.ts', 'b]c']);
});

await test('paths: absolute and relative inside the project, null outside', () => {
  const project = makeProject({ 'src/a.ts': '' });
  assert.strictEqual(rules.toProjectRelative(path.join(project, 'src', 'a.ts'), project), 'src/a.ts');
  assert.strictEqual(rules.toProjectRelative('src/a.ts', project), 'src/a.ts');
  assert.strictEqual(rules.toProjectRelative(path.join(project, 'new', 'file.ts'), project), 'new/file.ts');
  assert.strictEqual(rules.toProjectRelative('../elsewhere/a.ts', project), null);
  assert.strictEqual(rules.toProjectRelative(path.join(tmpRoot, 'x.ts'), project), null);
  assert.strictEqual(rules.toProjectRelative(project, project), null);
  assert.strictEqual(rules.toProjectRelative(undefined, project), null);
  // macOS: /var is a symlink to /private/var; either spelling must resolve.
  const real = fs.realpathSync(project);
  assert.strictEqual(rules.toProjectRelative(path.join(real, 'src', 'a.ts'), project), 'src/a.ts');
});

// ---------------------------------------------------------------------------
// Hook process tests
// ---------------------------------------------------------------------------

const project = makeProject(BASE_FILES);
const dataDir = makeDataDir();
const mainTs = path.join(project, 'src', 'app', 'main.ts');

await test('SessionStart injects CLAUDE.md and path-less rules only', () => {
  const sid = newSession();
  const context = assertContext(callHook(sessionStart(sid, project), project, dataDir), 'SessionStart');
  assert.ok(context.includes('CLAUDE-MARKER'));
  assert.ok(context.includes('## CLAUDE.md'));
  assert.ok(context.includes('GENERAL-MARKER'));
  assert.ok(!context.includes('TS-MARKER'));
  assert.ok(!context.includes('PROTO-MARKER'));
  assert.ok(!context.includes('TXT-MARKER'));
  assert.ok(context.startsWith('<project-rules>') && context.endsWith('</project-rules>'));
});

await test('SessionStart skips CLAUDE.md when AGENTS.md exists at the root', () => {
  const withAgents = makeProject(Object.assign({}, BASE_FILES, { 'AGENTS.md': 'agents file\n' }));
  const context = assertContext(
    callHook(sessionStart(newSession(), withAgents), withAgents, makeDataDir()),
    'SessionStart'
  );
  assert.ok(!context.includes('CLAUDE-MARKER'));
  assert.ok(context.includes('GENERAL-MARKER'));
});

await test('rule files and CLAUDE.md that resolve outside the project are skipped', () => {
  if (process.platform === 'win32') return; // creating symlinks needs extra privileges there
  const secret = path.join(makeProject({ 'secret.md': 'SECRET-MARKER: outside the project.\n' }), 'secret.md');
  const linked = makeProject({ 'docs/shared.md': 'SHARED-MARKER: inside the project.\n', '.zcode/rules/.keep': '' });
  fs.symlinkSync(secret, path.join(linked, '.zcode', 'rules', 'x.md'));
  fs.symlinkSync(secret, path.join(linked, 'CLAUDE.md'));
  fs.symlinkSync(path.join('..', '..', 'docs', 'shared.md'), path.join(linked, '.zcode', 'rules', 'shared.md'));
  const data = makeDataDir();
  const sid = newSession();
  const context = assertContext(callHook(sessionStart(sid, linked), linked, data), 'SessionStart');
  assert.ok(context.includes('SHARED-MARKER'), 'a symlink that stays inside the project still works');
  assert.ok(!context.includes('SECRET-MARKER'));
  assertSilent(callHook(preToolUse(sid, linked, 'Read', path.join(linked, 'docs', 'shared.md')), linked, data));
});

await test('SessionStart with nothing to inject prints nothing', () => {
  const empty = makeProject({ 'README.md': 'hi\n' });
  assertSilent(callHook(sessionStart(newSession(), empty), empty, makeDataDir()));
});

await test('PreToolUse Read on a matching path injects that rule once, then dedupes', () => {
  const sid = newSession();
  callHook(sessionStart(sid, project), project, dataDir);

  const first = callHook(preToolUse(sid, project, 'Read', mainTs), project, dataDir);
  const context = assertContext(first, 'PreToolUse');
  assert.ok(context.includes('TS-MARKER'));
  assert.ok(context.includes('Applies to: src/**/*.ts (matched src/app/main.ts)'));
  assert.ok(!context.includes('GENERAL-MARKER'), 'global rule was already delivered at SessionStart');
  assert.ok(!context.includes('PROTO-MARKER'));
  assert.ok(!context.includes('CLAUDE-MARKER'), 'CLAUDE.md is SessionStart-only');

  // Same file again, and a different matching file: already delivered.
  assertSilent(callHook(preToolUse(sid, project, 'Read', mainTs), project, dataDir));
  assertSilent(callHook(preToolUse(sid, project, 'Edit', path.join(project, 'src', 'other.ts')), project, dataDir));
});

await test('PreToolUse on a non-matching path prints nothing', () => {
  const sid = newSession();
  callHook(sessionStart(sid, project), project, dataDir);
  assertSilent(callHook(preToolUse(sid, project, 'Read', path.join(project, 'README.md')), project, dataDir));
  assertSilent(callHook(preToolUse(sid, project, 'Read', path.join(project, 'src', 'main.js')), project, dataDir));
});

await test('PreToolUse outside the project matches no path rules', () => {
  const sid = newSession();
  callHook(sessionStart(sid, project), project, dataDir);
  const outside = makeProject({ 'src/x.ts': '' });
  assertSilent(callHook(preToolUse(sid, project, 'Read', path.join(outside, 'src', 'x.ts')), project, dataDir));
});

await test('content change re-injects the rule once', () => {
  const changing = makeProject(BASE_FILES);
  const data = makeDataDir();
  const sid = newSession();
  const file = path.join(changing, 'src', 'app', 'main.ts');
  callHook(sessionStart(sid, changing), changing, data);
  assert.ok(assertContext(callHook(preToolUse(sid, changing, 'Read', file), changing, data), 'PreToolUse').includes('TS-MARKER'));
  assertSilent(callHook(preToolUse(sid, changing, 'Read', file), changing, data));

  fs.writeFileSync(
    path.join(changing, '.zcode', 'rules', 'typescript.md'),
    '---\npaths: src/**/*.ts\n---\nTS-MARKER-V2: use strict null checks.\n'
  );
  const updated = assertContext(callHook(preToolUse(sid, changing, 'Edit', file), changing, data), 'PreToolUse');
  assert.ok(updated.includes('TS-MARKER-V2'));
  assertSilent(callHook(preToolUse(sid, changing, 'Write', file), changing, data));

  // A changed path-less rule is re-delivered with the next Read/Edit/Write call.
  fs.writeFileSync(path.join(changing, '.zcode', 'rules', 'general.md'), 'GENERAL-MARKER-V2: changed.\n');
  const general = assertContext(
    callHook(preToolUse(sid, changing, 'Read', path.join(changing, 'README.md')), changing, data),
    'PreToolUse'
  );
  assert.ok(general.includes('GENERAL-MARKER-V2'));
});

await test('Edit with a relative path matches a slash-less glob at depth', () => {
  const sid = newSession();
  callHook(sessionStart(sid, project), project, dataDir);
  const context = assertContext(callHook(preToolUse(sid, project, 'Edit', 'api/v1/user.proto'), project, dataDir), 'PreToolUse');
  assert.ok(context.includes('PROTO-MARKER'));
  assert.ok(context.includes('(matched api/v1/user.proto)'));
});

await test('globs are compiled only when a pending path rule is matched', () => {
  const lazy = makeProject({ '.zcode/rules/lazy.md': '---\npaths: ' + 'z'.repeat(300) + ', *.ts\n---\nLAZY-MARKER\n' });
  const data = makeDataDir();
  const env = Object.assign(hookEnv(lazy, data), { PROJECT_RULES_DEBUG: '1' });
  const call = (payload) => callHook(payload, lazy, data, { env });
  const compiled = /ignoring a glob over 256 chars/;
  const sid = newSession();
  assert.doesNotMatch(call(sessionStart(sid, lazy)).stderr, compiled);
  const first = call(preToolUse(sid, lazy, 'Read', 'a.ts'));
  assert.ok(assertContext(first, 'PreToolUse').includes('LAZY-MARKER'), 'the short glob still applies');
  assert.match(first.stderr, compiled);
  const delivered = call(preToolUse(sid, lazy, 'Read', 'b.ts'));
  assertSilent(delivered);
  assert.doesNotMatch(delivered.stderr, compiled, 'a delivered rule is not compiled again');
});

await test('PreToolUse without a prior SessionStart also delivers path-less rules', () => {
  const sid = newSession();
  const context = assertContext(callHook(preToolUse(sid, project, 'Write', mainTs), project, dataDir), 'PreToolUse');
  assert.ok(context.includes('TS-MARKER'));
  assert.ok(context.includes('GENERAL-MARKER'));
  assert.ok(context.indexOf('TS-MARKER') < context.indexOf('GENERAL-MARKER'), 'matching rules come first');
});

await test('tools other than Read/Edit/Write are ignored', () => {
  const sid = newSession();
  assertSilent(callHook(preToolUse(sid, project, 'Bash', mainTs), project, dataDir));
  assertSilent(callHook(preToolUse(sid, project, 'Grep', mainTs), project, dataDir));
});

await test('SessionStart (resume/clear/compact) re-arms rules for the session', () => {
  const sid = newSession();
  callHook(sessionStart(sid, project), project, dataDir);
  assertContext(callHook(preToolUse(sid, project, 'Read', mainTs), project, dataDir), 'PreToolUse');
  assertSilent(callHook(preToolUse(sid, project, 'Read', mainTs), project, dataDir));

  const again = assertContext(callHook(sessionStart(sid, project, 'compact'), project, dataDir), 'SessionStart');
  assert.ok(again.includes('CLAUDE-MARKER'));
  assert.ok(assertContext(callHook(preToolUse(sid, project, 'Read', mainTs), project, dataDir), 'PreToolUse').includes('TS-MARKER'));
});

await test('Claude-style snake_case-only payloads work', () => {
  const sid = newSession();
  const payload = {
    session_id: sid,
    hook_event_name: 'PreToolUse',
    cwd: project,
    tool_name: 'Read',
    tool_input: { file_path: mainTs },
  };
  const env = hookEnv(project, dataDir);
  delete env.ZCODE_PROJECT_DIR;
  const context = assertContext(callHook(payload, project, dataDir, { env }), 'PreToolUse');
  assert.ok(context.includes('TS-MARKER'));
});

await test('a long rule is cut at 4000 chars with a truncation note', () => {
  const body = 'LONG-START ' + 'x'.repeat(9000) + ' LONG-END';
  const big = makeProject({ '.zcode/rules/big.md': '---\npaths: *.md\n---\n' + body });
  const context = assertContext(
    callHook(preToolUse(newSession(), big, 'Read', path.join(big, 'README.md')), big, makeDataDir()),
    'PreToolUse'
  );
  assert.ok(context.includes('LONG-START'));
  assert.ok(!context.includes('LONG-END'));
  assert.ok(context.includes('[project-rules: truncated, showing the first 4000 of ' + body.length + ' characters. Read .zcode/rules/big.md for the rest.]'));
  assert.ok(context.length < rules.limits.RULE_MAX_CHARS + 600);
});

await test('total budget defers extra rules to later calls; each lands exactly once', () => {
  const files = {};
  // Sized so three blocks pass the packing check but overflow 12000 once the
  // wrapper and the deferral note are added: the final-text cap must bind.
  for (let i = 1; i <= 5; i += 1) files['.zcode/rules/r' + i + '.md'] = 'RULE-' + i + '-MARKER ' + 'y'.repeat(3880) + '\n';
  const many = makeProject(files);
  const data = makeDataDir();
  const sid = newSession();
  const seen = {};
  const record = (context) => {
    assert.ok(context.length <= rules.limits.TOTAL_MAX_CHARS, 'context too long: ' + context.length);
    for (let i = 1; i <= 5; i += 1) if (context.includes('RULE-' + i + '-MARKER')) seen[i] = (seen[i] || 0) + 1;
  };

  const start = assertContext(callHook(sessionStart(sid, many), many, data), 'SessionStart');
  record(start);
  assert.ok(start.includes('more rule(s) deferred to keep context small'));
  assert.ok(Object.keys(seen).length < 5);

  for (let call = 0; call < 3; call += 1) {
    const result = callHook(preToolUse(sid, many, 'Read', path.join(many, 'any.txt')), many, data);
    if (result.context) record(result.context);
  }
  assert.deepStrictEqual(seen, { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 });
});

await test('multi-byte text that fits the char budget is still held under the 32 KiB stdout limit', () => {
  // About 11000 chars (inside the 12000 char budget) but about 33000 UTF-8 bytes.
  const cjk = makeProject({
    'CLAUDE.md': 'CJK-CLAUDE ' + '\u89c4'.repeat(7900) + '\n',
    '.zcode/rules/cjk.md': 'CJK-RULE ' + '\u5219'.repeat(3000) + '\n',
  });
  const data = makeDataDir();
  const sid = newSession();
  const result = callHook(sessionStart(sid, cjk), cjk, data);
  assertContext(result, 'SessionStart');
  assert.ok(result.context.length <= rules.limits.TOTAL_MAX_CHARS);
  assert.ok(Buffer.byteLength(result.stdout) <= rules.limits.MAX_STDOUT_BYTES, 'bytes: ' + Buffer.byteLength(result.stdout));
  assert.ok(result.context.includes('CJK-CLAUDE'));
  assert.ok(!result.context.includes('CJK-RULE'));
  assert.ok(result.context.includes('1 more rule(s) deferred'), 'the rule is deferred, not dropped');
  const later = assertContext(callHook(preToolUse(sid, cjk, 'Read', path.join(cjk, 'x.txt')), cjk, data), 'PreToolUse');
  assert.ok(later.includes('CJK-RULE'));
});

await test('a single block that escapes past the byte limit is shrunk, not dropped', () => {
  // Control characters serialize as 6-byte \u escapes: 8000 chars -> 48000 bytes.
  const escaped = makeProject({ 'CLAUDE.md': 'ESC-START ' + '\u0001'.repeat(8000) + '\n' });
  const result = callHook(sessionStart(newSession(), escaped), escaped, makeDataDir());
  assertContext(result, 'SessionStart');
  assert.ok(Buffer.byteLength(result.stdout) <= rules.limits.MAX_STDOUT_BYTES, 'bytes: ' + Buffer.byteLength(result.stdout));
  assert.ok(result.context.includes('ESC-START'));
  assert.ok(result.context.includes('Read CLAUDE.md for the rest.'));
});

await test('rule files share a 2 MiB read budget per call; files that do not fit are skipped', () => {
  const pad = 'p'.repeat(900 * 1024);
  const heavy = makeProject({
    '.zcode/rules/r1.md': 'R1-MARKER ' + pad,
    '.zcode/rules/r2.md': 'R2-MARKER ' + pad,
    '.zcode/rules/r3.md': 'R3-MARKER ' + pad,
    '.zcode/rules/r4.md': 'R4-MARKER small\n',
  });
  const context = assertContext(callHook(sessionStart(newSession(), heavy), heavy, makeDataDir()), 'SessionStart');
  for (const marker of ['R1-MARKER', 'R2-MARKER', 'R4-MARKER']) assert.ok(context.includes(marker), marker);
  assert.ok(!context.includes('R3-MARKER') && !context.includes('r3.md'), 'r3 is not loaded, not even deferred');
});

await test('malformed, empty, and unknown-event stdin exit 0 silently', () => {
  assertSilent(callHook(null, project, dataDir, { raw: '{not json' }));
  assertSilent(callHook(null, project, dataDir, { raw: '' }));
  assertSilent(callHook(null, project, dataDir, { raw: '[1,2,3]\n' }));
  assertSilent(callHook({ hookEventName: 'Stop', sessionId: newSession(), cwd: project }, project, dataDir));
});

await test('stdin over 1 MiB is drained and ignored: exit 0, no output', () => {
  const payload = Object.assign(sessionStart(newSession(), project), { padding: 'x'.repeat(1024 * 1024) });
  const child = spawnSync(process.execPath, [hookScript], {
    input: JSON.stringify(payload),
    env: hookEnv(project, makeDataDir()),
    encoding: 'utf8',
  });
  assert.strictEqual(child.error, undefined, 'the hook read all of stdin, so the writer saw no EPIPE');
  assertSilent(parseResult(child.status, child.stdout, child.stderr));
});

await test('corrupt state.json is replaced, not fatal', () => {
  const data = makeDataDir();
  fs.writeFileSync(path.join(data, 'state.json'), '{"sessions": oops');
  const context = assertContext(callHook(sessionStart(newSession(), project), project, data), 'SessionStart');
  assert.ok(context.includes('CLAUDE-MARKER'));
  const state = JSON.parse(fs.readFileSync(path.join(data, 'state.json'), 'utf8'));
  assert.strictEqual(state.version, 1);

  // A session entry without a rules map is rebuilt instead of failing every call.
  const sid = newSession();
  state.sessions[sid] = { updatedAt: Date.now() };
  fs.writeFileSync(path.join(data, 'state.json'), JSON.stringify(state));
  assert.ok(assertContext(callHook(preToolUse(sid, project, 'Read', mainTs), project, data), 'PreToolUse').includes('TS-MARKER'));
});

await test('array-shaped state maps and a __proto__ session id still dedupe', () => {
  const cases = [
    ['array-sessions', []],
    ['array-rules', { 'array-rules': { updatedAt: Date.now(), rules: [] } }],
    ['__proto__', {}],
  ];
  for (const [sid, sessions] of cases) {
    const data = makeDataDir();
    fs.writeFileSync(path.join(data, 'state.json'), JSON.stringify({ version: 1, sessions }));
    const first = callHook(preToolUse(sid, project, 'Read', mainTs), project, data);
    assert.ok(assertContext(first, 'PreToolUse').includes('TS-MARKER'), sid);
    assertSilent(callHook(preToolUse(sid, project, 'Read', mainTs), project, data));
  }
});

await test('sessions idle for more than 7 days are pruned from state', () => {
  const data = makeDataDir();
  const day = 24 * 60 * 60 * 1000;
  fs.writeFileSync(
    path.join(data, 'state.json'),
    JSON.stringify({
      version: 1,
      sessions: {
        'old-session': { updatedAt: Date.now() - 8 * day, rules: { '/x.md': 'abc' } },
        'recent-session': { updatedAt: Date.now() - 1 * day, rules: { '/y.md': 'def' } },
        'broken-session': null,
      },
    })
  );
  const sid = newSession();
  callHook(sessionStart(sid, project), project, data);
  const state = JSON.parse(fs.readFileSync(path.join(data, 'state.json'), 'utf8'));
  assert.ok(!('old-session' in state.sessions));
  assert.ok(!('broken-session' in state.sessions));
  assert.ok('recent-session' in state.sessions);
  assert.ok(sid in state.sessions);
  assert.ok(!fs.existsSync(path.join(data, 'state.lock')), 'lock file released');
});

await test('a state write refreshes updatedAt, which the 7-day TTL counts from', () => {
  const data = makeDataDir();
  const sid = newSession();
  const sixDaysAgo = Date.now() - 6 * 24 * 60 * 60 * 1000;
  const sessions = { [sid]: { updatedAt: sixDaysAgo, rules: {} } };
  fs.writeFileSync(path.join(data, 'state.json'), JSON.stringify({ version: 1, sessions }));
  const before = Date.now();
  assertContext(callHook(preToolUse(sid, project, 'Read', mainTs), project, data), 'PreToolUse');
  const state = JSON.parse(fs.readFileSync(path.join(data, 'state.json'), 'utf8'));
  assert.ok(state.sessions[sid].updatedAt >= before, 'still ' + state.sessions[sid].updatedAt);
});

await test('parallel tool calls inject a rule exactly once', async () => {
  const data = makeDataDir();
  const sid = newSession();
  callHook(sessionStart(sid, project), project, data);
  const held = spawnHeldHooks(16, preToolUse(sid, project, 'Read', mainTs), project, data);
  // Let every process finish booting and block on stdin, then release them together.
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const results = await held.release();
  for (const result of results) assert.strictEqual(result.status, 0, result.stderr);
  const injected = results.filter((result) => result.context && result.context.includes('TS-MARKER'));
  assert.strictEqual(injected.length, 1);
});

await test('a held state lock makes the hook wait for it', async () => {
  const data = makeDataDir();
  const lockFile = path.join(data, 'state.lock');
  fs.writeFileSync(lockFile, '');
  const held = spawnHeldHooks(1, preToolUse(newSession(), project, 'Read', mainTs), project, data);
  const finished = held.release().then((results) => ({ results, at: Date.now() }));
  await new Promise((resolve) => setTimeout(resolve, 600));
  const releasedAt = Date.now();
  fs.unlinkSync(lockFile);
  const { results, at } = await finished;
  assert.ok(at >= releasedAt, 'hook finished ' + (releasedAt - at) + ' ms before the lock was released');
  assert.ok(results[0].context.includes('TS-MARKER'));
});

await test('a stale state lock is reclaimed', () => {
  const data = makeDataDir();
  const lockFile = path.join(data, 'state.lock');
  fs.writeFileSync(lockFile, '');
  const old = (Date.now() - 60000) / 1000;
  fs.utimesSync(lockFile, old, old);
  const started = Date.now();
  const result = callHook(preToolUse(newSession(), project, 'Read', mainTs), project, data);
  assert.ok(assertContext(result, 'PreToolUse').includes('TS-MARKER'));
  assert.ok(Date.now() - started < 1900, 'should not wait out the 2 s lock deadline');
  assert.ok(!fs.existsSync(lockFile));
});

await test('an old state.lock that cannot be removed (a directory) waits out the deadline, no spin', () => {
  const data = makeDataDir();
  const lockDir = path.join(data, 'state.lock');
  fs.mkdirSync(lockDir);
  const old = (Date.now() - 60000) / 1000;
  fs.utimesSync(lockDir, old, old);
  const started = Date.now();
  const result = callHook(preToolUse(newSession(), project, 'Read', mainTs), project, data);
  assert.ok(Date.now() - started < 2500, 'took ' + (Date.now() - started) + ' ms');
  assert.ok(assertContext(result, 'PreToolUse').includes('TS-MARKER'));
  assert.ok(fs.statSync(lockDir).isDirectory());
});

await test('a lock the hook does not own is never removed', () => {
  // A live lock outlasting the wait: the hook proceeds unlocked and leaves it alone.
  const data = makeDataDir();
  const lockFile = path.join(data, 'state.lock');
  fs.writeFileSync(lockFile, 'live');
  assert.ok(assertContext(callHook(preToolUse(newSession(), project, 'Read', mainTs), project, data), 'PreToolUse').includes('TS-MARKER'));
  assert.strictEqual(fs.readFileSync(lockFile, 'utf8'), 'live');
  // Our lock, reclaimed by another hook while we stalled: release leaves the new owner's lock.
  fs.unlinkSync(lockFile);
  rules.withLock(data, () => {
    fs.unlinkSync(lockFile);
    fs.writeFileSync(lockFile, 'new owner');
  });
  assert.strictEqual(fs.readFileSync(lockFile, 'utf8'), 'new owner');
});

await test('unwritable data dir: SessionStart still delivers, PreToolUse stays silent', () => {
  const blocker = path.join(tmpRoot, 'not-a-directory');
  fs.writeFileSync(blocker, 'file in the way');
  const env = hookEnv(project, blocker);
  const sid = newSession();
  const start = callHook(sessionStart(sid, project), project, blocker, { env });
  assert.ok(assertContext(start, 'SessionStart').includes('CLAUDE-MARKER'));
  // Without state every call would repeat the rule, so nothing is emitted.
  assertSilent(callHook(preToolUse(sid, project, 'Read', mainTs), project, blocker, { env }));
});

await test('without ZCODE_PLUGIN_DATA, state goes to a private ~/.zcode/project-rules', () => {
  const home = fs.mkdtempSync(path.join(tmpRoot, 'home-'));
  const env = Object.assign(hookEnv(project, ''), { HOME: home, USERPROFILE: home });
  delete env.ZCODE_PLUGIN_DATA;
  const sid = newSession();
  assertContext(callHook(sessionStart(sid, project), project, null, { env }), 'SessionStart');
  const dir = path.join(home, '.zcode', 'project-rules');
  assert.ok(sid in JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')).sessions);
  if (process.platform !== 'win32') {
    assert.strictEqual(fs.statSync(dir).mode & 0o777, 0o700);
    assert.strictEqual(fs.statSync(path.join(dir, 'state.json')).mode & 0o777, 0o600);
  }
});

await test('hooks.json and plugin.json match the plugin contract', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'hooks', 'hooks.json'), 'utf8')).hooks;
  assert.deepStrictEqual(Object.keys(hooks).sort(), ['PreToolUse', 'SessionStart']);
  assert.strictEqual(hooks.PreToolUse[0].matcher, 'Read|Edit|Write');
  for (const event of ['PreToolUse', 'SessionStart']) {
    const hook = hooks[event][0].hooks[0];
    assert.strictEqual(hook.type, 'command');
    assert.strictEqual(hook.command, 'node "${ZCODE_PLUGIN_ROOT}/hooks/rules.js"');
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, '.zcode-plugin', 'plugin.json'), 'utf8'));
  assert.strictEqual(manifest.name, 'project-rules');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.ok(manifest.description_i18n.en && manifest.description_i18n['zh-CN']);
  assert.ok(!('hooks' in manifest), 'standard hooks/hooks.json is auto-discovered; do not declare it twice');
});

fs.rmSync(tmpRoot, { recursive: true, force: true });
console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exitCode = failures ? 1 : 0;

// Symlinked file_path: outside target excluded, inside target still matches.
{
  const dir = makeProject({
    '.zcode/rules/ts-style.md': '---\npaths: "src/**/*.ts"\n---\nTS rule marker.',
    '.zcode/rules/all.md': '---\n---\nAll marker.',
    'src/inbound.ts': '// real file',
  });
  const outsideTarget = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pr-outside-')), 'outside.ts');
  fs.writeFileSync(outsideTarget, '// outside target');
  const escapeLink = path.join(dir, 'src', 'escape.ts');
  fs.symlinkSync(outsideTarget, escapeLink);
  const inboundLink = path.join(dir, 'src', 'inbound-link.ts');
  fs.symlinkSync(path.join(dir, 'src', 'inbound.ts'), inboundLink);
  const data = makeDataDir();

  const escapeCtx = callHook(preToolUse('symlink-escape-1', dir, 'Edit', escapeLink), dir, data);
  const escapeText = JSON.stringify(escapeCtx.context ?? null);
  test('symlinked file_path resolving outside the project injects no path rule', () => {
    assert.ok(!escapeText.includes('TS rule marker'), 'path rule must not fire for outside target');
  });

  const inboundCtx = callHook(preToolUse('symlink-escape-2', dir, 'Read', inboundLink), dir, data);
  const inboundText = JSON.stringify(inboundCtx.context ?? null);
  test('symlinked file_path resolving inside the project still matches', () => {
    assert.ok(inboundText.includes('TS rule marker'), 'path rule must fire for inside target');
  });
}
