'use strict';

const MAKO_TYPES = ['product', 'article', 'docs', 'landing', 'profile', 'listing', 'event', 'recipe', 'faq', 'custom'];

const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '\u2014',
  ndash: '\u2013',
  hellip: '\u2026',
  laquo: '\u00ab',
  raquo: '\u00bb',
  copy: '\u00a9',
  reg: '\u00ae',
  trade: '\u2122',
  euro: '\u20ac',
  pound: '\u00a3',
  yen: '\u00a5',
  times: '\u00d7',
  middot: '\u00b7',
  bull: '\u2022',
  rsquo: '\u2019',
  lsquo: '\u2018',
  ldquo: '\u201c',
  rdquo: '\u201d'
};

function decodeEntities(text) {
  return String(text)
    .replace(/&#x([0-9a-fA-F]+);/g, (match, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    })
    .replace(/&#([0-9]+);/g, (match, dec) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    })
    .replace(/&([a-zA-Z]+);/g, (match, name) => {
      const lower = name.toLowerCase();
      return ENTITIES[lower] !== undefined ? ENTITIES[lower] : match;
    });
}

function stripElements(html, tags) {
  let out = html;
  for (const tag of tags) {
    const paired = new RegExp('<' + tag + '\\b[^>]*>[\\s\\S]*?<\\/' + tag + '\\s*>', 'gi');
    out = out.replace(paired, ' ');
    const selfClosing = new RegExp('<' + tag + '\\b[^>]*\\/?>', 'gi');
    out = out.replace(selfClosing, ' ');
  }
  return out;
}

function normalizeDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  const direct = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  if (direct) return direct[1];
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
}

function extractMeta(html) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const descriptionMatch = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i) ||
    html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i);
  const ogTitleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']*)["']/i);
  const canonicalMatch = html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);
  const langMatch = html.match(/<html[^>]+lang=["']([^"']+)["']/i);
  const ogImageMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']*)["']/i);
  const updatedMatch =
    html.match(/<meta[^>]+property=["']article:modified_time["'][^>]*content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+property=["']og:updated_time["'][^>]*content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+name=["']last-modified["'][^>]*content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+property=["']article:published_time["'][^>]*content=["']([^"']+)["']/i) ||
    html.match(/<time\b[^>]*datetime=["']([^"']+)["']/i);
  const keywordsMatch = html.match(/<meta[^>]+name=["']keywords["'][^>]*content=["']([^"']*)["'][^>]*>/i) ||
    html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']keywords["'][^>]*>/i);
  return {
    title: decodeEntities((titleMatch ? titleMatch[1] : (ogTitleMatch ? ogTitleMatch[1] : '')).trim()),
    description: decodeEntities((descriptionMatch ? descriptionMatch[1] : '').trim()),
    canonical: canonicalMatch ? canonicalMatch[1].trim() : null,
    language: langMatch ? langMatch[1].trim() : null,
    ogImage: ogImageMatch ? ogImageMatch[1].trim() : null,
    updated: normalizeDate(updatedMatch ? updatedMatch[1] : null),
    tags: keywordsMatch
      ? keywordsMatch[1].split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 10)
      : []
  };
}

function extractMain(html) {
  const mainMatch = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  if (mainMatch) return mainMatch[1];
  const articleMatch = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  if (articleMatch) return articleMatch[1];
  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) return bodyMatch[1];
  return html;
}

function inlineLinks(html) {
  let out = html;
  out = out.replace(/<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (match, href, label) => {
    const text = label.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    return '[' + text + '](' + href.trim() + ')';
  });
  out = out.replace(/<img\b[^>]*>/gi, (match) => {
    const src = match.match(/src=["']([^"']+)["']/i);
    const alt = match.match(/alt=["']([^"']*)["']/i);
    if (!src) return '';
    return '![' + (alt ? alt[1].trim() : '') + '](' + src[1].trim() + ')';
  });
  return out;
}

function convertBlocks(html) {
  let out = html;
  out = out.replace(/\r\n?/g, '\n');
  out = out.replace(/<!--[\s\S]*?-->/g, ' ');
  out = stripElements(out, ['script', 'style', 'noscript', 'svg', 'template', 'iframe', 'nav', 'footer', 'aside', 'form', 'button', 'select', 'option']);
  out = out.replace(/<(section|div)\b[^>]*class=["'][^"']*(comment|related|sidebar|promo|newsletter|ads?)[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi, ' ');

  out = out.replace(/<pre\b[^>]*>\s*<code\b[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi, (match, code) => {
    const text = decodeEntities(code.replace(/<[^>]+>/g, ''));
    return '\n```\n' + text.replace(/\n+$/, '') + '\n```\n\n';
  });
  out = out.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (match, code) => {
    const text = decodeEntities(code.replace(/<[^>]+>/g, ''));
    return '\n```\n' + text.replace(/\n+$/, '') + '\n```\n\n';
  });

  for (let level = 1; level <= 6; level++) {
    const pattern = new RegExp('<h' + level + '\\b[^>]*>([\\s\\S]*?)<\\/h' + level + '>', 'gi');
    out = out.replace(pattern, (match, content) => {
      const text = inlineLinks(content).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      return text ? '\n' + '#'.repeat(level) + ' ' + text + '\n\n' : '';
    });
  }

  out = out.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (match, content) => {
    const text = inlineLinks(content)
      .replace(/<p\b[^>]*>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text ? '- ' + text + '\n' : '';
  });
  out = out.replace(/<\/?(ul|ol)\b[^>]*>/gi, '\n');

  out = out.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (match, content) => {
    const text = inlineLinks(content).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return text ? '\n' + text.split(/(?<=[.!?])\s+/).map((line) => '> ' + line).join('\n') + '\n\n' : '';
  });

  out = out.replace(/<\/?(p|div|section|header|article|main|figure|figcaption|table|thead|tbody|tr)\b[^>]*>/gi, '\n\n');
  out = out.replace(/<\/?(td|th)\b[^>]*>/gi, ' | ');
  out = out.replace(/<hr\b[^>]*\/?>/gi, '\n\n---\n\n');
  out = out.replace(/<br\b[^>]*\/?>/gi, '\n');

  out = out.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');
  out = out.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*');
  out = out.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (match, content) => '`' + content.replace(/<[^>]+>/g, '') + '`');

  out = inlineLinks(out);
  out = out.replace(/<[^>]+>/g, ' ');
  out = decodeEntities(out);

  out = out.replace(/[ \t]+\n/g, '\n');
  out = out.replace(/\n{3,}/g, '\n\n');
  out = out.replace(/[ \t]{2,}/g, ' ');
  out = out.replace(/\n +/g, '\n');
  return out.trim();
}

function estimateTokens(text) {
  const words = String(text).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words * 1.33));
}

