'use strict';

const { fingerprintOf, decodePublicKey } = require('./crypto');

const SKEW_SECONDS = 300;
const ANCHOR_SKEW_SECONDS = 300;
const MIN_WINDOW_HOURS = 1;
const INSTANT_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/;

function parseInstant(value) {
  if (typeof value !== 'string' || !INSTANT_PATTERN.test(value)) return null;
  const milliseconds = Date.parse(value);
  return Number.isNaN(milliseconds) ? null : milliseconds;
}

function isSuccessor(directive) {
  return Boolean(directive) && typeof directive.successor_fp === 'string';
}

function isPredecessor(directive) {
  return Boolean(directive) && typeof directive.predecessor_fp === 'string';
}

function validateDirective(manifest, now) {
  const errors = [];
  const warnings = [];
  const directive = manifest && manifest.rotation;
  if (directive === undefined) return { errors, warnings, directive: null, phase: null };

  const successor = isSuccessor(directive);
  const predecessor = isPredecessor(directive);
  if (successor && predecessor) {
    errors.push({ code: 'rotation_invalid', message: 'rotation must not carry successor_fp and predecessor_fp together' });
    return { errors, warnings, directive, phase: null };
  }
  if (!successor && !predecessor) {
    errors.push({ code: 'rotation_invalid', message: 'rotation requires successor_fp or predecessor_fp' });
    return { errors, warnings, directive, phase: null };
  }

  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const signedAt = parseInstant(manifest.validity && manifest.validity.signed_at);
  let phase = null;

  if (successor) {
    const effectiveAt = parseInstant(directive.effective_at);
    const graceUntil = parseInstant(directive.grace_until);
    if (!directive.effective_at || !directive.grace_until) {
      errors.push({ code: 'rotation_invalid', message: 'successor_fp requires effective_at and grace_until' });
    } else if (effectiveAt === null || graceUntil === null) {
      errors.push({ code: 'rotation_invalid', message: 'rotation timestamps must be UTC instants (YYYY-MM-DDTHH:MM:SSZ)' });
    } else if (graceUntil - effectiveAt < MIN_WINDOW_HOURS * 3600 * 1000) {
      errors.push({ code: 'rotation_invalid', message: 'grace_until must exceed effective_at by at least ' + MIN_WINDOW_HOURS + ' hour' });
    }
    if (effectiveAt !== null) {
      phase = nowMs >= effectiveAt ? 'grace' : 'announced';
      if (graceUntil !== null && nowMs >= graceUntil) phase = 'completed';
    }
    if (phase === 'grace') {
      warnings.push({ code: 'grace_accepted', message: 'old signing key accepted inside its grace window' });
    } else if (phase === 'completed') {
      errors.push({ code: 'rotation_denied', message: 'old signing key is past grace_until; rotation must be completed' });
    }
    return { errors, warnings, directive, phase };
  }

  const supersedesAt = parseInstant(directive.supersedes_at);
  if (supersedesAt === null) {
    errors.push({ code: 'rotation_invalid', message: 'predecessor_fp requires supersedes_at' });
  } else if (signedAt !== null && supersedesAt > signedAt + SKEW_SECONDS * 1000) {
    errors.push({ code: 'rotation_invalid', message: 'supersedes_at must not follow signed_at by more than ' + SKEW_SECONDS + ' seconds' });
  }
  return { errors, warnings, directive, phase: 'cutover' };
}

function publicKeyMatches(publicKeyValue, expectedFingerprint) {
  try {
    return fingerprintOf(decodePublicKey(publicKeyValue)) === expectedFingerprint;
  } catch (error) {
    return false;
  }
}

function evaluateAnchor(manifest, record) {
  const warnings = [];
  const directive = manifest && manifest.rotation;
  const pk2 = record && typeof record.pk2 === 'string' && record.pk2.length > 0 ? record.pk2 : null;

  if (isSuccessor(directive)) {
    if (!pk2 || !publicKeyMatches(pk2, directive.successor_fp)) {
      warnings.push({ code: 'rotation_anchor_unverified', message: 'DNS pk2 is missing or does not match rotation.successor_fp; advisory cross-check skipped' });
      return { warnings };
    }
    const recordInstant = parseInstant(record.effective_at);
    const directiveInstant = parseInstant(directive.effective_at);
    if (recordInstant === null || directiveInstant === null || Math.abs(recordInstant - directiveInstant) > ANCHOR_SKEW_SECONDS * 1000) {
      warnings.push({ code: 'rotation_anchor_unverified', message: 'DNS effective_at does not match rotation.effective_at within ' + ANCHOR_SKEW_SECONDS + ' seconds' });
    }
    return { warnings };
  }

  if (pk2) {
    warnings.push({ code: 'rotation_anchor_unverified', message: 'DNS advertises pk2 without a manifest rotation directive; ignored' });
  }
  return { warnings };
}

function evaluateContinuity(pin, manifest, now) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const currentFingerprint = fingerprintOf(decodePublicKey(manifest.identity.public_key));
  const directive = manifest.rotation || null;

  if (!pin || typeof pin.fingerprint !== 'string' || pin.fingerprint.length === 0) {
    return { action: 'pin', codes: [], pin: { fingerprint: currentFingerprint } };
  }

  if (pin.fingerprint === currentFingerprint) {
    const graceUntil = parseInstant(pin.grace_until);
    if (typeof pin.successor_fp === 'string' && graceUntil !== null && nowMs >= graceUntil) {
      return {
        action: 'error',
        codes: [{ code: 'rotation_denied', message: 'retired key re-appeared after an announced successor passed its grace window' }],
        pin
      };
    }
    const nextPin = { fingerprint: currentFingerprint };
    if (directive && isSuccessor(directive)) {
      nextPin.successor_fp = directive.successor_fp;
      nextPin.effective_at = directive.effective_at;
      nextPin.grace_until = directive.grace_until;
    }
    return { action: 'accept', codes: [], pin: nextPin };
  }

  const effectiveAt = parseInstant(pin.effective_at);
  if (pin.successor_fp === currentFingerprint && effectiveAt !== null && nowMs >= effectiveAt) {
    if (directive && isPredecessor(directive) && directive.predecessor_fp !== pin.fingerprint) {
      return {
        action: 'error',
        codes: [{ code: 'rotation_denied', message: 'successor binding names a different predecessor than the pinned key' }],
        pin
      };
    }
    return { action: 'accept_successor', codes: [], pin: { fingerprint: currentFingerprint, predecessor_fp: pin.fingerprint } };
  }

  if (directive && isPredecessor(directive) && directive.predecessor_fp === pin.fingerprint) {
    return {
      action: 'resync',
      codes: [{ code: 'rotation_resync', message: 'dormant pin accepted a defined successor; refresh the pin store' }],
      pin: { fingerprint: currentFingerprint, predecessor_fp: pin.fingerprint }
    };
  }

  return {
    action: 'error',
    codes: [{ code: 'rotation_denied', message: 'signing key changed without a matching stored successor' }],
    pin
  };
}

module.exports = {
  SKEW_SECONDS,
  ANCHOR_SKEW_SECONDS,
  MIN_WINDOW_HOURS,
  parseInstant,
  isSuccessor,
  isPredecessor,
  validateDirective,
  evaluateAnchor,
  evaluateContinuity
};
