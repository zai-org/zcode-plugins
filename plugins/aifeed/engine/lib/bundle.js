'use strict';

const fs = require('node:fs');
const path = require('node:path');
const nodeCrypto = require('node:crypto');
const cryptoLib = require('./crypto');
const { parseStrict } = require('./parse');
const { sha256Base64 } = require('./digest');
const { verifyAll } = require('./validate');

const BUNDLE_VERSION = '0.1';
const BUNDLE_STALE_HOURS = 168;

function isoSecond(date) {
  return new Date(date).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function fileEntry(rootDir, relativePath) {
  const bytes = fs.readFileSync(path.join(rootDir, relativePath));
  return {
    path: relativePath,
    'sha-256': sha256Base64(bytes),
    size: bytes.length
  };
}

function createBundle(options) {
  const {
    sourceDir,
    outDir,
    domain,
    privateKey = null,
    keyId = null,
    revocationFile = null,
    now = new Date()
  } = options;

  const createdAt = isoSecond(now);
  const manifestDir = path.join(outDir, 'manifest');
  fs.mkdirSync(manifestDir, { recursive: true });
  fs.mkdirSync(path.join(outDir, 'governance'), { recursive: true });
  fs.mkdirSync(path.join(outDir, 'revocation'), { recursive: true });

  fs.copyFileSync(path.join(sourceDir, 'ai.json'), path.join(manifestDir, 'ai.json'));
  fs.copyFileSync(path.join(sourceDir, 'ai-signature.json'), path.join(manifestDir, 'ai-signature.json'));
  fs.writeFileSync(
    path.join(manifestDir, 'fetch-metadata.json'),
    JSON.stringify({
      url: 'https://' + domain + '/.well-known/ai.json',
      fetched_at: createdAt,
      source: 'local-bundle',
      content_digest: null,
      tls_fingerprint: null
    }, null, 2) + '\n'
  );

  const files = [
    fileEntry(outDir, 'manifest/ai.json'),
    fileEntry(outDir, 'manifest/ai-signature.json'),
    fileEntry(outDir, 'manifest/fetch-metadata.json')
  ];

  if (revocationFile) {
    const target = path.join('revocation', domain + '.json');
    fs.copyFileSync(revocationFile, path.join(outDir, target));
    files.push(fileEntry(outDir, target));
  }

  const bundleManifest = {
    version: BUNDLE_VERSION,
    created_at: createdAt,
    domain,
    files
  };

  if (privateKey) {
    const signatureBytes = cryptoLib.signBundle(privateKey, bundleManifest);
    bundleManifest.bundler = {
      fingerprint: cryptoLib.fingerprintOf(nodeCrypto.createPublicKey(privateKey)),
      key_id: keyId,
      algorithm: 'ed25519',
      signature: cryptoLib.encodeSignature(signatureBytes)
    };
  }

  fs.writeFileSync(
    path.join(outDir, 'BUNDLE-MANIFEST.json'),
    JSON.stringify(bundleManifest, null, 2) + '\n'
  );
  return bundleManifest;
}

function verifyBundle(options) {
  const { bundleDir, now = new Date(), bundlerPublicKeyValue = null } = options;
  const errors = [];
  const warnings = [];

  let bundleManifest;
  try {
    bundleManifest = parseStrict(
      fs.readFileSync(path.join(bundleDir, 'BUNDLE-MANIFEST.json'), 'utf8'),
      { integersOnly: true }
    );
  } catch (error) {
    return {
      result: 'UNVERIFIED',
      errors: [{ code: error.code || 'bundle_manifest_invalid', message: error.message }],
      warnings,
      files: 0,
      created_at: null,
      age_hours: null
    };
  }

  if (!Array.isArray(bundleManifest.files) || typeof bundleManifest.domain !== 'string' || typeof bundleManifest.created_at !== 'string') {
    return {
      result: 'UNVERIFIED',
      errors: [{ code: 'bundle_manifest_invalid', message: 'missing required bundle manifest fields' }],
      warnings,
      files: 0,
      created_at: null,
      age_hours: null
    };
  }

  for (const entry of bundleManifest.files) {
    if (!entry || typeof entry.path !== 'string' || typeof entry['sha-256'] !== 'string') {
      errors.push({ code: 'bundle_manifest_invalid', message: 'invalid file entry in bundle manifest' });
      continue;
    }
    if (path.isAbsolute(entry.path) || entry.path.split(path.sep).includes('..') || entry.path.split('/').includes('..')) {
      errors.push({ code: 'bundle_manifest_invalid', message: 'unsafe file path in bundle manifest: ' + entry.path });
      continue;
    }
    const resolved = path.resolve(bundleDir, entry.path);
    const root = path.resolve(bundleDir) + path.sep;
    if (!resolved.startsWith(root)) {
      errors.push({ code: 'bundle_manifest_invalid', message: 'file path escapes bundle directory: ' + entry.path });
      continue;
    }
    try {
      const bytes = fs.readFileSync(resolved);
      if (typeof entry.size === 'number' && bytes.length !== entry.size) {
        errors.push({ code: 'bundle_file_mismatch', message: 'size mismatch for ' + entry.path });
      }
      if (sha256Base64(bytes) !== entry['sha-256']) {
        errors.push({ code: 'bundle_file_mismatch', message: 'sha-256 mismatch for ' + entry.path });
      }
    } catch (error) {
      errors.push({ code: 'bundle_file_missing', message: 'cannot read ' + entry.path + ': ' + error.message });
    }
  }

  if (bundleManifest.bundler) {
    if (bundlerPublicKeyValue) {
      try {
        const publicKey = cryptoLib.decodePublicKey(bundlerPublicKeyValue);
        const { bundler, ...signedManifest } = bundleManifest;
        const signatureBytes = cryptoLib.decodeSignature(bundler.signature);
        if (!cryptoLib.verifyBundle(publicKey, signedManifest, signatureBytes)) {
          errors.push({ code: 'bundle_signature_invalid', message: 'bundler signature verification failed' });
        }
      } catch (error) {
        errors.push({ code: 'bundle_signature_invalid', message: error.message });
      }
    } else {
      warnings.push({ code: 'bundle_signature_unverified', message: 'bundler public key not provided; signature not checked' });
    }
  } else {
    warnings.push({ code: 'bundle_unsigned', message: 'bundle has no bundler signature' });
  }

  let manifestResult = null;
  try {
    const manifestPath = path.join(bundleDir, 'manifest', 'ai.json');
    manifestResult = verifyAll({
      manifestText: fs.readFileSync(manifestPath, 'utf8'),
      manifestBytes: fs.readFileSync(manifestPath),
      signatureText: fs.readFileSync(path.join(bundleDir, 'manifest', 'ai-signature.json'), 'utf8'),
      domain: bundleManifest.domain,
      now
    });
    errors.push(...manifestResult.errors);
    warnings.push(...manifestResult.warnings);
  } catch (error) {
    errors.push({ code: 'bundle_manifest_missing', message: error.message });
  }

  const createdAt = Date.parse(bundleManifest.created_at);
  const ageHours = Number.isFinite(createdAt) ? Math.max(0, (now.getTime() - createdAt) / 3600000) : null;
  if (ageHours !== null && ageHours > BUNDLE_STALE_HOURS && errors.length === 0) {
    errors.push({
      code: 'bundle_stale',
      message: 'bundle is older than ' + BUNDLE_STALE_HOURS + ' hours; trust reduced'
    });
  }

  return {
    result: errors.length === 0 ? 'VERIFIED' : 'UNVERIFIED',
    errors,
    warnings,
    files: bundleManifest.files.length,
    created_at: bundleManifest.created_at,
    age_hours: ageHours === null ? null : Math.round(ageHours * 100) / 100,
    manifest_result: manifestResult ? manifestResult.result : null
  };
}

module.exports = { BUNDLE_VERSION, BUNDLE_STALE_HOURS, createBundle, verifyBundle };
