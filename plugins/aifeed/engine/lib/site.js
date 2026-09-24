'use strict';

const fs = require('node:fs');
const path = require('node:path');
const nodeCrypto = require('node:crypto');
const makoLib = require('./mako');
const makoHtmlLib = require('./mako-html');
const cryptoLib = require('./crypto');
const { sha256Base64, rawDigestOf } = require('./digest');

const DEFAULT_TYPES = ['ecommerce', 'news', 'education', 'government', 'saas', 'portfolio', 'community', 'docs', 'nonprofit', 'personal', 'blog', 'media', 'marketplace', 'other'];
const ASSET_HASH_LIMIT_BYTES = 16 * 1024 * 1024;

function assetDetailsReader(baseDir) {
  const root = path.resolve(baseDir);
  const cache = new Map();
  return (url) => {
    if (cache.has(url)) return cache.get(url);
    let details = null;
    const clean = String(url || '').split('#')[0].split('?')[0];
    if (clean && !/^(https?:)?\/\//i.test(clean) && !/^(data|mailto|javascript):/i.test(clean)) {
      let relative = clean.replace(/^\/+/, '');
      try {
        relative = decodeURIComponent(relative);
      } catch (error) {
        relative = clean.replace(/^\/+/, '');
      }
      const filePath = path.resolve(root, relative);
      if (filePath.startsWith(root + path.sep)) {
        try {
          const stat = fs.statSync(filePath);
          if (stat.isFile() && stat.size <= ASSET_HASH_LIMIT_BYTES) {
            const bytes = fs.readFileSync(filePath);
            details = { size: bytes.length, sha256: sha256Base64(bytes) };
          }
        } catch (error) {
          details = null;
        }
      }
    }
    cache.set(url, details);
    return details;
  };
}

function collectHtmlFiles(dir, results = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      collectHtmlFiles(full, results);
    } else if (entry.name.endsWith('.html') || entry.name.endsWith('.htm')) {
      results.push(full);
    }
  }
  return results;
}

function pagePathFor(relative) {
  const posix = relative.split(path.sep).join('/');
  const stripped = posix.replace(/\.html?$/i, '');
  if (stripped === 'index' || stripped === '') return '/';
  return '/' + stripped.replace(/\/index$/, '');
}

function suffixForProfile(profile) {
  return profile === 'mako' ? '.mako.md' : '.aifeed.md';
}

function mdPathFor(relative, profile = 'aimd') {
  return relative.replace(/\.html?$/i, '') + suffixForProfile(profile);
}

function extractAlternates(html, baseUrl) {
  const items = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    if (!/\brel\s*=\s*"alternate"/i.test(tag)) continue;
    const lang = (tag.match(/\bhreflang\s*=\s*"([^"]+)"/i) || [])[1];
    const href = (tag.match(/\bhref\s*=\s*"([^"]+)"/i) || [])[1];
    if (!lang || !href) continue;
    let url;
    try {
      url = new URL(href, baseUrl).toString();
    } catch (error) {
      continue;
    }
    items.push({ url, lang });
  }
  return items.length > 0 ? items.slice(0, 20) : undefined;
}

