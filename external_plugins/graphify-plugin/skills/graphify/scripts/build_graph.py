#!/usr/bin/env python3
"""graphify build — turn a project directory into a queryable knowledge graph.

Outputs (under <root>/.graphify by default):
  graph.json        nodes + edges (queryable with query_graph.py)
  graph.html        self-contained interactive graph
  graph-report.md   human-readable summary

Stdlib only. Python 3.8+.
"""
import argparse
import ast
import datetime
import json
import os
import re
import sys
import urllib.parse
from collections import defaultdict
from pathlib import Path

CODE_EXTS = {".py": "python", ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript",
             ".jsx": "javascript", ".ts": "typescript", ".tsx": "typescript"}
DOC_EXTS = {".md": "markdown", ".markdown": "markdown", ".rst": "rst", ".txt": "text"}
CFG_EXTS = {".json": "json", ".yml": "yaml", ".yaml": "yaml", ".toml": "toml",
            ".ini": "ini", ".cfg": "ini"}
KNOWN_EXTS = set(CODE_EXTS) | set(DOC_EXTS) | set(CFG_EXTS)

IGNORE_DIRS = {".git", ".hg", ".svn", "node_modules", "__pycache__", ".venv", "venv", "env",
               "dist", "build", "out", ".graphify", ".idea", ".vscode", ".mypy_cache",
               ".pytest_cache", ".tox", "target", ".next", ".nuxt", "coverage", ".cache",
               "__pypackages__", ".ruff_cache"}
KEEP_HIDDEN = {".github"}
MAX_FILE_BYTES = 1_000_000
MAX_SYMBOLS = 300          # per file
MAX_MENTIONS = 50          # per doc
HTML_NODE_CAP = 600

MD_LINK = re.compile(r"\[[^\]]*\]\(\s*([^)\s]+)")
MD_CODESPAN = re.compile(r"`([^`\n]+)`")
JS_IMPORT = re.compile(
    r"(?:import\s+(?:[\w*{}\s,]+?\s+from\s+)?|export\s+(?:[\w*{}\s,]+?\s+from\s+)?|"
    r"require\s*\(\s*|import\s*\(\s*)['\"]([^'\"]+)['\"]")
JS_FUNC = re.compile(r"(?:function\s+([A-Za-z_$][\w$]*)\s*\(|class\s+([A-Za-z_$][\w$]*)|"
                     r"const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\(|async\b|function\b))")
PY_IMPORT_FALLBACK = re.compile(
    r"^\s*(?:from\s+([\w.]+)\s+import\b|import\s+([\w.]+(?:\s*,\s*[\w.]+)*))", re.M)


def read_text(path):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return ""


def walk_files(root):
    """Return sorted [(rel_posix, abs_path)] for files we care about."""
    result = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(
            d for d in dirnames
            if d not in IGNORE_DIRS and (not d.startswith(".") or d in KEEP_HIDDEN))
        for name in sorted(filenames):
            if name.startswith("."):
                continue
            abs_path = os.path.join(dirpath, name)
            rel = os.path.relpath(abs_path, root).replace(os.sep, "/")
            result.append((rel, abs_path))
    return result


def classify(rel):
    ext = os.path.splitext(rel)[1].lower()
    if ext in CODE_EXTS:
        return "code", CODE_EXTS[ext]
    if ext in DOC_EXTS:
        return "doc", DOC_EXTS[ext]
    if ext in CFG_EXTS:
        return "config", CFG_EXTS[ext]
    return None, None


# ---------------------------------------------------------------- parsing

def parse_python(text):
    """Return ([(module, level), ...], [symbol, ...])."""
    imports, symbols = [], []
    try:
        tree = ast.parse(text)
    except SyntaxError:
        for m in PY_IMPORT_FALLBACK.finditer(text):
            if m.group(1):
                imports.append((m.group(1), 0))
            elif m.group(2):
                for part in m.group(2).split(","):
                    part = part.strip()
                    if part:
                        imports.append((part, 0))
        return imports, symbols
    for node in tree.body:  # top-level symbols only
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            symbols.append(node.name)
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                imports.append((alias.name, 0))
        elif isinstance(node, ast.ImportFrom):
            imports.append((node.module or "", node.level))
    return imports, symbols