function truncateToTokens(text, maxTokens) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const maxWords = Math.floor(maxTokens / 1.33);
  if (words.length <= maxWords) return { text, truncated: false };
  const cut = words.slice(0, maxWords).join(' ');
  const lastSentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  const body = lastSentence > cut.length * 0.5 ? cut.slice(0, lastSentence + 1) : cut;
  return { text: body + '\u2026', truncated: true };
}

function yamlScalar(value) {
  if (typeof value === 'number' && Number.isInteger(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

const DOCUMENT_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md', 'csv', 'xls', 'xlsx', 'ppt', 'pptx', 'epub']);
const ARCHIVE_EXTENSIONS = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2']);
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif', 'bmp', 'tiff']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v', 'm3u8']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac']);

const MIME_TYPES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp', tiff: 'image/tiff',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
  m4v: 'video/x-m4v', m3u8: 'application/vnd.apple.mpegurl',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4',
  aac: 'audio/aac', flac: 'audio/flac',
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', rtf: 'application/rtf',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text', epub: 'application/epub+zip',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed',
  tar: 'application/x-tar', gz: 'application/gzip', tgz: 'application/gzip', bz2: 'application/x-bzip2'
};

function mimeOf(url) {
  return MIME_TYPES[extensionOf(url)] || null;
}

function extensionOf(url) {
  const clean = String(url).split('#')[0].split('?')[0];
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(clean);
  return match ? match[1].toLowerCase() : '';
}

function classifyAsset(url) {
  const extension = extensionOf(url);
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
  if (DOCUMENT_EXTENSIONS.has(extension)) return 'document';
  if (ARCHIVE_EXTENSIONS.has(extension)) return 'archive';
  return null;
}

function extractAssets(html, options = {}) {
  const assets = [];
  const seen = new Set();
  const push = (url, type, title, alt) => {
    const value = String(url || '').trim();
    if (!value || !isSafeAssetUrl(value)) return;
    const key = value + '|' + type;
    if (seen.has(key)) return;
    seen.add(key);
    const asset = { url: value, type };
    if (title) asset.title = String(title).slice(0, 500);
    if (alt) asset.alt = String(alt).slice(0, 500);
    const mime = mimeOf(value);
    if (mime) asset.mime = mime;
    if (typeof options.assetDetails === 'function') {
      let details = null;
      try {
        details = options.assetDetails(value);
      } catch (error) {
        details = null;
      }
      if (details && Number.isInteger(details.size) && details.size >= 0) asset.size = details.size;
      if (details && typeof details.sha256 === 'string') asset['sha-256'] = details.sha256;
    }
    assets.push(asset);
  };

  let match;
  const imgPattern = /<img\b[^>]*>/gi;
  while ((match = imgPattern.exec(html)) !== null) {
    const src = match[0].match(/\bsrc=["']([^"']+)["']/i);
    if (!src) continue;
    const alt = match[0].match(/\balt=["']([^"']*)["']/i);
    push(src[1], 'image', alt ? alt[1] : '', alt ? alt[1] : '');
  }

  const videoPattern = /<video\b[^>]*>[\s\S]*?<\/video>|<video\b[^>]*\/?>/gi;
  while ((match = videoPattern.exec(html)) !== null) {
    const block = match[0];
    const src = block.match(/<video\b[^>]*\bsrc=["']([^"']+)["']/i);
    if (src) push(src[1], classifyAsset(src[1]) || 'video', 'Video', '');
    for (const source of block.matchAll(/<source\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
      push(source[1], classifyAsset(source[1]) || 'video', 'Video', '');
    }
  }

  const audioPattern = /<audio\b[^>]*>[\s\S]*?<\/audio>|<audio\b[^>]*\/?>/gi;
  while ((match = audioPattern.exec(html)) !== null) {
    const block = match[0];
    const src = block.match(/<audio\b[^>]*\bsrc=["']([^"']+)["']/i);
    if (src) push(src[1], classifyAsset(src[1]) || 'audio', 'Audio', '');
    for (const source of block.matchAll(/<source\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
      push(source[1], classifyAsset(source[1]) || 'audio', 'Audio', '');
    }
  }

  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  while ((match = anchorPattern.exec(html)) !== null) {
    const href = match[1];
    const text = match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    let type = classifyAsset(href);
    if (!type && /\bdownload\b/i.test(match[0])) type = 'file';
    if (!type) continue;
    push(href, type, text || href, text || '');
  }

  const objectPattern = /<(?:embed|object)\b[^>]*\b(?:src|data)=["']([^"']+)["']/gi;
  while ((match = objectPattern.exec(html)) !== null) {
    push(match[1], classifyAsset(match[1]) || 'file', 'Embed', '');
  }

  return assets;
}

function isSafeAssetUrl(value) {
  if (/^(https?:)?\/\//i.test(value)) return true;
  if (value.startsWith('/')) return true;
  if (value.startsWith('mailto:') || value.startsWith('data:') || value.startsWith('javascript:')) return false;
  return /^[\w./-]+$/.test(value);
}

function assetsSection(assets) {
  if (assets.length === 0) return '';
  const lines = assets.slice(0, 25).map((asset) => '- [' + (asset.title || asset.url) + '](' + asset.url + ') \u2014 ' + asset.type);
  return '\n## Media & Unduhan\n\n' + lines.join('\n') + '\n';
}

function renderYaml(value, indent) {
  const pad = ' '.repeat(indent);
  const lines = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
        const entries = Object.entries(item).filter(([, entry]) => entry !== undefined && entry !== null);
        if (entries.length === 0) continue;
        const [firstKey, firstValue] = entries[0];
        if (firstValue !== null && typeof firstValue === 'object') {
          lines.push(pad + '- ' + firstKey + ':');
          lines.push(renderYaml(firstValue, indent + 4));
        } else {
          lines.push(pad + '- ' + firstKey + ': ' + yamlScalar(firstValue));
        }
        for (const [key, entry] of entries.slice(1)) {
          if (entry !== null && typeof entry === 'object') {
            lines.push(pad + '  ' + key + ':');
            lines.push(renderYaml(entry, indent + 4));
          } else {
            lines.push(pad + '  ' + key + ': ' + yamlScalar(entry));
          }
        }
      } else if (item !== null && typeof item === 'object') {
        lines.push(pad + '-');
        lines.push(renderYaml(item, indent + 2));
      } else {
        lines.push(pad + '- ' + yamlScalar(item));
      }
    }
    return lines.join('\n');
  }
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined || entry === null) continue;
    if (Array.isArray(entry) || (typeof entry === 'object' && entry !== null)) {
      const nested = renderYaml(entry, indent + 2);
      if (nested.trim() === '') continue;
      lines.push(pad + key + ':');
      lines.push(nested);
    } else {
      lines.push(pad + key + ': ' + yamlScalar(entry));
    }
  }
  return lines.join('\n');
}

