// Unit tests for the ZCode RTL Fixer plugin.
// Run: node tests/run-tests.mjs [path-to-any-real-app.asar]

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = path.join(PLUGIN_ROOT, 'scripts');

const { buildPatchedAsar, readHeader, extractFile, computeIntegrity } = await import(
  path.join(SCRIPTS, 'lib', 'asar.mjs')
);
// patch-zcode.mjs is side-effect-free on import (main() is entry-guarded)
const patcher = await import(path.join(SCRIPTS, 'patch-zcode.mjs'));

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (err) {
    failures.push({ name, err });
    console.error('FAIL  ' + name + ' -> ' + err.message);
  }
}

/* ------------------------------------------------------------------ *
 * 1. bidi heuristics (same logic as engine/bootstrap.js)
 * ------------------------------------------------------------------ */

const RTL_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const LTR_RE = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]/;
function rtlDominant(text) {
  let rtl = 0, ltr = 0;
  for (const ch of text) {
    if (RTL_RE.test(ch)) rtl++;
    else if (LTR_RE.test(ch)) ltr++;
  }
  return rtl > 0 && rtl >= ltr;
}
function hasRtl(text) { return RTL_RE.test(text); }

test('bidi: pure Persian is RTL-dominant', () => {
  assert.equal(rtlDominant('سلام دنیا'), true);
});
test('bidi: Persian with an embedded English term stays RTL-dominant', () => {
  assert.equal(rtlDominant('این یک متن فارسی با اصطلاح MutationObserver در وسط جمله است.'), true);
});
test('bidi: pure English is not RTL-dominant', () => {
  assert.equal(rtlDominant('The quick brown fox jumps over the lazy dog'), false);
});
test('bidi: mostly-English sentence with one Persian word is not RTL-dominant', () => {
  assert.equal(rtlDominant('This bug was fixed in the latest release نسخه'), false);
});
test('bidi: hasRtl detects Arabic script, rejects pure ASCII/punctuation', () => {
  assert.equal(hasRtl('متن'), true);
  assert.equal(hasRtl('hello... {123}'), false);
});
test('bidi: digits/neutral chars do not break dominance', () => {
  assert.equal(rtlDominant('در نسخهٔ ۰٫۱ از تاریخ ۱۳۸۴/۰۲/۱۲'), true);
});

/* ------------------------------------------------------------------ *
 * 2. asar: build a synthetic archive, patch it, verify round-trip
 * ------------------------------------------------------------------ */

const BLOCK = 4 * 1024 * 1024;
function makeIntegrity(buf) {
  const blocks = [];
  for (let i = 0; i < buf.length; i += BLOCK) {
    blocks.push(createHash('sha256').update(buf.subarray(i, i + BLOCK)).digest('hex'));
  }
  return { algorithm: 'SHA256', hash: createHash('sha256').update(buf).digest('hex'), blockSize: BLOCK, blocks };
}