def parse_js(text):
    """Return ([(specifier, 0), ...], [symbol, ...])."""
    imports = [(m.group(1), 0) for m in JS_IMPORT.finditer(text)]
    symbols = []
    for m in JS_FUNC.finditer(text):
        name = m.group(1) or m.group(2) or m.group(3)
        if name and name not in symbols:
            symbols.append(name)
    return imports, symbols


def resolve_py(module, level, rel, rel_set):
    if level == 0:
        cand = module.replace(".", "/")
    else:
        parts = rel.split("/")[:-1]
        for _ in range(level - 1):
            if parts:
                parts.pop()
        mod_parts = module.split(".") if module else []
        cand = "/".join(parts + mod_parts)
    if not cand:
        return None
    for c in (cand + ".py", cand + "/__init__.py"):
        if c in rel_set:
            return c
    return None


def resolve_js(spec, rel, rel_set):
    """Return (target_rel_or_None, external_pkg_or_None)."""
    if not spec.startswith(".") and not spec.startswith("/"):
        pkg = spec if spec.startswith("@") and "/" in spec else spec.split("/")[0]
        return None, pkg
    parts = []
    for seg in spec.replace("\\", "/").split("/"):
        if seg in ("", "."):
            continue
        if seg == "..":
            if parts:
                parts.pop()
        else:
            parts.append(seg)
    if not parts:
        return None, None
    if spec.startswith("/"):
        candidates = ["/".join(parts)]
    else:
        candidates = ["/".join(rel.split("/")[:-1] + parts)]
    exts = [".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs", ".json"]
    for base in candidates:
        tried = [base] + [base + e for e in exts] + [base + "/index" + e for e in exts]
        for t in tried:
            if t in rel_set:
                return t, None
    return None, None


def make_doc_resolver(rel, rel_set):
    base = rel.split("/")[:-1]

    def resolve_path(p):
        p = urllib.parse.unquote(p.split("#")[0].split("?")[0]).replace("\\", "/")
        if not p or p.startswith(("http://", "https://", "mailto:", "ftp:", "/")):
            return None
        out = []
        for seg in p.split("/"):
            if seg in ("", "."):
                continue
            if seg == "..":
                if out:
                    out.pop()
            else:
                out.append(seg)
        if not out:
            return None
        tail = "/".join(out)
        if base:  # doc-relative first (that's what markdown means)
            cand = "/".join(base + out)
            if cand in rel_set:
                return cand
        return tail if tail in rel_set else None

    return resolve_path


def parse_doc(text, resolve_path):
    """Return (links, mentions, missing). Each entry is a resolved rel path (missing = raw)."""
    links, mentions, missing = [], [], []
    for m in MD_LINK.finditer(text):
        raw = m.group(1)
        target = resolve_path(raw)
        if target:
            links.append(target)
        elif os.path.splitext(raw)[1].lower() in KNOWN_EXTS:
            missing.append(raw)
    n = 0
    for m in MD_CODESPAN.finditer(text):
        if n >= MAX_MENTIONS:
            break
        tok = m.group(1).strip().rstrip(".,;:")
        if not tok or "/" not in tok and os.path.splitext(tok)[1].lower() not in KNOWN_EXTS:
            continue
        target = resolve_path(tok)
        if target:
            mentions.append(target)
            n += 1
    return links, mentions, missing


# ---------------------------------------------------------------- graph build

