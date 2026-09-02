#!/usr/bin/env python3
"""Build the HTTP distribution artifacts under dist/.

Outputs:
- dist/plugins/<name>/<version>/plugin.zip  deterministic, immutable plugin artifact
- dist/marketplace.json                     marketplace document in the Claude Code
                                            marketplace schema (top-level name /
                                            description / owner / plugins), with each
                                            plugins[].source rewritten to the ZCode
                                            zip install source
- dist/assets/**                            shared assets (plugin icons, ...) copied
                                            from the repo's assets/ directory so the
                                            GitHub Pages mirror serves the same
                                            assets/<plugin>/icon.png layout as the CDN
- dist/.nojekyll                            allow dot-files/dirs on GitHub Pages

The zip is deterministic (sorted entries, fixed timestamp) so the sha256 only
changes when plugin content changes. Stdlib only.

Environment:
- CDN_BASE_URL  absolute base URL used for marketplace entries' source.url,
                e.g. https://cdn-zcode.z.ai/zcode/official-plugin
                (no trailing slash required). Defaults to the placeholder
                below; the publish pipeline always sets it explicitly.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
ASSETS_DIR = ROOT / "assets"

# Fixed timestamp for deterministic zips (2026-01-01 00:00:00).
ZIP_DATE = (2026, 1, 1, 0, 0, 0)

DEFAULT_CDN_BASE_URL = "https://cdn-zcode.z.ai/zcode/official-plugin"


def cdn_base_url() -> str:
    return os.environ.get("CDN_BASE_URL", DEFAULT_CDN_BASE_URL).rstrip("/")


def artifact_rel_path(name: str, version: str) -> str:
    """Immutable artifact path. One version, one path, forever."""
    return f"plugins/{name}/{version}/plugin.zip"


def copy_optional_fields(src: dict, dst: dict, fields: tuple[str, ...]) -> None:
    for field in fields:
        if field in src:
            dst[field] = src[field]


class UnsafeTree(RuntimeError):
    """A packaged tree contains something that must never reach the CDN."""


# Interpreter bytecode is an artifact of whatever machine last executed the
# code, not plugin content: it is gitignored, its bytes embed the source path
# and mtime, and packaging it makes a published zip's sha256 depend on whether
# anyone happened to run the tests before the build — which
# publish_incremental.py treats as a changed artifact and refuses.
BYTECODE_DIR = "__pycache__"
BYTECODE_SUFFIXES = frozenset({".pyc", ".pyo"})


def is_bytecode(path: Path, root: Path) -> bool:
    rel = path.relative_to(root)
    return BYTECODE_DIR in rel.parts or path.suffix in BYTECODE_SUFFIXES


def regular_files(root: Path) -> list[Path]:
    """Every regular file under *root*, refusing symlinks anywhere in the tree.

    validate.py rejects these first; this is the fail-closed backstop for the
    publish job itself, which runs with credentials on an internal machine.

    Bytecode is dropped from the result rather than skipped during the walk:
    the walk must still visit __pycache__ so a symlink hidden in there is
    refused instead of silently excluded.
    """
    if root.is_symlink():
        raise UnsafeTree(f"{root} is a symlink")
    out: list[Path] = []
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            rel = path.relative_to(root).as_posix()
            raise UnsafeTree(f"refusing to package symlink {rel} in {root.name}")
        if path.is_file() and not is_bytecode(path, root):
            out.append(path)
    return out


def build_zip(plugin_dir: Path, out_path: Path) -> None:
    files = regular_files(plugin_dir)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in files:
            arcname = f"{plugin_dir.name}/{f.relative_to(plugin_dir).as_posix()}"
            info = zipfile.ZipInfo(arcname, date_time=ZIP_DATE)
            info.external_attr = 0o644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            zf.writestr(info, f.read_bytes())


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def build_index_entry(entry: dict, artifact_path: Path, base_url: str) -> dict:
    """Build one published marketplace plugin entry.

    Same shape as a Claude Code marketplace entry; only `source` is rewritten
    from the in-repo relative path to the ZCode zip install source:
      { source: "url", type: "zip", url, sha256, path } — download the zip,
    verify sha256, install the `path` subdirectory inside the zip.
    (`type` / `sha256` / `path`-inside-zip are ZCode extensions.)
    `_artifact` keeps a BASE-relative path + size so mirror sources (GitHub
    Pages) can rebase the same object without rewriting URLs.
    """
    name = entry["name"]
    version = entry["version"]
    rel = artifact_rel_path(name, version)
    sha256 = sha256_of(artifact_path)
    size = artifact_path.stat().st_size

    plugin_index = dict(entry)
    plugin_index["source"] = {
        "source": "url",
        "type": "zip",
        "url": f"{base_url}/{rel}",
        "sha256": sha256,
        # Deterministic zips place all files under a single top-level
        # directory named after the plugin; install that subdirectory.
        # The client also supports `stripRoot: true` (strip the single
        # root folder) — we emit the explicit `path` form so installs
        # work even on clients without stripRoot support.
        "path": name,
    }
    plugin_index["_artifact"] = {
        "path": rel,
        "sha256": sha256,
        "size": size,
    }
    return plugin_index


def list_assets() -> list[tuple[Path, str]]:
    """(local_path, rel) for every publishable file under assets/, where rel
    is the path relative to the distribution root (\"assets/<...>\").

    Dot-files and the convention READMEs stay in the repo only.
    """
    if not ASSETS_DIR.is_dir():
        return []
    out: list[tuple[Path, str]] = []
    for f in regular_files(ASSETS_DIR):
        rel = f.relative_to(ASSETS_DIR).as_posix()
        if any(part.startswith(".") for part in f.relative_to(ASSETS_DIR).parts):
            continue
        if rel in ("README.md", "README_CN.md"):
            continue
        out.append((f, f"assets/{rel}"))
    return out


def build_published_marketplace(marketplace: dict, index_plugins: list) -> dict:
    """Published document = repo marketplace.json in the Claude Code schema,
    with plugins[].source swapped to zip install sources. No extra wrapper."""
    published = {k: v for k, v in marketplace.items() if k != "plugins"}
    published["plugins"] = index_plugins
    return published


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def main() -> int:
    marketplace = json.loads(
        (ROOT / "marketplace.json").read_text(encoding="utf-8")
    )
    base_url = cdn_base_url()

    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir(parents=True)

    index_plugins = []
    for entry in marketplace["plugins"]:
        name = entry["name"]
        version = entry["version"]
        plugin_dir = ROOT / entry["source"][2:]
        if plugin_dir.resolve().parent != (ROOT / "plugins").resolve():
            raise UnsafeTree(f"{name}: source resolves outside plugins/")

        artifact_path = DIST / artifact_rel_path(name, version)
        build_zip(plugin_dir, artifact_path)
        index_plugins.append(build_index_entry(entry, artifact_path, base_url))

    published = build_published_marketplace(marketplace, index_plugins)
    published_text = json.dumps(published, ensure_ascii=False, indent=2) + "\n"
    (DIST / "marketplace.json").write_text(published_text, encoding="utf-8")
    (DIST / ".nojekyll").write_text("")

    assets = list_assets()
    for local, rel in assets:
        dest = DIST / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(local, dest)

    print(f"Built dist/ with {len(index_plugins)} plugin artifact(s) "
          f"and {len(assets)} asset file(s)")
    for p in index_plugins:
        print(
            f"  - {p['_artifact']['path']}  sha256={p['_artifact']['sha256'][:12]}…  "
            f"{p['_artifact']['size']} bytes"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
