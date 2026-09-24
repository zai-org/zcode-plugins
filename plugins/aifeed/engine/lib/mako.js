'use strict';

const nodeCrypto = require('node:crypto');
const { parseStrict } = require('./parse');
const { serialize } = require('./jcs');
const { validate } = require('./schema');
const digestLib = require('./digest');
const cryptoLib = require('./crypto');
const makoSchema = require('../schema/mako.v0.2.json');
const aimdSchema = require('../schema/aimd.v1.json');
const makoIndexSchema = require('../schema/mako-index.v0.2.json');

const MAKO_SEPARATION = 'aifeed.mako.v0.2\n';
const MAKO_INDEX_SEPARATION = 'aifeed.mako-index.v0.2\n';
const AIMD_SEPARATION = 'aifeed.aimd.v1\n';
const AIMD_INDEX_SEPARATION = 'aifeed.aimd-index.v1\n';
const MAKO_MEDIA_TYPE = 'text/mako+markdown';
const AIMD_MEDIA_TYPE = 'text/aifeed+markdown';
const SEPARATIONS = {
  mako: MAKO_SEPARATION,
  'mako-index': MAKO_INDEX_SEPARATION,
  aimd: AIMD_SEPARATION,
  'aimd-index': AIMD_INDEX_SEPARATION
};
const FRONTMATTER_MAX_BYTES = 32768;
const SCALAR_MAX_LENGTH = 8192;
const NODE_LIMIT = 512;
const DEPTH_LIMIT = 6;

const USAGE_KEYS = [
  'search', 'retrieval', 'input', 'training', 'quote', 'summarize',
  'reproduce', 'translate', 'modify', 'embed', 'commercial_use'
];
const ATTRIBUTION_ORDER = { none: 0, optional: 1, required: 2 };
const MAKO_TYPES = ['product', 'article', 'docs', 'landing', 'profile', 'listing', 'event', 'recipe', 'faq', 'custom'];
const MAKO_UPDATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}(T[0-9]{2}:[0-9]{2}:[0-9]{2}Z)?$/;
const LANGUAGE_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const KEY_VALUE_PATTERN = /^([A-Za-z0-9_-]{1,64}):(?: (.*))?$/;
const INTEGER_PATTERN = /^-?(0|[1-9][0-9]*)$/;
const FLOAT_PATTERN = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/;
const ASCII_URL_PATTERN = /^https:\/\/[\x21-\x7e]+$/;
const LOOPBACK_URL_PATTERN = /^http:\/\/(127\.0\.0\.1|\[::1\]|localhost)(:\d+)?(\/[\x21-\x7e]*)?$/;

function isMakoUrl(value) {
  if (typeof value !== 'string') return false;
  return ASCII_URL_PATTERN.test(value) || LOOPBACK_URL_PATTERN.test(value);
}

class MakoFrontmatterError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MakoFrontmatterError';
    this.code = code;
  }
}

function error(code, message, extra = {}) {
  return { code, message, ...extra };
}

function decodeUtf8(bytes) {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function normalizeScalar(value, line) {
  if (value.normalize('NFC') !== value) {
    throw new MakoFrontmatterError('not_nfc', 'scalar is not NFC normalized (line ' + line + ')');
  }
  if (value.length > SCALAR_MAX_LENGTH) {
    throw new MakoFrontmatterError('scalar_too_long', 'scalar exceeds ' + SCALAR_MAX_LENGTH + ' chars (line ' + line + ')');
  }
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 && value[i] !== '\t') {
      throw new MakoFrontmatterError('yaml_control_char', 'control character in scalar (line ' + line + ')');
    }
  }
  return value;
}

