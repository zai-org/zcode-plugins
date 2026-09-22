'use strict';

const crypto = require('node:crypto');

const RAW_SHA256_PATTERN = /^[A-Za-z0-9+/]{43}=$/;
const RAW_SHA512_PATTERN = /^[A-Za-z0-9+/]{86}==$/;

function digestError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sha256Base64(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('base64');
}

function sha512Base64(bytes) {
  return crypto.createHash('sha512').update(bytes).digest('base64');
}

function rawDigestOf(bytes) {
  return { 'sha-256': sha256Base64(bytes), applies_to: 'raw-bytes' };
}

function checkRawDigestShape(rawDigest) {
  if (rawDigest === undefined) return { errors: [] };
  const errors = [];
  if (typeof rawDigest !== 'object' || rawDigest === null || Array.isArray(rawDigest)) {
    return { errors: [{ code: 'signature_malformed', message: 'raw_digest must be an object' }] };
  }
  const keys = Object.keys(rawDigest);
  for (const key of keys) {
    if (!['sha-256', 'sha-512', 'applies_to'].includes(key)) {
      errors.push({ code: 'signature_malformed', message: 'unknown raw_digest field: ' + key });
    }
  }
  if (typeof rawDigest['sha-256'] !== 'string' || !RAW_SHA256_PATTERN.test(rawDigest['sha-256'])) {
    errors.push({ code: 'signature_malformed', message: 'raw_digest.sha-256 must be base64 of a 32-byte digest' });
  }
  if (rawDigest['sha-512'] !== undefined) {
    if (typeof rawDigest['sha-512'] !== 'string' || !RAW_SHA512_PATTERN.test(rawDigest['sha-512'])) {
      errors.push({ code: 'signature_malformed', message: 'raw_digest.sha-512 must be base64 of a 64-byte digest' });
    }
  }
  if (rawDigest.applies_to !== 'raw-bytes') {
    errors.push({ code: 'signature_malformed', message: 'raw_digest.applies_to must be "raw-bytes"' });
  }
  return { errors };
}

function verifyRawDigest(rawDigest, bytes) {
  const shape = checkRawDigestShape(rawDigest);
  if (shape.errors.length > 0) return { ok: false, errors: shape.errors };
  const actual = sha256Base64(bytes);
  if (rawDigest['sha-256'] !== actual) {
    return {
      ok: false,
      errors: [{ code: 'raw_digest_mismatch', message: 'raw bytes do not match raw_digest.sha-256' }],
      expected: rawDigest['sha-256'],
      actual
    };
  }
  return { ok: true, errors: [], actual };
}

function parseContentDigest(headerValue) {
  if (typeof headerValue !== 'string' || headerValue.trim() === '') {
    throw digestError('content_digest_malformed', 'Content-Digest header is empty');
  }
  const result = {};
  for (const part of headerValue.split(',')) {
    const member = part.trim();
    if (!member) continue;
    const separator = member.indexOf('=');
    if (separator === -1) throw digestError('content_digest_malformed', 'invalid Content-Digest member: ' + member);
    const algorithm = member.slice(0, separator).trim().toLowerCase();
    let value = member.slice(separator + 1).trim();
    const parameterIndex = value.indexOf(';');
    if (parameterIndex !== -1) value = value.slice(0, parameterIndex).trim();
    if (!value.startsWith(':') || !value.endsWith(':')) {
      throw digestError('content_digest_malformed', 'Content-Digest value must be a byte sequence');
    }
    const encoded = value.slice(1, -1);
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
      throw digestError('content_digest_malformed', 'Content-Digest value is not valid base64');
    }
    result[algorithm] = encoded;
  }
  if (Object.keys(result).length === 0) {
    throw digestError('content_digest_malformed', 'Content-Digest header has no members');
  }
  return result;
}

function verifyContentDigest(headerValue, bytes) {
  const digests = parseContentDigest(headerValue);
  const checked = [];
  for (const algorithm of ['sha-512', 'sha-256']) {
    if (!digests[algorithm]) continue;
    const expected = digests[algorithm];
    const actual = algorithm === 'sha-512' ? sha512Base64(bytes) : sha256Base64(bytes);
    if (expected !== actual) {
      return {
        ok: false,
        algorithm,
        expected,
        actual,
        errors: [{ code: 'content_digest_mismatch', message: 'Content-Digest ' + algorithm + ' mismatch' }]
      };
    }
    checked.push(algorithm);
  }
  if (checked.length === 0) {
    return {
      ok: false,
      errors: [{ code: 'content_digest_unsupported', message: 'no supported Content-Digest algorithm found (need sha-256 or sha-512)' }]
    };
  }
  return { ok: true, algorithms: checked, errors: [] };
}

module.exports = {
  sha256Base64,
  sha512Base64,
  rawDigestOf,
  checkRawDigestShape,
  verifyRawDigest,
  parseContentDigest,
  verifyContentDigest
};
