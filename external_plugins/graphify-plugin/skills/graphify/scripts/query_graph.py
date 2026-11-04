#!/usr/bin/env python3
"""graphify query — query a knowledge graph produced by build_graph.py.

Usage:
  query_graph.py GRAPH.json COMMAND [REF] [--kind K] [--dir in|out|both] [--all] [--json]

Commands:
  info                size, node/edge counts, top external dependencies
  hubs [N]            most-connected files (skip symbols unless --all)
  orphans             code files with no import edges at all
  search TERM         find nodes by name or path substring
  node REF            details + direct edges of one node
  neighbors REF       first-degree edges (--kind imports/contains/links/mentions, --dir in/out)
  imports REF         what REF imports (project-internal)
  imported-by REF     what depends on REF (blast radius)
  external [N]        top third-party packages
"""
import argparse
import json
import sys
from collections import defaultdict


def build_index(g):
    out_map = defaultdict(list)
    in_map = defaultdict(list)
    for e in g["edges"]:
        out_map[e["from"]].append(e)
        in_map[e["to"]].append(e)
    return out_map, in_map


def resolve(nodes, ref):
    """Return (node_or_None, candidates_or_None)."""
    for n in nodes:
        if n["id"] == ref:
            return n, None
    exact = [n for n in nodes if n["label"] == ref]
    if len(exact) == 1:
        return exact[0], None
    sub = [n for n in nodes if ref.lower() in n["id"].lower()]
    if len(sub) == 1:
        return sub[0], None
    return None, (exact or sub) or []


def print_candidates(cands):
    print("ambiguous reference — matches:")
    for n in cands[:20]:
        print("  %s  [%s]" % (n["id"], n["type"]))
    if len(cands) > 20:
        print("  … %d more" % (len(cands) - 20))
    print("re-run with a full node id from the list above.")


def degree_maps(g):
    deg = defaultdict(int)
    imp = defaultdict(int)
    for e in g["edges"]:
        deg[e["from"]] += 1
        deg[e["to"]] += 1
        if e["kind"] == "imports":
            imp[e["from"]] += 1
            imp[e["to"]] += 1
    return deg, imp


def fmt_edges(edges, direction):
    rows = []
    for e in edges:
        other = e["to"] if direction == "out" else e["from"]
        arrow = "->" if direction == "out" else "<-"
        rows.append("  %s %s [%s] %s" % (arrow, other, e["kind"], ""))
    return rows