function parsePlainScalar(raw, line) {
  let value = raw;
  const commentIndex = value.search(/ #/);
  if (commentIndex !== -1) value = value.slice(0, commentIndex);
  value = value.replace(/[ ]+$/, '');
  if (value === '') {
    throw new MakoFrontmatterError('yaml_empty_value', 'empty scalar value (line ' + line + ')');
  }
  const first = value[0];
  if (first === '&') throw new MakoFrontmatterError('yaml_anchor_forbidden', 'anchors are forbidden (line ' + line + ')');
  if (first === '*') throw new MakoFrontmatterError('yaml_alias_forbidden', 'aliases are forbidden (line ' + line + ')');
  if (first === '!') throw new MakoFrontmatterError('yaml_tag_forbidden', 'tags are forbidden (line ' + line + ')');
  if (first === '%') throw new MakoFrontmatterError('yaml_directive_forbidden', 'directives are forbidden (line ' + line + ')');
  if (first === '|' || first === '>') throw new MakoFrontmatterError('yaml_block_scalar_forbidden', 'block scalars are forbidden (line ' + line + ')');
  if (first === '~') throw new MakoFrontmatterError('yaml_null_forbidden', 'null is forbidden (line ' + line + ')');
  if (first === '{' || first === '[') throw new MakoFrontmatterError('yaml_flow_forbidden', 'flow collections are forbidden (line ' + line + ')');
  if (first === '<' && value.startsWith('<<')) throw new MakoFrontmatterError('yaml_merge_forbidden', 'merge keys are forbidden (line ' + line + ')');
  if (value === '...') throw new MakoFrontmatterError('yaml_document_marker_forbidden', 'document markers are forbidden (line ' + line + ')');
  if (value.includes(': ')) throw new MakoFrontmatterError('yaml_inline_mapping_forbidden', 'inline mappings are forbidden (line ' + line + ')');
  if (value === 'null' || value === 'Null' || value === 'NULL') {
    throw new MakoFrontmatterError('yaml_null_forbidden', 'null is forbidden (line ' + line + ')');
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (INTEGER_PATTERN.test(value)) {
    const number = Number(value);
    if (!Number.isSafeInteger(number)) {
      throw new MakoFrontmatterError('integer_out_of_range', 'integer exceeds ±2^53-1 (line ' + line + ')');
    }
    return number === 0 ? 0 : number;
  }
  if (FLOAT_PATTERN.test(value)) {
    throw new MakoFrontmatterError('float_not_allowed', 'floating point numbers are forbidden (line ' + line + ')');
  }
  return normalizeScalar(value, line);
}

function parseQuotedScalar(raw, line, quote) {
  const body = raw.slice(1);
  let out = '';
  let closed = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === quote) {
      if (quote === "'" && body[i + 1] === "'") {
        out += "'";
        i++;
        continue;
      }
      closed = true;
      const rest = body.slice(i + 1);
      if (rest.trim() !== '' && !rest.trimStart().startsWith('#')) {
        throw new MakoFrontmatterError('yaml_parse_error', 'trailing content after quoted scalar (line ' + line + ')');
      }
      break;
    }
    if (quote === '"' && ch === '\\') {
      const esc = body[i + 1];
      const simple = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\', '/': '/' };
      if (simple[esc] !== undefined) {
        out += simple[esc];
        i++;
        continue;
      }
      if (esc === 'u') {
        const hex = body.slice(i + 2, i + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
          throw new MakoFrontmatterError('yaml_parse_error', 'invalid unicode escape (line ' + line + ')');
        }
        out += String.fromCharCode(parseInt(hex, 16));
        i += 5;
        continue;
      }
      throw new MakoFrontmatterError('yaml_parse_error', 'invalid escape sequence (line ' + line + ')');
    }
    if (ch === '\r' && quote === "'") {
      throw new MakoFrontmatterError('yaml_parse_error', 'unescaped carriage return (line ' + line + ')');
    }
    out += ch;
  }
  if (!closed) {
    throw new MakoFrontmatterError('yaml_parse_error', 'unterminated quoted scalar (line ' + line + ')');
  }
  return normalizeScalar(out, line);
}

function parseScalar(raw, line, key) {
  const value = raw.replace(/[ ]+$/, '');
  if (value.startsWith('"')) return parseQuotedScalar(value, line, '"');
  if (value.startsWith("'")) return parseQuotedScalar(value, line, "'");
  if (key === 'mako') {
    if (/^1\.0+$/.test(value)) return '1.0';
    if (INTEGER_PATTERN.test(value) || FLOAT_PATTERN.test(value)) return normalizeScalar(value, line);
  }
  return parsePlainScalar(value, line);
}

