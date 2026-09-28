// zc-prism v10 (installed by the Prism plugin for ZCode)
// Per-project AND per-conversation color + icon for the ZCode desktop
// sidebar, a right-click picker on project headers, and an opt-out recency
// ordering for every sidebar view. Everything here runs inside the production
// renderer and must never break the app: every entry point is defensive.
// Icons are Lucide path data extracted from the app's own renderer chunks.
(() => {
  try {
    if (window.__zcPrism) return;
    const STORE_KEY = "zcProjectTint.v1";
    const ICON_STORE_KEY = "zcProjectTint.icons.v1";
    const ALIAS_STORE_KEY = "zcProjectTint.aliases.v1";
    const HEADER_PREFIX = "workspace-item-";
    const ROW_SELECTOR = "li[data-task-item-key], div[data-grouped-task-key]";
    const HEADER_SELECTOR = 'div[data-testid^="' + HEADER_PREFIX + '"]';
    const HUES = [0, 25, 50, 95, 140, 165, 190, 215, 240, 270, 300, 330];
    const ICONS = {
  "code-xml": "<path d=\"m18 16 4-4-4-4\"/><path d=\"m6 8-4 4 4 4\"/><path d=\"m14.5 4-5 16\"/>",
  "terminal": "<path d=\"M12 19h8\"/><path d=\"m4 17 6-6-6-6\"/>",
  "database": "<ellipse cx=\"12\" cy=\"5\" rx=\"9\" ry=\"3\"/><path d=\"M3 5V19A9 3 0 0 0 21 19V5\"/><path d=\"M3 12A9 3 0 0 0 21 12\"/>",
  "globe": "<circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20\"/><path d=\"M2 12h20\"/>",
  "git-branch": "<path d=\"M15 6a9 9 0 0 0-9 9V3\"/><circle cx=\"18\" cy=\"6\" r=\"3\"/><circle cx=\"6\" cy=\"18\" r=\"3\"/>",
  "palette": "<path d=\"M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z\"/><circle cx=\"13.5\" cy=\"6.5\" r=\".5\" fill=\"currentColor\"/><circle cx=\"17.5\" cy=\"10.5\" r=\".5\" fill=\"currentColor\"/><circle cx=\"6.5\" cy=\"12.5\" r=\".5\" fill=\"currentColor\"/><circle cx=\"8.5\" cy=\"7.5\" r=\".5\" fill=\"currentColor\"/>",
  "music-2": "<circle cx=\"8\" cy=\"18\" r=\"4\"/><path d=\"M12 18V2l7 4\"/>",
  "video": "<path d=\"m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5\"/><rect x=\"2\" y=\"6\" width=\"14\" height=\"12\" rx=\"2\"/>",
  "image": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" ry=\"2\"/><circle cx=\"9\" cy=\"9\" r=\"2\"/><path d=\"m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21\"/>",
  "book-open": "<path d=\"M12 7v14\"/><path d=\"M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z\"/>",
  "pen-tool": "<path d=\"M15.707 21.293a1 1 0 0 1-1.414 0l-1.586-1.586a1 1 0 0 1 0-1.414l5.586-5.586a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414z\"/><path d=\"m18 13-1.375-6.874a1 1 0 0 0-.746-.776L3.235 2.028a1 1 0 0 0-1.207 1.207L5.35 15.879a1 1 0 0 0 .776.746L13 18\"/><path d=\"m2.3 2.3 7.286 7.286\"/><circle cx=\"11\" cy=\"11\" r=\"2\"/>",
  "flask-conical": "<path d=\"M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2\"/><path d=\"M6.453 15h11.094\"/><path d=\"M8.5 2h7\"/>",
  "message-square": "<path d=\"M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z\"/>",
  "rocket": "<path d=\"M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5\"/><path d=\"M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09\"/><path d=\"M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z\"/><path d=\"M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05\"/>",
  "sparkles": "<path d=\"M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z\"/><path d=\"M20 2v4\"/><path d=\"M22 4h-4\"/><circle cx=\"4\" cy=\"20\" r=\"2\"/>",
  "wrench": "<path d=\"M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z\"/>",
  "bug": "<path d=\"M12 20v-9\"/><path d=\"M14 7a4 4 0 0 1 4 4v3a6 6 0 0 1-12 0v-3a4 4 0 0 1 4-4z\"/><path d=\"M14.12 3.88 16 2\"/><path d=\"M21 21a4 4 0 0 0-3.81-4\"/><path d=\"M21 5a4 4 0 0 1-3.55 3.97\"/><path d=\"M22 13h-4\"/><path d=\"M3 21a4 4 0 0 1 3.81-4\"/><path d=\"M3 5a4 4 0 0 0 3.55 3.97\"/><path d=\"M6 13H2\"/><path d=\"m8 2 1.88 1.88\"/><path d=\"M9 7.13V6a3 3 0 1 1 6 0v1.13\"/>",
  "target": "<circle cx=\"12\" cy=\"12\" r=\"10\"/><circle cx=\"12\" cy=\"12\" r=\"6\"/><circle cx=\"12\" cy=\"12\" r=\"2\"/>",
  "tag": "<path d=\"M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z\"/><circle cx=\"7.5\" cy=\"7.5\" r=\".5\" fill=\"currentColor\"/>",
  "house": "<path d=\"M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8\"/><path d=\"M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z\"/>",
  "hard-drive": "<path d=\"M10 16h.01\"/><path d=\"M2.212 11.577a2 2 0 0 0-.212.896V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5.527a2 2 0 0 0-.212-.896L18.55 5.11A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z\"/><path d=\"M21.946 12.013H2.054\"/><path d=\"M6 16h.01\"/>",
  "package": "<path d=\"M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z\"/><path d=\"M12 22V12\"/><polyline points=\"3.29 7 12 12 20.71 7\"/><path d=\"m7.5 4.27 9 5.15\"/>",
  "files": "<path d=\"M15 2h-4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8\"/><path d=\"M16.706 2.706A2.4 2.4 0 0 0 15 2v5a1 1 0 0 0 1 1h5a2.4 2.4 0 0 0-.706-1.706z\"/><path d=\"M5 7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 1.732-1\"/>",
  "calendar-days": "<path d=\"M8 2v4\"/><path d=\"M16 2v4\"/><rect width=\"18\" height=\"18\" x=\"3\" y=\"4\" rx=\"2\"/><path d=\"M3 10h18\"/><path d=\"M8 14h.01\"/><path d=\"M12 14h.01\"/><path d=\"M16 14h.01\"/><path d=\"M8 18h.01\"/><path d=\"M12 18h.01\"/><path d=\"M16 18h.01\"/>",
  "chart-line": "<path d=\"M3 3v16a2 2 0 0 0 2 2h16\"/><path d=\"m19 9-5 5-4-4-3 3\"/>",
  "users": "<path d=\"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2\"/><path d=\"M16 3.128a4 4 0 0 1 0 7.744\"/><path d=\"M22 21v-2a4 4 0 0 0-3-3.87\"/><circle cx=\"9\" cy=\"7\" r=\"4\"/>",
  "cpu": "<path d=\"M12 20v2\"/><path d=\"M12 2v2\"/><path d=\"M17 20v2\"/><path d=\"M17 2v2\"/><path d=\"M2 12h2\"/><path d=\"M2 17h2\"/><path d=\"M2 7h2\"/><path d=\"M20 12h2\"/><path d=\"M20 17h2\"/><path d=\"M20 7h2\"/><path d=\"M7 20v2\"/><path d=\"M7 2v2\"/><rect x=\"4\" y=\"4\" width=\"16\" height=\"16\" rx=\"2\"/><rect x=\"8\" y=\"8\" width=\"8\" height=\"8\" rx=\"1\"/>",
  "lightbulb": "<path d=\"M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5\"/><path d=\"M9 18h6\"/><path d=\"M10 22h4\"/>",
  "workflow": "<rect width=\"8\" height=\"8\" x=\"3\" y=\"3\" rx=\"2\"/><path d=\"M7 11v4a2 2 0 0 0 2 2h4\"/><rect width=\"8\" height=\"8\" x=\"13\" y=\"13\" rx=\"2\"/>",
  "briefcase-business": "<path d=\"M12 12h.01\"/><path d=\"M16 6V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2\"/><path d=\"M22 13a18.15 18.15 0 0 1-20 0\"/><rect width=\"20\" height=\"14\" x=\"2\" y=\"6\" rx=\"2\"/>"
};

    // Entity-escaped attributes (e.g. d=&quot;...&quot;) parse as UNQUOTED
    // attributes in innerHTML, truncating path data at the first space, so
    // decode before building markup.
    function iconInner(id) {
      return String(ICONS[id] || "").replace(/&quot;/g, '"');
    }

    function readMap() {
      try {
        const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
        return raw && typeof raw === "object" ? raw : {};
      } catch (_) {
        return {};
      }
    }
    function writeMap(map) {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(map));
      } catch (_) {}
    }
    function readIconMap() {
      try {
        const raw = JSON.parse(localStorage.getItem(ICON_STORE_KEY) || "{}");
        return raw && typeof raw === "object" ? raw : {};
      } catch (_) {
        return {};
      }
    }
    function writeIconMap(map) {
      try {
        localStorage.setItem(ICON_STORE_KEY, JSON.stringify(map));
      } catch (_) {}
    }
    function readAliasMap() {
      try {
        const raw = JSON.parse(localStorage.getItem(ALIAS_STORE_KEY) || "{}");
        return raw && typeof raw === "object" ? raw : {};
      } catch (_) {
        return {};
      }
    }
    function writeAliasMap(map) {
      try {
        localStorage.setItem(ALIAS_STORE_KEY, JSON.stringify(map));
      } catch (_) {}
    }
    function leafOf(p) {
      return p.replace(/\/+$/, "").split("/").pop() || p;
    }
    function aliasFor(p) {
      return readAliasMap()[p] || leafOf(p);
    }
    // Per-conversation hue overrides, keyed by "<workspacePath>\u0000<taskId>"
    // — the canonical form both row shapes normalize to (project/timeline rows
    // carry "path:taskId", grouped rows carry encodeURIComponent(path\0taskId)).
    const TASK_STORE_KEY = "zcProjectTint.tasks.v1";
    function readTaskMap() {
      try {
        const raw = JSON.parse(localStorage.getItem(TASK_STORE_KEY) || "{}");
        return raw && typeof raw === "object" ? raw : {};
      } catch (_) {
        return {};
      }
    }
    function writeTaskMap(map) {
      try {
        localStorage.setItem(TASK_STORE_KEY, JSON.stringify(map));
      } catch (_) {}
    }
    function taskKeyOf(el) {
      const k = el.getAttribute("data-task-item-key");
      if (k) {
        const cut = k.lastIndexOf(":");
        return cut > 0 ? k.slice(0, cut) + "\u0000" + k.slice(cut + 1) : null;
      }
      const g = el.getAttribute("data-grouped-task-key");
      if (g) {
        try {
          const d = decodeURIComponent(g);
          return d.indexOf("\u0000") > 0 ? d : null;
        } catch (_) {
          return null;
        }
      }
      return null;
    }
    function taskTitleOf(el) {
      const lb = el.querySelector("span.truncate");
      return lb ? (lb.textContent || "").trim() : "";
    }
    const SETTINGS_KEY = "zcPrism.settings.v1";
    // autoColor: hash-based hue for projects without a manual pick — off by
    // default, a hue is only ever applied when explicitly picked or opted in.
    // groupRecency: display-only recency ordering for the grouped view.
    const DEFAULT_SETTINGS = { dimTitles: true, brightenThinking: true, autoColor: false, groupRecency: true };
    function readSettings() {
      try {
        return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"));
      } catch (_) {
        return Object.assign({}, DEFAULT_SETTINGS);
      }
    }
    function writeSettings(s) {
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
      } catch (_) {}
    }
    // global look & feel switches, kept in a dedicated style node so toggling
    // rewrites it without touching the per-project tint rules
    function applySettingsStyle() {
      const st = readSettings();
      let el = document.getElementById("zc-prism-settings");
      if (!el) {
        el = document.createElement("style");
        el.id = "zc-prism-settings";
        document.head.appendChild(el);
      }
      const rules = [];
      if (st.dimTitles) {
        rules.push(
          ":is(li[data-task-item-key], div[data-grouped-task-key]) :is(p, span).text-foreground { opacity: 0.6; }",
        );
      }
      if (st.brightenThinking) {
        // the shimmer sweep animates the --animated-gradient-text-soft stop,
        // which is only ~20% white in dark themes; lift it to 65% of the strong
        // color so the pulse stays theme-correct but clearly visible. Also
        // covers .cua-group-gradient-text (computer-use streaming label),
        // which sweeps the same two variables.
        rules.push(
          ":is(.animated-gradient-text, .cua-group-gradient-text) { --animated-gradient-text-soft: color-mix(in oklab, var(--animated-gradient-text-strong) 65%, transparent) !important; }",
        );
      }
      el.textContent = rules.join("\n");
    }

    const autoHueCache = new Map();
    // leaf aliases currently applied to timeline rows, so clearing an alias
    // can restore the original text immediately instead of waiting for the
    // app's next re-render of that row
    const rowAliasApplied = new Map();
    function autoHue(key) {
      let h = autoHueCache.get(key);
      if (h === undefined) {
        let acc = 0;
        for (let i = 0; i < key.length; i++) acc = (acc * 31 + key.charCodeAt(i)) >>> 0;
        h = Math.round((acc * 137.508) % 360);
        autoHueCache.set(key, h);
      }
      return h;
    }
    function hueFor(path) {
      const v = readMap()[path];
      if (typeof v === "number") return v === -1 ? null : v; // -1 = explicit transparent
      return readSettings().autoColor ? autoHue(path) : null;
    }
    function hueColor(path) {
      const h = hueFor(path);
      return h === null ? null : "hsl(" + h + " 70% 55%)";
    }

    function projectOfRow(el) {
      const k = el.getAttribute("data-task-item-key");
      if (k) {
        const cut = k.lastIndexOf(":");
        return cut > 0 ? k.slice(0, cut) : k;
      }
      const g = el.getAttribute("data-grouped-task-key");
      if (g) {
        try {
          return decodeURIComponent(g).split("\u0000")[0];
        } catch (_) {
          return null;
        }
      }
      return null;
    }

    function projectOfHeader(el) {
      return (el.getAttribute("data-testid") || "").slice(HEADER_PREFIX.length) || null;
    }

    // Replace the generic folder icon on project headers with the picked icon
    // (native house/cloud keep their remote/home semantics and stay).
    function syncHeaderIcon(header, path) {
      const iconId = readIconMap()[path];
      const folderSvg = header.querySelector("svg.lucide-folder, svg.lucide-folder-open");
      const holder = folderSvg ? folderSvg.parentElement : null;
      const mine = header.querySelector('span[data-zc-pt-icon="1"]');
      if (!iconId || !ICONS[iconId]) {
        if (mine) mine.remove();
        if (holder) holder.style.display = "";
        return;
      }
      const color = hueColor(path); // null → keep the app's foreground color
      if (holder) holder.style.display = "none";
      const wantKey = iconId + "|" + (color || "");
      let el = mine;
      if (el && el.dataset.zc === wantKey) return;
      if (!el) {
        el = document.createElement("span");
        el.dataset.zcPtIcon = "1";
        if (holder && holder.parentNode) holder.parentNode.insertBefore(el, holder.nextSibling);
        else header.insertBefore(el, header.firstChild);
      }
      el.dataset.zc = wantKey;
      el.style.cssText =
        "display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex:none" +
        (color ? ";color:" + color : "");
      el.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        iconInner(iconId) +
        "</svg>";
    }

    // Show the display alias on the project header label. The text node is
    // edited IN PLACE (nodeValue): assigning textContent would detach the
    // text node React tracks, and its next commit would throw
    // "removeChild ... not a child of this node". React restores the original
    // text on re-render; the next pass rewrites it, guarded by comparison so
    // no mutation is emitted once equal.
    function syncHeaderAlias(header, path) {
      const label = header.querySelector("div.truncate");
      if (!label) return;
      const alias = readAliasMap()[path];
      const orig = label.dataset.zcPtOrig;
      if (!alias) {
        if (orig !== undefined) {
          delete label.dataset.zcPtOrig;
          for (const n of label.childNodes) {
            if (n.nodeType === 3 && n.nodeValue !== orig) n.nodeValue = orig;
          }
        }
        return;
      }
      for (const n of label.childNodes) {
        if (n.nodeType !== 3 || n.nodeValue === alias) continue;
        if (orig === undefined) label.dataset.zcPtOrig = n.nodeValue;
        n.nodeValue = alias;
      }
    }

    // ---- sidebar recency ordering (display-only, all views) ----
    // The sidebar orders things manually (dragged groups/projects) or by join
    // time; this floats recently-active conversations to the top WITHOUT
    // touching any persisted order — purely CSS `order` on flexed containers,
    // so toggling off restores the native order byte-for-byte. Times come
    // from each task object (lastActivityAt/updatedAt), read ONLY through the
    // React fiber pointer React leaves on row DOM nodes.
    //
    // Three shapes of list are recognized, each validation-gated so an
    // unrecognized DOM simply stays native:
    //   1. grouped view top level: group wrappers + loose rows (by recency)
    //   2. row containers whose children are ALL rows → sorted directly
    //   3. containers mixing headers and rows → segmented: each header keeps
    //      its following rows; segments ranked by their newest row
    // Project *sections* (header + row-list wrappers) are then ranked among
    // their siblings by their newest row, but only when the wrapper shape is
    // unambiguous (exactly one header inside).
    const recencyFlex = new Set();
    let recencyState = "off";
    function setRecencyState(s) {
      if (recencyState === s) return;
      recencyState = s;
      try {
        console.info("[zc-prism] recency: " + s);
      } catch (_) {}
    }
    function taskTimeOf(rowEl) {
      try {
        let fiber = null;
        for (const k of Object.keys(rowEl)) {
          if (k.indexOf("__reactFiber$") === 0) {
            fiber = rowEl[k];
            break;
          }
        }
        for (let hops = 0; fiber && hops < 12; hops++, fiber = fiber.return) {
          const p = fiber.memoizedProps;
          if (!p) continue;
          const t = typeof p.task === "object" && p.task ? p.task : typeof p === "object" && typeof p.taskId === "string" && typeof p.updatedAt === "number" ? p : null;
          if (!t) continue;
          const v = typeof t.lastActivityAt === "number" ? t.lastActivityAt : t.updatedAt;
          if (typeof v === "number" && Number.isFinite(v)) return v;
        }
      } catch (_) {}
      return NaN;
    }
    function rowRootWithin(rowEl, container) {
      let root = rowEl;
      while (root.parentElement && root.parentElement !== container) root = root.parentElement;
      return root.parentElement === container ? root : null;
    }
    function setOrder(el, ord) {
      if (el.dataset.zcPtOrd === ord) return;
      el.dataset.zcPtOrd = ord;
      el.style.order = ord;
    }
    function flexColumn(el) {
      if (el.dataset.zcPtFlex !== "1") {
        el.dataset.zcPtFlex = "1";
        el.style.display = "flex";
        el.style.flexDirection = "column";
      }
      recencyFlex.add(el);
    }
    const recencyTime = (e) => (Number.isFinite(e.time) ? e.time : -Infinity);
    // key entries: {el, time, pos}, ranked newest first, ties keep DOM order.
    // Non-keyed children keep their top/bottom bands: those before the first
    // keyed child (draft inputs, pinned blocks) order -1, those after 9999.
    function orderChildren(container, keyed) {
      let anyTime = false;
      for (const k of keyed) if (Number.isFinite(k.time)) anyTime = true;
      if (!anyTime) return false;
      const isKeyed = new Set(keyed.map((k) => k.el));
      const kids = Array.prototype.slice.call(container.children);
      let firstKeyed = -1;
      for (let i = 0; i < kids.length; i++) if (isKeyed.has(kids[i])) { firstKeyed = i; break; }
      const sorted = keyed.slice().sort((a, b) => recencyTime(b) - recencyTime(a) || a.pos - b.pos);
      flexColumn(container);
      for (let i = 0; i < kids.length; i++) {
        if (!isKeyed.has(kids[i])) setOrder(kids[i], i < firstKeyed ? "-1" : "9999");
      }
      sorted.forEach((k, i) => setOrder(k.el, String(i)));
      return true;
    }
    // A container mixing header-ish blocks with rows: each block "owns" the
    // rows that follow it (a segment); segments ranked by newest row, rows
    // sorted within their segment. Rank slots are 1000 apart so a segment's
    // header + rows stay contiguous after reordering.
    function orderSegments(container, children) {
      const isRow = (el) => el.matches(ROW_SELECTOR);
      const segments = [];
      for (const ch of children) {
        if (isRow(ch)) {
          // a row belongs to the segment opened by the block before it
          if (!segments.length) segments.push({ head: null, headIsBlock: false, rows: [] });
          segments[segments.length - 1].rows.push(ch);
          continue;
        }
        segments.push({ head: ch, headIsBlock: true, rows: [] });
      }
      if (segments.length < 2 && segments[0] && !segments[0].headIsBlock) return false;
      const keyed = [];
      const pinned = []; // rowless non-header blocks: leading → top, trailing → bottom
      segments.forEach((seg, si) => {
        if (!seg.headIsBlock) {
          seg.rows.forEach((r, i) => {
            keyed.push({ el: r, time: taskTimeOf(r), seg, pos: i });
          });
          return;
        }
        if (!seg.head.matches(HEADER_SELECTOR) && seg.rows.length === 0) {
          // separators / draft rows / trailing footers with no rows — keep out
          // of the ranked flow, on the side of the list they came from
          pinned.push({ el: seg.head, top: si < segments.length - 1 });
          return;
        }
        let best = NaN;
        seg.rows.forEach((r, i) => {
          const t = taskTimeOf(r);
          keyed.push({ el: r, time: t, seg, pos: i });
          if (Number.isFinite(t) && (Number.isNaN(best) || t > best)) best = t;
        });
        keyed.push({ el: seg.head, time: best, seg });
      });
      let anyTime = false;
      for (const k of keyed) if (Number.isFinite(k.time) && k.el !== k.seg.head) anyTime = true;
      if (!anyTime) return false;
      const bySeg = new Map();
      for (const k of keyed) {
        if (k.el === k.seg.head) continue;
        const prev = bySeg.get(k.seg);
        if (!prev || (Number.isFinite(k.time) && (Number.isNaN(prev) || k.time > prev))) bySeg.set(k.seg, k.time);
      }
      const segs = Array.from(bySeg.keys());
      const sortedSegs = segs.slice().sort((a, b) => {
        const ta = bySeg.get(a), tb = bySeg.get(b);
        const fa = Number.isFinite(ta) ? ta : -Infinity;
        const fb = Number.isFinite(tb) ? tb : -Infinity;
        return fb - fa || segs.indexOf(a) - segs.indexOf(b);
      });
      const rank = new Map(sortedSegs.map((s, i) => [s, i * 1000]));
      flexColumn(container);
      for (const p of pinned) setOrder(p.el, p.top ? "-1" : "9999");
      // rows within a segment ranked by their own recency, newest first
      const rowsBySeg = new Map();
      for (const k of keyed) {
        if (k.el === k.seg.head) continue;
        if (!rowsBySeg.has(k.seg)) rowsBySeg.set(k.seg, []);
        rowsBySeg.get(k.seg).push(k);
      }
      for (const [seg, list] of rowsBySeg) {
        const base = rank.get(seg) || 0;
        list.sort((a, b) => recencyTime(b) - recencyTime(a) || a.pos - b.pos);
        list.forEach((k, i) => setOrder(k.el, String(base + 1 + i)));
      }
      for (const seg of segs) {
        if (seg.head) setOrder(seg.head, String(rank.get(seg) || 0));
      }
      return true;
    }
    function removeGroupRecency() {
      for (const el of recencyFlex) {
        if (!el.isConnected) continue;
        try {
          if (el.dataset.zcPtFlex === "1") {
            el.style.display = "";
            el.style.flexDirection = "";
            delete el.dataset.zcPtFlex;
          }
          for (const ch of el.children) {
            ch.style.order = "";
            delete ch.dataset.zcPtOrd;
          }
        } catch (_) {}
      }
      recencyFlex.clear();
    }
    function applyRecency(root) {
      if (!readSettings().groupRecency) {
        setRecencyState("off");
        if (recencyFlex.size) removeGroupRecency();
        return;
      }
      const rows = root.querySelectorAll(ROW_SELECTOR);
      if (!rows.length) {
        setRecencyState("sidebar-hidden");
        if (recencyFlex.size) removeGroupRecency();
        return;
      }
      const anchor = root.querySelector("[data-grouped-layout-key]");
      let applied = 0;
      // 1) grouped view top level: groups + loose rows ranked by newest task
      if (anchor) {
        const top = anchor.parentElement;
        if (top && top !== document.body && top !== anchor) {
          let virtual = false;
          for (const ch of top.children) {
            if (ch.hasAttribute("data-index")) { virtual = true; break; }
          }
          if (virtual) {
            if (recencyFlex.size) removeGroupRecency();
            setRecencyState("virtualized-list-skipped");
            return;
          }
          const keyedTop = [];
          let pos = 0;
          let anyTime = false;
          for (const ch of top.children) {
            if (ch.hasAttribute("data-grouped-layout-key")) {
              let best = NaN;
              const grows = ch.querySelectorAll("[data-grouped-task-key]");
              if (grows.length) {
                // rows sit a few wrappers deep inside the group; the task-list
                // container is the group wrapper's direct ancestor of row #1
                const listEl = rowRootWithin(grows[0], ch);
                const roots = new Map();
                let okList = !!listEl;
                for (const r of grows) {
                  const t = taskTimeOf(r);
                  if (Number.isFinite(t)) {
                    anyTime = true;
                    if (Number.isNaN(best) || t > best) best = t;
                  }
                  const rootEl = listEl && rowRootWithin(r, listEl);
                  if (!rootEl) {
                    okList = false;
                    continue;
                  }
                  const prev = roots.get(rootEl);
                  if (!prev || (!Number.isFinite(prev.time) && Number.isFinite(t)) || t > prev.time) {
                    roots.set(rootEl, { el: rootEl, time: t, pos: prev ? prev.pos : roots.size });
                  }
                }
                if (okList && roots.size && orderChildren(listEl, Array.from(roots.values()))) applied++;
              }
              keyedTop.push({ el: ch, time: best, pos: pos++ });
              continue;
            }
            const row = ch.matches("[data-grouped-task-key]") ? ch : ch.querySelector("[data-grouped-task-key]");
            if (row) {
              const t = taskTimeOf(row);
              if (Number.isFinite(t)) anyTime = true;
              keyedTop.push({ el: ch, time: t, pos: pos++ });
            } else {
              setOrder(ch, "-1");
            }
          }
          if (anyTime && orderChildren(top, keyedTop)) applied++;
        }
      }
      // 2) project/timeline containers (li rows — their parentElement IS the
      //    list): sort all-row containers directly, segmented ones by block
      const byParent = new Map();
      for (const r of rows) {
        if (!r.hasAttribute("data-task-item-key")) continue; // grouped rows done above
        const p = r.parentElement;
        if (!p) continue;
        if (!byParent.has(p)) byParent.set(p, []);
        byParent.get(p).push(r);
      }
      for (const [parent, list] of byParent) {
        if (list.length < 2) continue;
        const kids = Array.prototype.slice.call(parent.children);
        const rowSet = new Set(list);
        let allRows = true;
        for (const k of kids) {
          if (!rowSet.has(k) && (k.matches ? !k.matches(ROW_SELECTOR) : true)) { allRows = false; break; }
        }
        let ok = false;
        try {
          // all-row containers sort directly; anything else (headers, footers,
          // separators, drafts) goes through the segment model so stray blocks
          // no longer disqualify the whole list
          ok = allRows ? orderChildren(parent, list.map((el, i) => ({ el, time: taskTimeOf(el), pos: i }))) : orderSegments(parent, kids);
        } catch (_) {}
        if (ok) applied++;
      }
      // 3) project sections: rank header+list wrappers among their siblings
      let sectionsRanked = 0;
      if (!anchor) {
        const secByParent = new Map();
        for (const h of root.querySelectorAll(HEADER_SELECTOR)) {
          let S = null;
          let node = h;
          for (let up = 0; node && up < 8; up++, node = node.parentElement) {
            if (node === document.body) break;
            if (node.querySelector(ROW_SELECTOR)) {
              if (node.querySelectorAll(HEADER_SELECTOR).length === 1) S = node;
              break;
            }
          }
          if (!S || !S.parentElement) continue;
          const p = S.parentElement;
          if (!secByParent.has(p)) secByParent.set(p, []);
          secByParent.get(p).push({ S, h });
        }
        for (const [p, list] of secByParent) {
          if (list.length < 2) continue;
          const keyed = [];
          let anyTime = false;
          for (const { S } of list) {
            let best = NaN;
            for (const r of S.querySelectorAll("[data-task-item-key]")) {
              const t = taskTimeOf(r);
              if (Number.isFinite(t)) {
                anyTime = true;
                if (Number.isNaN(best) || t > best) best = t;
              }
            }
            keyed.push({ el: S, time: best, pos: keyed.length });
          }
          if (anyTime && orderChildren(p, keyed)) sectionsRanked++;
        }
      }
      const shape =
        "gw=" + root.querySelectorAll("[data-grouped-layout-key]").length +
        " li=" + root.querySelectorAll("li[data-task-item-key]").length +
        " div=" + root.querySelectorAll("div[data-grouped-task-key]").length +
        " hdr=" + root.querySelectorAll(HEADER_SELECTOR).length;
      if (applied || sectionsRanked) {
        setRecencyState("applied: containers=" + applied + " sections=" + sectionsRanked + " (" + shape + ")");
      } else {
        setRecencyState("no-recognizable-list (" + shape + ")");
        if (recencyFlex.size) removeGroupRecency();
      }
    }

    function pass(root) {
      const map = readMap();
      const rows = root.querySelectorAll(ROW_SELECTOR);
      const aliasMap = readAliasMap();
      const st = readSettings();
      const taskMap = readTaskMap();
      for (const el of rows) {
        const path = projectOfRow(el);
        if (!path) continue;
        const tk = taskKeyOf(el);
        const tv = tk !== null ? taskMap[tk] : undefined;
        let v = typeof tv === "number" ? tv : map[path];
        if (v === -1) v = null; // explicit transparent beats project/auto
        else if (v === undefined && st.autoColor) v = autoHue(path);
        const want = typeof v === "number" ? String(v) : "off";
        if (el.dataset.zcPtH === want) continue;
        el.dataset.zcPtH = want;
        if (typeof v === "number") {
          el.style.setProperty("--zc-pt-h", want.split(".")[0]);
          el.dataset.zcPtOn = "1";
        } else {
          el.style.removeProperty("--zc-pt-h");
          delete el.dataset.zcPtOn;
        }
      }
      // timeline rows show the workspace leaf name in a span.truncate; swap in
      // the alias when one is set. Text nodes are edited in place (nodeValue),
      // never via textContent — detaching React's tracked node would crash its
      // next commit with "removeChild ... not a child of this node".
      for (const el of rows) {
        const path = projectOfRow(el);
        if (!path) continue;
        const alias = aliasMap[path];
        const leaf = leafOf(path);
        if (leaf === alias) continue;
        const applied = rowAliasApplied.get(path);
        if (!alias) {
          if (applied !== undefined) {
            rowAliasApplied.delete(path);
            for (const lb of el.querySelectorAll("span.truncate")) {
              for (const n of lb.childNodes) {
                if (n.nodeType === 3 && n.nodeValue === applied) n.nodeValue = leaf;
              }
            }
          }
          continue;
        }
        let hit = false;
        for (const lb of el.querySelectorAll("span.truncate")) {
          for (const n of lb.childNodes) {
            if (n.nodeType === 3 && n.nodeValue === leaf) {
              n.nodeValue = alias;
              hit = true;
            }
          }
        }
        if (hit) rowAliasApplied.set(path, alias);
        else if (applied !== undefined) rowAliasApplied.set(path, applied);
      }
      const headers = root.querySelectorAll(HEADER_SELECTOR);
      for (const el of headers) {
        const path = projectOfHeader(el);
        if (!path) continue;
        let v = map[path];
        if (v === -1) v = null;
        else if (v === undefined && st.autoColor) v = autoHue(path);
        const want = typeof v === "number" ? String(v) : "off";
        if (el.dataset.zcPtH !== want) {
          el.dataset.zcPtH = want;
          if (typeof v === "number") {
            el.style.setProperty("--zc-pt-h", want.split(".")[0]);
            el.dataset.zcPtOn = "1";
          } else {
            el.style.removeProperty("--zc-pt-h");
            delete el.dataset.zcPtOn;
          }
        }
        try {
          syncHeaderIcon(el, path);
        } catch (_) {}
        try {
          syncHeaderAlias(el, path);
        } catch (_) {}
      }
      try {
        enhanceMenus();
      } catch (_) {}
      try {
        applyRecency(root || document);
      } catch (_) {}
    }

    function injectStyle() {
      if (document.getElementById("zc-prism-style")) return;
      const style = document.createElement("style");
      style.id = "zc-prism-style";
      style.textContent = [
        "li[data-task-item-key], div[data-grouped-task-key] { position: relative; }",
        "li[data-task-item-key][data-zc-pt-on]::before, div[data-grouped-task-key][data-zc-pt-on]::before {",
        "  content: \"\"; position: absolute; inset: 0; border-radius: inherit;",
        "  background: hsl(var(--zc-pt-h, 0) 70% 55% / 0.09);",
        "  pointer-events: none; }",
        "li[data-task-item-key][data-zc-pt-on]::after, div[data-grouped-task-key][data-zc-pt-on]::after {",
        "  content: \"\"; position: absolute; left: 1px; top: 50%; transform: translateY(-50%);",
        "  width: 3px; height: 60%; border-radius: 2px;",
        "  background: hsl(var(--zc-pt-h, 0) 70% 60% / 0.55);",
        "  pointer-events: none; }",
        HEADER_SELECTOR + " { position: relative; }",
        HEADER_SELECTOR + "[data-zc-pt-on]::before {",
        "  content: \"\"; position: absolute; inset: 0; border-radius: inherit;",
        "  background: hsl(var(--zc-pt-h, 0) 60% 50% / 0.06);",
        "  pointer-events: none; }",
        ".zc-pt-menu {",
        "  position: fixed; z-index: 2147483646; width: 224px; padding: 10px;",
        "  border-radius: 10px; background: rgba(28,30,32,0.98);",
        "  border: 1px solid rgba(255,255,255,0.09);",
        "  box-shadow: 0 12px 32px rgba(0,0,0,0.4); color: #e8eaec;",
        "  font: 12px -apple-system, system-ui, sans-serif; }",
        ".zc-pt-title { margin: 0 0 8px; font-weight: 600; opacity: 0.9;",
        "  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
        ".zc-pt-grid { display: grid; grid-template-columns: repeat(7, 24px); gap: 6px; }",
        ".zc-pt-swatch { width: 24px; height: 24px; border-radius: 7px; cursor: pointer;",
        "  border: 1px solid rgba(255,255,255,0.15); box-sizing: border-box;",
        "  display: flex; align-items: center; justify-content: center;",
        "  font: 600 11px -apple-system, system-ui, sans-serif; color: rgba(0,0,0,0.6); }",
        ".zc-pt-swatch:hover { transform: scale(1.12); }",
        ".zc-pt-swatch[data-current='1'] { outline: 2px solid #fff; outline-offset: 1px; }",
        ".zc-pt-swatch.zc-pt-auto { background: transparent; color: #cfd3d6; font-weight: 500; }",
        ".zc-pt-swatch.zc-pt-none { background: linear-gradient(135deg, transparent 42%, #e05252 42%, #e05252 58%, transparent 58%); }",
        ".zc-pt-sep { margin: 10px 0 6px; font-size: 11px; opacity: 0.55; }",
        ".zc-pt-isw { width: 24px; height: 24px; border-radius: 7px; cursor: pointer;",
        "  display: flex; align-items: center; justify-content: center; color: #b9bec3; }",
        ".zc-pt-isw:hover { color: #fff; background: rgba(255,255,255,0.08); }",
        ".zc-pt-isw[data-current='1'] { outline: 2px solid #fff; outline-offset: 1px; }",
        ".zc-pt-isw svg { width: 15px; height: 15px; }",
        ".zc-pt-isw.zc-pt-none { font-size: 11px; font-weight: 500; }",
        ".zc-pt-input { width: 100%; box-sizing: border-box; margin-bottom: 8px;",
        "  padding: 6px 8px; border-radius: 7px; border: 1px solid rgba(255,255,255,0.14);",
        "  background: rgba(255,255,255,0.06); color: #e8eaec;",
        "  font: 12px -apple-system, system-ui, sans-serif; outline: none; }",
        ".zc-pt-input:focus { border-color: rgba(255,255,255,0.35); }",
        ".zc-pt-btnrow { display: flex; gap: 6px; justify-content: flex-end; }",
        ".zc-pt-btn { padding: 5px 10px; border-radius: 7px; cursor: pointer;",
        "  border: 1px solid rgba(255,255,255,0.14); color: #cfd3d6; }",
        ".zc-pt-btn:hover { background: rgba(255,255,255,0.08); }",
        ".zc-pt-btn.zc-pt-primary { background: #2f6feb; border-color: #2f6feb; color: #fff; }",
        ".zc-pt-btn.zc-pt-primary:hover { background: #3d7bff; }",
        ".zc-pt-tg { display: flex; align-items: center; justify-content: space-between;",
        "  gap: 12px; padding: 5px 0; cursor: pointer; }",
        ".zc-pt-tg:hover { opacity: 0.85; }",
        ".zc-pt-tg-sw { width: 28px; height: 16px; border-radius: 9px; flex: none;",
        "  background: rgba(255,255,255,0.16); position: relative; transition: background 0.15s; }",
        ".zc-pt-tg-sw::after { content: \"\"; position: absolute; top: 2px; left: 2px;",
        "  width: 12px; height: 12px; border-radius: 50%; background: #b9bec3; transition: left 0.15s; }",
        ".zc-pt-tg[data-on='1'] .zc-pt-tg-sw { background: #2f6feb; }",
        ".zc-pt-tg[data-on='1'] .zc-pt-tg-sw::after { left: 14px; background: #fff; }",
      ].join("\n");
      document.head.appendChild(style);
    }

    // ---- picker popover ----
    let menu = null;
    function closeMenu() {
      if (!menu) return;
      const m = menu;
      menu = null;
      try {
        m.remove();
      } catch (_) {}
      document.removeEventListener("pointerdown", onDocPointer, true);
      document.removeEventListener("keydown", onDocKey, true);
      document.removeEventListener("contextmenu", onMenuCtx, true);
    }
    function onDocPointer(e) {
      if (menu && !menu.contains(e.target)) closeMenu();
    }
    function onDocKey(e) {
      if (e.key === "Escape") closeMenu();
    }
    function onMenuCtx(e) {
      e.preventDefault();
      e.stopPropagation();
    }

    // ---- rename popover ----
    function openRename(path, x, y) {
      try {
        closeMenu();
        injectStyle();
        menu = document.createElement("div");
        menu.className = "zc-pt-menu";
        const title = document.createElement("div");
        title.className = "zc-pt-title";
        title.textContent = "重命名项目（仅显示名）";
        menu.appendChild(title);
        const input = document.createElement("input");
        input.className = "zc-pt-input";
        input.value = readAliasMap()[path] || leafOf(path);
        input.spellcheck = false;
        menu.appendChild(input);
        const row = document.createElement("div");
        row.className = "zc-pt-btnrow";
        const reset = document.createElement("div");
        reset.className = "zc-pt-btn";
        reset.textContent = "恢复原名";
        reset.addEventListener("click", () => {
          const m = readAliasMap();
          delete m[path];
          writeAliasMap(m);
          pass(document);
          closeMenu();
        });
        const save = document.createElement("div");
        save.className = "zc-pt-btn zc-pt-primary";
        save.textContent = "保存";
        save.addEventListener("click", () => {
          const m = readAliasMap();
          const v = input.value.trim();
          if (v && v !== leafOf(path)) m[path] = v;
          else delete m[path];
          writeAliasMap(m);
          pass(document);
          closeMenu();
        });
        row.appendChild(reset);
        row.appendChild(save);
        menu.appendChild(row);
        document.body.appendChild(menu);
        input.addEventListener("keydown", (ev) => {
          ev.stopPropagation();
          if (ev.key === "Enter") save.click();
          else if (ev.key === "Escape") closeMenu();
        });
        const r = menu.getBoundingClientRect();
        menu.style.left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8)) + "px";
        menu.style.top = Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) + "px";
        document.addEventListener("pointerdown", onDocPointer, true);
        document.addEventListener("keydown", onDocKey, true);
        document.addEventListener("contextmenu", onMenuCtx, true);
        setTimeout(() => {
          try {
            input.focus();
            input.select();
          } catch (_) {}
        }, 30);
      } catch (err) {
        try {
          console.error("[zc-prism] rename", err);
        } catch (_) {}
      }
    }

    // ---- native "..." menu / context menu enhancement ----
    let pendingProject = null;
    let pendingTask = null;
    // lucide "ban" glyph — used by the one-click "cancel color" entries
    const BAN_PATHS = '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>';
    function dismissNativeMenu(menuEl) {
      // React attaches its listeners at the root container, so an Escape
      // dispatched on `document` never reaches the menu; dispatched on the
      // menu element itself it bubbles through the root and Radix closes the
      // menu through its own state path. Never detach the node here: React
      // unmounts it later and a forced removal makes that removeChild throw.
      try {
        menuEl.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
        );
      } catch (_) {}
      // If the synthetic Escape was ignored, just get the menu out of the way;
      // the next pointerdown dismisses it for real. Unhide on any later
      // pointerdown in case the app reuses the node for the next menu.
      setTimeout(() => {
        try {
          if (!menuEl || !menuEl.isConnected) return;
          menuEl.style.display = "none";
          const unhide = () => {
            document.removeEventListener("pointerdown", unhide, true);
            try {
              if (menuEl.isConnected && menuEl.style.display === "none") menuEl.style.display = "";
            } catch (_) {}
          };
          document.addEventListener("pointerdown", unhide, true);
        } catch (_) {}
      }, 80);
    }
    function enhanceMenus() {
      const menus = document.querySelectorAll('[role="menu"]:not([data-zc-pt-menu])');
      if (!menus.length) return;
      const now = Date.now();
      const task = pendingTask && now - pendingTask.at < 4000 ? pendingTask : null;
      const proj = !task && pendingProject && now - pendingProject.at < 4000 ? pendingProject : null;
      if (!task && !proj) return;
      for (const menuEl of menus) {
        let template = null;
        const wantTask = task && !proj;
        const kw = wantTask ? /移除|归档|置顶|固定|重命名|删除|移到/ : /移除/;
        for (const it of menuEl.querySelectorAll('[role="menuitem"]')) {
          if ((it.textContent || "").search(kw) !== -1) {
            template = it;
            break;
          }
        }
        if (!template && wantTask) {
          template = menuEl.querySelector('[role="menuitem"]');
        }
        if (!template) continue;
        menuEl.dataset.zcPtMenu = wantTask ? task.key : proj.path;
        const mk = (label, paths, fn) => {
          const el = template.cloneNode(true);
          el.setAttribute("data-zc-pt-item", "1");
          const svg = el.querySelector("svg");
          const iconMarkup =
            '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex:none">' +
            paths +
            "</svg>";
          if (svg) svg.outerHTML = iconMarkup;
          for (const n of Array.from(el.childNodes)) {
            if (n !== el.querySelector("svg")) n.remove();
          }
          el.appendChild(document.createTextNode(" " + label));
          el.addEventListener("click", (ev) => {
            ev.stopPropagation();
            dismissNativeMenu(menuEl);
            if (wantTask) fn(task.key, task.title, ev.clientX || 200, ev.clientY || 200);
            else fn(proj.path, ev.clientX || 200, ev.clientY || 200);
          });
          return el;
        };
        if (wantTask) {
          menuEl.appendChild(mk("调整颜色（此对话）", iconInner("palette"), openTaskPicker));
          menuEl.appendChild(
            mk("取消颜色（此对话）", BAN_PATHS, (key) => {
              const m = readTaskMap();
              m[key] = -1;
              writeTaskMap(m);
              pass(document);
            }),
          );
        } else {
          menuEl.appendChild(mk("调整颜色", iconInner("palette"), openPicker));
          menuEl.appendChild(
            mk("取消颜色", BAN_PATHS, (path) => {
              const m = readMap();
              m[path] = -1;
              writeMap(m);
              pass(document);
            }),
          );
          menuEl.appendChild(mk("重命名", iconInner("pen-tool"), openRename));
        }
      }
    }

    function markCurrent(grid, current) {
      for (const el of grid.children) {
        if (el.dataset.v === String(current)) el.dataset.current = "1";
        else delete el.dataset.current;
      }
    }

    function openPicker(path, x, y) {
      try {
        closeMenu();
        injectStyle();
        const leaf = aliasFor(path);
        menu = document.createElement("div");
        menu.className = "zc-pt-menu";

        const title = document.createElement("div");
        title.className = "zc-pt-title";
        title.textContent = leaf;
        menu.appendChild(title);

        const grid = document.createElement("div");
        grid.className = "zc-pt-grid";
        for (const h of HUES) {
          const sw = document.createElement("div");
          sw.className = "zc-pt-swatch";
          sw.style.background = "hsl(" + h + " 70% 55%)";
          sw.dataset.v = String(h);
          sw.title = "色相 " + h;
          sw.addEventListener("click", () => {
            const map = readMap();
            map[path] = h;
            writeMap(map);
            pass(document);
            markCurrent(grid, h);
          });
          grid.appendChild(sw);
        }
        const noneSw = document.createElement("div");
        noneSw.className = "zc-pt-swatch zc-pt-none";
        noneSw.dataset.v = "-1";
        noneSw.title = "透明（明确不染色，优先于自动配色）";
        noneSw.addEventListener("click", () => {
          const map = readMap();
          map[path] = -1;
          writeMap(map);
          pass(document);
          markCurrent(grid, -1);
        });
        grid.appendChild(noneSw);
        const auto = document.createElement("div");
        auto.className = "zc-pt-swatch zc-pt-auto";
        auto.textContent = "自";
        auto.dataset.v = "auto";
        auto.title = "跟随全局自动配色（开启=按路径哈希，关闭=无颜色）";
        auto.addEventListener("click", () => {
          const map = readMap();
          delete map[path];
          writeMap(map);
          pass(document);
          markCurrent(grid, "auto");
        });
        grid.appendChild(auto);
        menu.appendChild(grid);
        markCurrent(grid, String(readMap()[path] ?? "auto"));

        const sep = document.createElement("div");
        sep.className = "zc-pt-sep";
        sep.textContent = "图标";
        menu.appendChild(sep);

        const igrid = document.createElement("div");
        igrid.className = "zc-pt-grid";
        for (const id of Object.keys(ICONS)) {
          const b = document.createElement("div");
          b.className = "zc-pt-isw";
          b.dataset.v = id;
          b.title = id;
          b.innerHTML =
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            iconInner(id) +
            "</svg>";
          b.addEventListener("click", () => {
            const imap = readIconMap();
            imap[path] = id;
            writeIconMap(imap);
            pass(document);
            markCurrent(igrid, id);
          });
          igrid.appendChild(b);
        }
        const none = document.createElement("div");
        none.className = "zc-pt-isw zc-pt-none";
        none.textContent = "无";
        none.dataset.v = "none";
        none.title = "不使用项目图标";
        none.addEventListener("click", () => {
          const imap = readIconMap();
          delete imap[path];
          writeIconMap(imap);
          pass(document);
          markCurrent(igrid, "none");
        });
        igrid.appendChild(none);
        menu.appendChild(igrid);
        markCurrent(igrid, readIconMap()[path] ?? "none");

        const sep2 = document.createElement("div");
        sep2.className = "zc-pt-sep";
        sep2.textContent = "Prism 全局";
        menu.appendChild(sep2);
        const st = readSettings();
        for (const tg of [
          { key: "dimTitles", label: "压暗对话标题" },
          { key: "brightenThinking", label: "调亮思考动画" },
          { key: "autoColor", label: "自动配色（未指定的项目）" },
          { key: "groupRecency", label: "侧边栏按最近活跃排序" },
        ]) {
          const row = document.createElement("div");
          row.className = "zc-pt-tg";
          row.dataset.on = st[tg.key] ? "1" : "0";
          const lb = document.createElement("span");
          lb.textContent = tg.label;
          const sw = document.createElement("span");
          sw.className = "zc-pt-tg-sw";
          row.appendChild(lb);
          row.appendChild(sw);
          row.addEventListener("click", () => {
            const cur = readSettings();
            cur[tg.key] = !cur[tg.key];
            writeSettings(cur);
            applySettingsStyle();
            pass(document); // reapplies or tears down the recency ordering
            row.dataset.on = cur[tg.key] ? "1" : "0";
          });
          menu.appendChild(row);
        }

        document.body.appendChild(menu);
        const r = menu.getBoundingClientRect();
        menu.style.left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8)) + "px";
        menu.style.top = Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) + "px";
        document.addEventListener("pointerdown", onDocPointer, true);
        document.addEventListener("keydown", onDocKey, true);
        document.addEventListener("contextmenu", onMenuCtx, true);
      } catch (err) {
        try {
          console.error("[zc-prism] picker", err);
        } catch (_) {}
      }
    }

    // Per-conversation picker: overrides the color of a single conversation
    // row; "自" clears the override so the row follows its project again.
    function openTaskPicker(key, title, x, y) {
      try {
        if (!key) return;
        closeMenu();
        injectStyle();
        menu = document.createElement("div");
        menu.className = "zc-pt-menu";
        const cap = document.createElement("div");
        cap.className = "zc-pt-title";
        cap.textContent = title || "此对话";
        menu.appendChild(cap);
        const hint = document.createElement("div");
        hint.className = "zc-pt-sep";
        hint.style.margin = "0 0 8px";
        hint.textContent = "只影响这一条对话，未选时跟随项目";
        menu.appendChild(hint);
        const grid = document.createElement("div");
        grid.className = "zc-pt-grid";
        for (const h of HUES) {
          const sw = document.createElement("div");
          sw.className = "zc-pt-swatch";
          sw.style.background = "hsl(" + h + " 70% 55%)";
          sw.dataset.v = String(h);
          sw.title = "色相 " + h;
          sw.addEventListener("click", () => {
            const m = readTaskMap();
            m[key] = h;
            writeTaskMap(m);
            pass(document);
            markCurrent(grid, h);
          });
          grid.appendChild(sw);
        }
        const noneSw = document.createElement("div");
        noneSw.className = "zc-pt-swatch zc-pt-none";
        noneSw.dataset.v = "-1";
        noneSw.title = "透明（本条不染色，优先于项目颜色）";
        noneSw.addEventListener("click", () => {
          const m = readTaskMap();
          m[key] = -1;
          writeTaskMap(m);
          pass(document);
          markCurrent(grid, -1);
        });
        grid.appendChild(noneSw);
        const auto = document.createElement("div");
        auto.className = "zc-pt-swatch zc-pt-auto";
        auto.textContent = "自";
        auto.dataset.v = "auto";
        auto.title = "清除对话颜色，恢复跟随项目";
        auto.addEventListener("click", () => {
          const m = readTaskMap();
          delete m[key];
          writeTaskMap(m);
          pass(document);
          markCurrent(grid, "auto");
        });
        grid.appendChild(auto);
        menu.appendChild(grid);
        markCurrent(grid, String(readTaskMap()[key] ?? "auto"));
        document.body.appendChild(menu);
        const r = menu.getBoundingClientRect();
        menu.style.left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8)) + "px";
        menu.style.top = Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) + "px";
        document.addEventListener("pointerdown", onDocPointer, true);
        document.addEventListener("keydown", onDocKey, true);
        document.addEventListener("contextmenu", onMenuCtx, true);
      } catch (err) {
        try {
          console.error("[zc-prism] task picker", err);
        } catch (_) {}
      }
    }

    document.addEventListener(
      "contextmenu",
      (e) => {
        try {
          const target = e.target instanceof Element ? e.target : null;
          if (!target) return;
          const header = target.closest(HEADER_SELECTOR);
          if (header) {
            const path = projectOfHeader(header);
            if (path) {
              e.preventDefault();
              e.stopPropagation();
              openPicker(path, e.clientX, e.clientY);
            }
            return;
          }
          if (e.altKey) {
            const row = target.closest(ROW_SELECTOR);
            if (row) {
              const path = projectOfRow(row);
              if (path) {
                e.preventDefault();
                e.stopPropagation();
                openPicker(path, e.clientX, e.clientY);
              }
            }
          }
        } catch (err) {
          try {
            console.error("[zc-prism] ctx", err);
          } catch (_) {}
        }
      },
      true,
    );

    let queued = false;
    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        pass(document);
      });
    });

    function start() {
      injectStyle();
      applySettingsStyle();
      pass(document);
      observer.observe(document.body, { childList: true, subtree: true });
      try {
        console.info("[zc-prism] v8 loaded");
      } catch (_) {}
      // remember what was last interacted with, so the native menus can be
      // enhanced with our entries when they open (project header "..." menu →
      // project color/rename; row context menu → per-conversation color)
      document.addEventListener(
        "pointerdown",
        (e) => {
          try {
            const t = e.target instanceof Element ? e.target : null;
            if (!t) return;
            const row = t.closest(ROW_SELECTOR);
            if (row) {
              const key = taskKeyOf(row);
              if (key) {
                pendingTask = { key, title: taskTitleOf(row), at: Date.now() };
                return;
              }
            }
            const header = t.closest(HEADER_SELECTOR);
            if (header) {
              const p = projectOfHeader(header);
              if (p) {
                pendingProject = { path: p, at: Date.now() };
                pendingTask = null;
              }
            }
          } catch (_) {}
        },
        true,
      );
      window.__zcPrism = {
        version: 10,
        pass,
        openPicker,
        openTaskPicker,
        openRename,
        applyRecency,
        removeGroupRecency,
        taskKeyOf,
        get recencyState() {
          return recencyState;
        },
      };
    }

    if (document.body) start();
    else document.addEventListener("DOMContentLoaded", start, { once: true });
  } catch (err) {
    try {
      console.error("[zc-prism]", err);
    } catch (_) {
      /* never break the app because of the tint */
    }
  }
})();
