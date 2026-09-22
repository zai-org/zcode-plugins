'use strict';

const crypto = require('node:crypto');
const { serialize } = require('./jcs');

const PK_PREFIX = 'ed25519:';
const SIG_PREFIX = 'base64url:';
const MANIFEST_SEPARATION = 'aifeed.v0.1\n';
const MANIFEST_SEPARATION_02 = 'aifeed.v0.2\n';
const REVOCATION_SEPARATION = 'aifeed-revoke.v0.1\n';
const BUNDLE_SEPARATION = 'aifeed-bundle.v0.1\n';
const PK_PATTERN = /^ed25519:[A-Za-z0-9+/]{59}=$/;
const SIG_PATTERN = /^base64url:[A-Za-z0-9_-]{86}$/;
const SPKI_DER_LENGTH = 44;

function manifestFamily(version) {
  if (typeof version !== 'string') return null;
  if (/^0\.1(\.\d+)?$/.test(version)) return '0.1';
  if (/^0\.2(\.\d+)?$/.test(version)) return '0.2';
  return null;
}

function generateKeyPair() {
  return crypto.generateKeyPairSync('ed25519');
}

function spkiDer(publicKey) {
  return publicKey.export({ type: 'spki', format: 'der' });
}

function encodePublicKey(publicKey) {
  const der = spkiDer(publicKey);
  if (der.length !== SPKI_DER_LENGTH) throw new Error('unexpected SPKI DER length');
  return PK_PREFIX + der.toString('base64');
}

function decodePublicKey(value) {
  if (typeof value !== 'string' || !PK_PATTERN.test(value)) {
    const error = new Error('public key must match ' + PK_PATTERN);
    error.code = 'pk_format';
    throw error;
  }
  const der = Buffer.from(value.slice(PK_PREFIX.length), 'base64');
  if (der.length !== SPKI_DER_LENGTH) {
    const error = new Error('invalid SPKI DER length');
    error.code = 'pk_format';
    throw error;
  }
  return crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
}

function fingerprintOf(publicKeyOrDer) {
  const der = Buffer.isBuffer(publicKeyOrDer) ? publicKeyOrDer : spkiDer(publicKeyOrDer);
  return 'sha256:' + crypto.createHash('sha256').update(der).digest('base64url');
}

function canonicalMessage(manifest, kind = 'manifest') {
  let separation = MANIFEST_SEPARATION;
  if (kind === 'revocation') separation = REVOCATION_SEPARATION;
  if (kind === 'bundle') separation = BUNDLE_SEPARATION;
  if (kind === 'manifest' && manifestFamily(manifest && manifest.version) === '0.2') {
    separation = MANIFEST_SEPARATION_02;
  }
  return Buffer.from(separation + serialize(manifest), 'utf8');
}

function signManifest(privateKey, manifest) {
  return crypto.sign(null, canonicalMessage(manifest), privateKey);
}

function signRevocation(privateKey, revocation) {
  return crypto.sign(null, canonicalMessage(revocation, 'revocation'), privateKey);
}

function signBundle(privateKey, bundleManifest) {
  return crypto.sign(null, canonicalMessage(bundleManifest, 'bundle'), privateKey);
}

function verifyBundle(publicKey, bundleManifest, signature) {
  return crypto.verify(null, canonicalMessage(bundleManifest, 'bundle'), publicKey, signature);
}

function verifyRevocation(publicKey, revocation, signature) {
  return crypto.verify(null, canonicalMessage(revocation, 'revocation'), publicKey, signature);
}

function verifyManifest(publicKey, manifest, signature) {
  return crypto.verify(null, canonicalMessage(manifest), publicKey, signature);
}

function encodeSignature(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length !== 64) throw new Error('signature must be 64 bytes');
  return SIG_PREFIX + bytes.toString('base64url');
}

function decodeSignature(value) {
  if (typeof value !== 'string' || !SIG_PATTERN.test(value)) {
    const error = new Error('signature must match ' + SIG_PATTERN);
    error.code = 'signature_malformed';
    throw error;
  }
  const bytes = Buffer.from(value.slice(SIG_PREFIX.length), 'base64url');
  if (bytes.length !== 64) {
    const error = new Error('signature must decode to 64 bytes');
    error.code = 'signature_malformed';
    throw error;
  }
  return bytes;
}

module.exports = {
  PK_PREFIX,
  SIG_PREFIX,
  MANIFEST_SEPARATION,
  MANIFEST_SEPARATION_02,
  REVOCATION_SEPARATION,
  BUNDLE_SEPARATION,
  PK_PATTERN,
  SIG_PATTERN,
  manifestFamily,
  generateKeyPair,
  spkiDer,
  encodePublicKey,
  decodePublicKey,
  fingerprintOf,
  canonicalMessage,
  signManifest,
  signRevocation,
  signBundle,
  verifyBundle,
  verifyRevocation,
  verifyManifest,
  encodeSignature,
  decodeSignature
};