// Build a minimal but realistic asar from scratch (same pickle format).
// `links` maps relPath -> link target (asar symlink entries: header-only, no data).
function buildAsar(entries, links = {}) {
  // layout pass — offsets relative to a guessed base; two-pass for exactness
  let dataBase = 4096;
  let header;
  for (let i = 0; i < 5; i++) {
    header = { files: {} };
    let cursor = dataBase;
    for (const [rel, buf] of Object.entries(entries)) {
      const parts = rel.split('/');
      let cur = header.files;
      for (let j = 0; j < parts.length - 1; j++) {
        cur[parts[j]] = cur[parts[j]] || { files: {} };
        cur = cur[parts[j]].files;
      }
      cur[parts[parts.length - 1]] = { size: buf.length, offset: String(cursor - dataBase), integrity: makeIntegrity(buf) };
      cursor += buf.length;
    }
    for (const [rel, target] of Object.entries(links)) {
      const parts = rel.split('/');
      let cur = header.files;
      for (let j = 0; j < parts.length - 1; j++) {
        cur[parts[j]] = cur[parts[j]] || { files: {} };
        cur = cur[parts[j]].files;
      }
      cur[parts[parts.length - 1]] = { link: target };
    }
    const json = Buffer.from(JSON.stringify(header), 'utf8');
    const newBase = 8 + ((8 + json.length + 3) & ~3);
    if (newBase === dataBase) break;
    dataBase = newBase;
  }
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const headerSize = (8 + json.length + 3) & ~3;
  const head = Buffer.alloc(8 + headerSize);
  head.writeUInt32LE(4, 0);
  head.writeUInt32LE(headerSize, 4);
  head.writeUInt32LE(headerSize - 4, 8);
  head.writeUInt32LE(json.length, 12);
  json.copy(head, 16);
  const dataParts = [head];
  const base = 8 + headerSize;
  const laidOut = new Map();
  // recompute absolute offsets from header
  const walk = (files, prefix = '') => {
    for (const [k, v] of Object.entries(files)) {
      const rel = prefix ? prefix + '/' + k : k;
      if (v.files) walk(v.files, rel);
      else laidOut.set(rel, { offset: base + parseInt(v.offset, 10), size: v.size });
    }
  };
  walk(header.files);
  const out = Buffer.alloc(base + Object.values(entries).reduce((a, b) => a + b.length, 0));
  head.copy(out, 0);
  for (const [rel, buf] of Object.entries(entries)) {
    const pos = laidOut.get(rel).offset;
    buf.copy(out, pos);
  }
  return { buf: out, dataBase: base };
}

const tmp = fs.mkdtempSync('/tmp/rtl-test-');
const origAsar = path.join(tmp, 'orig.asar');const origEntries = {
  'package.json': Buffer.from(JSON.stringify({ name: 'fake-app', main: 'out/main/index.js' })),
  'out/main/index.js': Buffer.from('// main\nconsole.log("hello");\n'.repeat(40)),
  'out/renderer/index.html': Buffer.from('<!doctype html><html><head><script src="app.js"></script></head><body><div id="root"></div></body></html>'),
  'out/renderer/assets/index-abc.js': Buffer.from('// renderer bundle\n'.repeat(1000)),
  'out/renderer/assets/style.css': Buffer.from('body{margin:0}'.repeat(50)),
  'out/empty-dir-marker/.keep': Buffer.alloc(0),
};
fs.writeFileSync(origAsar, buildAsar(origEntries).buf);

test('asar: original archive parses and files extract byte-identical', () => {
  const { header, dataBase } = readHeader(origAsar);
  assert.equal(dataBase > 0, true);
  for (const [rel, buf] of Object.entries(origEntries)) {
    const got = extractFile(origAsar, rel);
    assert.equal(got.equals(buf), true, 'mismatch for ' + rel);
  }
  assert.ok(header.files['out'].files.renderer.files['index.html'].integrity);
});

test('asar: patch replaces index.html and adds new nested file', () => {
  const newIndex = Buffer.from(
    '<!doctype html><html><head><script src="app.js"></script><script defer src="./zcode-rtl/bootstrap.js"></script></head><body><div id="root"></div></body></html>'
  );
  const bootstrap = Buffer.from('// injected engine\nwindow.__ZCODE_RTL_FIXER__=1;\n'.repeat(200));
  const outAsar = path.join(tmp, 'patched.asar');
  const res = buildPatchedAsar(origAsar, outAsar, {
    replace: { 'out/renderer/index.html': newIndex },
    add: { 'out/renderer/zcode-rtl/bootstrap.js': bootstrap },
  });
  assert.ok(res.dataBase > 0);

  // replaced entry
  const gotHtml = extractFile(outAsar, 'out/renderer/index.html');
  assert.equal(gotHtml.equals(newIndex), true);
  assert.ok(gotHtml.toString().includes('zcode-rtl/bootstrap.js'));

  // added entry
  const gotBootstrap = extractFile(outAsar, 'out/renderer/zcode-rtl/bootstrap.js');
  assert.equal(gotBootstrap.equals(bootstrap), true);

  // untouched entries intact
  for (const rel of ['package.json', 'out/main/index.js', 'out/renderer/assets/index-abc.js', 'out/renderer/assets/style.css', 'out/empty-dir-marker/.keep']) {
    assert.equal(extractFile(outAsar, rel).equals(origEntries[rel]), true, 'untouched entry damaged: ' + rel);
  }
});

