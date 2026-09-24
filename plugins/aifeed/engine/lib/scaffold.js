'use strict';

const fs = require('node:fs');
const path = require('node:path');
const cryptoLib = require('./crypto');
const { rawDigestOf } = require('./digest');
const { serialize } = require('./jcs');

const VERSION = '1.0.0-draft';

const PROFILES = {
  blog: { type: 'blog', usage: ['search', 'retrieval', 'input', 'quote', 'summarize'], attribution: 'required' },
  news: { type: 'news', usage: ['search', 'retrieval', 'input', 'quote', 'summarize', 'translate'], attribution: 'required' },
  ecommerce: { type: 'ecommerce', usage: ['search', 'retrieval', 'input', 'quote', 'summarize', 'translate', 'embed'], attribution: 'required' },
  marketplace: { type: 'marketplace', usage: ['search', 'retrieval', 'input', 'quote', 'summarize', 'translate', 'embed'], attribution: 'required' },
  government: { type: 'government', usage: ['search', 'retrieval', 'input', 'quote', 'summarize', 'reproduce', 'translate', 'embed'], attribution: 'optional' },
  open: { type: 'blog', usage: ['search', 'retrieval', 'input', 'quote', 'summarize', 'translate', 'embed'], attribution: 'optional' },
  restrictive: { type: 'other', usage: ['search'], attribution: 'required' }
};

const USAGE_KEYS = [
  'search', 'retrieval', 'input', 'training', 'quote',
  'summarize', 'reproduce', 'translate', 'modify', 'embed', 'commercial_use'
];