function buildManifest(options) {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const content = {
    languages: options.languages,
    profile: options.profile === 'mako' ? 'mako' : options.profile === 'both' ? 'both' : 'aifeed-md',
    index_url: options.profile === 'mako' ? '/.well-known/mako-index.json' : '/.well-known/aifeed-index.json'
  };
  if (options.profile === 'mako' || options.profile === 'both') {
    content.mako = {
      index_url: '/.well-known/mako-index.json',
      signature: 'required',
      overrides: 'restrict-only'
    };
  }
  if (options.llms) content.llms_txt = '/llms.txt';
  const hasSitemap = options.sitemap !== undefined
    ? Boolean(options.sitemap)
    : Boolean(options.dir && fs.existsSync(path.join(options.dir, 'sitemap.xml')));
  if (hasSitemap) content.sitemap = '/sitemap.xml';
  if (options.license && typeof options.license === 'object') content.license = options.license;

  const permissions = {
    default: 'deny',
    usage: {
      search: 'allow',
      retrieval: 'allow',
      input: 'allow',
      training: 'deny',
      quote: 'allow',
      summarize: 'allow',
      reproduce: 'deny',
      translate: 'allow',
      modify: 'deny',
      embed: 'deny',
      commercial_use: 'deny',
      ...((options.permissions && options.permissions.usage) || {})
    },
    attribution: (options.permissions && options.permissions.attribution) || 'required'
  };
  if (options.permissions && options.permissions.attribution_url) {
    permissions.attribution_url = options.permissions.attribution_url;
  }
  if (options.permissions && options.permissions.attribution_text) {
    permissions.attribution_text = options.permissions.attribution_text;
  }

  const manifest = {
    $schema: 'https://aifeed.md/schema/ai-json/v0.2.json',
    version: '0.2',
    identity: {
      domain: options.domain,
      name: options.name,
      type: options.type,
      locale: options.locale,
      contact: options.contact,
      public_key: options.publicKey,
      key_id: options.keyId,
      signature_url: '/.well-known/ai-signature.json'
    },
    validity: {
      signed_at: now,
      expires_at: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
    },
    content,
    permissions,
    limits: {
      requests_per_minute: 60,
      concurrent: 2,
      crawl_delay_seconds: 1,
      ...((options.limits && typeof options.limits === 'object') ? options.limits : {})
    },
    revocation: {
      list_url: 'https://aifeed.md/revoke/v1/' + options.domain + '.json',
      maximum_check_interval_hours: options.maxCheckIntervalHours || 24
    },
    metadata: {
      generated_at: now,
      generated_by: 'aifeed-site/' + require('../package.json').version
    }
  };
  return manifest;
}

function buildSiteIndexEntry(url, mdBytes, frontmatter) {
  const digest = sha256Base64(mdBytes);
  const entry = {
    url,
    type: frontmatter.type || 'custom',
    tokens: frontmatter.tokens || makoHtmlLib.estimateTokens(mdBytes.toString('utf8')),
    updated: typeof frontmatter.updated === 'string' ? frontmatter.updated : new Date().toISOString().slice(0, 10),
    etag: '"aimd-' + digest.slice(0, 22).replace(/[+/=]/g, '') + '"',
    'sha-256': digest
  };
  if (typeof frontmatter.entity === 'string' && frontmatter.entity !== '') entry.title = frontmatter.entity.slice(0, 500);
  if (typeof frontmatter.summary === 'string' && frontmatter.summary !== '') entry.summary = frontmatter.summary.slice(0, 160);
  if (Array.isArray(frontmatter.tags) && frontmatter.tags.length > 0) entry.tags = frontmatter.tags.slice(0, 10);
  if (typeof frontmatter.language === 'string') entry.lang = frontmatter.language;
  if (Array.isArray(frontmatter.related) && frontmatter.related.length > 0) entry.related = frontmatter.related.slice(0, 20);
  if (frontmatter.aifeed && Array.isArray(frontmatter.aifeed.assets) && frontmatter.aifeed.assets.length > 0) {
    entry.assets = frontmatter.aifeed.assets.length;
  }
  return entry;
}

function injectAlternateLink(htmlPath, href, type) {
  let html = fs.readFileSync(htmlPath, 'utf8');
  const marker = '<link rel="alternate" type="' + type + '"';
  if (html.includes(marker)) return false;
  const tag = '<link rel="alternate" type="' + type + '" href="' + href + '">';
  if (html.includes('</head>')) {
    html = html.replace('</head>', tag + '\n</head>');
  } else {
    html = tag + '\n' + html;
  }
  fs.writeFileSync(htmlPath, html, 'utf8');
  return true;
}

