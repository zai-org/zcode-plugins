#!/usr/bin/env node
'use strict';

const parse = require('./lib/parse');
const httpLib = require('node:http');
const cryptoLib = require('./lib/crypto');
const makoLib = require('./lib/mako');
const digestLib = require('./lib/digest');
const remoteLib = require('./lib/remote');
const validateLib = require('./lib/validate');
const schemaLib = require('./lib/schema');
const makoIndexSchema = require('./schema/mako-index.v0.2.json');

const SERVER_NAME = 'aifeed-mcp-server';
const SERVER_VERSION = '1.0.0-draft.1';
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15000;

function allowPrivate() {
  return process.env.AIFEED_MCP_ALLOW_PRIVATE === '1';
}

function checkUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch (error) {
    throw { code: -32602, message: 'invalid url: ' + String(value) };
  }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  if (url.protocol === 'http:' && loopback && allowPrivate()) return url.toString();
  if (url.protocol !== 'https:') {
    throw { code: -32602, message: 'only https URLs are allowed (http loopback needs AIFEED_MCP_ALLOW_PRIVATE=1)' };
  }
  return url.toString();
}

function checkDomain(value) {
  const domain = validateLib.normalizeDomain(value);
  if (!domain) throw { code: -32602, message: 'invalid domain: ' + String(value) };
  return domain;
}

function estimateTokens(text) {
  return Math.ceil(Buffer.byteLength(String(text), 'utf8') / 4);
}

function fetchLoopbackHttp(url, options) {
  const maxBytes = options.maxBytes ?? MAX_BYTES;
  const timeout = options.timeout ?? TIMEOUT_MS;
  const allowedContentTypes = options.allowedContentTypes ?? ['application/json'];
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    const request = httpLib.get(url, { timeout }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400) {
        const err = new Error('redirects are not allowed (status ' + response.statusCode + ')');
        err.code = 'redirect_not_allowed';
        fail(err);
        return;
      }
      if (response.statusCode !== 200) {
        const err = new Error('unexpected status ' + response.statusCode);
        err.code = response.statusCode === 404 ? 'not_found' : 'http_error';
        fail(err);
        return;
      }
      const contentType = String(response.headers['content-type'] || '');
      if (!allowedContentTypes.some((allowed) => contentType.includes(allowed))) {
        const err = new Error('unexpected content-type: ' + contentType);
        err.code = 'content_type_invalid';
        fail(err);
        return;
      }
      const chunks = [];
      let total = 0;
      response.on('data', (chunk) => {
        if (settled) return;
        total += chunk.length;
        if (total > maxBytes) {
          const err = new Error('response exceeds ' + maxBytes + ' bytes');
          err.code = 'response_too_large';
          fail(err);
          response.resume();
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        if (settled) return;
        settled = true;
        const buffer = Buffer.concat(chunks);
        const headers = {};
        for (const [key, value] of Object.entries(response.headers)) {
          headers[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value === undefined ? '' : value);
        }
        resolve({ status: response.statusCode, headers, buffer, text: buffer.toString('utf8') });
      });
      response.on('error', (error) => {
        if (!error.code) error.code = 'network_error';
        fail(error);
      });
    });
    request.on('timeout', () => {
      request.destroy();
      const err = new Error('request timed out');
      err.code = 'timeout';
      fail(err);
    });
    request.on('error', (error) => {
      if (!error.code) error.code = 'network_error';
      fail(error);
    });
  });
}

async function fetchChecked(url, options) {
  const checked = checkUrl(url);
  if (new URL(checked).protocol === 'http:') {
    return fetchLoopbackHttp(checked, options);
  }
  return remoteLib.fetchText(checked, { timeout: TIMEOUT_MS, allowPrivate: allowPrivate(), ...options });
}

function textResult(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

function errorResult(message, extra) {
  return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: message, ...(extra || {}) }) }], isError: true };
}

function decodeInlineSignature(headerValue) {
  if (typeof headerValue !== 'string') return null;
  const match = /^(?:mako1|aimd1):/.exec(headerValue);
  if (!match) return null;
  try {
    const text = Buffer.from(headerValue.slice(match[0].length), 'base64url').toString('utf8');
    parse.parseStrict(text, { integersOnly: true, maxDepth: 10, requireNFC: true });
    return text;
  } catch (error) {
    return null;
  }
}