def main():
    ap = argparse.ArgumentParser(description="Query a graphify graph.json.")
    ap.add_argument("graph")
    ap.add_argument("command",
                    choices=["info", "hubs", "orphans", "search", "node",
                             "neighbors", "imports", "imported-by", "external"])
    ap.add_argument("ref", nargs="?", help="node id, file name, symbol id, or search term")
    ap.add_argument("--kind", help="filter edges by kind")
    ap.add_argument("--dir", default="both", choices=["in", "out", "both"])
    ap.add_argument("--all", action="store_true", help="hubs: include symbol nodes")
    ap.add_argument("--json", action="store_true", help="emit raw JSON")
    args = ap.parse_args()

    try:
        with open(args.graph, "r", encoding="utf-8") as f:
            g = json.load(f)
    except (OSError, ValueError) as exc:
        sys.exit("cannot read graph: %s" % exc)

    nodes = g["nodes"]
    out_map, in_map = build_index(g)
    deg, imp = degree_maps(g)
    need_ref = args.command in ("search", "node", "neighbors", "imports", "imported-by")
    if need_ref and not args.ref:
        sys.exit("command '%s' needs a reference argument" % args.command)

    if args.command == "info":
        if args.json:
            print(json.dumps(g["meta"], ensure_ascii=False, indent=2))
            return
        m = g["meta"]
        print("root: %s   generated: %s" % (m["root"], m["generated"]))
        c = m["counts"]
        print("nodes: %d   edges: %d" % (c["nodes"], c["edges"]))
        print("by type: " + ", ".join("%s=%d" % kv for kv in sorted(c["by_type"].items())))
        print("by lang: " + ", ".join("%s=%d" % kv for kv in sorted(c["by_lang"].items())))
        if m.get("external"):
            print("top external: " + ", ".join("%s×%d" % tuple(kv) for kv in m["external"][:10]))

    elif args.command == "hubs":
        n = int(args.ref) if args.ref and args.ref.isdigit() else 15
        pool = nodes if args.all else [x for x in nodes if x["type"] != "symbol"]
        pool = sorted(pool, key=lambda x: -deg.get(x["id"], 0))[:n]
        pool = [x for x in pool if deg.get(x["id"], 0) > 0]
        if args.json:
            print(json.dumps([{"id": x["id"], "type": x["type"],
                               "degree": deg.get(x["id"], 0),
                               "imports_degree": imp.get(x["id"], 0)} for x in pool],
                             ensure_ascii=False, indent=2))
            return
        print("top %d hubs:" % len(pool))
        for x in pool:
            print("  %-4d imports=%-4d %s  [%s]" %
                  (deg.get(x["id"], 0), imp.get(x["id"], 0), x["id"], x["type"]))

    elif args.command == "orphans":
        orphans = [x for x in nodes if x["type"] == "code" and imp.get(x["id"], 0) == 0]
        if args.json:
            print(json.dumps([x["id"] for x in orphans], ensure_ascii=False, indent=2))
            return
        print("%d orphan code files:" % len(orphans))
        for x in orphans[:50]:
            print("  " + x["id"])
        if len(orphans) > 50:
            print("  … %d more" % (len(orphans) - 50))

    elif args.command == "search":
        term = args.ref.lower()
        hits = [x for x in nodes if term in x["id"].lower() or term in x["label"].lower()]
        if args.json:
            print(json.dumps(hits, ensure_ascii=False, indent=2))
            return
        print("%d matches for %r:" % (len(hits), args.ref))
        for x in hits[:50]:
            print("  %s  [%s]  degree=%d" % (x["id"], x["type"], deg.get(x["id"], 0)))
        if len(hits) > 50:
            print("  … %d more" % (len(hits) - 50))

    elif args.command in ("node", "neighbors", "imports", "imported-by"):
        node, cands = resolve(nodes, args.ref)
        if node is None:
            if cands:
                print_candidates(cands)
                sys.exit(2)
            sys.exit("no node matches %r — try the search command" % args.ref)
        if args.command == "node":
            related = out_map.get(node["id"], []) + in_map.get(node["id"], [])
            if args.json:
                print(json.dumps({"node": node, "edges": related},
                                 ensure_ascii=False, indent=2))
                return
            print("%s  [%s]  lang=%s  degree=%d" %
                  (node["id"], node["type"], node.get("lang", "?"), deg.get(node["id"], 0)))
            for line in fmt_edges(out_map.get(node["id"], []), "out"):
                print(line)
            for line in fmt_edges(in_map.get(node["id"], []), "in"):
                print(line)
            return
        kind = args.kind or ("imports" if args.command in ("imports", "imported-by") else None)
        direction = {"imports": "out", "imported-by": "in"}.get(args.command, args.dir)
        selected = []
        if direction in ("out", "both"):
            for e in out_map.get(node["id"], []):
                if not kind or e["kind"] == kind:
                    selected.append(("out", e))
        if direction in ("in", "both"):
            for e in in_map.get(node["id"], []):
                if not kind or e["kind"] == kind:
                    selected.append(("in", e))
        if args.json:
            print(json.dumps([{"direction": d, **e} for d, e in selected],
                             ensure_ascii=False, indent=2))
            return
        print("%s (%s) — %d %s edges%s%s:" % (
            node["id"], node["type"], len(selected),
            kind or "all", " dir=" + direction if direction != "both" else "",
            "" if direction != "both" else ""))
        shown = selected[:60]
        for d, e in shown:
            other = e["to"] if d == "out" else e["from"]
            print("  %s %s  [%s]" % ("->" if d == "out" else "<-", other, e["kind"]))
        if len(selected) > len(shown):
            print("  … %d more" % (len(selected) - len(shown)))

    elif args.command == "external":
        n = int(args.ref) if args.ref and args.ref.isdigit() else 20
        ext = g["meta"].get("external", [])[:n]
        if args.json:
            print(json.dumps(ext, ensure_ascii=False, indent=2))
            return
        print("top external packages:")
        for name, cnt in ext:
            print("  %-6d %s" % (cnt, name))


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    main()
