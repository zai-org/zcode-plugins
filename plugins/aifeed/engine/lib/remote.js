'use strict';

const https = require('node:https');
const dns = require('node:dns').promises;
const net = require('node:net');

function isPrivateIpv4(address) {
  const parts = address.split('.').map((part) => parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIpv6(address) {
  const value = address.toLowerCase();
  if (value === '::' || value === '::1') return true;
  if (value.startsWith('fe80')) return true;
  if (value.startsWith('fc') || value.startsWith('fd')) return true;
  if (value.startsWith('::ffff:')) return isPrivateIpv4(value.slice(7));
  return false;
}

function isPrivateAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return true;
}

async function resolvePinnedAddress(hostname, options = {}) {
  if (net.isIP(hostname)) {
    if (!options.allowPrivate && isPrivateAddress(hostname)) {
      const error = new Error('refusing to fetch private address: ' + hostname);
      error.code = 'private_address_blocked';
      throw error;
    }
    return { address: hostname, family: net.isIP(hostname) };
  }
  const results = await dns.lookup(hostname, { all: true });
  if (results.length === 0) {
    const error = new Error('hostname did not resolve: ' + hostname);
    error.code = 'dns_resolution_failed';
    throw error;
  }
  if (!options.allowPrivate) {
    for (const result of results) {
      if (isPrivateAddress(result.address)) {
        const error = new Error('hostname resolves to private address: ' + result.address);
        error.code = 'private_address_blocked';
        throw error;
      }
    }
  }
  return { address: results[0].address, family: results[0].family };
}

function fetchText(url, options = {}) {
  const timeout = options.timeout ?? 10000;
  const maxBytes = options.maxBytes ?? 100 * 1024;
  const allowPrivate = options.allowPrivate ?? false;
  const ca = options.ca;
  const accept = options.accept ?? 'application/json';
  const allowedContentTypes = options.allowedContentTypes ?? ['application/json'];

  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      const err = new Error('invalid URL: ' + url);
      err.code = 'invalid_url';
      reject(err);
      return;
    }
    if (parsed.protocol !== 'https:') {
      const err = new Error('only https URLs are allowed');
      err.code = 'https_required';
      reject(err);
      return;
    }
    if (parsed.username || parsed.password) {
      const err = new Error('credentials in URL are not allowed');
      err.code = 'credentials_not_allowed';
      reject(err);
      return;
    }
    if (net.isIP(parsed.hostname) && !allowPrivate && isPrivateAddress(parsed.hostname)) {
      const err = new Error('refusing to fetch private address: ' + parsed.hostname);
      err.code = 'private_address_blocked';
      reject(err);
      return;
    }
    if (parsed.port && parsed.port !== '443' && !allowPrivate) {
      const err = new Error('non-standard ports are not allowed: ' + parsed.port);
      err.code = 'port_not_allowed';
      reject(err);
      return;
    }

    resolvePinnedAddress(parsed.hostname, { allowPrivate })
      .then((pinned) => {
        const pinnedLookup = (hostname, lookupOptions, callback) => {
          if (lookupOptions && lookupOptions.all) {
            callback(null, [pinned]);
          } else {
            callback(null, pinned.address, pinned.family);
          }
        };
        const request = https.request(
          parsed,
          {
            method: 'GET',
            timeout,
            lookup: pinnedLookup,
            ca,
            headers: {
              accept,
              'accept-encoding': 'identity',
              'user-agent': 'AIFeedValidate/0.1 (+https://aifeed.md)'
            }
          },
          (response) => {
            let settled = false;
            const fail = (err) => {
              if (settled) return;
              settled = true;
              try {
                response.resume();
              } catch (resumeError) {
                // ignore resume errors during teardown
              }
              try {
                request.destroy();
              } catch (destroyError) {
                // ignore destroy errors during teardown
              }
              reject(err);
            };
            const remoteAddress = response.socket && response.socket.remoteAddress;
            if (remoteAddress && net.isIP(remoteAddress)) {
              const sameAddress = remoteAddress === pinned.address;
              const mappedAddress = pinned.family === 4 && remoteAddress === '::ffff:' + pinned.address;
              if (!sameAddress && !mappedAddress) {
                const err = new Error('connection address changed (possible DNS rebinding)');
                err.code = 'dns_rebinding_detected';
                fail(err);
                return;
              }
            }
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
            const contentEncoding = String(response.headers['content-encoding'] || 'identity').toLowerCase();
            if (contentEncoding !== 'identity') {
              const err = new Error('unsupported content-encoding: ' + contentEncoding);
              err.code = 'unsupported_content_encoding';
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
                return;
              }
              chunks.push(chunk);
            });
            response.on('end', () => {
              if (settled) return;
              const buffer = Buffer.concat(chunks);
              resolve({ status: response.statusCode, headers: response.headers, buffer, text: buffer.toString('utf8') });
            });
            response.on('error', (error) => {
              if (!error.code) error.code = 'network_error';
              fail(error);
            });
          }
        );
        request.on('timeout', () => {
          const err = new Error('request timed out after ' + timeout + ' ms');
          err.code = 'timeout';
          request.destroy(err);
          reject(err);
        });
        request.on('error', (error) => {
          if (!error.code) error.code = 'network_error';
          reject(error);
        });
        request.end();
      })
      .catch(reject);
  });
}