async function resolvePageSignature(url, response, options) {
  const inline = decodeInlineSignature(response.headers['x-aifeed-signature']);
  if (inline) return inline;
  if (typeof response.headers['x-aifeed-signature-url'] === 'string') {
    try {
      const target = new URL(response.headers['x-aifeed-signature-url'], url).toString();
      const signature = await fetchChecked(checkUrl(target), {
        accept: 'application/json',
        allowedContentTypes: ['application/json'],
        maxBytes: 64 * 1024,
        timeout: TIMEOUT_MS,
        allowPrivate: allowPrivate()
      });
      return signature.text;
    } catch (error) {
      return null;
    }
  }
  try {
    const signature = await fetchChecked(url + '.sig', {
      accept: 'application/json',
      allowedContentTypes: ['application/json'],
      maxBytes: 64 * 1024,
      timeout: TIMEOUT_MS,
      allowPrivate: allowPrivate()
    });
    return signature.text;
  } catch (error) {
    return null;
  }
}

async function fetchPage(url, profile, options = {}) {
  const mediaType = profile === 'mako' ? 'text/mako+markdown' : 'text/aifeed+markdown';
  const context = profile === 'mako' ? 'mako' : 'aimd';
  const response = await fetchChecked(checkUrl(url), {
    accept: mediaType,
    allowedContentTypes: [mediaType, 'text/html'],
    maxBytes: MAX_BYTES,
    timeout: TIMEOUT_MS,
    allowPrivate: allowPrivate()
  });
  const contentType = String(response.headers['content-type'] || '');
  if (!contentType.includes(mediaType)) {
    throw { code: -32602, message: 'origin did not serve ' + mediaType + ' for ' + url };
  }
  const parsed = makoLib.parseFrontmatter(response.buffer);
  const errors = [...parsed.errors];
  if (parsed.frontmatter !== null) {
    errors.push(...makoLib.validateDocumentFields(parsed.frontmatter, context));
  }
  let verified = false;
  if (options.publicKeyValue) {
    const containerText = await resolvePageSignature(url, response, options);
    if (containerText === null) {
      errors.push({ code: 'mako_signature_missing', message: 'no signature found' });
    } else {
      const result = makoLib.verifyMakoContainer({
        containerText,
        pageUrl: url,
        bodyBytes: response.buffer,
        publicKey: cryptoLib.decodePublicKey(options.publicKeyValue),
        context
      });
      verified = result.ok;
      errors.push(...result.errors);
    }
  }
  return { response, parsed, verified, errors, profile: context };
}

function normalizeAsset(asset, pageUrl) {
  if (!asset || typeof asset !== 'object') return null;
  if (typeof asset.url !== 'string' || asset.url === '' || typeof asset.type !== 'string') return null;
  let resolved = asset.url;
  if (!/^(https?:)?\/\//i.test(resolved)) {
    try {
      resolved = new URL(resolved, pageUrl).toString();
    } catch (error) {
      resolved = asset.url;
    }
  }
  const normalized = { url: resolved, type: asset.type };
  for (const key of ['mime', 'title', 'alt', 'sha-256']) {
    if (typeof asset[key] === 'string' && asset[key] !== '') normalized[key] = asset[key];
  }
  if (Number.isInteger(asset.size) && asset.size >= 0) normalized.size = asset.size;
  return normalized;
}

function truncateToBudget(body, maxTokens) {
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) return { markdown: body, truncated: false };
  const budget = Math.floor(maxTokens) * 4;
  if (Buffer.byteLength(body, 'utf8') <= budget) return { markdown: body, truncated: false };
  let cut = body.slice(0, budget);
  const lastBreak = cut.lastIndexOf('\n');
  if (lastBreak > budget * 0.5) cut = cut.slice(0, lastBreak);
  return { markdown: cut, truncated: true };
}