function parseFrontmatter(bytes) {
  const errors = [];
  const fail = (code, message) => errors.push(error(code, message));

  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  if (bytes.length > FRONTMATTER_MAX_BYTES) {
    fail('frontmatter_too_large', 'frontmatter exceeds ' + FRONTMATTER_MAX_BYTES + ' bytes');
    return { ok: false, errors, frontmatter: null, body: null };
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    fail('bom_forbidden', 'BOM is forbidden');
    return { ok: false, errors, frontmatter: null, body: null };
  }
  let text;
  try {
    text = decodeUtf8(bytes);
  } catch (decodeError) {
    fail('invalid_utf8', 'MAKO document is not valid UTF-8');
    return { ok: false, errors, frontmatter: null, body: null };
  }
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) {
    fail('frontmatter_missing', 'frontmatter block delimited by --- was not found');
    return { ok: false, errors, frontmatter: null, body: null };
  }
  const frontText = match[1];
  const body = text.slice(match[0].length);

  const root = {};
  const stack = [{ kind: 'map', indent: 0, node: root }];
  let nodeCount = 0;

  const countNode = (line) => {
    nodeCount++;
    if (nodeCount > NODE_LIMIT) {
      throw new MakoFrontmatterError('node_limit_exceeded', 'frontmatter exceeds ' + NODE_LIMIT + ' nodes (line ' + line + ')');
    }
  };

  const assign = (node, key, value) => {
    if (Object.prototype.hasOwnProperty.call(node, key)) {
      throw new MakoFrontmatterError('duplicate_key', 'duplicate key: ' + key);
    }
    Object.defineProperty(node, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true
    });
  };

  const ensureContext = (indent, wantsList, line) => {
    const top = stack[stack.length - 1];
    if (top.kind === null) {
      if (indent <= top.parentIndent) {
        throw new MakoFrontmatterError('yaml_indent_invalid', 'nested block must be indented (line ' + line + ')');
      }
      top.kind = wantsList ? 'list' : 'map';
      top.indent = indent;
      top.node = wantsList ? [] : {};
      assign(top.parent, top.key, top.node);
      countNode(line);
    }
    return top;
  };

  const lines = frontText.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1;
    let raw = lines[index];
    if (raw.endsWith('\r')) raw = raw.slice(0, -1);
    if (raw.trim() === '') continue;
    const leading = raw.slice(0, raw.length - raw.trimStart().length);
    if (leading.includes('\t')) {
      fail('yaml_tab_indent', 'tabs are forbidden for indentation (line ' + lineNumber + ')');
      continue;
    }
    const indent = leading.length;
    if (indent % 2 !== 0) {
      fail('yaml_indent_invalid', 'indentation must be a multiple of 2 spaces (line ' + lineNumber + ')');
      continue;
    }
    const content = raw.slice(indent);
    if (content.startsWith('#')) continue;

    while (stack.length > 1 && stack[stack.length - 1].kind !== null && stack[stack.length - 1].indent > indent) {
      stack.pop();
    }

    try {
      if (content.startsWith('- ') || content === '-') {
        if (content === '-') {
          fail('yaml_parse_error', 'sequence item without value is not supported (line ' + lineNumber + ')');
          continue;
        }
        const top = ensureContext(indent, true, lineNumber);
        if (top.kind !== 'list' || top.indent !== indent) {
          throw new MakoFrontmatterError('yaml_indent_invalid', 'misaligned sequence item (line ' + lineNumber + ')');
        }
        const itemRaw = content.slice(2).replace(/[ ]+$/, '');
        const itemMatch = KEY_VALUE_PATTERN.exec(itemRaw);
        if (itemMatch) {
          const item = {};
          countNode(lineNumber);
          top.node.push(item);
          const [, itemKey, itemValue] = itemMatch;
          if (itemValue === undefined) {
            stack.push({ kind: null, key: itemKey, parent: item, parentIndent: indent });
            if (stack.length > DEPTH_LIMIT) {
              throw new MakoFrontmatterError('yaml_max_depth', 'maximum nesting depth exceeded (line ' + lineNumber + ')');
            }
          } else {
            assign(item, itemKey, parseScalar(itemValue, lineNumber, itemKey));
            countNode(lineNumber);
          }
          stack.push({ kind: 'map', indent: indent + 2, node: item });
          if (stack.length > DEPTH_LIMIT) {
            throw new MakoFrontmatterError('yaml_max_depth', 'maximum nesting depth exceeded (line ' + lineNumber + ')');
          }
        } else {
          top.node.push(parseScalar(itemRaw, lineNumber));
          countNode(lineNumber);
        }
        continue;
      }

      const keyMatch = KEY_VALUE_PATTERN.exec(content);
      if (!keyMatch) {
        throw new MakoFrontmatterError('yaml_parse_error', 'line is not a mapping or sequence item (line ' + lineNumber + ')');
      }
      const [, key, rawValue] = keyMatch;
      if (!KEY_PATTERN.test(key)) {
        throw new MakoFrontmatterError('yaml_key_invalid', 'invalid key: ' + key);
      }
      const top = ensureContext(indent, false, lineNumber);
      if (top.kind !== 'map' || top.indent !== indent) {
        throw new MakoFrontmatterError('yaml_indent_invalid', 'misaligned mapping key (line ' + lineNumber + ')');
      }
      if (rawValue === undefined) {
        stack.push({ kind: null, key, parent: top.node, parentIndent: indent });
        if (stack.length > DEPTH_LIMIT) {
          throw new MakoFrontmatterError('yaml_max_depth', 'maximum nesting depth exceeded (line ' + lineNumber + ')');
        }
        continue;
      }
      assign(top.node, key, parseScalar(rawValue, lineNumber, key));
      countNode(lineNumber);
    } catch (parseError) {
      if (parseError instanceof MakoFrontmatterError) {
        fail(parseError.code, parseError.message);
      } else {
        throw parseError;
      }
    }
  }

  for (const context of stack) {
    if (context.kind === null) {
      fail('yaml_null_forbidden', 'key without a value: ' + context.key);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    frontmatter: errors.length === 0 ? root : null,
    body
  };
}