function parseTxtRecord(value) {
  const result = {};
  for (const part of value.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const val = trimmed.slice(index + 1).trim();
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      const error = new Error('duplicate key in TXT record: ' + key);
      error.code = 'txt_duplicate_key';
      throw error;
    }
    result[key] = val;
  }
  return result;
}

async function lookupAifeedTxt(domain) {
  const name = '_aifeed.' + domain;
  try {
    const records = await dns.resolveTxt(name);
    return records.map((chunks) => parseTxtRecord(chunks.join('')));
  } catch (error) {
    if (error.code === 'ENOTFOUND' || error.code === 'ENODATA' || error.code === 'ESERVFAIL') {
      return [];
    }
    throw error;
  }
}

function findAiFeedInLinkHeader(headerValue, base) {
  for (const part of String(headerValue || '').split(/,(?=\s*<)/)) {
    if (!/rel\s*=\s*"?ai-feed"?/i.test(part)) continue;
    const match = part.match(/<([^>]+)>/);
    if (match) {
      try {
        return new URL(match[1], base).toString();
      } catch (error) {
        return null;
      }
    }
  }
  return null;
}

function findAiFeedInHtml(html, base) {
  const tag = String(html).match(/<link[^>]+rel=["']ai-feed["'][^>]*>/i);
  if (!tag) return null;
  const href = tag[0].match(/href=["']([^"']+)["']/i);
  if (!href) return null;
  try {
    return new URL(href[1], base).toString();
  } catch (error) {
    return null;
  }
}

async function discoverManifestUrl(baseUrl, options = {}) {
  let base;
  try {
    base = new URL(baseUrl);
  } catch (error) {
    const err = new Error('invalid base URL: ' + baseUrl);
    err.code = 'invalid_url';
    throw err;
  }
  const fallback = new URL('/.well-known/ai.json', base).toString();
  const { manifestUrl = null, ...fetchOptions } = options;

  let response;
  try {
    response = await fetchText(base.toString(), {
      ...fetchOptions,
      accept: 'text/html,application/xhtml+xml',
      allowedContentTypes: ['text/html', 'application/xhtml+xml'],
      maxBytes: fetchOptions.maxBytes ?? 64 * 1024
    });
  } catch (error) {
    return { manifestUrl: manifestUrl || fallback, discoveredVia: 'fallback', error: error.code || 'network_error' };
  }

  const fromHeader = findAiFeedInLinkHeader(response.headers.link, base);
  if (fromHeader) return { manifestUrl: fromHeader, discoveredVia: 'link-header' };

  const fromHtml = findAiFeedInHtml(response.text, base);
  if (fromHtml) return { manifestUrl: fromHtml, discoveredVia: 'html-link' };

  return { manifestUrl: fallback, discoveredVia: 'fallback' };
}

module.exports = {
  fetchText,
  lookupAifeedTxt,
  isPrivateAddress,
  parseTxtRecord,
  resolvePinnedAddress,
  discoverManifestUrl,
  findAiFeedInLinkHeader,
  findAiFeedInHtml
};