def build_graph(root):
    files = walk_files(root)
    rel_set, parsed, abs_map = set(), {}, {}
    for rel, abs_path in files:
        kind, lang = classify(rel)
        if not kind:
            continue
        try:
            size = os.path.getsize(abs_path)
        except OSError:
            continue
        if size > MAX_FILE_BYTES:
            continue
        rel_set.add(rel)
        parsed[rel] = (kind, lang)
        abs_map[rel] = abs_path

    nodes, edges = [], []
    edge_set = set()
    external = defaultdict(int)
    doc_missing = {}

    def add_edge(a, b, kind):
        if a == b:
            return
        key = (a, b, kind)
        if key not in edge_set:
            edge_set.add(key)
            edges.append({"from": a, "to": b, "kind": kind})

    for rel in sorted(parsed):
        kind, lang = parsed[rel]
        label = rel.rsplit("/", 1)[-1]
        nodes.append({"id": rel, "type": kind, "label": label, "lang": lang})
        text = read_text(abs_map[rel])
        if kind == "code":
            if lang == "python":
                imports, symbols = parse_python(text)
            else:
                imports, symbols = parse_js(text)
            for name in symbols[:MAX_SYMBOLS]:
                sid = rel + "::" + name
                nodes.append({"id": sid, "type": "symbol", "label": name,
                              "lang": lang, "parent": rel})
                add_edge(rel, sid, "contains")
            for raw, level in imports:
                if lang == "python":
                    target = resolve_py(raw, level, rel, rel_set)
                    if target is None and level == 0 and raw:
                        external[raw.split(".")[0]] += 1
                else:
                    target, pkg = resolve_js(raw, rel, rel_set)
                    if target is None and pkg:
                        external[pkg] += 1
                if target:
                    add_edge(rel, target, "imports")
        elif kind == "doc":
            resolve_path = make_doc_resolver(rel, rel_set)
            links, mentions, missing = parse_doc(text, resolve_path)
            for t in links:
                add_edge(rel, t, "links")
            for t in mentions:
                add_edge(rel, t, "mentions")
            if missing:
                doc_missing[rel] = missing[:10]

    by_type = defaultdict(int)
    by_lang = defaultdict(int)
    for n in nodes:
        by_type[n["type"]] += 1
        if n["type"] != "symbol":
            by_lang[n.get("lang") or "?"] += 1

    meta = {
        "root": os.path.basename(root) or root,
        "generated": datetime.datetime.now().isoformat(timespec="seconds"),
        "counts": {"nodes": len(nodes), "edges": len(edges),
                   "by_type": dict(by_type), "by_lang": dict(by_lang)},
        "external": sorted(external.items(), key=lambda kv: -kv[1])[:25],
        "missing_links": dict(list(doc_missing.items())[:30]),
    }
    return {"meta": meta, "nodes": nodes, "edges": edges}


# ---------------------------------------------------------------- html

