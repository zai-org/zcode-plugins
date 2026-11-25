'use strict';

const fs = require('fs');
const path = require('path');

function read(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch (_) { return ''; }
}

function settingsText(root) {
  return (read(path.join(root, 'settings.gradle')) + '\n' + read(path.join(root, 'settings.gradle.kts')))
    .replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
}

function moduleDirectory(root, module) {
  const text = settingsText(root);
  const mappings = /project\s*\(\s*['"]([^'"]+)['"]\s*\)\.projectDir\s*=\s*(?:new\s+File\s*\(\s*(?:rootDir|settingsDir)\s*,|file\s*\()\s*['"]([^'"]+)['"]/g;
  for (const match of text.matchAll(mappings)) {
    if (match[1].replace(/^:/, '') === module.replace(/^:/, '')) return path.resolve(root, match[2]);
  }
  return path.join(root, ...module.replace(/^:/, '').split(':'));
}

/** Static discovery avoids executing Gradle just to draw a selector. */
function discoverModules(root, configured = 'app') {
  if (!root) return [configured];
  const candidates = new Set([configured]);
  let declared = false;
  for (const include of settingsText(root).matchAll(/\binclude\s*(?:\(([^)]*)\)|([^\n;]+))/g)) {
    for (const match of (include[1] || include[2] || '').matchAll(/['"](:?[\w:.-]+)['"]/g)) {
      candidates.add(match[1].replace(/^:/, ''));
      declared = true;
    }
  }
  try {
    for (const entry of declared ? [] : fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) candidates.add(entry.name);
    }
  } catch (_) { /* root may have been removed */ }
  return Array.from(candidates).filter((module) => {
    if (module === configured) return true;
    const dir = moduleDirectory(root, module);
    const source = read(path.join(dir, 'build.gradle')) + read(path.join(dir, 'build.gradle.kts'));
    return /com\.android\.application|libs\.plugins\.android\.application|\bapplicationId\b/.test(source);
  }).sort((a, b) => a.localeCompare(b));
}

function findApk(root, module, variant, explicit) {
  if (!root) return null;
  if (explicit) return { path: path.resolve(root, explicit), applicationId: '' };
  const base = path.join(moduleDirectory(root, module), 'build', 'outputs', 'apk');
  const candidates = [];
  function visit(dir, depth) {
    if (depth > 4) return;
    const metadata = read(path.join(dir, 'output-metadata.json'));
    if (metadata) {
      try {
        const data = JSON.parse(metadata);
        if (String(data.variantName).toLowerCase() === variant.toLowerCase()) {
          for (const element of data.elements || []) {
            if (!element.outputFile || !/\.apk$/i.test(element.outputFile)) continue;
            const file = path.resolve(dir, element.outputFile);
            if (!file.startsWith(base + path.sep)) continue;
            try {
              const stat = fs.statSync(file);
              if (stat.isFile()) candidates.push({ path: file, applicationId: data.applicationId || '', universal: !(element.filters || []).length, modifiedAt: stat.mtimeMs });
            } catch (_) { /* Gradle may be replacing outputs while the sidebar refreshes. */ }
          }
        }
      } catch (_) { /* incomplete metadata during build */ }
    }
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) visit(path.join(dir, entry.name), depth + 1);
      }
    } catch (_) { /* not built yet */ }
  }
  visit(base, 0);
  if (candidates.length) {
    candidates.sort((a, b) => Number(b.universal) - Number(a.universal) || b.modifiedAt - a.modifiedAt);
    return candidates[0];
  }
  const dir = path.join(base, variant);
  try {
    const apks = fs.readdirSync(dir).filter((file) => /\.apk$/i.test(file)).map((file) => path.join(dir, file));
    apks.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    if (apks.length) return { path: apks[0], applicationId: '' };
  } catch (_) { /* missing output */ }
  return { path: path.join(dir, module.split(':').pop() + '-' + variant + '.apk'), applicationId: '' };
}

function apkInfo(candidate) {
  if (!candidate) return null;
  try {
    const stat = fs.statSync(candidate.path);
    return stat.isFile() ? { path: candidate.path, name: path.basename(candidate.path), size: stat.size, modifiedAt: stat.mtimeMs } : null;
  } catch (_) { return null; }
}

module.exports = { discoverModules, moduleDirectory, findApk, apkInfo };
