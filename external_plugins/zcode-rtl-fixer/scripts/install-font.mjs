// Install a Persian font system-wide (~/.fonts) so the RTL engine can use it.
//
// Usage:
//   node install-font.mjs                    # default: Vazirmatn (latest release)
//   node install-font.mjs --url <woff2/ttf>  # any direct font URL
//   node install-font.mjs --name <family> --url <url>
//
// After installing, settings.fontFamily should include the family name and the
// app must be re-patched (node patch-zcode.mjs) for the baked CSS to pick it up.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const VAZIRMATN_RELEASE = 'https://api.github.com/repos/rastikerdar/vazirmatn/releases/latest';

function log(m) { console.log('[rtl-fixer/font] ' + m); }
function fail(m) { console.error('[rtl-fixer/font][FAIL] ' + m); process.exit(1); }

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function latestVazirmatnUrl() {
  const res = await fetch(VAZIRMATN_RELEASE, { headers: { 'User-Agent': 'zcode-rtl-fixer' } });
  if (!res.ok) fail(`cannot query Vazirmatn release: HTTP ${res.status}`);
  const data = await res.json();
  const asset = (data.assets || []).find((a) => /fonts?-(ttf|webfonts)\.zip$/i.test(a.name)) ||
    (data.assets || []).find((a) => a.name.endsWith('.zip'));
  if (!asset) fail('no font asset found in Vazirmatn release');
  return asset.browser_download_url;
}

const url = arg('--url') || (await latestVazirmatnUrl());
const fontsDir = path.join(os.homedir(), '.fonts');
fs.mkdirSync(fontsDir, { recursive: true });

log('downloading ' + url);
const res = await fetch(url);
if (!res.ok) fail(`download failed: HTTP ${res.status}`);
const buf = Buffer.from(await res.arrayBuffer());

const tmp = fs.mkdtempSync('/tmp/zcode-rtl-font-');
let baseName;
try {
  baseName = path.basename(decodeURIComponent(new URL(url).pathname)) || 'font.bin';
} catch {
  baseName = 'font.bin'; // invalid URL / opaque path — keep a safe name
}
if (!/^[\w.\- ]+$/.test(baseName)) baseName = 'font.bin'; // no path tricks into ~/.fonts
const file = path.join(tmp, baseName);
fs.writeFileSync(file, buf);

let count = 0;
if (file.endsWith('.zip')) {
  execFileSync('unzip', ['-o', file, '-d', tmp + '/unzipped'], { stdio: 'ignore' });
  const fonts = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ttf|otf|woff2?)$/i.test(e.name)) fonts.push(p);
    }
  };
  walk(tmp + '/unzipped');
  for (const f of fonts) {
    fs.copyFileSync(f, path.join(fontsDir, path.basename(f)));
    count++;
  }
} else if (/\.(ttf|otf|woff2?)$/i.test(file)) {
  fs.copyFileSync(file, path.join(fontsDir, path.basename(file)));
  count = 1;
} else {
  fail('unsupported font file type: ' + file);
}

fs.rmSync(tmp, { recursive: true, force: true });
log(`installed ${count} font file(s) into ${fontsDir}`);

try {
  execFileSync('fc-cache', ['-f', fontsDir], { stdio: 'ignore' });
  log('font cache refreshed (fc-cache)');
} catch {
  log('fc-cache not available — font will be picked up on next session');
}

try {
  const out = execFileSync('fc-list', { encoding: 'utf8' });
  const families = [...new Set(
    out.split('\n').filter((l) => /vazir|iransans|sahel|shabnam|naskh/i.test(l))
      .map((l) => l.split(':')[1]?.trim()).filter(Boolean)
  )];
  if (families.length) log('detected families: ' + families.join(', '));
} catch { /* ignore */ }