HTML_TEMPLATE = r"""<!doctype html>
<html><head><meta charset="utf-8"><title>Graphify — knowledge graph</title>
<style>
  html,body{margin:0;height:100%;background:#0d1117;color:#dde6f0;font:13px system-ui,sans-serif;overflow:hidden}
  #bar{position:fixed;top:0;left:0;right:0;height:44px;display:flex;align-items:center;gap:12px;
       padding:0 14px;background:#161b22;border-bottom:1px solid #2a3240;box-sizing:border-box;z-index:5}
  #bar b{color:#4d9fff;letter-spacing:.5px}
  #q{background:#0d1117;color:#dde6f0;border:1px solid #2a3240;border-radius:6px;padding:5px 9px;outline:none}
  #legend{display:flex;gap:12px;font-size:12px}
  #legend label{display:flex;align-items:center;gap:4px;cursor:pointer}
  #info{color:#7b8797;font-size:12px;margin-left:auto}
  button{background:#21262d;color:#dde6f0;border:1px solid #2a3240;border-radius:6px;padding:5px 10px;cursor:pointer}
  #cv{position:absolute;top:44px;left:0}
  #tip{position:fixed;display:none;background:#161b22;border:1px solid #2a3240;border-radius:6px;
       padding:7px 10px;font-size:12px;pointer-events:none;z-index:9;max-width:420px;box-shadow:0 4px 14px #0008}
</style></head>
<body>
<div id="bar"><b>&#9678; Graphify</b>
  <input id="q" placeholder="search node…" size="26" autocomplete="off">
  <span id="legend"></span>
  <button id="reset">reset view</button>
  <span id="info"></span>
</div>
<canvas id="cv"></canvas>
<div id="tip"></div>
<script>
const DATA = __DATA__;
const COLORS = {code:"#4d9fff", doc:"#3ecf8e", config:"#f5a623", symbol:"#b48cff"};
const TYPES = ["code","doc","config","symbol"];
const TOP = 44;
const cv = document.getElementById("cv"), ctx = cv.getContext("2d");
const tip = document.getElementById("tip"), info = document.getElementById("info");
const q = document.getElementById("q");
let W, H, stateReady = false;
function resize(){ W = cv.width = innerWidth; H = cv.height = innerHeight - TOP; cv.style.height = H + "px"; if (stateReady) draw(); }
addEventListener("resize", resize); resize();

const nodes = DATA.nodes.map(n => Object.assign({}, n, {x:0, y:0, vx:0, vy:0, deg:0, hit:false, on:true}));
const byId = {}; nodes.forEach(n => byId[n.id] = n);
const links = DATA.links.map(l => ({s: byId[l.from], t: byId[l.to], k: l.kind})).filter(l => l.s && l.t);
links.forEach(l => { l.s.deg++; l.t.deg++; });
nodes.forEach(n => { n.r = Math.min(16, 2.5 + Math.sqrt(n.deg) * (n.type === "symbol" ? 1.1 : 2.2)); });

// seed positions: one circle per type (center is corrected live by gravity)
TYPES.forEach((t, ti) => {
  const arr = nodes.filter(n => n.type === t);
  const R = 100 + ti * 170;
  arr.forEach((n, i) => { const a = i / Math.max(1, arr.length) * 2 * Math.PI;
    n.x = W/2 + R * Math.cos(a); n.y = H/2 + R * Math.sin(a); });
});

let alpha = 1, running = true, panX = 0, panY = 0, zoom = 1;
let hover = null, sel = null, dragging = false, dragNode = null, moved = false, lastMX = 0, lastMY = 0;

function step(){
  const vis = nodes.filter(n => n.on);
  const a = alpha;
  for (let i = 0; i < vis.length; i++){ const p = vis[i];
    for (let j = i + 1; j < vis.length; j++){ const r = vis[j];
      let dx = p.x - r.x, dy = p.y - r.y, d2 = dx*dx + dy*dy;
      if (d2 < 0.01){ dx = Math.random() - .5; dy = Math.random() - .5; d2 = 0.01; }
      if (d2 > 90000) continue;
      const d = Math.sqrt(d2), f = 1600 * a / d2, fx = dx/d*f, fy = dy/d*f;
      p.vx += fx; p.vy += fy; r.vx -= fx; r.vy -= fy;
    }}
  for (const l of links){
    if (!l.s.on || !l.t.on) continue;
    let dx = l.t.x - l.s.x, dy = l.t.y - l.s.y;
    const d = Math.sqrt(dx*dx + dy*dy) || 0.01;
    const want = l.k === "contains" ? 55 : 120;
    const f = (d - want) * 0.03 * a, ux = dx/d, uy = dy/d;
    l.s.vx += ux*f; l.s.vy += uy*f; l.t.vx -= ux*f; l.t.vy -= uy*f;
  }
  for (const n of vis){
    n.vx += (W/2 - n.x) * 0.0015 * a; n.vy += (H/2 - n.y) * 0.0015 * a;
    n.vx *= 0.85; n.vy *= 0.85; n.x += n.vx; n.y += n.vy;
  }
  alpha = Math.max(0, alpha - 0.0005);
  draw();
  if (alpha > 0 || dragging) requestAnimationFrame(step); else running = false;
}
function reheat(v){ alpha = Math.max(alpha, v || 0.4); if (!running){ running = true; requestAnimationFrame(step); } }

function edgeColor(k){ return k === "contains" ? "#46536b" : k === "imports" ? "#7f95ad" : "#7b8b98"; }
function edgeAlpha(k){ return k === "contains" ? 0.14 : k === "imports" ? 0.3 : 0.22; }
function esc(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;"); }

function draw(){
  if (cv.width !== innerWidth || cv.height !== innerHeight - TOP){
    W = cv.width = innerWidth; H = cv.height = innerHeight - TOP; cv.style.height = H + "px";
  }
  ctx.clearRect(0, 0, W, H);
  ctx.save(); ctx.translate(panX, panY); ctx.scale(zoom, zoom);
  const nbrs = new Set();
  if (sel){ nbrs.add(sel);
    for (const l of links){
      if (l.s === sel && l.t.on) nbrs.add(l.t);
      if (l.t === sel && l.s.on) nbrs.add(l.s);
    }}
  for (const l of links){
    if (!l.s.on || !l.t.on) continue;
    const hot = sel && (l.s === sel || l.t === sel);
    ctx.strokeStyle = hot ? "#ffd75e" : edgeColor(l.k);
    ctx.globalAlpha = hot ? 0.9 : (sel && !hot ? 0.05 : edgeAlpha(l.k));
    ctx.beginPath(); ctx.moveTo(l.s.x, l.s.y); ctx.lineTo(l.t.x, l.t.y); ctx.stroke();
  }
  for (const n of nodes){
    if (!n.on) continue;
    ctx.globalAlpha = sel && !nbrs.has(n) ? 0.15 : 1;
    ctx.fillStyle = COLORS[n.type] || "#999";
    ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, 2*Math.PI); ctx.fill();
    if (n.hit){ ctx.strokeStyle = "#ff5e5e"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 3, 0, 2*Math.PI); ctx.stroke(); ctx.lineWidth = 1; }
    if (n === sel || n === hover){ ctx.strokeStyle = "#fff";
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 2, 0, 2*Math.PI); ctx.stroke(); }
    const showLabel = (n.type !== "symbol" && n.deg >= 3) || n.deg >= 10 || n === hover || n === sel || n.hit;
    if (showLabel){ ctx.fillStyle = (sel && !nbrs.has(n)) ? "#666" : "#dde6f0";
      ctx.font = (n.type === "symbol" ? "10" : "11") + "px system-ui";
      ctx.fillText(n.label, n.x + n.r + 3, n.y + 4); }
  }
  ctx.restore(); ctx.globalAlpha = 1;
}

function world(mx, my){ return [(mx - panX) / zoom, (my - TOP - panY) / zoom]; }
function pick(wx, wy){ let best = null, bd = 1e9;
  for (const n of nodes){ if (!n.on) continue;
    const d = (n.x - wx)*(n.x - wx) + (n.y - wy)*(n.y - wy);
    if (d < (n.r + 4)*(n.r + 4) && d < bd){ bd = d; best = n; } }
  return best; }

cv.addEventListener("mousedown", e => {
  dragging = true; moved = false; lastMX = e.clientX; lastMY = e.clientY;
  const w = world(e.clientX, e.clientY); dragNode = pick(w[0], w[1]);
  if (dragNode) reheat(0.3);
});
addEventListener("mousemove", e => {
  const mx = e.clientX, my = e.clientY - TOP;
  if (dragging){
    if (dragNode){ const w = world(mx, my); dragNode.x = w[0]; dragNode.y = w[1];
      dragNode.vx = dragNode.vy = 0; alpha = Math.max(alpha, 0.15); }
    else { panX += mx - lastMX; panY += my - lastMY; }
    if (Math.abs(mx - lastMX) + Math.abs(my - lastMY) > 3) moved = true;
    lastMX = mx; lastMY = my; return;
  }
  const w = world(mx, my); hover = pick(w[0], w[1]);
  cv.style.cursor = hover ? "pointer" : "default";
  if (hover){ tip.style.display = "block"; tip.style.left = (mx + 14) + "px"; tip.style.top = (e.clientY + 12) + "px";
    tip.innerHTML = "<b>" + esc(hover.label) + "</b> <span style='color:" + (COLORS[hover.type]||"#999") + "'>[" +
      hover.type + "]</span><br>" + esc(hover.id) + "<br>degree " + hover.deg;
  } else tip.style.display = "none";
});
addEventListener("mouseup", () => {
  if (dragging && !moved){ if (dragNode) sel = (sel === dragNode) ? null : dragNode; else sel = null; }
  dragging = false; dragNode = null; draw();
});
addEventListener("keydown", e => { if (e.key === "Escape"){ sel = null; q.value = "";
  nodes.forEach(n => n.hit = false); draw(); } });
cv.addEventListener("wheel", e => {
  e.preventDefault();
  const k = e.deltaY < 0 ? 1.15 : 0.87;
  const mx = e.clientX, my = e.clientY - TOP;
  panX = mx - (mx - panX) * k; panY = my - (my - panY) * k; zoom *= k; draw();
}, {passive: false});

q.addEventListener("input", () => {
  const v = q.value.trim().toLowerCase();
  nodes.forEach(n => n.hit = !!v && n.on &&
    (n.label.toLowerCase().includes(v) || n.id.toLowerCase().includes(v)));
  if (v) reheat(0.1);
  draw();
});
document.getElementById("reset").onclick = () => { panX = 0; panY = 0; zoom = 1; reheat(0.3); draw(); };

// legend
const legend = document.getElementById("legend");
const counts = {}; nodes.forEach(n => counts[n.type] = (counts[n.type] || 0) + 1);
TYPES.forEach(t => { if (!counts[t]) return;
  const lab = document.createElement("label"); lab.style.color = COLORS[t];
  lab.innerHTML = "<input type='checkbox' checked data-t='" + t + "'> " + t + " (" + counts[t] + ")";
  legend.appendChild(lab); });
legend.addEventListener("change", e => {
  const t = e.target.dataset.t;
  nodes.forEach(n => { if (n.type === t) n.on = e.target.checked; });
  reheat(0.2); draw();
});

info.textContent = nodes.length + " nodes · " + links.length + " edges" +
  (DATA.meta.capped ? " (showing top " + nodes.length + " of " + DATA.meta.total_nodes + " by degree)" : "");
stateReady = true;
requestAnimationFrame(step);
</script>
</body></html>
"""


