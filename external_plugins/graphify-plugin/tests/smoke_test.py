#!/usr/bin/env python3
"""End-to-end smoke test: build a graph of the sample fixture and query it."""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "skills" / "graphify" / "scripts" / "build_graph.py"
QUERY = ROOT / "skills" / "graphify" / "scripts" / "query_graph.py"
SAMPLE = ROOT / "tests" / "sample"


def run(*argv):
    p = subprocess.run([sys.executable, *argv], capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    if p.returncode != 0:
        raise SystemExit("command failed: %r\n%s%s" % (argv, p.stdout, p.stderr))
    return p.stdout


def main():
    run(str(BUILD), str(SAMPLE))
    graph = json.loads((SAMPLE / ".graphify" / "graph.json").read_text(encoding="utf-8"))
    edges = {(e["from"], e["to"], e["kind"]) for e in graph["edges"]}
    node_ids = {n["id"] for n in graph["nodes"]}

    for fid in ("app.py", "utils.py", "models.py", "web/index.js", "web/lib.js",
                "docs/README.md", "config.json", "docs/guide.md", "legacy/old.py"):
        assert fid in node_ids, "missing node: " + fid

    for e in (("app.py", "utils.py", "imports"),
              ("app.py", "models.py", "imports"),
              ("models.py", "utils.py", "imports"),
              ("web/index.js", "web/lib.js", "imports")):
        assert e in edges, "missing edge: " + str(e)

    assert ("docs/README.md", "app.py", "links") in edges, "doc link edge missing"
    assert ("docs/README.md", "config.json", "mentions") in edges, "mention edge missing"

    for sym in ("app.py::App", "app.py::main", "models.py::User", "models.py::Order",
                "web/index.js::render", "web/lib.js::formatName", "legacy/old.py::cleanup"):
        assert sym in node_ids, "missing symbol: " + sym

    assert graph["meta"]["missing_links"].get("docs/README.md") == ["usage.md"], "broken link not reported"

    c = graph["meta"]["counts"]
    assert (c["by_type"]["code"], c["by_type"]["doc"], c["by_type"]["config"],
            c["by_type"]["symbol"]) == (6, 2, 1, 11), "counts wrong: " + str(c)

    q = str(SAMPLE / ".graphify" / "graph.json")
    out = run(str(QUERY), q, "orphans")
    assert "legacy/old.py" in out, "orphans query wrong"
    out = run(str(QUERY), q, "imported-by", "utils.py")
    assert "app.py" in out and "models.py" in out, "imported-by query wrong"
    out = run(str(QUERY), q, "info")
    assert "nodes: 20" in out, "info counts wrong"
    out = run(str(QUERY), q, "hubs")
    assert "app.py" in out, "hubs query wrong"

    html = (SAMPLE / ".graphify" / "graph.html").read_text(encoding="utf-8")
    assert "Graphify" in html and "__DATA__" not in html, "html template broken"
    report = (SAMPLE / ".graphify" / "graph-report.md").read_text(encoding="utf-8")
    assert "Orphan code files" in report, "report section missing"

    print("smoke test OK —", c)


if __name__ == "__main__":
    main()