function validateMakoFields(frontmatter) {
  const errors = [];
  if (frontmatter === null || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
    return [error('mako_frontmatter_invalid', 'frontmatter must be a mapping')];
  }
  if (!Object.prototype.hasOwnProperty.call(frontmatter, 'mako')) {
    errors.push(error('mako_frontmatter_missing', 'missing required field: mako'));
  } else if (frontmatter.mako !== '1.0') {
    errors.push(error('mako_unsupported', 'unsupported MAKO protocol version: ' + String(frontmatter.mako)));
  }
  for (const field of ['type', 'entity', 'updated', 'tokens', 'language']) {
    if (!Object.prototype.hasOwnProperty.call(frontmatter, field)) {
      errors.push(error('mako_frontmatter_missing', 'missing required field: ' + field));
    }
  }
  if (frontmatter.type !== undefined && !MAKO_TYPES.includes(frontmatter.type)) {
    errors.push(error('mako_frontmatter_invalid', 'invalid type: ' + String(frontmatter.type)));
  }
  if (frontmatter.entity !== undefined && (typeof frontmatter.entity !== 'string' || frontmatter.entity === '')) {
    errors.push(error('mako_frontmatter_invalid', 'entity must be a non-empty string'));
  }
  if (frontmatter.updated !== undefined && (typeof frontmatter.updated !== 'string' || !MAKO_UPDATE_PATTERN.test(frontmatter.updated))) {
    errors.push(error('mako_frontmatter_invalid', 'updated must be an ISO 8601 date or UTC timestamp'));
  }
  if (frontmatter.tokens !== undefined && (!Number.isSafeInteger(frontmatter.tokens) || frontmatter.tokens < 1 || frontmatter.tokens > 100000)) {
    errors.push(error('mako_frontmatter_invalid', 'tokens must be an integer between 1 and 100000'));
  }
  if (frontmatter.language !== undefined && (typeof frontmatter.language !== 'string' || !LANGUAGE_PATTERN.test(frontmatter.language))) {
    errors.push(error('mako_frontmatter_invalid', 'language must be a BCP 47 tag'));
  }
  if (frontmatter.aifeed !== undefined) {
    if (typeof frontmatter.aifeed !== 'object' || frontmatter.aifeed === null || Array.isArray(frontmatter.aifeed)) {
      errors.push(error('aifeed_invalid', 'aifeed block must be a mapping'));
    } else {
      const schemaErrors = validate(frontmatter.aifeed, makoSchema.$defs.aifeed, { root: makoSchema });
      for (const schemaError of schemaErrors) {
        const code = schemaError.keyword === 'additionalProperties' ? 'aifeed_unknown_field' : 'aifeed_invalid';
        errors.push(error(code, 'aifeed' + schemaError.path.replace(/^\$/, '') + ': ' + schemaError.message));
      }
    }
  }
  return errors;
}