def contained_path(out_dir, filename):
    """Resolve filename inside out_dir and refuse paths that escape it."""
    full = os.path.realpath(os.path.join(out_dir, filename))
    base = os.path.realpath(out_dir)
    if os.path.commonpath([base, full]) != base:
        sys.exit("output path escapes output directory: " + filename)
    return full


def write_html(out_dir, graph):
    path = contained_path(out_dir, "graph.html")
    data = {"meta": graph["meta"], "nodes": graph["nodes"], "links": graph["edges"]}
    ranked = sorted(graph["nodes"],
                    key=lambda n: -sum(1 for e in graph["edges"]
                                       if e["from"] == n["id"] or e["to"] == n["id"]))
    if len(ranked) > HTML_NODE_CAP:
        keep = {n["id"] for n in ranked[:HTML_NODE_CAP]}
        data["nodes"] = [n for n in graph["nodes"] if n["id"] in keep]
        data["links"] = [e for e in graph["edges"]
                         if e["from"] in keep and e["to"] in keep]
        data["meta"]["capped"] = True
        data["meta"]["total_nodes"] = len(graph["nodes"])
    payload = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    html = HTML_TEMPLATE.replace("__DATA__", payload)
    Path(path).write_text(html, encoding="utf-8")


# ---------------------------------------------------------------- report

