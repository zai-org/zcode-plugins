#!/usr/bin/env node
/**
 * project-rules hook for ZCode.
 *
 * SessionStart: injects the project-root CLAUDE.md (only when no AGENTS.md exists,
 * because ZCode already loads AGENTS.md) plus every .zcode/rules/*.md without `paths:`.
 * PreToolUse (Read|Edit|Write): injects .zcode/rules/*.md whose `paths:` globs match
 * toolInput.file_path, plus any path-less rule not yet delivered in this session.
 *
 * Protocol: one JSON object on stdin, optional JSON on stdout, exit code 0 always.
 * This hook never blocks or rewrites a tool call; on any unexpected error it prints
 * nothing. Set PROJECT_RULES_DEBUG=1 to get diagnostics on stderr.
 *
 * Manual smoke test:
 *   printf '%s\n' '{"hookEventName":"SessionStart","sessionId":"manual","cwd":"'"$PWD"'"}' \
 *     | node hooks/rules.js
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RULE_MAX_CHARS = 4000;
const CLAUDE_MD_MAX_CHARS = 8000;
const TOTAL_MAX_CHARS = 12000;
// ZCode cuts hook stdout at hooks.maxOutputBytes (default 32768); a cut JSON
// document fails to parse, so the serialized output must stay below this.
const MAX_STDOUT_BYTES = 30000;
const MAX_RULE_FILE_BYTES = 1024 * 1024;
const MAX_RULE_BYTES_TOTAL = 2 * 1024 * 1024;
const MAX_RULE_FILES = 200;
const MAX_RULE_GLOBS = 32;
const MAX_GLOB_CHARS = 256;
const MAX_BRACE_EXPANSIONS = 64;
const MAX_STDIN_BYTES = 1024 * 1024;
const STATE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LOCK_WAIT_MS = 2000;
const LOCK_STALE_MS = 10000;
const STDIN_TIMEOUT_MS = 5000;
const TOOL_NAMES = new Set(['Read', 'Edit', 'Write']);
const RULES_DIR = path.join('.zcode', 'rules');

function debug(message) {
  if (process.env.PROJECT_RULES_DEBUG === '1') {
    process.stderr.write('[project-rules] ' + message + '\n');
  }
}

// ---------------------------------------------------------------------------
// Glob matching: `*`, `**`, `?`, and `{a,b}` alternatives. Paths use `/`.
// A pattern without `/` matches the file name at any depth (gitignore style);
// a leading `/` or `./` anchors it to the project root; a trailing `/` means
// everything below that directory.
// ---------------------------------------------------------------------------

/**
 * Splits `value` on commas that sit outside braces and quotes; strips quotes
 * and a trailing YAML ` # comment`.
 */
function splitList(value) {
  const out = [];
  let current = '';
  let depth = 0;
  let quote = null;
  for (const ch of value) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '#' && depth === 0 && (current === '' || /\s$/.test(current))) break;
    if (ch === '{') depth += 1;
    else if (ch === '}' && depth > 0) depth -= 1;
    else if (ch === ',' && depth === 0) {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map((item) => item.trim()).filter(Boolean);
}

/**
 * Expands `{a,b}` groups (nested and empty alternatives allowed) breadth-first, capped at
 * MAX_BRACE_EXPANSIONS results. A first `{` without a matching `}` leaves the pattern literal.
 */
function expandBraces(pattern) {
  const done = [];
  const queue = [pattern];
  while (queue.length && done.length < MAX_BRACE_EXPANSIONS) {
    const current = queue.shift();
    const open = current.indexOf('{');
    const options = [];
    let start = open + 1;
    let depth = 0;
    let close = open;
    for (; open !== -1 && close < current.length; close += 1) {
      const ch = current[close];
      if (ch === '{') depth += 1;
      else if (ch === '}' && --depth === 0) break;
      else if (ch === ',' && depth === 1) {
        options.push(current.slice(start, close));
        start = close + 1;
      }
    }
    if (open === -1 || close === current.length) {
      done.push(current);
      continue;
    }
    options.push(current.slice(start, close));
    for (const option of options) {
      if (queue.length >= MAX_BRACE_EXPANSIONS) break;
      queue.push(current.slice(0, open) + option + current.slice(close + 1));
    }
  }
  return done;
}

