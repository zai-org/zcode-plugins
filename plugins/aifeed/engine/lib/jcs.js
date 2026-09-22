'use strict';

const SIMPLE_ESCAPES = {
  '"': '\\"',
  '\\': '\\\\',
  '\b': '\\b',
  '\f': '\\f',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t'
};

function escapeString(value) {
  let out = '"';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    const mapped = SIMPLE_ESCAPES[ch];
    if (mapped) {
      out += mapped;
      continue;
    }
    const code = value.charCodeAt(i);
    if (code < 0x20) {
      out += '\\u' + code.toString(16).padStart(4, '0');
      continue;
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new Error('lone high surrogate in string');
      }
      out += ch + value[i + 1];
      i++;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Error('lone low surrogate in string');
    }
    out += ch;
  }
  return out + '"';
}

function serialize(value) {
  if (value === null) return 'null';
  const type = typeof value;
  if (type === 'boolean') return value ? 'true' : 'false';
  if (type === 'number') {
    if (!Number.isFinite(value)) throw new Error('non-finite number is not serializable');
    return String(value);
  }
  if (type === 'string') return escapeString(value);
  if (Array.isArray(value)) {
    return '[' + value.map((item) => serialize(item)).join(',') + ']';
  }
  if (type === 'object') {
    const keys = Object.keys(value).sort();
    const parts = keys.map((key) => escapeString(key) + ':' + serialize(value[key]));
    return '{' + parts.join(',') + '}';
  }
  throw new Error('unsupported value type: ' + type);
}

module.exports = { serialize, escapeString };