function isoSecond(date) {
  return new Date(date).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function buildManifest(options) {
  const {
    domain,
    profile = 'blog',
    publicKey,
    keyId,
    name,
    organization,
    contact,
    locale = 'en',
    sitemap = '/sitemap.xml',
    llmsTxt = '/llms.txt',
    now = new Date()
  } = options;

  const preset = PROFILES[profile] || PROFILES.blog;
  const usage = {};
  for (const key of USAGE_KEYS) {
    usage[key] = preset.usage.includes(key) ? 'allow' : 'deny';
  }

  const expires = new Date(now.getTime());
  expires.setUTCFullYear(expires.getUTCFullYear() + 1);

  const manifest = {
    version: '0.1',
    identity: {
      domain,
      name: name || domain,
      type: preset.type,
      locale,
      contact: contact || 'mailto:admin@' + domain,
      public_key: publicKey,
      key_id: keyId || 'aifeed-' + new Date(now).getUTCFullYear() + '-key1',
      signature_url: '/.well-known/ai-signature.json'
    },
    validity: {
      signed_at: isoSecond(now),
      expires_at: isoSecond(expires)
    },
    content: {
      llms_txt: llmsTxt,
      sitemap,
      languages: [String(locale).split('-')[0].toLowerCase()]
    },
    permissions: {
      default: 'deny',
      usage,
      attribution: preset.attribution
    },
    limits: {
      requests_per_minute: 60,
      concurrent: 2,
      crawl_delay_seconds: 1
    },
    revocation: {
      list_url: 'https://aifeed.md/revoke/v1/' + domain + '.json',
      maximum_check_interval_hours: 24
    },
    metadata: {
      generated_at: isoSecond(now),
      generated_by: 'aifeed-cli/' + VERSION
    }
  };

  if (organization) {
    manifest.identity.organization = organization;
  }
  return manifest;
}

function setupGuide(options) {
  const { domain, publicKey, fingerprint } = options;
  const dns = 'v=aifeed1; pk=' + publicKey + '; fp=' + fingerprint + '; manifest=https://' + domain + '/.well-known/ai.json';
  return [
    'AIFeed setup — ' + domain,
    '='.repeat(48),
    '',
    'AIFeed uses ONE manifest per origin. A site with thousands or millions of pages',
    'still publishes a single /.well-known/ai.json. No per-page work is required.',
    '',
    '1) Publish these files at the origin root:',
    '   .well-known/ai.json',
    '   .well-known/ai-signature.json',
    '   (recommended) .well-known/ai.txt  — human-readable, non-normative',
    '',
    '2) Add this DNS TXT record (strong verification):',
    '   Name : _aifeed.' + domain,
    '   Type : TXT',
    '   Value: "' + dns + '"',
    '',
    '3) Serve with correct headers:',
    '   Content-Type: application/json; charset=utf-8',
    '   Cache-Control: public, max-age=3600, must-revalidate',
    "   Link: </.well-known/ai.json>; rel=\"ai-feed\"; type=\"application/json\"",
    '',
    '   nginx:',
    '     location = /.well-known/ai.json {',
    '       default_type application/json;',
    '       add_header Link \'</.well-known/ai.json>; rel="ai-feed"; type="application/json"\' always;',
    '     }',
    '',
    '   Apache (.htaccess):',
    '     <Files "ai.json">',
    '       Header set Link \'</.well-known/ai.json>; rel="ai-feed"; type="application/json"\'',
    '     </Files>',
    '',
    '4) Re-sign before expiry (recommended: every 6-11 months) and after any change:',
    '   aifeed sign ./.well-known/ai.json',
    '',
    '5) Validate:',
    '   aifeed validate ' + domain,
    ''
  ].join('\n');
}

function initSite(options) {
  const { dir, domain, profile = 'blog', force = false, now = new Date() } = options;
  if (!dir) throw new Error('dir is required');
  if (!domain) throw new Error('domain is required');

  const target = path.resolve(dir);
  const privatePath = path.join(target, 'aifeed-private.pem');
  if (fs.existsSync(privatePath) && !force) {
    const error = new Error('refusing to overwrite existing key at ' + privatePath + ' (use --force)');
    error.code = 'key_exists';
    throw error;
  }

  fs.mkdirSync(path.join(target, '.well-known'), { recursive: true });

  const { privateKey, publicKey } = cryptoLib.generateKeyPair();
  const publicKeyValue = cryptoLib.encodePublicKey(publicKey);
  const fingerprint = cryptoLib.fingerprintOf(publicKey);
  fs.writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  fs.writeFileSync(path.join(target, 'aifeed-public.txt'), publicKeyValue + '\n' + fingerprint + '\n');

  const manifest = buildManifest({
    domain,
    profile,
    publicKey: publicKeyValue,
    keyId: options.keyId,
    name: options.name,
    organization: options.organization,
    contact: options.contact,
    locale: options.locale,
    now
  });
  const manifestText = JSON.stringify(manifest, null, 2) + '\n';
  const signatureBytes = cryptoLib.signManifest(privateKey, manifest);
  const container = {
    algorithm: 'ed25519',
    canonicalization: 'jcs-rfc8785',
    signature: cryptoLib.encodeSignature(signatureBytes),
    raw_digest: rawDigestOf(Buffer.from(manifestText, 'utf8'))
  };
  const signatureText = JSON.stringify(container, null, 2) + '\n';

  const manifestPath = path.join(target, '.well-known', 'ai.json');
  const signaturePath = path.join(target, '.well-known', 'ai-signature.json');
  fs.writeFileSync(manifestPath, manifestText);
  fs.writeFileSync(signaturePath, signatureText);
  fs.writeFileSync(path.join(target, 'aifeed-setup.txt'), setupGuide({ domain, publicKey: publicKeyValue, fingerprint }));

  return {
    dir: target,
    profile,
    publicKey: publicKeyValue,
    fingerprint,
    privateKeyPath: privatePath,
    manifestPath,
    signaturePath,
    setupPath: path.join(target, 'aifeed-setup.txt'),
    canonicalBytes: serialize(manifest).length
  };
}

module.exports = { PROFILES, USAGE_KEYS, buildManifest, initSite, setupGuide, VERSION };
