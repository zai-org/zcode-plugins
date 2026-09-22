'use strict';

const { parseStrict } = require('./parse');
const cryptoLib = require('./crypto');

function withoutSignatures(document) {
  const { signatures, ...rest } = document;
  return rest;
}

function verifyRevocationDocument(text, options = {}) {
  const {
    domain,
    now = new Date(),
    governanceKeys = null,
    threshold = 2,
    keyFingerprint = null
  } = options;

  const errors = [];
  const warnings = [];

  let document;
  try {
    document = parseStrict(text, { integersOnly: true, maxDepth: 10, requireNFC: true });
  } catch (error) {
    return {
      status: 'invalid',
      result: 'invalid',
      valid_signatures: 0,
      errors: [{ code: error.code || 'parse_error', message: error.message }],
      warnings
    };
  }

  const { domainToASCII } = require('node:url');
  const normalizeName = (value) => {
    if (typeof value !== 'string') return null;
    let name = value.trim().toLowerCase();
    if (name.endsWith('.')) name = name.slice(0, -1);
    try {
      const ascii = domainToASCII(name);
      return ascii ? ascii.toLowerCase() : null;
    } catch (normalizeError) {
      return null;
    }
  };
  if (domain && normalizeName(document.domain) !== normalizeName(domain)) {
    errors.push({ code: 'revocation_domain_mismatch', message: 'revocation domain does not match ' + domain });
  }

  const VALID_STATUSES = ['active', 'under_review', 'suspended'];
  if (!VALID_STATUSES.includes(document.status)) {
    errors.push({ code: 'revocation_status_invalid', message: 'revocation status must be one of ' + VALID_STATUSES.join(', ') });
  }

  const expiresAt = Date.parse(document.expires_at || '');
  if (!Number.isFinite(expiresAt)) {
    errors.push({ code: 'revocation_expires_invalid', message: 'revocation document requires a valid expires_at timestamp' });
  } else if (expiresAt <= now.getTime()) {
    errors.push({ code: 'revocation_document_expired', message: 'revocation document has expired' });
  } else if (expiresAt > now.getTime() + 30 * 24 * 3600000) {
    warnings.push({ code: 'revocation_expiry_long', message: 'revocation document lifetime exceeds 30 days' });
  }

  let validSignatures = 0;
  if (!Array.isArray(document.signatures) || document.signatures.length === 0) {
    errors.push({ code: 'revocation_unsigned', message: 'revocation document has no signatures' });
  } else if (governanceKeys && governanceKeys.length > 0) {
    const signed = withoutSignatures(document);
    const validFingerprints = new Set();
    for (const entry of document.signatures) {
      if (!entry || typeof entry.signature !== 'string') continue;
      let signatureBytes;
      try {
        signatureBytes = cryptoLib.decodeSignature(entry.signature);
      } catch (error) {
        continue;
      }
      for (const keyValue of governanceKeys) {
        let publicKey;
        try {
          publicKey = cryptoLib.decodePublicKey(keyValue);
        } catch (error) {
          continue;
        }
        try {
          if (cryptoLib.verifyRevocation(publicKey, signed, signatureBytes)) {
            validFingerprints.add(cryptoLib.fingerprintOf(publicKey));
          }
        } catch (error) {
          continue;
        }
      }
    }
    validSignatures = validFingerprints.size;
    if (validSignatures < threshold) {
      errors.push({
        code: 'revocation_threshold_not_met',
        message: 'only ' + validSignatures + ' valid governance signature(s); threshold is ' + threshold
      });
    }
  } else {
    warnings.push({
      code: 'revocation_signature_unchecked',
      message: 'no governance keys provided; revocation signatures not verified'
    });
  }

  const revokedKeys = Array.isArray(document.keys) ? document.keys : [];
  if (keyFingerprint && errors.length === 0 && revokedKeys.some((entry) => entry && entry.fingerprint === keyFingerprint)) {
    errors.push({ code: 'key_revoked', message: 'signing key is listed in the revocation document' });
  }

  return {
    status: document.status,
    result: errors.length === 0 ? 'valid' : 'invalid',
    valid_signatures: validSignatures,
    keys: revokedKeys,
    errors,
    warnings
  };
}

module.exports = { verifyRevocationDocument, withoutSignatures };