function validateAimdFields(frontmatter) {
  const errors = [];
  if (frontmatter === null || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
    return [error('aimd_frontmatter_invalid', 'frontmatter must be a mapping')];
  }
  if (!Object.prototype.hasOwnProperty.call(frontmatter, 'aimd')) {
    errors.push(error('aimd_frontmatter_missing', 'missing required field: aimd'));
  } else if (frontmatter.aimd !== '1.0') {
    errors.push(error('aimd_unsupported', 'unsupported AIFeed Markdown protocol version: ' + String(frontmatter.aimd)));
  }
  if (frontmatter.mako !== undefined && frontmatter.mako !== '1.0') {
    errors.push(error('mako_unsupported', 'unsupported MAKO protocol version: ' + String(frontmatter.mako)));
  }
  for (const field of ['type', 'entity', 'updated', 'tokens', 'language']) {
    if (!Object.prototype.hasOwnProperty.call(frontmatter, field)) {
      errors.push(error('aimd_frontmatter_missing', 'missing required field: ' + field));
    }
  }
  if (frontmatter.type !== undefined && !MAKO_TYPES.includes(frontmatter.type)) {
    errors.push(error('aimd_frontmatter_invalid', 'invalid type: ' + String(frontmatter.type)));
  }
  if (frontmatter.entity !== undefined && (typeof frontmatter.entity !== 'string' || frontmatter.entity === '')) {
    errors.push(error('aimd_frontmatter_invalid', 'entity must be a non-empty string'));
  }
  if (frontmatter.updated !== undefined && (typeof frontmatter.updated !== 'string' || !MAKO_UPDATE_PATTERN.test(frontmatter.updated))) {
    errors.push(error('aimd_frontmatter_invalid', 'updated must be an ISO 8601 date or UTC timestamp'));
  }
  if (frontmatter.tokens !== undefined && (!Number.isSafeInteger(frontmatter.tokens) || frontmatter.tokens < 1 || frontmatter.tokens > 1000000)) {
    errors.push(error('aimd_frontmatter_invalid', 'tokens must be an integer between 1 and 1000000'));
  }
  if (frontmatter.language !== undefined && (typeof frontmatter.language !== 'string' || !LANGUAGE_PATTERN.test(frontmatter.language))) {
    errors.push(error('aimd_frontmatter_invalid', 'language must be a BCP 47 tag'));
  }
  if (frontmatter.alternates !== undefined) {
    if (!Array.isArray(frontmatter.alternates) || frontmatter.alternates.length > 20) {
      errors.push(error('aimd_frontmatter_invalid', 'alternates must be an array of at most 20 items'));
    } else {
      for (const item of frontmatter.alternates) {
        if (item === null || typeof item !== 'object' || Array.isArray(item)) {
          errors.push(error('aimd_frontmatter_invalid', 'alternates items must be objects'));
          continue;
        }
        const keys = Object.keys(item);
        if (keys.some((key) => key !== 'url' && key !== 'lang')) {
          errors.push(error('aimd_frontmatter_invalid', 'alternates items may only contain url and lang'));
        }
        if (typeof item.url !== 'string' || item.url.length === 0 || item.url.length > 2048) {
          errors.push(error('aimd_frontmatter_invalid', 'alternates.url must be a non-empty string (<=2048)'));
        }
        if (typeof item.lang !== 'string' || !LANGUAGE_PATTERN.test(item.lang)) {
          errors.push(error('aimd_frontmatter_invalid', 'alternates.lang must be a BCP 47 tag'));
        }
      }
    }
  }
  if (frontmatter.summary !== undefined && (typeof frontmatter.summary !== 'string' || frontmatter.summary.length > 300)) {
    errors.push(error('aimd_frontmatter_invalid', 'summary must be a string of at most 300 characters'));
  }
  if (frontmatter.canonical !== undefined && (typeof frontmatter.canonical !== 'string' || frontmatter.canonical.length === 0 || frontmatter.canonical.length > 2048)) {
    errors.push(error('aimd_frontmatter_invalid', 'canonical must be a non-empty string (<=2048)'));
  }
  if (frontmatter.tags !== undefined) {
    if (!Array.isArray(frontmatter.tags) || frontmatter.tags.length > 50) {
      errors.push(error('aimd_frontmatter_invalid', 'tags must be an array of at most 50 items'));
    } else if (frontmatter.tags.some((tag) => typeof tag !== 'string' || tag.length === 0 || tag.length > 64)) {
      errors.push(error('aimd_frontmatter_invalid', 'tags items must be strings of 1-64 characters'));
    }
  }
  if (frontmatter.related !== undefined) {
    if (!Array.isArray(frontmatter.related) || frontmatter.related.length > 100) {
      errors.push(error('aimd_frontmatter_invalid', 'related must be an array of at most 100 items'));
    } else if (frontmatter.related.some((item) => typeof item !== 'string' || item.length === 0 || item.length > 2048)) {
      errors.push(error('aimd_frontmatter_invalid', 'related items must be strings of 1-2048 characters'));
    }
  }
  if (frontmatter.audience !== undefined && (typeof frontmatter.audience !== 'string' || frontmatter.audience.length > 128)) {
    errors.push(error('aimd_frontmatter_invalid', 'audience must be a string of at most 128 characters'));
  }
  if (frontmatter.freshness !== undefined && !['realtime', 'hourly', 'daily', 'weekly', 'monthly', 'static'].includes(frontmatter.freshness)) {
    errors.push(error('aimd_frontmatter_invalid', 'freshness must be realtime, hourly, daily, weekly, monthly, or static'));
  }
  if (frontmatter.media !== undefined) {
    const media = frontmatter.media;
    if (media === null || typeof media !== 'object' || Array.isArray(media)) {
      errors.push(error('aimd_frontmatter_invalid', 'media must be a mapping'));
    } else {
      if (media.cover !== undefined) {
        const cover = media.cover;
        if (cover === null || typeof cover !== 'object' || Array.isArray(cover) ||
          typeof cover.url !== 'string' || cover.url.length === 0 || cover.url.length > 2048 ||
          typeof cover.alt !== 'string' || cover.alt.length === 0 || cover.alt.length > 500) {
          errors.push(error('aimd_frontmatter_invalid', 'media.cover must be {url, alt} strings'));
        }
      }
      for (const key of ['images', 'video', 'audio', 'interactive', 'downloads']) {
        if (media[key] !== undefined && (!Number.isSafeInteger(media[key]) || media[key] < 0)) {
          errors.push(error('aimd_frontmatter_invalid', 'media.' + key + ' must be a non-negative integer'));
        }
      }
    }
  }
  if (frontmatter.actions !== undefined) {
    if (!Array.isArray(frontmatter.actions) || frontmatter.actions.length > 100) {
      errors.push(error('aimd_frontmatter_invalid', 'actions must be an array of at most 100 items'));
    } else {
      const names = new Set();
      for (const action of frontmatter.actions) {
        if (action === null || typeof action !== 'object' || Array.isArray(action) ||
          typeof action.name !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(action.name) ||
          typeof action.description !== 'string' || action.description.length === 0 || action.description.length > 500) {
          errors.push(error('aimd_frontmatter_invalid', 'actions items must have a snake_case name and a description'));
          continue;
        }
        if (names.has(action.name)) {
          errors.push(error('aimd_frontmatter_invalid', 'duplicate action name: ' + action.name));
        }
        names.add(action.name);
        if (action.method !== undefined && !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(action.method)) {
          errors.push(error('aimd_frontmatter_invalid', 'action method must be an HTTP method'));
        }
        if (action.endpoint !== undefined && (typeof action.endpoint !== 'string' || !/^\/\S*$/.test(action.endpoint))) {
          errors.push(error('aimd_frontmatter_invalid', 'action endpoint must be a path'));
        }
      }
    }
  }
  if (frontmatter.links !== undefined) {
    const links = frontmatter.links;
    if (links === null || typeof links !== 'object' || Array.isArray(links)) {
      errors.push(error('aimd_frontmatter_invalid', 'links must be a mapping'));
    } else {
      for (const side of ['internal', 'external']) {
        if (links[side] === undefined) continue;
        if (!Array.isArray(links[side]) || links[side].length > 100) {
          errors.push(error('aimd_frontmatter_invalid', 'links.' + side + ' must be an array of at most 100 items'));
          continue;
        }
        for (const link of links[side]) {
          if (link === null || typeof link !== 'object' || Array.isArray(link) ||
            typeof link.url !== 'string' || link.url.length === 0 || link.url.length > 2048 ||
            typeof link.context !== 'string' || link.context.length === 0 || link.context.length > 500) {
            errors.push(error('aimd_frontmatter_invalid', 'links.' + side + ' items must be {url, context} strings'));
          }
        }
      }
    }
  }
  if (frontmatter.aifeed !== undefined) {
    if (typeof frontmatter.aifeed !== 'object' || frontmatter.aifeed === null || Array.isArray(frontmatter.aifeed)) {
      errors.push(error('aifeed_invalid', 'aifeed block must be a mapping'));
    } else {
      const schemaErrors = validate(frontmatter.aifeed, aimdSchema.$defs.aifeed, { root: aimdSchema });
      for (const schemaError of schemaErrors) {
        const code = schemaError.keyword === 'additionalProperties' ? 'aifeed_unknown_field' : 'aifeed_invalid';
        errors.push(error(code, 'aifeed' + schemaError.path.replace(/^\$/, '') + ': ' + schemaError.message));
      }
    }
  }
  return errors;
}