test('asar: header size grows/shrinks without corrupting data offsets', () => {
  // huge bootstrap → header digits grow → offsets shift; verify all files still extract
  const bigAdd = Buffer.alloc(9 * 1024 * 1024, 0x41);
  const outAsar = path.join(tmp, 'patched-big.asar');
  buildPatchedAsar(origAsar, outAsar, {
    replace: { 'out/renderer/index.html': Buffer.from('<html>patched</html>') },
    add: { 'out/renderer/zcode-rtl/big.bin': bigAdd },
  });
  assert.equal(extractFile(outAsar, 'out/renderer/zcode-rtl/big.bin').equals(bigAdd), true);
  assert.equal(extractFile(outAsar, 'out/renderer/index.html').toString(), '<html>patched</html>');
  assert.equal(extractFile(outAsar, 'out/main/index.js').equals(origEntries['out/main/index.js']), true);
});

test('asar: integrity metadata of replaced entries is recomputed and correct', () => {
  const newIndex = Buffer.from('<html>patched</html>');
  const outAsar = path.join(tmp, 'patched-integrity.asar');
  buildPatchedAsar(origAsar, outAsar, { replace: { 'out/renderer/index.html': newIndex } });
  const { header } = readHeader(outAsar);
  const node = header.files.out.files.renderer.files['index.html'];
  assert.deepEqual(node.integrity.hash, computeIntegrity(newIndex).hash);
  // untouched entries keep original integrity (byte-identical data anyway)
  const mainNode = header.files.out.files.main.files['index.js'];
  assert.deepEqual(mainNode.integrity, makeIntegrity(origEntries['out/main/index.js']));
});

test('asar: refuses unknown replace target and duplicate add', () => {
  const outAsar = path.join(tmp, 'should-not-exist.asar');
  assert.throws(() => buildPatchedAsar(origAsar, outAsar, { replace: { 'no/such/file': Buffer.from('x') } }));
  assert.throws(() => buildPatchedAsar(origAsar, outAsar, { add: { 'out/main/index.js': Buffer.from('x') } }));
  assert.equal(fs.existsSync(outAsar), false);
});

test('asar: symlink entries survive a patch and extractFile refuses them', () => {
  const linkAsar = path.join(tmp, 'links.asar');
  fs.writeFileSync(
    linkAsar,
    buildAsar(origEntries, { 'out/renderer/assets/current.js': '../index-abc.js' }).buf
  );
  const { header } = readHeader(linkAsar);
  const linkNode = header.files.out.files.renderer.files.assets.files['current.js'];
  assert.equal(linkNode.link, '../index-abc.js');

  const outAsar = path.join(tmp, 'links-patched.asar');
  buildPatchedAsar(linkAsar, outAsar, { add: { 'out/renderer/assets/new.js': Buffer.from('new!') } });
  const { header: h2 } = readHeader(outAsar);
  assert.equal(h2.files.out.files.renderer.files.assets.files['current.js'].link, '../index-abc.js');
  assert.equal(extractFile(outAsar, 'out/renderer/assets/new.js').toString(), 'new!');
  assert.throws(() => extractFile(outAsar, 'out/renderer/assets/current.js'), /not a file entry/);
  assert.equal(extractFile(outAsar, 'out/renderer/assets/index-abc.js').equals(origEntries['out/renderer/assets/index-abc.js']), true);
});

/* ------------------------------------------------------------------ *
 * 3. engine + settings wiring
 * ------------------------------------------------------------------ */

