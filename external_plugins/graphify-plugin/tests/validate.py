#!/usr/bin/env python3
"""Validate the plugin structure: manifests, skill frontmatter and declared paths."""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
errors = []


def check(cond, msg):
    if not cond:
        errors.append(msg)


def load_json(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


manifest = load_json(ROOT / ".zcode-plugin" / "plugin.json")
check(manifest.get("name") == "graphify-plugin", "manifest name must be graphify-plugin")
check(bool(re.match(r"^\d+\.\d+\.\d+$", manifest.get("version", ""))),
      "manifest version must be semver (x.y.z)")
check(bool(manifest.get("description")), "manifest description is empty")
check(bool(manifest.get("author")), "manifest author is empty")
check(manifest.get("skills") == "./skills", "manifest skills must point to ./skills")

skill_md = ROOT / "skills" / "graphify" / "SKILL.md"
check(skill_md.is_file(), "skills/graphify/SKILL.md is missing")
front = skill_md.read_text(encoding="utf-8") if skill_md.is_file() else ""
fm = re.match(r"^---\n(.*?)\n---\n", front, re.S)
check(bool(fm), "SKILL.md frontmatter is missing")
if fm:
    block = fm.group(1)
    check(bool(re.search(r"^name:\s*graphify\s*$", block, re.M)), "SKILL.md name must be graphify")
    check(bool(re.search(r"^description:\s*>", block, re.M)), "SKILL.md description is missing")

for s in ("build_graph.py", "query_graph.py"):
    check((ROOT / "skills" / "graphify" / "scripts" / s).is_file(), "script missing: " + s)

market = load_json(ROOT / ".claude-plugin" / "marketplace.json")
entries = market.get("plugins", [])
match = [e for e in entries if e.get("name") == manifest["name"]]
check(len(match) == 1, "marketplace entry missing for graphify-plugin")
if match:
    e = match[0]
    check(e.get("version") == manifest["version"], "marketplace version != manifest version")
    src = (ROOT / e.get("source", "")).resolve()
    check(src == ROOT.resolve(), "marketplace source does not resolve to the plugin root")
    check(bool(e.get("description")), "marketplace description is empty")

declared = [manifest.get("skills", ""), *[x.get("source", "") for x in entries]]
for p in declared:
    check(not str(p).startswith("..") and ".." not in Path(p).parts,
          "declared path escapes plugin root: " + str(p))

if errors:
    print("VALIDATION FAILED:")
    for e in errors:
        print("  -", e)
    sys.exit(1)
print("plugin validation OK — %s %s" % (manifest["name"], manifest["version"]))