function documentProfile(frontmatter) {
  if (frontmatter === null || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) return null;
  if (frontmatter.aimd === '1.0') return 'aimd';
  if (frontmatter.mako === '1.0') return 'mako';
  return null;
}

function validateDocumentFields(frontmatter, profile) {
  return profile === 'aimd' ? validateAimdFields(frontmatter) : validateMakoFields(frontmatter);
}

function resolvePermissions(manifestPermissions, aifeedBlock, overrides = 'restrict-only') {
  const permissions = manifestPermissions || {};
  const usage = {};
  const warnings = [];
  const baseUsage = permissions.usage || {};
  const pageUsage = (aifeedBlock && aifeedBlock.usage) || {};
  for (const key of USAGE_KEYS) {
    const base = baseUsage[key] !== undefined ? baseUsage[key] : permissions.default;
    const page = pageUsage[key];
    if (page === undefined || page === base) {
      usage[key] = base;
      continue;
    }
    if (overrides === 'bidirectional') {
      usage[key] = page;
      continue;
    }
    if (base === 'deny' && page === 'allow') {
      warnings.push(error('permission_override_rejected', 'page may not grant "' + key + '" (manifest denies it)', { key, attempted: page, effective: base }));
      usage[key] = base;
      continue;
    }
    usage[key] = page;
  }

  let attribution = permissions.attribution;
  if (aifeedBlock && aifeedBlock.attribution !== undefined && aifeedBlock.attribution !== attribution) {
    const baseRank = ATTRIBUTION_ORDER[attribution];
    const pageRank = ATTRIBUTION_ORDER[aifeedBlock.attribution];
    if (overrides === 'bidirectional' || (baseRank !== undefined && pageRank > baseRank)) {
      attribution = aifeedBlock.attribution;
    } else {
      warnings.push(error('permission_override_rejected', 'page may not loosen attribution', { key: 'attribution', attempted: aifeedBlock.attribution, effective: attribution }));
    }
  }

  const baseLimits = permissions.limits || {};
  const pageLimits = (aifeedBlock && aifeedBlock.limits) || {};
  const limits = { ...baseLimits };
  for (const key of ['requests_per_minute', 'concurrent']) {
    const page = pageLimits[key];
    if (page === undefined) continue;
    const base = limits[key];
    if (overrides === 'bidirectional' || base === undefined || page <= base) {
      limits[key] = page;
    } else {
      warnings.push(error('permission_override_rejected', 'page may not loosen limit "' + key + '"', { key, attempted: page, effective: base }));
    }
  }
  if (pageLimits.crawl_delay_seconds !== undefined) {
    const page = pageLimits.crawl_delay_seconds;
    const base = limits.crawl_delay_seconds;
    if (overrides === 'bidirectional' || base === undefined || page >= base) {
      limits.crawl_delay_seconds = page;
    } else {
      warnings.push(error('permission_override_rejected', 'page may not loosen limit "crawl_delay_seconds"', { key: 'crawl_delay_seconds', attempted: page, effective: base }));
    }
  }

  const baseLicense = permissions.license;
  const pageLicense = aifeedBlock && aifeedBlock.license;
  let license = baseLicense;
  if (pageLicense !== undefined) {
    if (baseLicense === undefined) {
      license = pageLicense;
    } else if (overrides === 'bidirectional') {
      license = pageLicense;
    } else {
      let same = false;
      try {
        same = serialize(pageLicense) === serialize(baseLicense);
      } catch (serializeError) {
        same = false;
      }
      if (same) {
        license = baseLicense;
      } else {
        warnings.push(error('permission_override_rejected', 'page may not replace license (manifest license applies)', { key: 'license', attempted: pageLicense, effective: baseLicense }));
        license = baseLicense;
      }
    }
  }

  return { usage, attribution, limits, license, warnings };
}