test('engine: bootstrap contains placeholder and is valid JS after substitution', () => {
  const enginePath = path.join(SCRIPTS, 'engine', 'bootstrap.js');
  const src = fs.readFileSync(enginePath, 'utf8');
  assert.ok(src.includes('__RTL_SETTINGS__'), 'placeholder missing');
  const defaults = JSON.parse(fs.readFileSync(path.join(SCRIPTS, 'engine', 'settings.default.json'), 'utf8'));
  // must be a GLOBAL replace: the header comment also mentions the placeholder,
  // so a naive replace() would bake into the comment and leave `var SETTINGS`
  // referencing an undefined identifier (valid syntax! node --check passes).
  const baked = src.split('__RTL_SETTINGS__').join(JSON.stringify(defaults));
  assert.ok(!baked.includes('__RTL_SETTINGS__'), 'placeholder survived substitution');
  const varLine = baked.split('\n').find((l) => l.includes('var SETTINGS'));
  assert.ok(varLine && varLine.includes('"enabled"'), 'var SETTINGS was not baked with real JSON');
  const out = path.join(tmp, 'bootstrap-sub.js');
  fs.writeFileSync(out, baked);
  execFileSync('node', ['--check', out]);
});

test('engine: fixLists default on and list-marker class present', () => {
  const defaults = JSON.parse(fs.readFileSync(path.join(SCRIPTS, 'engine', 'settings.default.json'), 'utf8'));
  assert.equal(defaults.fixLists, true);
  const engine = fs.readFileSync(path.join(SCRIPTS, 'engine', 'bootstrap.js'), 'utf8');
  assert.ok(engine.includes('zcode-rtl-li'), 'engine lacks the list-item class');
  assert.ok(/li\.zcode-rtl-li/.test(engine), 'engine CSS does not target li.zcode-rtl-li');
  // Persian-dominant li content qualifies for the marker fix
  assert.equal(rtlDominant('بازکردن فایل package.json در ادیتور'), true);
  assert.equal(rtlDominant('run the build with --watch'), false);
});

test('engine: language-* class prefix is treated as code (regression)', () => {
  const engine = fs.readFileSync(path.join(SCRIPTS, 'engine', 'bootstrap.js'), 'utf8');
  assert.ok(/language\|lang\)-/.test(engine), 'inCode must prefix-match language-*/lang-* classes');
  assert.ok(!engine.includes("contains('language-')"), 'exact contains(language-) never matches language-js');
});

test('meta: engine version matches plugin manifest', () => {
  const engine = fs.readFileSync(path.join(SCRIPTS, 'engine', 'bootstrap.js'), 'utf8');
  const m = engine.match(/version: '([^']+)'/);
  assert.ok(m, 'engine version string not found');
  assert.equal(m[1], patcher.PLUGIN_VERSION, 'engine version out of sync with plugin.json');
});

test('meta: both marketplace catalogs match the plugin manifest', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, '.zcode-plugin', 'plugin.json'), 'utf8'));
  for (const [label, catPath] of [
    ['local dev catalog', path.join(PLUGIN_ROOT, '..', 'marketplace.json')],
    ['published catalog', path.join(PLUGIN_ROOT, '..', '..', 'marketplace.json')],
  ]) {
    const cat = JSON.parse(fs.readFileSync(catPath, 'utf8'));
    const entry = cat.plugins.find((p) => p.name === manifest.name);
    assert.ok(entry, label + ': plugin entry missing');
    assert.equal(entry.version, manifest.version, label + ': version out of sync');
    assert.ok(entry.source.endsWith(manifest.name), label + ': source path does not point at the plugin');
  }
});

/* ------------------------------------------------------------------ *
 * 3b. patcher unit tests (module is importable without side effects)
 * ------------------------------------------------------------------ */

test('patcher: patchIndexHtml injects the engine tag exactly once', () => {
  const html = '<!doctype html><html><head><script src="app.js"></script></head><body><div id="root"></div></body></html>';
  const once = patcher.patchIndexHtml(html);
  assert.ok(once.includes('assets/zcode-rtl-bootstrap.js'), 'script tag missing');
  assert.equal(once.split('zcode-rtl-bootstrap').length - 1, 1, 'tag injected more than once');
  assert.equal(patcher.patchIndexHtml(once), once, 're-patch must be a no-op (idempotent)');
});