def write_report(out_dir, root, graph):
    path = contained_path(out_dir, "graph-report.md")
    deg = defaultdict(int)
    import_deg = defaultdict(int)
    symbol_count = defaultdict(int)
    for e in graph["edges"]:
        deg[e["from"]] += 1
        deg[e["to"]] += 1
        if e["kind"] == "imports":
            import_deg[e["from"]] += 1
            import_deg[e["to"]] += 1
        elif e["kind"] == "contains":
            symbol_count[e["from"]] += 1
    nodes = graph["nodes"]
    meta = graph["meta"]

    def top(items, key, n):
        return sorted(items, key=key, reverse=True)[:n]

    lines = []
    ap = lines.append
    ap("# Knowledge graph report — " + meta["root"])
    ap("")
    ap("Generated " + meta["generated"] + " · " + str(meta["counts"]["nodes"]) +
       " nodes · " + str(meta["counts"]["edges"]) + " edges")
    ap("")
    ap("## Overview")
    ap("")
    ap("| Type | Count |")
    ap("|---|---|")
    for t in ("code", "doc", "config", "symbol"):
        if meta["counts"]["by_type"].get(t):
            ap("| " + t + " | " + str(meta["counts"]["by_type"][t]) + " |")
    ap("")
    if meta["counts"]["by_lang"]:
        ap("Languages: " + ", ".join(k + " (" + str(v) + ")"
                                     for k, v in sorted(meta["counts"]["by_lang"].items(),
                                                        key=lambda kv: -kv[1])))
        ap("")

    hubs = top([n for n in nodes if n["type"] != "symbol"],
               lambda n: deg.get(n["id"], 0), 15)
    hubs = [n for n in hubs if deg.get(n["id"], 0) > 0]
    if hubs:
        ap("## Hubs (most connected)")
        ap("")
        ap("| Node | Type | Imports° | Total° |")
        ap("|---|---|---|---|")
        for n in hubs:
            ap("| `" + n["id"] + "` | " + n["type"] + " | " +
               str(import_deg.get(n["id"], 0)) + " | " + str(deg.get(n["id"], 0)) + " |")
        ap("")

    orphans = [n for n in nodes
               if n["type"] == "code" and import_deg.get(n["id"], 0) == 0]
    if orphans:
        ap("## Orphan code files (nothing imports them, they import nothing)")
        ap("")
        for n in orphans[:30]:
            ap("- `" + n["id"] + "`")
        if len(orphans) > 30:
            ap("- … " + str(len(orphans) - 30) + " more")
        ap("")

    if meta["external"]:
        ap("## External dependencies (top)")
        ap("")
        ap(", ".join("`" + k + "`×" + str(v) for k, v in meta["external"][:20]))
        ap("")

    docs = [n for n in nodes if n["type"] == "doc"]
    if docs:
        ap("## Docs")
        ap("")
        for n in sorted(docs, key=lambda n: -deg.get(n["id"], 0))[:15]:
            ap("- `" + n["id"] + "` — degree " + str(deg.get(n["id"], 0)))
        ap("")

    if meta["missing_links"]:
        ap("## Broken doc links (target not found)")
        ap("")
        for rel, misses in meta["missing_links"].items():
            ap("- `" + rel + "` → " + ", ".join("`" + m + "`" for m in misses))
        ap("")

    big = top([n for n in nodes if symbol_count.get(n["id"])],
              lambda n: symbol_count[n["id"]], 10)
    if big:
        ap("## Largest files by symbol count")
        ap("")
        for n in big:
            ap("- `" + n["id"] + "` — " + str(symbol_count[n["id"]]) + " top-level symbols")
        ap("")

    Path(path).write_text("\n".join(lines), encoding="utf-8")


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description="Build a knowledge graph of a project directory.")
    ap.add_argument("root", help="project directory to scan")
    ap.add_argument("--out", help="output directory (default: <root>/.graphify)")
    args = ap.parse_args()
    root = os.path.realpath(os.path.abspath(args.root))
    if not os.path.isdir(root):
        sys.exit("not a directory: " + root)
    out_dir = os.path.realpath(os.path.abspath(args.out)) if args.out \
        else os.path.join(root, ".graphify")
    os.makedirs(out_dir, exist_ok=True)

    graph = build_graph(root)
    json_path = contained_path(out_dir, "graph.json")
    html_path = os.path.join(out_dir, "graph.html")
    report_path = os.path.join(out_dir, "graph-report.md")
    Path(json_path).write_text(json.dumps(graph, ensure_ascii=False, indent=1), encoding="utf-8")
    write_html(out_dir, graph)
    write_report(out_dir, root, graph)

    c = graph["meta"]["counts"]
    print("graphify: scanned %s" % root)
    print("  nodes: %d  edges: %d  (code %d, doc %d, config %d, symbol %d)" % (
        c["nodes"], c["edges"], c["by_type"].get("code", 0), c["by_type"].get("doc", 0),
        c["by_type"].get("config", 0), c["by_type"].get("symbol", 0)))
    print("  wrote:")
    print("    " + json_path)
    print("    " + html_path)
    print("    " + report_path)


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    main()
