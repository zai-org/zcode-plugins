'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { domainToASCII } = require('node:url');
const { parseStrict, StrictParseError } = require('./parse');
const { validate: validateSchema } = require('./schema');
const {
  decodePublicKey,
  decodeSignature,
  verifyManifest,
  manifestFamily,
  PK_PATTERN
} = require('./crypto');
const { verifyRawDigest } = require('./digest');
const rotationLib = require('./rotation');

const manifestSchema01 = require('../schema/ai-json.v0.1.json');
const manifestSchema02 = require('../schema/ai-json.v0.2.json');
const signatureSchema = require('../schema/ai-signature.v0.1.json');

const SKEW_SECONDS = 300;
const MAX_CHECK_INTERVAL_HOURS = 168;

function canonicalRevocationUrl(domain) {
  return 'https://aifeed.md/revoke/v1/' + domain + '.json';
}

function normalizeDomain(input) {
  if (typeof input !== 'string') return null;
  let domain = input.trim().toLowerCase();
  if (domain.endsWith('.')) domain = domain.slice(0, -1);
  if (domain.length === 0 || domain.length > 253) return null;
  if (domain.includes('/') || domain.includes(':') || domain.includes(' ') || domain.includes('@')) return null;
  let ascii;
  try {
    ascii = domainToASCII(domain);
  } catch (domainError) {
    return null;
  }
  if (!ascii || ascii.length === 0 || ascii.length > 253) return null;
  const labels = ascii.toLowerCase().split('.');
  if (labels.some((label) => label.length === 0 || label.length > 63 || label.startsWith('-') || label.endsWith('-'))) {
    return null;
  }
  return ascii.toLowerCase();
}

function checkManifest(manifest, options = {}) {
  const errors = [];
  const warnings = [];

  const version = manifest && typeof manifest === 'object' && !Array.isArray(manifest) ? manifest.version : null;
  const family = manifestFamily(version);
  if (family === null) {
    errors.push({
      code: 'upgrade_required',
      message: 'unsupported manifest version: ' + String(version) + ' (supported: 0.1.x, 0.2.x)'
    });
    return { errors, warnings, publicKey: null, manifestDomain: null, family: null };
  }
  const schema = family === '0.2' ? manifestSchema02 : manifestSchema01;
  const schemaErrors = validateSchema(manifest, schema);
  for (const error of schemaErrors) {
    errors.push({ code: 'schema_violation', path: error.path, message: error.message });
  }
  if (errors.length > 0) return { errors, warnings, publicKey: null, manifestDomain: null, family };

  const expectedDomain = options.domain ? normalizeDomain(options.domain) : null;
  const manifestDomain = normalizeDomain(manifest.identity.domain);
  if (expectedDomain && manifestDomain !== expectedDomain) {
    errors.push({
      code: 'domain_mismatch',
      message: 'manifest domain "' + manifestDomain + '" does not match expected "' + expectedDomain + '"'
    });
  }

  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const signedAt = Date.parse(manifest.validity.signed_at);
  const expiresAt = Date.parse(manifest.validity.expires_at);
  if (Number.isNaN(signedAt) || Number.isNaN(expiresAt)) {
    errors.push({ code: 'schema_violation', message: 'invalid validity timestamps' });
  } else {
    if (signedAt > now.getTime() + SKEW_SECONDS * 1000) {
      errors.push({ code: 'validity_not_yet_valid', message: 'signed_at is too far in the future' });
    }
    if (expiresAt <= now.getTime()) {
      errors.push({ code: 'expired', message: 'manifest has expired' });
    }
    if (expiresAt <= signedAt) {
      errors.push({ code: 'validity_order', message: 'expires_at must be after signed_at' });
    }
  }

  const rotationCheck = rotationLib.validateDirective(manifest, now);
  errors.push(...rotationCheck.errors);
  warnings.push(...rotationCheck.warnings);

  const expectedRevocation = canonicalRevocationUrl(manifestDomain);
  if (manifest.revocation.list_url !== expectedRevocation) {
    warnings.push({
      code: 'revocation_url_mismatch',
      message: 'list_url should be ' + expectedRevocation + '; clients use the canonical URL regardless'
    });
  }
  if (manifest.revocation.maximum_check_interval_hours > MAX_CHECK_INTERVAL_HOURS) {
    warnings.push({
      code: 'check_interval_capped',
      message: 'maximum_check_interval_hours above ' + MAX_CHECK_INTERVAL_HOURS + ' is ignored by clients'
    });
  }

  let publicKey = null;
  if (!PK_PATTERN.test(manifest.identity.public_key)) {
    errors.push({ code: 'pk_format', message: 'invalid public key encoding' });
  } else {
    try {
      publicKey = decodePublicKey(manifest.identity.public_key);
    } catch (error) {
      errors.push({ code: 'pk_format', message: error.message });
    }
  }

  return { errors, warnings, publicKey, manifestDomain, family };
}

