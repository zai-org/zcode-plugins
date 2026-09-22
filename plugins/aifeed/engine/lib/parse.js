'use strict';

const WHITESPACE = new Set([' ', '\t', '\n', '\r']);

class StrictParseError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StrictParseError';
    this.code = code;
  }
}

function parseStrict(text, options = {}) {
  const maxDepth = options.maxDepth ?? 10;
  const integersOnly = options.integersOnly ?? false;
  const requireNFC = options.requireNFC ?? true;
  let pos = 0;

  const fail = (code, message) => {
    throw new StrictParseError(code, message);
  };

  const peek = () => text[pos];

  const skipWhitespace = () => {
    while (pos < text.length && WHITESPACE.has(text[pos])) pos++;
  };

  const readLiteral = (literal, value) => {
    if (text.startsWith(literal, pos)) {
      pos += literal.length;
      return value;
    }
    fail('parse_error', 'unexpected token at ' + pos);
  };

  const readString = () => {
    pos++;
    let out = '';
    while (pos < text.length) {
      const ch = text[pos];
      if (ch === '"') {
        pos++;
        if (requireNFC && out.normalize('NFC') !== out) {
          fail('not_nfc', 'string is not NFC normalized');
        }
        return out;
      }
      if (ch === '\\') {
        pos++;
        const esc = text[pos];
        if (esc === '"' || esc === '\\' || esc === '/') {
          out += esc;
          pos++;
          continue;
        }
        if (esc === 'b') {
          out += '\b';
          pos++;
          continue;
        }
        if (esc === 'f') {
          out += '\f';
          pos++;
          continue;
        }
        if (esc === 'n') {
          out += '\n';
          pos++;
          continue;
        }
        if (esc === 'r') {
          out += '\r';
          pos++;
          continue;
        }
        if (esc === 't') {
          out += '\t';
          pos++;
          continue;
        }
        if (esc === 'u') {
          const hex = text.slice(pos + 1, pos + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('parse_error', 'invalid unicode escape');
          const code = parseInt(hex, 16);
          pos += 5;
          if (code >= 0xd800 && code <= 0xdbff) {
            if (text[pos] === '\\' && text[pos + 1] === 'u') {
              const hex2 = text.slice(pos + 2, pos + 6);
              if (/^[0-9a-fA-F]{4}$/.test(hex2)) {
                const low = parseInt(hex2, 16);
                if (low >= 0xdc00 && low <= 0xdfff) {
                  out += String.fromCharCode(code, low);
                  pos += 6;
                  continue;
                }
              }
            }
            fail('lone_surrogate', 'lone high surrogate');
          }
          if (code >= 0xdc00 && code <= 0xdfff) fail('lone_surrogate', 'lone low surrogate');
          out += String.fromCharCode(code);
          continue;
        }
        fail('parse_error', 'invalid escape sequence');
      }
      const code = ch.charCodeAt(0);
      if (code < 0x20) fail('parse_error', 'unescaped control character');
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = text.charCodeAt(pos + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          out += ch + text[pos + 1];
          pos += 2;
          continue;
        }
        fail('lone_surrogate', 'lone high surrogate');
      }
      if (code >= 0xdc00 && code <= 0xdfff) fail('lone_surrogate', 'lone low surrogate');
      out += ch;
      pos++;
    }
    fail('parse_error', 'unterminated string');
  };

  const readNumber = () => {
    const match = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(pos));
    if (!match) fail('parse_error', 'invalid number');
    const raw = match[0];
    const isInteger = !match[2] && !match[3];
    if (isInteger) {
      const value = Number(raw);
      if (!Number.isSafeInteger(value)) fail('integer_out_of_range', 'integer exceeds ±2^53-1');
      pos += raw.length;
      return value === 0 ? 0 : value;
    }
    if (integersOnly) fail('float_not_allowed', 'floating point numbers are not allowed');
    const value = Number(raw);
    if (!Number.isFinite(value)) fail('parse_error', 'non-finite number');
    if (Math.abs(value) > Number.MAX_SAFE_INTEGER) fail('integer_out_of_range', 'number exceeds ±2^53-1');
    pos += raw.length;
    return value === 0 ? 0 : value;
  };

  const readArray = (depth) => {
    pos++;
    const out = [];
    skipWhitespace();
    if (peek() === ']') {
      pos++;
      return out;
    }
    for (;;) {
      out.push(readValue(depth + 1));
      skipWhitespace();
      const ch = peek();
      if (ch === ',') {
        pos++;
        skipWhitespace();
        continue;
      }
      if (ch === ']') {
        pos++;
        return out;
      }
      fail('parse_error', 'expected , or ]');
    }
  };

  const readObject = (depth) => {
    pos++;
    const out = {};
    const seen = new Set();
    skipWhitespace();
    if (peek() === '}') {
      pos++;
      return out;
    }
    for (;;) {
      skipWhitespace();
      if (peek() !== '"') fail('parse_error', 'expected object key');
      const key = readString();
      if (seen.has(key)) fail('duplicate_key', 'duplicate object key: ' + key);
      seen.add(key);
      skipWhitespace();
      if (peek() !== ':') fail('parse_error', 'expected : after key');
      pos++;
      const member = readValue(depth + 1);
      Object.defineProperty(out, key, {
        value: member,
        writable: true,
        enumerable: true,
        configurable: true
      });
      skipWhitespace();
      const ch = peek();
      if (ch === ',') {
        pos++;
        continue;
      }
      if (ch === '}') {
        pos++;
        return out;
      }
      fail('parse_error', 'expected , or }');
    }
  };

  const readValue = (depth) => {
    if (depth > maxDepth) fail('max_depth', 'maximum nesting depth exceeded');
    skipWhitespace();
    const ch = peek();
    if (ch === '{') return readObject(depth);
    if (ch === '[') return readArray(depth);
    if (ch === '"') return readString();
    if (ch === 't') return readLiteral('true', true);
    if (ch === 'f') return readLiteral('false', false);
    if (ch === 'n') return readLiteral('null', null);
    if (ch === '-' || (ch >= '0' && ch <= '9')) return readNumber();
    fail('parse_error', 'unexpected token at ' + pos);
  };

  const value = readValue(0);
  skipWhitespace();
  if (pos !== text.length) fail('parse_error', 'trailing data after value');
  return value;
}

module.exports = { parseStrict, StrictParseError };