function buildAifeedBlock(aifeed) {
  if (!aifeed || typeof aifeed !== 'object') return null;
  const block = {};
  if (aifeed.policy_version) block.policy_version = aifeed.policy_version;
  if (aifeed.usage && Object.keys(aifeed.usage).length > 0) block.usage = aifeed.usage;
  if (aifeed.attribution) block.attribution = aifeed.attribution;
  if (aifeed.attribution_url) block.attribution_url = aifeed.attribution_url;
  if (aifeed.attribution_text) block.attribution_text = aifeed.attribution_text;
  if (aifeed.limits && Object.keys(aifeed.limits).length > 0) block.limits = aifeed.limits;
  if (aifeed.license && Object.keys(aifeed.license).length > 0) block.license = aifeed.license;
  return Object.keys(block).length > 0 ? block : null;
}

function htmlToMako(html, options = {}) {
  const warnings = [];
  const profile = options.profile === 'aimd' ? 'aimd' : options.profile === 'both' ? 'both' : 'mako';
  const meta = extractMeta(html);
  const main = extractMain(html);
  let body = convertBlocks(main);

  const entity = options.entity || meta.title || 'Untitled';
  const type = options.type || 'article';
  if (!MAKO_TYPES.includes(type)) {
    warnings.push({ code: 'mako_type_invalid', message: 'unknown type "' + type + '"; using "article"' });
  }
  const assets = options.assets === false ? [] : extractAssets(main, { assetDetails: options.assetDetails });
  const tokens = estimateTokens(body);
  const maxTokens = options.maxTokens ?? (profile === 'mako' ? 1000 : 4000);
  let truncated = false;
  if (tokens > maxTokens) {
    const result = truncateToTokens(body, maxTokens);
    body = result.text;
    truncated = result.truncated;
    warnings.push({
      code: 'mako_body_truncated',
      message: 'body exceeded ' + maxTokens + ' tokens and was truncated'
    });
  }
  const finalBody = options.assetsSection === false ? body : body + assetsSection(assets);

  const frontmatter = {};
  if (profile === 'aimd' || profile === 'both') frontmatter.aimd = '1.0';
  if (profile === 'mako' || profile === 'both') frontmatter.mako = '1.0';
  frontmatter.type = MAKO_TYPES.includes(type) ? type : 'article';
  frontmatter.entity = entity;
  frontmatter.updated = options.updated ||
    (options.useMetaDates && meta.updated ? meta.updated : new Date().toISOString().slice(0, 10));
  frontmatter.tokens = estimateTokens(finalBody);
  frontmatter.language = options.language || (meta.language ? meta.language.split('-')[0].toLowerCase() : 'en');
  const canonical = options.canonical || meta.canonical;
  if (canonical) frontmatter.canonical = canonical;
  const summary = options.summary || meta.description;
  if (summary) frontmatter.summary = summary.slice(0, 160);
  const tags = Array.isArray(options.tags) && options.tags.length > 0
    ? options.tags
    : (options.useMetaTags ? meta.tags : []);
  if (tags.length > 0) frontmatter.tags = tags.slice(0, 50);
  if (options.related && options.related.length > 0) frontmatter.related = options.related.slice(0, 100);
  if (Array.isArray(options.alternates) && options.alternates.length > 0) {
    frontmatter.alternates = options.alternates.slice(0, 20);
  }
  if (meta.ogImage) frontmatter.media = { cover: { url: meta.ogImage, alt: entity.slice(0, 200) } };
  const aifeedBlock = buildAifeedBlock(options.aifeed) || {};
  if (assets.length > 0) aifeedBlock.assets = assets.slice(0, options.maxAssets ?? 100);
  if (Object.keys(aifeedBlock).length > 0) frontmatter.aifeed = aifeedBlock;

  const text = '---\n' + renderYaml(frontmatter, 0) + '\n---\n\n' + finalBody + '\n';
  return { text, frontmatter, body: finalBody, warnings, meta, truncated, assets };
}

module.exports = {
  MAKO_TYPES,
  decodeEntities,
  extractMeta,
  convertBlocks,
  extractAssets,
  assetsSection,
  classifyAsset,
  mimeOf,
  estimateTokens,
  renderYaml,
  htmlToMako
};