/** A glob as `/` segments, with anchoring and the trailing-`/` directory form resolved. */
function globToSegments(glob) {
  let pattern = glob.trim().replace(/\\/g, '/');
  const anchored = /^\.?\//.test(pattern);
  pattern = pattern.replace(/^\.?\//, '');
  if (pattern.endsWith('/')) pattern += '**';
  if (!anchored && !pattern.includes('/')) pattern = '**/' + pattern;
  const segments = pattern.split('/').filter((segment) => segment !== '');
  // A trailing `**` needs one segment: `docs/**` matches below docs/, not a file named docs.
  if (segments[segments.length - 1] === '**') segments.splice(-1, 0, '*');
  return segments;
}

/**
 * Matches `subject` against `pattern`, where a `star` item spans any run of subject items and
 * any other item must satisfy same(item, subjectItem). Greedy with one backtrack point, so it
 * is O(pattern * subject); a RegExp built from a hostile glob can backtrack for minutes.
 */
function wildcard(pattern, subject, star, same) {
  let p = 0;
  let s = 0;
  let starP = -1;
  let starS = 0;
  while (s < subject.length) {
    if (pattern[p] === star) {
      starP = p++;
      starS = s;
    } else if (p < pattern.length && same(pattern[p], subject[s])) {
      p += 1;
      s += 1;
    } else if (starP === -1) {
      return false;
    } else {
      p = starP + 1;
      s = ++starS;
    }
  }
  while (pattern[p] === star) p += 1;
  return p === pattern.length;
}

/** Segment lists for a rule's first MAX_RULE_GLOBS globs; over-long globs never match. */
function compileGlobs(globs) {
  const matchers = [];
  for (const glob of globs.slice(0, MAX_RULE_GLOBS)) {
    if (glob.length > MAX_GLOB_CHARS) {
      debug('ignoring a glob over ' + MAX_GLOB_CHARS + ' chars: ' + glob.slice(0, 40) + '...');
      continue;
    }
    for (const expanded of expandBraces(glob)) {
      if (expanded.trim()) matchers.push(globToSegments(expanded));
    }
  }
  return matchers;
}

function matchesAny(relativePath, matchers) {
  const names = relativePath.split('/');
  const sameName = (glob, name) => wildcard(glob, name, '*', (g, ch) => g === '?' || g === ch);
  return matchers.some((segments) => wildcard(segments, names, '**', sameName));
}

// ---------------------------------------------------------------------------
// Rule files
// ---------------------------------------------------------------------------

/**
 * Parses optional frontmatter. Accepts `paths:` (or Cursor's `globs:`) as a
 * comma-separated list, an inline `[a, b]` list, or a YAML block list.
 */
function parseRule(raw) {
  let text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  text = text.replace(/\r\n/g, '\n');
  const match = /^---[ \t]*\n(?:([\s\S]*?)\n)?---[ \t]*(?:\n|$)/.exec(text);
  if (!match) return { paths: [], body: text.trim() };

  const lines = (match[1] || '').split('\n');
  const paths = [];
  for (let i = 0; i < lines.length; i += 1) {
    const field = /^(paths|globs)[ \t]*:[ \t]*(.*)$/.exec(lines[i]);
    if (!field) continue;
    let value = field[2].trim();
    if (value === '') {
      while (i + 1 < lines.length && /^[ \t]*-[ \t]+/.test(lines[i + 1])) {
        i += 1;
        paths.push(...splitList(lines[i].replace(/^[ \t]*-[ \t]+/, '')));
      }
      continue;
    }
    // Strip an inline list before splitList drops the comment: `["src/**"]  # api`.
    const inline = /^\[(.*?)\](?:[ \t]+#.*)?$/.exec(value);
    if (inline) value = inline[1];
    paths.push(...splitList(value));
  }
  return { paths, body: text.slice(match[0].length).trim() };
}

function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/** File text, or null for a non-file, a file over maxBytes, or one resolving outside root. */
function readSmallFile(file, root, maxBytes) {
  const real = fs.realpathSync(file);
  if (!relativeInside(root, real)) return null;
  const stat = fs.statSync(real);
  if (!stat.isFile() || stat.size > maxBytes) return null;
  return fs.readFileSync(real, 'utf8');
}

function loadRules(projectDir) {
  const dir = path.join(projectDir, RULES_DIR);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (_) {
    return [];
  }
  const root = realish(projectDir);
  let budget = MAX_RULE_BYTES_TOTAL;
  const rules = [];
  for (const name of names.filter((n) => n.toLowerCase().endsWith('.md')).sort()) {
    if (rules.length >= MAX_RULE_FILES) break;
    const file = path.join(dir, name);
    let raw;
    try {
      raw = readSmallFile(file, root, Math.min(MAX_RULE_FILE_BYTES, budget));
    } catch (err) {
      debug('skipping ' + file + ': ' + err.message);
      continue;
    }
    if (raw === null) continue;
    budget -= Buffer.byteLength(raw);
    const parsed = parseRule(raw);
    if (!parsed.body) continue;
    rules.push({
      kind: 'rule',
      file,
      label: RULES_DIR.split(path.sep).join('/') + '/' + name,
      hash: hashContent(raw),
      body: parsed.body,
      paths: parsed.paths,
    });
  }
  return rules;
}

function loadClaudeMd(projectDir) {
  if (fs.existsSync(path.join(projectDir, 'AGENTS.md'))) return null;
  const file = path.join(projectDir, 'CLAUDE.md');
  let raw;
  try {
    raw = readSmallFile(file, realish(projectDir), MAX_RULE_FILE_BYTES);
  } catch (_) {
    return null;
  }
  if (raw === null || !raw.trim()) return null;
  return { kind: 'claude', file, label: 'CLAUDE.md', hash: hashContent(raw), body: raw.trim() };
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function realish(p) {
  try {
    return fs.realpathSync(p);
  } catch (_) {
    try {
      return path.join(fs.realpathSync(path.dirname(p)), path.basename(p));
    } catch (_err) {
      return p;
    }
  }
}

function relativeInside(base, target) {
  const rel = path.relative(base, target);
  if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

/** Project-relative `/` path for a tool's file path, or null when outside the project. */
function toProjectRelative(filePath, projectDir) {
  if (typeof filePath !== 'string' || !filePath.trim()) return null;
  const absolute = path.resolve(projectDir, filePath);
  // A file that exists but resolves (symlink) outside the project never matches:
  // rule scoping follows the real target, not just the path as written.
  if (fs.existsSync(absolute) && !relativeInside(realish(path.resolve(projectDir)), realish(absolute))) {
    return null;
  }
  return (
    relativeInside(path.resolve(projectDir), absolute) ||
    relativeInside(realish(path.resolve(projectDir)), realish(absolute))
  );
}

// ---------------------------------------------------------------------------
// Per-session dedupe state in ${ZCODE_PLUGIN_DATA:-~/.zcode/project-rules}/state.json:
//   { version: 1, sessions: { <sessionId>: { updatedAt, rules: { <file>: <hash> } } } }
// A rule is delivered again only when its content hash changes. Every state write
// refreshes updatedAt, and a session is pruned STATE_TTL_MS after its last write.
// ---------------------------------------------------------------------------

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Runs fn under an exclusive lock file so parallel tool calls do not double-inject. */
function withLock(dataDir, fn) {
  const lockFile = path.join(dataDir, 'state.lock');
  const deadline = Date.now() + LOCK_WAIT_MS;
  let fd = null;
  while (fd === null) {
    try {
      fd = fs.openSync(lockFile, 'wx');
    } catch (err) {
      if (err.code !== 'EEXIST') {
        // Unwritable data dir: run unlocked; saveState decides what that means.
        debug('lock unavailable (' + err.code + '); continuing without the lock');
        break;
      }
      try {
        // Reclaim a lock left by a crashed hook; the mtime is checked at unlink time.
        if (Date.now() - fs.statSync(lockFile).mtimeMs > LOCK_STALE_MS) {
          fs.unlinkSync(lockFile);
          continue;
        }
      } catch (_) {
        // Vanished or not removable (a directory, EPERM): wait out the deadline, no spinning.
      }
      if (Date.now() > deadline) {
        debug('lock wait timed out; continuing without the lock');
        break;
      }
      sleep(15);
    }
  }
  try {
    return fn();
  } finally {
    if (fd !== null) {
      try {
        // After a long stall another hook may have reclaimed the lock: never remove theirs.
        if (fs.statSync(lockFile).ino === fs.fstatSync(fd).ino) fs.unlinkSync(lockFile);
      } catch (_) {
        // Already removed as stale by another process.
      }
      fs.closeSync(fd);
    }
  }
}

const isMap = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function loadState(stateFile) {
  let sessions = null;
  try {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (isMap(state) && isMap(state.sessions)) sessions = state.sessions;
  } catch (_) {
    // Missing or corrupt state starts fresh.
  }
  // Null prototype: a session id such as `__proto__` stays an ordinary, saved key.
  return { version: 1, sessions: Object.assign(Object.create(null), sessions) };
}

function pruneState(state, now) {
  for (const [id, session] of Object.entries(state.sessions)) {
    const updatedAt = session && typeof session.updatedAt === 'number' ? session.updatedAt : 0;
    if (now - updatedAt > STATE_TTL_MS) delete state.sessions[id];
  }
}

function saveState(stateFile, state) {
  const tmp = stateFile + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(state), { flag: 'wx', mode: 0o600 });
    fs.renameSync(tmp, stateFile);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch (_) {
      // Nothing was written.
    }
    throw err;
  }
}

/** The session's entry, recreated when missing or malformed, with updatedAt refreshed. */
function sessionEntry(state, sessionId, now) {
  const existing = state.sessions[sessionId];
  const session = isMap(existing) && isMap(existing.rules) ? existing : { rules: {} };
  session.updatedAt = now;
  state.sessions[sessionId] = session;
  return session;
}

// ---------------------------------------------------------------------------
// Context assembly with size caps
// ---------------------------------------------------------------------------

function clip(text, max) {
  if (text.length <= max) return text;
  let end = max;
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return text.slice(0, end);
}

function makeBlock(item, maxChars) {
  const body = clip(item.body, maxChars);
  const lines = [item.kind === 'claude' ? '## CLAUDE.md' : '## Rule: ' + item.label];
  if (item.kind === 'rule') {
    const scope = item.paths.length ? item.paths.join(', ') : 'all files';
    lines.push('Applies to: ' + scope + (item.matched ? ' (matched ' + item.matched + ')' : ''));
  }
  lines.push(body);
  if (body.length < item.body.length) {
    lines.push(
      '[project-rules: truncated, showing the first ' + body.length + ' of ' + item.body.length +
        ' characters. Read ' + item.label + ' for the rest.]'
    );
  }
  return lines.join('\n');
}

function serialize(eventName, text) {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: eventName, additionalContext: text } });
}

