/*!
 * ZCode RTL Fixer — renderer bootstrap (injected into out/renderer/index.html)
 *
 * Fixes mixed Persian/English text rendering in the ZCode Desktop chat box:
 *  - per-paragraph automatic direction (first-strong) via unicode-bidi: plaintext
 *  - Persian-friendly font for text blocks that contain Arabic-script glyphs
 *  - RTL tables when content is Persian-dominant; code blocks stay untouched
 *  - streaming-safe MutationObserver with rAF batching
 *
 * Settings are baked at patch time: __RTL_SETTINGS__ is replaced by the patcher.
 */
(function () {
  'use strict';

  var SETTINGS = __RTL_SETTINGS__;

  if (!SETTINGS || SETTINGS.enabled === false) return;
  if (window.__ZCODE_RTL_FIXER__) return;
  window.__ZCODE_RTL_FIXER__ = { version: '0.2.1', settings: SETTINGS };

  /* ------------------------------------------------------------------ *
   *  CSS
   * ------------------------------------------------------------------ */

  var CSS = [
    // Composer input: direction follows the typed text automatically.
    'textarea { unicode-bidi: plaintext; }',
    'div[contenteditable="true"], div[contenteditable=""] { unicode-bidi: plaintext; }',

    // Text blocks the engine marked: automatic paragraph direction,
    // aligned to the start edge (right for Persian, left for English).
    '.zcode-rtl-p {',
    '  unicode-bidi: plaintext;',
    '  text-align: start;',
    '}',

    // Persian font for blocks containing Arabic-script glyphs.
    '.zcode-rtl-fa {',
    '  font-family: ' + SETTINGS.fontFamily + ' !important;',
    '}',

    // Optional font-size compensation (Persian fonts often look smaller).
    SETTINGS.fontSizeScale && SETTINGS.fontSizeScale !== 1
      ? '.zcode-rtl-fa { font-size: calc(1em * ' + Number(SETTINGS.fontSizeScale) + '); }'
      : '',

    // RTL tables (only marked ones — code grids stay LTR).
    '.zcode-rtl-table, .zcode-rtl-table thead, .zcode-rtl-table tbody,',
    '.zcode-rtl-table tr, .zcode-rtl-table th, .zcode-rtl-table td {',
    '  direction: rtl;',
    '  text-align: start;',
    '}',

    // Persian list items: `direction: rtl` moves the marker (bullet/number) to the
    // right edge; unicode-bidi: plaintext keeps the text itself first-strong.
    'li.zcode-rtl-li {',
    '  direction: rtl;',
    '  unicode-bidi: plaintext;',
    '  text-align: start;',
    '}',

    // Headings inherit block direction; keep inline-code visually neutral.
    '.zcode-rtl-p code { unicode-bidi: isolate; direction: ltr; display: inline-block; }'
  ].filter(Boolean).join('\n');

  var styleEl = document.createElement('style');
  styleEl.id = 'zcode-rtl-fixer-style';
  styleEl.textContent = CSS;
  document.documentElement.appendChild(styleEl);

  /* ------------------------------------------------------------------ *
   *  Bidi heuristics
   * ------------------------------------------------------------------ */

  // Strong RTL characters: Arabic block + supplements + presentation forms.
  var RTL_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
  // Strong LTR: basic latin letters + latin extended + greek + cyrillic + hebrew? (hebrew is RTL; skip)
  var LTR_RE = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]/;

  function hasRtl(text) { return RTL_RE.test(text); }

  // "Persian-dominant": more strong RTL chars than strong LTR chars.
  function rtlDominant(text) {
    var rtl = 0, ltr = 0;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (RTL_RE.test(ch)) rtl++;
      else if (LTR_RE.test(ch)) ltr++;
    }
    return rtl > 0 && rtl >= ltr;
  }

  /* ------------------------------------------------------------------ *
   *  DOM scanner
   * ------------------------------------------------------------------ */

  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, CODE: 1, PRE: 1, KBD: 1, SAMP: 1, TEXTAREA: 1, NOSCRIPT: 1, SVG: 1 };

  function inCode(el) {
    var cur = el;
    while (cur && cur !== document.body) {
      var tag = cur.tagName;
      if (tag && SKIP_TAGS[tag]) return true;
      if (cur.classList) {
        if (cur.classList.contains('hljs')) return true;
        var cls = cur.getAttribute('class') || '';
        // "language-ts", "lang-java", "code-block", "pre-wrap", "mono" …
        if (/(^|\s)(language|lang)-/i.test(cls)) return true;
        if (/(^|\s)(code|pre|mono)[\s_-]/i.test(cls)) return true;
      }
      cur = cur.parentElement;
    }
    return false;
  }

  // An element is a "text block" when it has direct text nodes with content.
  function directText(el) {
    var out = '';
    for (var n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) out += n.nodeValue;
    }
    return out;
  }

  function mark(el, cls, on) {
    if (on) el.classList.add(cls);
    else el.classList.remove(cls);
  }

  function processElement(el) {
    if (el.nodeType !== 1) return;
    if (inCode(el)) return;

    var text = directText(el);
    var rtl = text && hasRtl(text);
    if (rtl) {
      el.classList.add('zcode-rtl-p');
      if (SETTINGS.fontEnabled) el.classList.add('zcode-rtl-fa');
      // List markers (bullets/numbers) sit on the physical side given by `direction`;
      // plain bidi plaintext fixes the text but not the marker. fixLists moves it.
      if (SETTINGS.fixLists && el.tagName === 'LI' && rtlDominant(text)) {
        el.classList.add('zcode-rtl-li');
      } else {
        el.classList.remove('zcode-rtl-li');
      }
    } else if (el.classList.contains('zcode-rtl-p') || el.classList.contains('zcode-rtl-fa') || el.classList.contains('zcode-rtl-li')) {
      // content replaced by LTR-only text (virtualized lists reuse nodes)
      el.classList.remove('zcode-rtl-p');
      el.classList.remove('zcode-rtl-fa');
      el.classList.remove('zcode-rtl-li');
    }
  }

  function processTable(table) {
    if (inCode(table)) return;
    var text = table.textContent || '';
    mark(table, 'zcode-rtl-table', SETTINGS.fixTables && rtlDominant(text));
  }

  function scan(root) {
    var scope;
    var tableRoot; // tables are re-judged only inside the scanned scope (streaming cost)
    if (root === document || root === document.body || root === document.documentElement) {
      scope = [document.body];
      tableRoot = document.body;
      if (document.body) scope = scope.concat([].slice.call(document.body.querySelectorAll('*')));
    } else if (root.nodeType === 1) {
      scope = [root].concat([].slice.call(root.querySelectorAll('*')));
      tableRoot = root;
    } else {
      return;
    }
    for (var i = 0; i < scope.length; i++) processElement(scope[i]);
    if (!tableRoot || !tableRoot.querySelectorAll) return;
    var tables = tableRoot.matches && tableRoot.matches('table')
      ? [tableRoot]
      : [].slice.call(tableRoot.querySelectorAll('table'));
    for (var t = 0; t < tables.length; t++) processTable(tables[t]);
  }

  /* ------------------------------------------------------------------ *
   *  Streaming-safe observation
   * ------------------------------------------------------------------ */

  var pending = false;
  var pendingNodes = [];

  function flush() {
    pending = false;
    var nodes = pendingNodes;
    pendingNodes = [];
    for (var i = 0; i < nodes.length; i++) scan(nodes[i]);
  }

  function scheduleScan(node) {
    pendingNodes.push(node);
    if (!pending) {
      pending = true;
      requestAnimationFrame(flush);
    }
  }

  function onMutations(muts) {
    for (var i = 0; i < muts.length; i++) {
      var m = muts[i];
      for (var j = 0; j < m.addedNodes.length; j++) {
        var n = m.addedNodes[j];
        if (n.nodeType === 1 && n.id !== 'zcode-rtl-fixer-style' && !n.classList.contains('zcode-rtl-fixer-style')) {
          scheduleScan(n);
        }
      }
      if (m.type === 'characterData' && m.target.parentElement) {
        scheduleScan(m.target.parentElement);
      }
    }
  }

  function start() {
    scan(document);
    var mo = new MutationObserver(onMutations);
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  /* ------------------------------------------------------------------ *
   *  Probe (for automated verification only)
   * ------------------------------------------------------------------ */

  if (SETTINGS.probe) {
    setInterval(function () {
      document.title = 'RTLPROBE-' + (document.body ? document.body.children.length : 'x');
    }, 1000);
    try { localStorage.setItem('__zcode_rtl_probe__', String(Date.now())); } catch (e) { /* ignore */ }
    document.documentElement.style.outline = '8px solid #ff2d55';
    document.documentElement.style.outlineOffset = '-8px';
  }
})();
