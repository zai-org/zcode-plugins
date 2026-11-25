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

/** 取从 openIndex 处的 `{` 匹配到的整块内容(忽略字符串里的括号,够用)。 */
function blockAt(text, openIndex) {
  let depth = 0;
  let quote = '';
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(openIndex + 1, i);
    }
  }
  return text.slice(openIndex + 1);
}

/** 静态读取 module 的 productFlavors(渠道插件也会注册 flavor,这里一并识别)。 */
function discoverFlavors(root, module) {
  if (!root) return [];
  const dir = moduleDirectory(root, module);
  const text = read(path.join(dir, 'build.gradle')) + '\n' + read(path.join(dir, 'build.gradle.kts'));
  const names = new Set();
  const blockRe = /productFlavors\s*\{/g;
  let match;
  while ((match = blockRe.exec(text)) !== null) {
    const block = blockAt(text, blockRe.lastIndex - 1);
    for (const item of block.matchAll(/^\s*([A-Za-z_][\w]*)\s*(?:\{|$)/gm)) {
      const name = item[1];
      if (['configureEach', 'all', 'create', 'register', 'maybeCreate', 'each'].includes(name)) continue;
      names.add(name);
    }
    for (const item of block.matchAll(/(?:create|register|maybeCreate)\s*\(\s*['"]([\w]+)['"]/g)) names.add(item[1]);
  }
  // 静态解析可能遇到循环/create(变量) 等动态写法:从已构建的输出目录反推 flavor
  const apkRoot = path.join(dir, 'build', 'outputs', 'apk');
  const skip = new Set(['debug', 'release', 'androidtest', 'test', 'rebuildchannel', 'channel', 'outputs']);
  try {
    for (const entry of fs.readdirSync(apkRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (skip.has(entry.name.toLowerCase())) continue;
      let looksLikeFlavor = false;
      try {
        looksLikeFlavor = fs.readdirSync(path.join(apkRoot, entry.name), { withFileTypes: true })
          .some((sub) => sub.isDirectory() && /^(debug|release)/i.test(sub.name));
      } catch (_) { /* 空目录 */ }
      if (!looksLikeFlavor) {
        try {
          looksLikeFlavor = fs.readdirSync(path.join(apkRoot, entry.name)).some((file) => /\.apk$/i.test(file));
        } catch (_) { /* 忽略 */ }
      }
      if (looksLikeFlavor) names.add(entry.name);
    }
  } catch (_) { /* 还没有构建产物 */ }
  return Array.from(names).sort();
}

/** 是否存在 flavor 配置(即使名字没解析出来,也绝不能退化成 assembleDebug 全渠道构建)。 */
function hasFlavorConfig(root, module) {
  if (!root) return false;
  const dir = moduleDirectory(root, module);
  const text = read(path.join(dir, 'build.gradle')) + '\n' + read(path.join(dir, 'build.gradle.kts'));
  return /productFlavors\s*\{|flavorDimensions\b/.test(text);
}

function findApk(root, module, variant, explicit, flavor, options) {
  const plainOnly = !!(options && options.plainOnly);
  if (!root) return null;
  if (explicit) return { path: path.resolve(root, explicit), applicationId: '' };
  const base = path.join(moduleDirectory(root, module), 'build', 'outputs', 'apk');
  const variantLower = variant.toLowerCase();
  const flavorLower = (flavor || '').toLowerCase();
  const variants = flavorLower
    ? new Set([`${flavorLower}${variantLower}`])
    : new Set([variantLower]);
  const matchesVariant = (name) => {
    const value = String(name || '').toLowerCase();
    if (variants.has(value)) return true;
    if (plainOnly) return false;
    // 没有 flavor 信息时,允许 <flavor><variant> 这种 AGP 命名
    return !flavorLower && value.endsWith(variantLower);
  };
  const candidates = [];
  function visit(dir, depth) {
    if (depth > 4) return;
    const metadata = read(path.join(dir, 'output-metadata.json'));
    if (metadata) {
      try {
        const data = JSON.parse(metadata);
        if (matchesVariant(data.variantName)) {
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
    // AGP 3.x 使用 output.json(数组),没有 output-metadata.json
    const legacy = read(path.join(dir, 'output.json'));
    if (legacy) {
      try {
        const list = JSON.parse(legacy);
        for (const item of Array.isArray(list) ? list : []) {
          const data = (item && item.apkData) || {};
          if (!matchesVariant(data.fullName || data.baseName)) continue;
          const relative = item.path || data.outputFile || '';
          if (!relative || !/\.apk$/i.test(relative)) continue;
          const file = path.resolve(dir, relative);
          if (!file.startsWith(base + path.sep)) continue;
          try {
            const stat = fs.statSync(file);
            if (stat.isFile()) candidates.push({ path: file, applicationId: '', universal: !(data.splits || []).length, modifiedAt: stat.mtimeMs });
          } catch (_) { /* 构建中间态 */ }
        }
      } catch (_) { /* 不完整的 output.json */ }
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

  // 目录回退:有 flavor 时严格限定在 <flavor> 下,避免拿到旧的、无 flavor 的包
  const flavorName = flavor || '';
  const dirs = [];
  if (flavorName) {
    dirs.push(path.join(base, flavorName, variantLower));
    dirs.push(path.join(base, flavorName));
  } else {
    dirs.push(path.join(base, variantLower));
  }
  const mtime = (file) => {
    try { return fs.statSync(file).mtimeMs; } catch (_) { return 0; }
  };
  for (const dir of dirs) {
    try {
      const apks = fs.readdirSync(dir).filter((file) => /\.apk$/i.test(file)).map((file) => path.join(dir, file));
      apks.sort((a, b) => mtime(b) - mtime(a));
      if (apks.length) return { path: apks[0], applicationId: '' };
    } catch (_) { /* 继续找下一个布局 */ }
  }

  if (plainOnly) {
    return { path: path.join(base, variantLower, `${module.split(':').pop()}-${variantLower}.apk`), applicationId: '' };
  }

  // 兜底:channel 重建或自定义输出目录;有 flavor 时只认带 flavor 的路径
  const loose = [];
  (function walk(current, depth) {
    if (depth > 4) return;
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (/\.apk$/i.test(entry.name)) {
        let stat;
        try { stat = fs.statSync(full); } catch (_) { continue; }
        if (!stat.isFile()) continue;
        const lower = full.toLowerCase();
        if (flavorLower && !lower.includes(flavorLower)) continue;
        loose.push({
          path: full,
          modifiedAt: stat.mtimeMs,
          matchesVariant: lower.includes(variantLower)
        });
      }
    }
  })(base, 0);
  if (loose.length) {
    loose.sort((a, b) => Number(b.matchesVariant) - Number(a.matchesVariant) || b.modifiedAt - a.modifiedAt);
    return { path: loose[0].path, applicationId: '', loose: true };
  }
  const expectedDir = flavorLower
    ? path.join(base, flavorLower, variantLower)
    : path.join(base, variantLower);
  const expectedName = flavorLower
    ? `${module.split(':').pop()}-${flavorLower}-${variantLower}.apk`
    : `${module.split(':').pop()}-${variantLower}.apk`;
  return { path: path.join(expectedDir, expectedName), applicationId: '' };
}

function apkInfo(candidate) {
  if (!candidate) return null;
  try {
    const stat = fs.statSync(candidate.path);
    return stat.isFile() ? { path: candidate.path, name: path.basename(candidate.path), size: stat.size, modifiedAt: stat.mtimeMs } : null;
  } catch (_) { return null; }
}

module.exports = { discoverModules, discoverFlavors, hasFlavorConfig, moduleDirectory, findApk, apkInfo };