test('patcher: patchIndexHtml fails clearly when </head> is missing', () => {
  assert.throws(() => patcher.patchIndexHtml('<html><body>no head here</body></html>'), /<\/head>/);
});

test('patcher: buildBootstrap bakes settings into valid JS', () => {
  const buf = patcher.buildBootstrap({
    enabled: true, fontEnabled: true, fontFamily: 'TestFont, sans-serif',
    fontSizeScale: 1.1, fixTables: true, fixLists: true, probe: false,
  });
  const baked = buf.toString();
  assert.ok(!baked.includes('__RTL_SETTINGS__'), 'placeholder not replaced');
  assert.ok(baked.includes('TestFont'), 'settings not baked');
  assert.ok(/var SETTINGS = \{/.test(baked), 'var SETTINGS must be a real object literal');
  const out = path.join(tmp, 'bootstrap-baked.js');
  fs.writeFileSync(out, buf);
  execFileSync('node', ['--check', out]);
});

test('patcher: findAppImage rejects missing paths and directories, resolves relative', () => {
  assert.throws(() => patcher.findAppImage('/no/such/AppImage'), /not found/);
  assert.throws(() => patcher.findAppImage(tmp), /not a file/); // tmp is a directory
  const p = patcher.findAppImage(path.join('tests', '..', 'tests', 'run-tests.mjs'));
  assert.equal(path.isAbsolute(p), true, 'relative AppImage path must be resolved to absolute');
});

test('engine: settings CLI get/set round-trip (against a temp user path)', () => {
  // run `get` — must not crash and must return the default shape
  const res = execFileSync('node', [path.join(SCRIPTS, 'settings.mjs'), 'get'], { encoding: 'utf8' });
  const parsed = JSON.parse(res);
  for (const key of ['enabled', 'fontEnabled', 'fontFamily', 'fontSizeScale', 'fixTables', 'fixLists', 'probe']) {
    assert.ok(key in parsed, 'missing settings key: ' + key);
  }
});

test('patcher: --status returns parseable JSON with full shape', () => {
  const res = execFileSync('node', [path.join(SCRIPTS, 'patch-zcode.mjs'), '--status'], { encoding: 'utf8' });
  const parsed = JSON.parse(res);
  for (const key of ['version', 'extracted', 'patched', 'backup', 'launcher', 'desktopEntry', 'settings']) {
    assert.ok(key in parsed, 'missing status key: ' + key);
  }
  assert.equal(parsed.version, patcher.PLUGIN_VERSION);
});

/* ------------------------------------------------------------------ *
 * 4. real-asar smoke test (optional, when ZCode is running from AppImage)
 * ------------------------------------------------------------------ */

(function tryRealAsar() {
  let candidate;
  for (const mount of fs.readdirSync('/tmp').filter((d) => d.startsWith('.mount_ZCode'))) {
    const p = path.join('/tmp', mount, 'resources', 'app.asar');
    if (fs.existsSync(p)) candidate = p;
  }
  if (!candidate) {
    console.log('  --  real-asar smoke test skipped (no mounted ZCode AppImage)');
    return;
  }
  const { header } = readHeader(candidate);
  assert.ok(header.files['out'].files.renderer.files['index.html'], 'real asar lacks renderer index.html');
  const html = extractFile(candidate, 'out/renderer/index.html').toString('utf8');
  assert.ok(html.includes('</head>'), 'real index.html lacks </head>');
  assert.ok(!html.includes('zcode-rtl-bootstrap'), 'mounted AppImage unexpectedly pre-patched');
  console.log('  ok  real-asar smoke test on ' + candidate);
})();

/* ------------------------------------------------------------------ */

fs.rmSync(tmp, { recursive: true, force: true });
console.log('\n' + passed + ' passed, ' + failures.length + ' failed');
if (failures.length) process.exit(1);
