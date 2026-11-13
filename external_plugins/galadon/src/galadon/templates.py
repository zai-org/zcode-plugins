from __future__ import annotations

import shutil
from datetime import date
from pathlib import Path

from .config import DEFAULT_PATHS, LAYOUTS, STACKS
from .layouts import LAYOUT_RETRO, LAYOUT_SPECS, checks_for, npm_name, package_name

PLUGIN_ROOT = Path(__file__).resolve().parents[2]

# `.agents/` is gitignored inside the galadon repo itself, and npm drops every
# `.gitignore` from the published tarball, so templates store the leading dot
# under a neutral name and the renderer maps it back.
PATH_ALIASES = {"__agents__": ".agents", "gitignore": ".gitignore"}

# Shared by every non-none layout: the spec truth layer plus the files that are
# byte-identical across layouts (`.agents/` slots and READMEs, the wiki /
# openspec / scripts READMEs, `.gitignore`, `openspec/config.yaml`). It renders
# before the layout's `common/` layer so a layout can override a file; `plugin`
# does, with its CLI/packaging-specific versions.
SHARED_LAYER = "_shared"

# Base stubs a layout replaces with a real layer: layouts generate code under
# `src/` and move the retro into `wiki/progress/`, so the base README and the
# root retro stub would be wrong or duplicated.
LAYOUT_SUPERSEDES = frozenset({"src/README.md", "wiki/retro.md"})


class TemplateError(ValueError):
    pass


class FileTemplateProvider:
    def __init__(self, plugin_root: Path | None = None) -> None:
        self.plugin_root = plugin_root or PLUGIN_ROOT

    def _files(self, directory: Path) -> list[Path]:
        if not directory.is_dir():
            return []
        return sorted(path for path in directory.rglob("*") if path.is_file())

    def _relative(self, source: Path, layer: Path, values: dict[str, str]) -> Path:
        parts: list[str] = []
        for part in source.relative_to(layer).parts:
            part = PATH_ALIASES.get(part, part)
            for key, value in values.items():
                part = part.replace(key, value)
            if "{{" in part:
                raise TemplateError(f"unknown placeholder in template path: {source}")
            parts.append(part)
        rendered = Path(*parts)
        return rendered.with_suffix("") if source.suffix == ".tmpl" else rendered

    def render(
        self,
        root: Path,
        profile: str,
        role: str,
        name: str,
        force: bool = False,
        layout: str = "none",
        stack: str = "python",
    ) -> dict[str, list[str]]:
        if layout not in LAYOUTS:
            raise TemplateError(f"unknown layout: {layout}")
        if stack not in STACKS:
            raise TemplateError(f"unknown stack: {stack}")
        if "/" in name or "\\" in name:
            raise TemplateError(f"project name must not contain a path separator: {name}")
        if name in {".", ".."}:
            raise TemplateError(f"project name must not be a path component: {name}")
        effective_stack = stack if layout != "none" else "none"

        base = self.plugin_root / "templates" / "base"
        overlay = self.plugin_root / "templates" / "profiles" / profile
        if not base.is_dir():
            raise TemplateError(f"missing template base: {base}")
        if not overlay.is_dir():
            raise TemplateError(f"unknown template profile: {profile}")

        # Explicit order: base, profile, shared, layout/common, layout/<stack>.
        # Later layers win, so a layout may override a shared file; `none`
        # never renders the shared layer.
        layers: list[tuple[Path, bool]] = [(base, True), (overlay, False)]
        if layout != "none":
            shared = self.plugin_root / "templates" / "layouts" / SHARED_LAYER
            if not shared.is_dir():
                raise TemplateError(f"missing shared layout template: {shared}")
            layers.append((shared, False))
            layout_root = self.plugin_root / "templates" / "layouts" / layout
            common = layout_root / "common"
            if not common.is_dir():
                raise TemplateError(f"missing layout common template: {common}")
            layers.append((common, False))
            if effective_stack != "none":
                stack_owner = LAYOUT_SPECS[layout].stack_templates or layout
                stack_dir = (
                    self.plugin_root / "templates" / "layouts" / stack_owner / effective_stack
                )
                if not stack_dir.is_dir():
                    raise TemplateError(
                        f"missing template stack {effective_stack} for layout {layout}: {stack_dir}"
                    )
                layers.append((stack_dir, False))

        build_check, test_check = checks_for(layout, effective_stack, name)
        values = {
            "{{PROJECT}}": name,
            "{{PACKAGE}}": package_name(name),
            "{{NPM_NAME}}": npm_name(name),
            "{{TEMPLATE}}": profile,
            "{{ROLE}}": role,
            "{{LAYOUT}}": layout,
            "{{STACK}}": effective_stack,
            "{{RETRO}}": LAYOUT_RETRO if layout != "none" else DEFAULT_PATHS["retro"],
            "{{BUILD_CHECK}}": build_check,
            "{{TEST_CHECK}}": test_check,
            "{{DATE}}": date.today().isoformat(),
        }

        written: list[str] = []
        skipped: list[str] = []
        written_targets: set[Path] = set()
        for layer, is_base in layers:
            for source in self._files(layer):
                relative = self._relative(source, layer, values)
                if is_base and layout != "none" and relative.as_posix() in LAYOUT_SUPERSEDES:
                    continue
                target = root / relative
                if target.exists() and target not in written_targets and not force:
                    skipped.append(str(relative))
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                if source.suffix == ".tmpl":
                    text = source.read_text(encoding="utf-8")
                    for key, value in values.items():
                        text = text.replace(key, value)
                    if "{{" in text:
                        raise TemplateError(f"unknown placeholder in template: {source}")
                    target.write_text(text, encoding="utf-8")
                else:
                    shutil.copyfile(source, target)
                target.chmod(source.stat().st_mode & 0o777)
                written.append(str(relative))
                written_targets.add(target)
        return {"written": sorted(set(written)), "skipped": sorted(set(skipped))}
