#!/usr/bin/env python3
"""Zero-token project scanner: detect stacks from manifests, diff against
installed skills, report gaps. Deterministic, stdlib only — no LLM calls.

Usage: scan_project.py [project-root]      (default: cwd)
Output: human report + JSON blob on stdout.

Stack -> skill-keyword map mirrors the recipes in skills/skill-forge/SKILL.md.
A gap is a detected stack with no installed skill whose name/description
matches its keywords.
"""
import json
import os
import re
import sys

STACK_KEYWORDS = {
    "laravel": ["laravel"],
    "symfony": ["symfony"],
    "wordpress": ["wordpress"],
    "php": ["php"],
    "react": ["react", "nextjs", "next.js"],
    "vue": ["vue", "nuxt"],
    "svelte": ["svelte"],
    "angular": ["angular"],
    "astro": ["astro"],
    "node": ["node", "npm", "express"],
    "django": ["django"],
    "flask": ["flask"],
    "fastapi": ["fastapi"],
    "python": ["python", "pytest"],
    "rails": ["rails", "ruby on rails"],
    "ruby": ["ruby"],
    "go": ["golang", "go "],
    "rust": ["rust", "cargo"],
    "spring": ["spring boot", "spring"],
    "java": ["java"],
    "dotnet": [".net", "csharp", "c#"],
}


def read_json(path):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return None


def scan_stacks(root):
    stacks = set()
    composer = read_json(os.path.join(root, "composer.json"))
    if composer:
        stacks.add("php")
        req = {**composer.get("require", {}), **composer.get("require-dev", {})}
        for pkg in req:
            if "laravel/framework" in pkg:
                stacks.add("laravel")
            elif "symfony" in pkg:
                stacks.add("symfony")
            elif "wordpress" in pkg or pkg == "roots/wordpress":
                stacks.add("wordpress")
    pkg = read_json(os.path.join(root, "package.json"))
    if pkg:
        stacks.add("node")
        deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
        for d in deps:
            if d.startswith("next"):
                stacks.update({"react", "next"})
            elif d.startswith("react"):
                stacks.add("react")
            elif d.startswith("vue") or d.startswith("nuxt"):
                stacks.add("vue")
            elif d.startswith("svelte"):
                stacks.add("svelte")
            elif d.startswith("@angular"):
                stacks.add("angular")
            elif d.startswith("astro"):
                stacks.add("astro")
            if "tailwind" in d:
                stacks.add("tailwind")
    for pyfile, add in (("requirements.txt", None), ("pyproject.toml", None)):
        p = os.path.join(root, pyfile)
        if os.path.exists(p):
            stacks.add("python")
            text = open(p, errors="replace").read().lower()
            for fw in ("django", "flask", "fastapi"):
                if re.search(rf"^\s*[-\w./]*{fw}", text, re.M) or f'"{fw}' in text:
                    stacks.add(fw)
    if os.path.exists(os.path.join(root, "manage.py")):
        stacks.update({"python", "django"})
    if os.path.exists(os.path.join(root, "go.mod")):
        stacks.add("go")
    if os.path.exists(os.path.join(root, "Cargo.toml")):
        stacks.add("rust")
    gemfile = os.path.join(root, "Gemfile")
    if os.path.exists(gemfile):
        stacks.add("ruby")
        if "rails" in open(gemfile, errors="replace").read().lower():
            stacks.add("rails")
    for j in ("pom.xml", "build.gradle", "build.gradle.kts"):
        if os.path.exists(os.path.join(root, j)):
            stacks.add("java")
            text = open(os.path.join(root, j), errors="replace").read().lower()
            if "spring" in text:
                stacks.add("spring")
    csproj = [f for f in os.listdir(root) if f.endswith(".csproj") or f.endswith(".sln")] \
        if os.path.isdir(root) else []
    if csproj:
        stacks.add("dotnet")
    stacks.discard("next")  # 'next' implies react; keep tailwind as its own signal
    return stacks


def installed_skills(root):
    """Plugin skills + workspace/user skills, with name+description text."""
    here = os.path.dirname(os.path.abspath(__file__))
    plugin_root = os.path.abspath(os.path.join(here, "..", "..", ".."))
    dirs = [
        os.path.join(plugin_root, "skills"),
        os.path.join(root, ".zcode", "skills"),
        os.path.join(root, ".agents", "skills"),
        os.path.expanduser("~/.zcode/skills"),
        os.path.expanduser("~/.agents/skills"),
    ]
    found = []
    for d in dirs:
        if not os.path.isdir(d):
            continue
        for skf in glob_skls(d):
            try:
                text = open(skf, errors="replace").read()
                m = re.match(r"^---\n(.*?)\n---", text, re.S)
                meta = {}
                if m:
                    for line in m.group(1).splitlines():
                        if ":" in line:
                            k, v = line.split(":", 1)
                            meta[k.strip()] = v.strip()
                found.append({"path": skf,
                              "name": meta.get("name", os.path.basename(os.path.dirname(skf))),
                              "text": (meta.get("name", "") + " " + meta.get("description", "")).lower()})
            except Exception:
                pass
    return found


def glob_skls(d, max_depth=2):
    out = []
    for dirpath, dirnames, filenames in os.walk(d):
        depth = dirpath[len(d):].count(os.sep)
        if depth >= max_depth:
            dirnames[:] = []
            continue
        dirnames[:] = [x for x in dirnames
                       if x not in ("node_modules", ".git", "__pycache__")]
        if "SKILL.md" in filenames:
            out.append(os.path.join(dirpath, "SKILL.md"))
    return out


def covers(stack, skill, kws):
    """A skill covers a stack only if the keyword is a NAME token. Description
    matching is deliberately rejected: any skill that *talks about* a stack
    (recipe lists, examples) would claim coverage — observed live on
    laravel/laravel 2026-09-03, where skill-forge's recipe mention covered
    'laravel' and an animation skill covered 'tailwind'. A false GAP merely
    offers creation; a false COVERED silently misses. Err toward GAP."""
    name_tokens = set(re.split(r"[-_]", skill["name"].lower()))
    return any(kw.strip() in name_tokens for kw in kws)


def main():
    root = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.getcwd())
    stacks = scan_stacks(root)
    installed = installed_skills(root)
    gaps = []
    covered = []
    for stack in sorted(stacks):
        kws = STACK_KEYWORDS.get(stack, [stack])
        match = next((s["name"] for s in installed if covers(stack, s, kws)), None)
        (covered if match else gaps).append((stack, match))
    print(f"project: {root}")
    print(f"stacks detected: {', '.join(sorted(stacks)) or '(none)'}")
    print(f"skills installed: {len(installed)}")
    for stack, via in covered:
        print(f"  COVERED  {stack:<12} by {via}")
    for stack, _ in gaps:
        print(f"  GAP      {stack:<12} no matching skill installed")
    print(json.dumps({"root": root, "detected": sorted(stacks),
                      "installed": [s["name"] for s in installed],
                      "gaps": [g for g, _ in gaps]}, indent=None))


if __name__ == "__main__":
    main()