function render(intro, included, deferred) {
  const parts = ['<project-rules>', intro, ''];
  parts.push(included.map((entry) => entry.block).join('\n\n'));
  if (deferred.length) {
    const names = deferred.slice(0, 5).map((item) => item.label);
    if (deferred.length > names.length) names.push('...');
    parts.push(
      '',
      '[project-rules: ' + deferred.length + ' more rule(s) deferred to keep context small (' +
        names.join(', ') + '). They will be attached to a later matching Read/Edit/Write result.]'
    );
  }
  parts.push('</project-rules>');
  return parts.join('\n');
}

/** Packs items in priority order under the char and byte budgets. */
function buildContext(eventName, intro, items) {
  const included = [];
  const deferred = [];
  let used = intro.length;
  for (const item of items) {
    const max = item.kind === 'claude' ? CLAUDE_MD_MAX_CHARS : RULE_MAX_CHARS;
    const block = makeBlock(item, max);
    if (included.length && used + block.length + 2 > TOTAL_MAX_CHARS) {
      deferred.push(item);
      continue;
    }
    included.push({ item, block, max });
    used += block.length + 2;
  }
  if (!included.length) return null;

  // The wrapper and the deferral note count too: enforce both caps on the final text.
  const fits = (candidate) =>
    candidate.length <= TOTAL_MAX_CHARS &&
    Buffer.byteLength(serialize(eventName, candidate)) <= MAX_STDOUT_BYTES;
  let text = render(intro, included, deferred);
  while (!fits(text)) {
    if (included.length > 1) {
      deferred.unshift(included.pop().item);
    } else {
      const only = included[0];
      only.max = Math.floor(only.max * 0.75);
      if (only.max < 200) return null;
      only.block = makeBlock(only.item, only.max);
    }
    text = render(intro, included, deferred);
  }
  return { output: serialize(eventName, text), included: included.map((entry) => entry.item) };
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

const SESSION_INTRO =
  'Project instructions loaded by the project-rules plugin. ZCode does not read these files ' +
  'natively; follow them as you would AGENTS.md.';
const TOOL_INTRO =
  'Project rules loaded by the project-rules plugin from .zcode/rules/. Follow them for this ' +
  'and later work on matching files.';

function onSessionStart(ctx) {
  const items = [];
  const claude = loadClaudeMd(ctx.projectDir);
  if (claude) items.push(claude);
  for (const rule of loadRules(ctx.projectDir)) {
    if (!rule.paths.length) items.push(rule);
  }
  return withLock(ctx.dataDir, () => {
    const state = loadState(ctx.stateFile);
    pruneState(state, ctx.now);
    // Each SessionStart (startup, resume, clear, compact) begins a fresh model
    // context, so every rule is re-armed for this session.
    const session = { updatedAt: ctx.now, rules: {} };
    state.sessions[ctx.sessionId] = session;
    const built = items.length ? buildContext('SessionStart', SESSION_INTRO, items) : null;
    if (built) for (const item of built.included) session.rules[item.file] = item.hash;
    try {
      saveState(ctx.stateFile, state);
    } catch (err) {
      // Still deliver session context; dedupe for later tool calls is degraded.
      debug('could not save state: ' + err.message);
    }
    return built ? built.output : null;
  });
}

function onPreToolUse(ctx, input) {
  const toolName = input.toolName || input.tool_name;
  if (!TOOL_NAMES.has(toolName)) return null;
  const toolInput = input.toolInput || input.tool_input || {};
  const filePath = toolInput.file_path || toolInput.filePath || toolInput.path;
  const relative = toProjectRelative(filePath, ctx.projectDir);

  const rules = loadRules(ctx.projectDir);
  if (!rules.length) return null;

  return withLock(ctx.dataDir, () => {
    const state = loadState(ctx.stateFile);
    pruneState(state, ctx.now);
    const session = sessionEntry(state, ctx.sessionId, ctx.now);
    const pending = (rule) => session.rules[rule.file] !== rule.hash;

    const items = [];
    if (relative) {
      for (const rule of rules) {
        if (rule.paths.length && pending(rule) && matchesAny(relative, compileGlobs(rule.paths))) {
          items.push(Object.assign({}, rule, { matched: relative }));
        }
      }
    }
    for (const rule of rules) {
      if (!rule.paths.length && pending(rule)) items.push(rule);
    }
    const built = items.length ? buildContext('PreToolUse', TOOL_INTRO, items) : null;
    if (!built) return null;

    for (const item of built.included) session.rules[item.file] = item.hash;
    // Only emit what could be recorded; otherwise every tool call would repeat it.
    saveState(ctx.stateFile, state);
    return built.output;
  });
}

function run(input, env) {
  if (!input || typeof input !== 'object') return null;
  const eventName = input.hookEventName || input.hook_event_name;
  if (eventName !== 'SessionStart' && eventName !== 'PreToolUse') return null;

  const projectDir = path.resolve(env.ZCODE_PROJECT_DIR || input.cwd || process.cwd());
  const dataDir = env.ZCODE_PLUGIN_DATA || path.join(os.homedir(), '.zcode', 'project-rules');
  try {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  } catch (err) {
    debug('cannot create data dir: ' + err.message);
  }
  const ctx = {
    dataDir,
    now: Date.now(),
    projectDir,
    sessionId: String(input.sessionId || input.session_id || 'unknown-session'),
    stateFile: path.join(dataDir, 'state.json'),
  };
  return eventName === 'SessionStart' ? onSessionStart(ctx) : onPreToolUse(ctx, input);
}

function main() {
  const chunks = [];
  let size = 0;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    let output = null;
    try {
      if (size > MAX_STDIN_BYTES) throw new Error('stdin over ' + MAX_STDIN_BYTES + ' bytes');
      output = run(JSON.parse(Buffer.concat(chunks).toString('utf8')), process.env);
    } catch (err) {
      debug('no output: ' + (err && err.message ? err.message : String(err)));
    }
    process.exitCode = 0;
    if (output) process.stdout.write(output);
  };
  const timer = setTimeout(() => {
    finish();
    process.stdin.destroy();
  }, STDIN_TIMEOUT_MS);
  // Past the cap, drain without buffering: closing the pipe early would EPIPE the host.
  process.stdin.on('data', (chunk) => {
    size += chunk.length;
    if (size <= MAX_STDIN_BYTES) chunks.push(chunk);
  });
  process.stdin.on('end', finish);
  process.stdin.on('error', finish);
}

if (require.main === module) {
  process.on('uncaughtException', (err) => {
    debug('uncaught: ' + (err && err.message ? err.message : String(err)));
    process.exit(0);
  });
  main();
}

module.exports = {
  compileGlobs,
  expandBraces,
  matchesAny,
  parseRule,
  run,
  splitList,
  toProjectRelative,
  withLock,
  limits: { CLAUDE_MD_MAX_CHARS, MAX_STDOUT_BYTES, RULE_MAX_CHARS, TOTAL_MAX_CHARS },
};