function checkSignatureContainer(signature) {
  const errors = [];
  const schemaErrors = validateSchema(signature, signatureSchema);
  for (const error of schemaErrors) {
    errors.push({ code: 'signature_malformed', path: error.path, message: error.message });
  }
  if (errors.length > 0) return { errors, bytes: null };

  let bytes = null;
  try {
    bytes = decodeSignature(signature.signature);
  } catch (error) {
    errors.push({ code: 'signature_malformed', message: error.message });
  }
  return { errors, bytes };
}

function verifyAll(input) {
  const errors = [];
  const warnings = [];
  let manifest = null;
  let signature = null;
  let parseFailed = false;

  try {
    manifest = parseStrict(input.manifestText, { integersOnly: true, maxDepth: 10, requireNFC: true });
  } catch (error) {
    if (error instanceof StrictParseError) {
      parseFailed = true;
      errors.push({ code: error.code, message: error.message });
    } else {
      throw error;
    }
  }

  try {
    signature = parseStrict(input.signatureText, { integersOnly: true, maxDepth: 5, requireNFC: true });
  } catch (error) {
    if (error instanceof StrictParseError) {
      parseFailed = true;
      errors.push({ code: error.code, message: error.message });
    } else {
      throw error;
    }
  }

  const manifestBytes = input.manifestBytes || Buffer.from(input.manifestText, 'utf8');
  if (signature && signature.raw_digest !== undefined) {
    const rawCheck = verifyRawDigest(signature.raw_digest, manifestBytes);
    errors.push(...rawCheck.errors);
  }

  if (parseFailed) return { result: 'UNVERIFIED', errors, warnings, manifest, signature };

  const manifestCheck = checkManifest(manifest, input);
  errors.push(...manifestCheck.errors);
  warnings.push(...manifestCheck.warnings);

  const signatureCheck = checkSignatureContainer(signature);
  errors.push(...signatureCheck.errors);

  if (manifestCheck.publicKey && signatureCheck.bytes) {
    let valid = false;
    try {
      valid = verifyManifest(manifestCheck.publicKey, manifest, signatureCheck.bytes);
    } catch (error) {
      errors.push({ code: 'bad_signature', message: error.message });
    }
    if (!valid && !errors.some((error) => error.code === 'bad_signature')) {
      errors.push({ code: 'bad_signature', message: 'Ed25519 signature verification failed' });
    }
  }

  return {
    result: errors.length === 0 ? 'VERIFIED' : 'UNVERIFIED',
    errors,
    warnings,
    manifest,
    signature
  };
}

function verifyDirectory(target, options = {}) {
  let manifestPath = target;
  let stat = null;
  try {
    stat = fs.statSync(target);
  } catch (error) {
    stat = null;
  }
  let signaturePath;
  if (stat && stat.isDirectory()) {
    const rootManifest = path.join(target, 'ai.json');
    manifestPath = fs.existsSync(rootManifest) ? rootManifest : path.join(target, '.well-known', 'ai.json');
    signaturePath = path.join(path.dirname(manifestPath), 'ai-signature.json');
  } else {
    signaturePath = path.join(path.dirname(manifestPath), 'ai-signature.json');
  }
  const manifestText = fs.readFileSync(manifestPath, 'utf8');
  const signatureText = fs.readFileSync(signaturePath, 'utf8');
  const now = options.now instanceof Date ? options.now : (options.now ? new Date(options.now) : new Date());
  return verifyAll({
    manifestText,
    manifestBytes: fs.readFileSync(manifestPath),
    signatureText,
    domain: options.domain,
    now
  });
}

module.exports = {
  SKEW_SECONDS,
  MAX_CHECK_INTERVAL_HOURS,
  canonicalRevocationUrl,
  normalizeDomain,
  checkManifest,
  checkSignatureContainer,
  verifyAll,
  verifyDirectory
};