const TOOLS = {
  verify_manifest: {
    description: 'Verify an AIFeed manifest: signature, DNS _aifeed anchor, and result (VERIFIED/UNVERIFIED).',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['domain'],
      properties: { domain: { type: 'string', description: 'Origin domain, e.g. demo.aifeed.md' } }
    },
    handler: async (args) => {
      const domain = checkDomain(args.domain);
      const discovery = await remoteLib.discoverManifestUrl('https://' + domain, {
        timeout: TIMEOUT_MS,
        allowPrivate: allowPrivate()
      });
      const manifest = await fetchChecked(checkUrl(discovery.manifestUrl), {
        accept: 'application/json',
        allowedContentTypes: ['application/json'],
        maxBytes: 256 * 1024,
        timeout: TIMEOUT_MS,
        allowPrivate: allowPrivate()
      });
      const signature = await fetchChecked(checkUrl(discovery.manifestUrl.replace(/ai\.json$/, 'ai-signature.json')), {
        accept: 'application/json',
        allowedContentTypes: ['application/json'],
        maxBytes: 64 * 1024,
        timeout: TIMEOUT_MS,
        allowPrivate: allowPrivate()
      });
      const verified = validateLib.verifyAll({
        manifestText: manifest.text,
        manifestBytes: manifest.buffer,
        signatureText: signature.text,
        domain
      });
      return textResult({
        ok: true,
        domain,
        manifest_url: discovery.manifestUrl,
        result: verified.result,
        public_key: verified.manifest ? verified.manifest.identity.public_key : null,
        usage: verified.manifest ? verified.manifest.permissions.usage : null,
        errors: verified.errors || []
      });
    }
  },
  fetch_aifeed: {
    description: 'Fetch a page as token-budgeted AIFeed Markdown/MAKO with permissions and optional signature verification.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['url'],
      properties: {
        url: { type: 'string', description: 'Page URL (https)' },
        profile: { type: 'string', enum: ['aimd', 'mako'], description: 'Content profile (default aimd)' },
        max_tokens: { type: 'number', description: 'Token budget; body is truncated to fit' },
        publicKeyValue: { type: 'string', description: 'ed25519:… key to verify the page signature' }
      }
    },
    handler: async (args) => {
      const fetched = await fetchPage(checkUrl(args.url), args.profile === 'mako' ? 'mako' : 'aimd', args);
      const body = fetched.parsed.body === null ? '' : fetched.parsed.body;
      const trimmed = truncateToBudget(body, args.max_tokens);
      const block = fetched.parsed.frontmatter && fetched.parsed.frontmatter.aifeed ? fetched.parsed.frontmatter.aifeed : null;
      return textResult({
        ok: fetched.errors.length === 0,
        url: args.url,
        profile: fetched.profile,
        verified: fetched.verified,
        usage: block && block.usage ? block.usage : null,
        attribution: block && block.attribution ? block.attribution : null,
        tokens: estimateTokens(body),
        truncated: trimmed.truncated,
        markdown: trimmed.markdown,
        errors: fetched.errors
      });
    }
  },
  list_assets: {
    description: 'List the images, videos, audio, documents, and downloads a signed page declares.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['url'],
      properties: {
        url: { type: 'string', description: 'Page URL (https)' },
        profile: { type: 'string', enum: ['aimd', 'mako'], description: 'Content profile (default aimd)' },
        publicKeyValue: { type: 'string', description: 'ed25519:… key to verify the page signature' }
      }
    },
    handler: async (args) => {
      const fetched = await fetchPage(checkUrl(args.url), args.profile === 'mako' ? 'mako' : 'aimd', args);
      const list = fetched.parsed.frontmatter && fetched.parsed.frontmatter.aifeed && Array.isArray(fetched.parsed.frontmatter.aifeed.assets)
        ? fetched.parsed.frontmatter.aifeed.assets
        : [];
      return textResult({
        ok: fetched.errors.length === 0,
        url: args.url,
        verified: fetched.verified,
        assets: list.map((asset) => normalizeAsset(asset, args.url)).filter(Boolean),
        errors: fetched.errors
      });
    }
  },
  verify_asset: {
    description: 'Download a declared asset and verify its bytes against the page-declared size/sha-256.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['assetUrl', 'pageUrl'],
      properties: {
        assetUrl: { type: 'string', description: 'Asset URL (https)' },
        pageUrl: { type: 'string', description: 'Page that declares the asset (https)' },
        profile: { type: 'string', enum: ['aimd', 'mako'], description: 'Content profile (default aimd)' },
        publicKeyValue: { type: 'string', description: 'ed25519:… key to verify the page signature' }
      }
    },
    handler: async (args) => {
      const fetched = await fetchPage(checkUrl(args.pageUrl), args.profile === 'mako' ? 'mako' : 'aimd', args);
      const declared = fetched.parsed.frontmatter && fetched.parsed.frontmatter.aifeed && Array.isArray(fetched.parsed.frontmatter.aifeed.assets)
        ? fetched.parsed.frontmatter.aifeed.assets.map((asset) => normalizeAsset(asset, args.pageUrl)).filter(Boolean)
        : [];
      const asset = declared.find((entry) => entry.url === args.assetUrl);
      if (!asset) throw { code: -32602, message: 'asset not declared on ' + args.pageUrl };
      const response = await fetchChecked(checkUrl(args.assetUrl), {
        accept: '*/*',
        allowedContentTypes: [''],
        maxBytes: MAX_BYTES,
        timeout: TIMEOUT_MS,
        allowPrivate: allowPrivate()
      });
      const errors = [];
      if (Number.isInteger(asset.size) && asset.size >= 0 && response.buffer.length !== asset.size) {
        errors.push({ code: 'asset_size_mismatch', message: 'expected ' + asset.size + ' bytes, got ' + response.buffer.length });
      }
      if (typeof asset['sha-256'] === 'string' && asset['sha-256'] !== '') {
        const digest = digestLib.sha256Base64(response.buffer);
        if (digest !== asset['sha-256']) errors.push({ code: 'asset_digest_mismatch', message: 'sha-256 mismatch' });
      }
      const verified = Number.isInteger(asset.size) || typeof asset['sha-256'] === 'string';
      return textResult({
        ok: errors.length === 0,
        assetUrl: args.assetUrl,
        verified,
        size: response.buffer.length,
        'sha-256': verified ? digestLib.sha256Base64(response.buffer) : null,
        errors,
        warnings: verified ? [] : [{ code: 'asset_no_integrity', message: 'asset has no size or sha-256 to verify' }]
      });
    }
  },
  select_index: {
    description: 'Fetch a signed delta index and rank entries by query within page/token budgets.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['domain'],
      properties: {
        domain: { type: 'string', description: 'Origin domain, e.g. news.aifeed.md' },
        query: { type: 'string', description: 'Search terms to rank entries' },
        max_pages: { type: 'number', description: 'Maximum entries to select' },
        max_tokens: { type: 'number', description: 'Token budget across selected entries' },
        indexUrl: { type: 'string', description: 'Index URL override (default /.well-known/aifeed-index.json)' }
      }
    },
    handler: async (args) => {
      const domain = checkDomain(args.domain);
      const indexUrl = args.indexUrl ? checkUrl(args.indexUrl) : 'https://' + domain + '/.well-known/aifeed-index.json';
      const response = await fetchChecked(indexUrl, {
        accept: 'application/json',
        allowedContentTypes: ['application/json'],
        maxBytes: 5 * 1024 * 1024,
        timeout: TIMEOUT_MS,
        allowPrivate: allowPrivate()
      });
      let index;
      try {
        index = parse.parseStrict(response.text, { integersOnly: true, maxDepth: 10, requireNFC: true });
      } catch (error) {
        throw { code: -32602, message: 'index is not valid strict JSON: ' + error.message };
      }
      const schemaErrors = schemaLib.validate(index, makoIndexSchema, { root: makoIndexSchema });
      if (schemaErrors.length > 0) {
        throw { code: -32602, message: 'index schema violation: ' + schemaErrors[0].message };
      }
      const terms = String(args.query || '').toLowerCase().normalize('NFC').split(/[^\p{L}\p{N}]+/u).filter((term) => term.length >= 2);
      const scored = [];
      for (const entry of index.entries) {
        let score = 1;
        if (terms.length > 0) {
          score = 0;
          const haystack = [entry.title, entry.summary, entry.url, ...(entry.tags || [])].map((part) => String(part || '').toLowerCase());
          for (const term of terms) {
            if (String(entry.title || '').toLowerCase().includes(term)) score += 3;
            else if ((entry.tags || []).some((tag) => String(tag).toLowerCase().includes(term))) score += 2;
            else if (haystack.some((part) => part.includes(term))) score += 1;
          }
          if (score <= 0) continue;
        }
        scored.push({ entry, score });
      }
      scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return String(a.entry.url || '').localeCompare(String(b.entry.url || ''));
      });
      const maxPages = Number.isFinite(args.max_pages) ? Math.floor(args.max_pages) : Infinity;
      const maxTokens = Number.isFinite(args.max_tokens) ? Math.floor(args.max_tokens) : Infinity;
      const selected = [];
      let totalTokens = 0;
      for (const item of scored) {
        if (selected.length >= maxPages) break;
        const tokens = Number(item.entry.tokens) || 0;
        if (selected.length > 0 && totalTokens + tokens > maxTokens) continue;
        selected.push({ ...item.entry, score: item.score });
        totalTokens += tokens;
      }
      return textResult({ ok: true, index_url: indexUrl, selected, considered: scored.length, total_tokens: totalTokens });
    }
  },
  decide_usage: {
    description: 'Decide whether a usage (retrieval, training, summarize, …) is allowed on an origin.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['domain', 'usage'],
      properties: {
        domain: { type: 'string', description: 'Origin domain, e.g. shop.aifeed.md' },
        usage: { type: 'string', description: 'Usage key: search, retrieval, input, training, quote, summarize, reproduce, translate, modify, embed, commercial_use' },
        manifestUrl: { type: 'string', description: 'Manifest URL override' }
      }
    },
    handler: async (args) => {
      const domain = checkDomain(args.domain);
      const manifestUrl = args.manifestUrl ? checkUrl(args.manifestUrl) : 'https://' + domain + '/.well-known/ai.json';
      const manifest = await fetchChecked(manifestUrl, {
        accept: 'application/json',
        allowedContentTypes: ['application/json'],
        maxBytes: 256 * 1024,
        timeout: TIMEOUT_MS,
        allowPrivate: allowPrivate()
      });
      let document;
      try {
        document = parse.parseStrict(manifest.text, { integersOnly: true, maxDepth: 10, requireNFC: true });
      } catch (error) {
        throw { code: -32602, message: 'manifest is not valid strict JSON: ' + error.message };
      }
      const usage = document.permissions && document.permissions.usage ? document.permissions.usage[String(args.usage)] : undefined;
      return textResult({
        ok: true,
        domain,
        usage: String(args.usage),
        allowed: usage === 'allow',
        attribution: document.permissions ? document.permissions.attribution || null : null,
        reason: usage === 'allow' ? 'allowed' : 'denied'
      });
    }
  }
};