function buildSite(options) {
  const dir = path.resolve(options.dir);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error('site directory not found: ' + dir);
  }
  const profile = options.profile === 'mako' || options.profile === 'both' ? options.profile : 'aimd';
  const baseUrl = (options.baseUrl || 'https://' + options.domain).replace(/\/+$/, '');
  const domain = options.domain || new URL(baseUrl).hostname;
  const type = DEFAULT_TYPES.includes(options.type) ? options.type : 'blog';

  const privateKey = nodeCrypto.createPrivateKey(fs.readFileSync(options.keyPath));
  const publicKeyValue = cryptoLib.encodePublicKey(nodeCrypto.createPublicKey(privateKey));
  const fingerprint = cryptoLib.fingerprintOf(nodeCrypto.createPublicKey(privateKey));

  const htmlFiles = collectHtmlFiles(dir);
  if (htmlFiles.length === 0) throw new Error('no HTML files found in ' + dir);

  const warnings = [];
  const pages = [];
  for (const htmlPath of htmlFiles) {
    const relative = path.relative(dir, htmlPath);
    const pagePath = pagePathFor(relative);
    const html = fs.readFileSync(htmlPath, 'utf8');
    const converted = makoHtmlLib.htmlToMako(html, {
      profile: profile === 'both' ? 'both' : profile === 'mako' ? 'mako' : 'aimd',
      canonical: baseUrl + pagePath,
      updated: options.updated,
      alternates: extractAlternates(html, baseUrl),
      assetDetails: assetDetailsReader(dir)
    });
    for (const warning of converted.warnings) warnings.push({ file: relative, ...warning });

    const mdBytes = Buffer.from(converted.text, 'utf8');
    const pageUrl = baseUrl + pagePath;
    const writtenProfiles = profile === 'both' ? ['aimd', 'mako'] : [profile];
    let primaryRelative = null;
    for (const writtenProfile of writtenProfiles) {
      const mdRelative = mdPathFor(relative, writtenProfile);
      const mdFsPath = path.join(dir, mdRelative);
      fs.mkdirSync(path.dirname(mdFsPath), { recursive: true });
      fs.writeFileSync(mdFsPath, converted.text, 'utf8');
      const container = makoLib.signMakoContainer(privateKey, pageUrl, mdBytes, {
        context: writtenProfile,
        signedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
      });
      fs.writeFileSync(mdFsPath + '.sig', JSON.stringify(container, null, 2) + '\n', 'utf8');
      if (primaryRelative === null || writtenProfile === profile) {
        primaryRelative = mdRelative.split(path.sep).join('/');
      }
    }

    if (options.inject) {
      for (const writtenProfile of writtenProfiles) {
        const mdRelative = mdPathFor(relative, writtenProfile).split(path.sep).join('/');
        const mdUrl = baseUrl + '/' + mdRelative;
        injectAlternateLink(htmlPath, mdUrl, writtenProfile === 'mako' ? makoLib.MAKO_MEDIA_TYPE : makoLib.AIMD_MEDIA_TYPE);
      }
    }

    pages.push({
      pagePath,
      md: primaryRelative,
      title: converted.frontmatter.entity,
      tokens: converted.frontmatter.tokens,
      language: converted.frontmatter.language,
      frontmatter: converted.frontmatter,
      bytes: mdBytes
    });
  }

  const wellKnownDir = path.join(dir, '.well-known');
  fs.mkdirSync(wellKnownDir, { recursive: true });

  const index = {
    version: '0.2',
    domain,
    site: {
      name: options.name,
      type,
      languages: [options.locale.split('-')[0].toLowerCase()],
      updated_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
    },
    generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    page: 1,
    page_count: 1,
    entries: pages
      .map((page) => buildSiteIndexEntry(page.pagePath, page.bytes, page.frontmatter))
      .sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0))
  };
  const indexText = JSON.stringify(index, null, 2) + '\n';
  const indexBytes = Buffer.from(indexText, 'utf8');
  const indexContext = profile === 'mako' ? 'mako-index' : 'aimd-index';
  const indexFileName = profile === 'mako' ? 'mako-index.json' : 'aifeed-index.json';
  const indexUrl = baseUrl + '/.well-known/' + indexFileName;
  const indexContainer = makoLib.signMakoContainer(privateKey, indexUrl, indexBytes, { context: indexContext, signedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') });
  fs.writeFileSync(path.join(wellKnownDir, indexFileName), indexText, 'utf8');
  fs.writeFileSync(path.join(wellKnownDir, indexFileName + '.sig'), JSON.stringify(indexContainer, null, 2) + '\n', 'utf8');
  if (profile === 'both') {
    const makoIndexText = JSON.stringify({ ...index }, null, 2) + '\n';
    const makoIndexUrl = baseUrl + '/.well-known/mako-index.json';
    const makoIndexContainer = makoLib.signMakoContainer(privateKey, makoIndexUrl, Buffer.from(makoIndexText, 'utf8'), { context: 'mako-index', signedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') });
    fs.writeFileSync(path.join(wellKnownDir, 'mako-index.json'), makoIndexText, 'utf8');
    fs.writeFileSync(path.join(wellKnownDir, 'mako-index.json.sig'), JSON.stringify(makoIndexContainer, null, 2) + '\n', 'utf8');
  }

  const manifest = buildManifest({
    dir,
    domain,
    name: options.name,
    type,
    locale: options.locale,
    contact: options.contact,
    publicKey: publicKeyValue,
    keyId: options.keyId,
    profile,
    languages: [options.locale.split('-')[0].toLowerCase()],
    llms: options.llms,
    permissions: options.permissions,
    limits: options.limits,
    license: options.license,
    sitemap: options.sitemap,
    maxCheckIntervalHours: options.maxCheckIntervalHours
  });
  const manifestText = JSON.stringify(manifest, null, 2) + '\n';
  const manifestBytes = Buffer.from(manifestText, 'utf8');
  const manifestSignature = {
    algorithm: 'ed25519',
    canonicalization: 'jcs-rfc8785',
    signature: cryptoLib.encodeSignature(cryptoLib.signManifest(privateKey, manifest)),
    raw_digest: rawDigestOf(manifestBytes)
  };
  fs.writeFileSync(path.join(wellKnownDir, 'ai.json'), manifestText, 'utf8');
  fs.writeFileSync(path.join(wellKnownDir, 'ai-signature.json'), JSON.stringify(manifestSignature, null, 2) + '\n', 'utf8');

  let llmsPath = null;
  if (options.llms) {
    const lines = ['# ' + options.name, ''];
    lines.push('> ' + (options.description || 'AI-ready content published with AIFeed.'), '');
    lines.push('## Pages', '');
    for (const page of index.entries) {
      const summary = page.summary ? ': ' + page.summary : '';
      lines.push('- [' + (page.title || page.url) + '](' + baseUrl + page.url + ')' + summary);
    }
    lines.push('', '## Metadata', '', '- AIFeed manifest: ' + baseUrl + '/.well-known/ai.json', '');
    llmsPath = path.join(dir, 'llms.txt');
    fs.writeFileSync(llmsPath, lines.join('\n'), 'utf8');
  }

  return {
    dir,
    profile,
    domain,
    baseUrl,
    fingerprint,
    pages: pages.map((page) => ({ url: page.pagePath, md: page.md, tokens: page.tokens })),
    index: path.join(wellKnownDir, indexFileName),
    manifest: path.join(wellKnownDir, 'ai.json'),
    llms: llmsPath,
    warnings
  };
}

module.exports = { buildSite, buildManifest, buildSiteIndexEntry, assetDetailsReader, collectHtmlFiles, pagePathFor, mdPathFor, extractAlternates };