function signedMessage(pageUrl, bodyBytes, context) {
  const separation = SEPARATIONS[context] || MAKO_SEPARATION;
  if (!isMakoUrl(pageUrl)) {
    const invalid = new Error('page URL must be an absolute https URL with ASCII characters (loopback http allowed for tests)');
    invalid.code = 'mako_url_invalid';
    throw invalid;
  }
  return Buffer.concat([
    Buffer.from(separation, 'utf8'),
    Buffer.from(pageUrl, 'utf8'),
    Buffer.from('\n', 'ascii'),
    bodyBytes
  ]);
}

function signMakoContainer(privateKey, pageUrl, bodyBytes, options = {}) {
  const context = options.context || 'mako';
  const message = signedMessage(pageUrl, bodyBytes, context);
  const signature = nodeCrypto.sign(null, message, privateKey);
  const publicKey = nodeCrypto.createPublicKey(privateKey);
  const container = {
    algorithm: 'ed25519',
    context,
    url: pageUrl,
    key_fingerprint: cryptoLib.fingerprintOf(publicKey),
    signature: cryptoLib.encodeSignature(signature),
    raw_digest: digestLib.rawDigestOf(bodyBytes)
  };
  if (options.signedAt) container.signed_at = options.signedAt;
  return container;
}

function verifyMakoContainer({ containerText, pageUrl, bodyBytes, publicKey, context = 'mako' }) {
  const errors = [];
  let container;
  try {
    container = parseStrict(containerText, { maxDepth: 10, integersOnly: true });
  } catch (parseError) {
    return { ok: false, errors: [error('mako_container_malformed', 'signature container is not valid strict JSON: ' + parseError.message)] };
  }
  if (container === null || typeof container !== 'object' || Array.isArray(container)) {
    return { ok: false, errors: [error('mako_container_malformed', 'signature container must be an object')] };
  }
  if (container.algorithm !== 'ed25519') {
    return { ok: false, errors: [error('mako_container_malformed', 'algorithm must be "ed25519"')] };
  }
  if (container.context !== context) {
    return { ok: false, errors: [error('mako_context_invalid', 'context must be "' + context + '"')] };
  }
  if (typeof container.url !== 'string' || !isMakoUrl(container.url)) {
    return { ok: false, errors: [error('mako_container_malformed', 'url must be an absolute ASCII https URL (loopback http allowed for tests)')] };
  }
  if (container.url !== pageUrl) {
    return { ok: false, errors: [error('mako_url_mismatch', 'signed URL does not match the requested page URL', { signed: container.url, requested: pageUrl })] };
  }
  if (container.key_fingerprint !== cryptoLib.fingerprintOf(publicKey)) {
    return { ok: false, errors: [error('mako_key_mismatch', 'signature key does not match the manifest key')] };
  }
  if (container.raw_digest === undefined) {
    return { ok: false, errors: [error('mako_container_malformed', 'raw_digest is required')] };
  }
  const digestResult = digestLib.verifyRawDigest(container.raw_digest, bodyBytes);
  if (!digestResult.ok) {
    return { ok: false, errors: [error('mako_digest_mismatch', 'MAKO bytes do not match raw_digest.sha-256')] };
  }
  let signatureBytes;
  try {
    signatureBytes = cryptoLib.decodeSignature(container.signature);
  } catch (signatureError) {
    return { ok: false, errors: [error('mako_container_malformed', 'signature is malformed')] };
  }
  const message = signedMessage(pageUrl, bodyBytes, context);
  if (!nodeCrypto.verify(null, message, publicKey, signatureBytes)) {
    return { ok: false, errors: [error('mako_bad_signature', 'MAKO signature verification failed')] };
  }
  return { ok: true, errors: [], container };
}

function verifyMakoDocument({
  pageUrl,
  makoBytes,
  containerText,
  manifestFragment,
  now,
  lastModified,
  profile = 'mako'
}) {
  const bytes = Buffer.isBuffer(makoBytes) ? makoBytes : Buffer.from(makoBytes, 'utf8');
  const errors = [];
  const warnings = [];
  const fragment = manifestFragment || {};
  const publicKeyValue = fragment.public_key;
  const contentMako = fragment.content_mako || {};
  const overrides = contentMako.overrides || 'restrict-only';
  const signaturePolicy = contentMako.signature || 'optional';
  const context = profile === 'aimd' ? 'aimd' : 'mako';
  const formatLabel = profile === 'aimd' ? 'AIFeed Markdown' : 'MAKO';

  let publicKey;
  try {
    publicKey = cryptoLib.decodePublicKey(publicKeyValue);
  } catch (keyError) {
    return {
      verified: false,
      mako_verified: false,
      aimd_verified: false,
      mako_signature_present: false,
      errors: [error('mako_manifest_key_invalid', 'manifest public key is invalid')],
      warnings,
      frontmatter: null,
      body: null,
      usage: null,
      attribution: null,
      limits: null,
      license: null
    };
  }

  const parsed = parseFrontmatter(bytes);
  errors.push(...parsed.errors);
  if (parsed.frontmatter !== null) {
    errors.push(...validateDocumentFields(parsed.frontmatter, profile));
    if (parsed.frontmatter.updated && lastModified) {
      const updated = Date.parse(parsed.frontmatter.updated);
      const modified = Date.parse(lastModified);
      if (Number.isFinite(updated) && Number.isFinite(modified) && updated < modified - 86400000) {
        warnings.push(error('mako_stale', formatLabel + ' document is older than the page Last-Modified timestamp'));
      }
    }
  }

  let verified = false;
  const signaturePresent = containerText !== undefined && containerText !== null;
  if (signaturePresent) {
    const containerResult = verifyMakoContainer({ containerText, pageUrl, bodyBytes: bytes, publicKey, context });
    if (containerResult.ok) {
      verified = true;
    } else {
      errors.push(...containerResult.errors);
    }
  } else if (signaturePolicy === 'required') {
    errors.push(error('mako_signature_missing', 'manifest requires ' + formatLabel + ' signatures but none was provided'));
  }

  const resolved = resolvePermissions(fragment.permissions, parsed.frontmatter ? parsed.frontmatter.aifeed : undefined, overrides);
  warnings.push(...resolved.warnings);

  return {
    verified,
    mako_verified: verified,
    aimd_verified: verified,
    mako_signature_present: signaturePresent,
    profile,
    errors,
    warnings,
    frontmatter: parsed.frontmatter,
    body: parsed.body,
    usage: resolved.usage,
    attribution: resolved.attribution,
    limits: resolved.limits,
    license: resolved.license
  };
}