function toolList() {
  return Object.entries(TOOLS).map(([name, tool]) => ({
    name,
    description: tool.description,
    inputSchema: tool.inputSchema
  }));
}

function writeMessage(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

async function handleRequest(request) {
  const id = request.id === undefined || request.id === null ? null : request.id;
  if (request.method && request.method.startsWith('notifications/')) return null;
  if (id === null && request.method !== undefined) return null;
  if (request.method === 'initialize') {
    const requested = request.params && request.params.protocolVersion;
    const negotiated = PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0];
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: negotiated,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }
      }
    };
  }
  if (request.method === 'ping') {
    return { jsonrpc: '2.0', id, result: {} };
  }
  if (request.method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: toolList() } };
  }
  if (request.method === 'tools/call') {
    const name = request.params && request.params.name;
    const tool = TOOLS[name];
    if (!tool) return { jsonrpc: '2.0', id, error: { code: -32602, message: 'unknown tool: ' + String(name) } };
    try {
      const output = await tool.handler(request.params && request.params.arguments ? request.params.arguments : {});
      return { jsonrpc: '2.0', id, result: output };
    } catch (error) {
      if (error && Number.isInteger(error.code)) {
        return { jsonrpc: '2.0', id, result: errorResult(error.message) };
      }
      return { jsonrpc: '2.0', id, result: errorResult(error && error.message ? error.message : String(error)) };
    }
  }
  return { jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found: ' + String(request.method) } };
}

function start() {
  let buffer = '';
  let chain = Promise.resolve();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line === '') continue;
      chain = chain.then(async () => {
        let request;
        try {
          request = JSON.parse(line);
        } catch (error) {
          writeMessage({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
          return;
        }
        const requests = Array.isArray(request) ? request : [request];
        const responses = [];
        for (const item of requests) {
          try {
            const response = await handleRequest(item);
            if (response !== null) responses.push(response);
          } catch (error) {
            responses.push({ jsonrpc: '2.0', id: item && item.id !== undefined ? item.id : null, error: { code: -32603, message: error && error.message ? error.message : String(error) } });
          }
        }
        if (responses.length === 1 && !Array.isArray(request)) writeMessage(responses[0]);
        else if (responses.length > 0) writeMessage(responses);
      });
    }
  });
  process.stdin.on('end', () => {
    chain.then(() => process.exit(0));
  });
  process.stdin.resume();
}

if (require.main === module) {
  start();
}

module.exports = { TOOLS, toolList, handleRequest, SERVER_NAME, SERVER_VERSION, PROTOCOL_VERSIONS };