function verifyAimdDocument(options) {
  return verifyMakoDocument({ ...options, profile: 'aimd' });
}

function verifyMakoIndex({ indexText, indexUrl, publicKeyValue, signatureText, requireSignature = false, profile = 'mako' }) {
  const errors = [];
  const bytes = Buffer.from(indexText, 'utf8');
  let index;
  try {
    index = parseStrict(indexText, { maxDepth: 10, integersOnly: true });
  } catch (parseError) {
    return { ok: false, verified: false, errors: [error('mako_index_malformed', 'index is not valid strict JSON: ' + parseError.message)], entries: null };
  }
  const schemaErrors = validate(index, makoIndexSchema, { root: makoIndexSchema });
  for (const schemaError of schemaErrors) {
    errors.push(error('mako_index_invalid', schemaError.path + ': ' + schemaError.message));
  }
  if (errors.length > 0) {
    return { ok: false, verified: false, errors, entries: index && index.entries };
  }
  let indexHost;
  try {
    indexHost = new URL(indexUrl).hostname;
  } catch (urlError) {
    return { ok: false, verified: false, errors: [error('mako_index_malformed', 'index URL is not a valid absolute URL')], entries: index.entries };
  }
  if (index.domain !== indexHost) {
    errors.push(error('mako_index_domain_mismatch', 'index domain does not match the serving host', { declared: index.domain, serving: indexHost }));
    return { ok: false, verified: false, errors, entries: index.entries };
  }
  let verified = false;
  const signaturePresent = signatureText !== undefined && signatureText !== null;
  if (signaturePresent) {
    let publicKey;
    try {
      publicKey = cryptoLib.decodePublicKey(publicKeyValue);
    } catch (keyError) {
      return { ok: false, verified: false, errors: [error('mako_manifest_key_invalid', 'manifest public key is invalid')], entries: index.entries };
    }
    const containerResult = verifyMakoContainer({
      containerText: signatureText,
      pageUrl: indexUrl,
      bodyBytes: bytes,
      publicKey,
      context: profile === 'aimd' ? 'aimd-index' : 'mako-index'
    });
    if (containerResult.ok) {
      verified = true;
    } else {
      errors.push(...containerResult.errors);
    }
  } else if (requireSignature) {
    errors.push(error('mako_signature_missing', 'manifest requires signatures but the index is unsigned'));
  }
  return { ok: errors.length === 0, verified, errors, entries: index.entries, profile };
}

function verifyAimdIndex(options) {
  return verifyMakoIndex({ ...options, profile: 'aimd' });
}

function checkIndexEntryDigest(entry, bodyBytes) {
  const actual = digestLib.sha256Base64(bodyBytes);
  if (entry['sha-256'] !== actual) {
    return { ok: false, error: error('mako_index_digest_mismatch', 'index entry digest does not match MAKO bytes', { url: entry.url }) };
  }
  return { ok: true };
}

module.exports = {
  MAKO_SEPARATION,
  MAKO_INDEX_SEPARATION,
  AIMD_SEPARATION,
  AIMD_INDEX_SEPARATION,
  MAKO_MEDIA_TYPE,
  AIMD_MEDIA_TYPE,
  SEPARATIONS,
  FRONTMATTER_MAX_BYTES,
  USAGE_KEYS,
  MakoFrontmatterError,
  parseFrontmatter,
  validateMakoFields,
  validateAimdFields,
  validateDocumentFields,
  documentProfile,
  resolvePermissions,
  signedMessage,
  signMakoContainer,
  verifyMakoContainer,
  verifyMakoDocument,
  verifyAimdDocument,
  verifyMakoIndex,
  verifyAimdIndex,
  checkIndexEntryDigest
};
