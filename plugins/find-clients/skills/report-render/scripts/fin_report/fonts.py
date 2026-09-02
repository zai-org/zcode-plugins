"""Locate and register CJK-capable fonts for reportlab and matplotlib.

The single most common way a Chinese financial PDF ships broken is the font.
Two failure modes, both silent:

* reportlab's built-in CID fonts (``STSong-Light``) produce a document that
  renders blank in any viewer without Adobe's CJK packs. The file looks fine to
  the process that wrote it.
* matplotlib without a CJK font draws tofu boxes (□□□) for every Chinese label.

So fonts are resolved once, explicitly, and a failure to find one is a loud
error rather than a fallback to something that "works" locally.

Search order (first hit wins):
  1. ``$FIN_REPORT_FONT_DIR``
  2. ``./fonts`` and ``./charts`` relative to the working directory
  3. user and system font directories
  4. any variable Noto Sans SC on the search path, from which static Regular and
     Bold weights are instantiated into a cache (reportlab cannot use a variable
     font, and rejects PostScript-outline OTFs entirely)
"""
from __future__ import annotations

import os
import warnings
from dataclasses import dataclass
from pathlib import Path

#: Registered names. Kept short and stable — the two prior hand-built reports
#: used "CN"/"CN-B" and "CJK"/"CJK-B" respectively, which is exactly the kind of
#: divergence that makes two report scripts impossible to merge.
REGULAR = "CJK"
BOLD = "CJK-B"

#: Preferred family, then acceptable substitutes.
FAMILIES = (
    ("NotoSansSC-Regular.ttf", "NotoSansSC-Bold.ttf"),
    ("NotoSansCJKsc-Regular.ttf", "NotoSansCJKsc-Bold.ttf"),
    ("SourceHanSansSC-Regular.ttf", "SourceHanSansSC-Bold.ttf"),
)
VARIABLE_CANDIDATES = ("NotoSansSC.ttf", "NotoSansSC-VF.ttf", "NotoSansSC[wght].ttf")

CACHE = Path(os.environ.get("FIN_REPORT_FONT_CACHE", Path.home() / ".cache" / "fin_report" / "fonts"))


class FontError(RuntimeError):
    """No CJK-capable TTF could be found or built."""


@dataclass(frozen=True)
class FontPair:
    regular: Path
    bold: Path

    def __str__(self) -> str:
        return f"{self.regular.name} + {self.bold.name} (in {self.regular.parent})"


def search_dirs() -> list[Path]:
    dirs: list[Path] = []
    env = os.environ.get("FIN_REPORT_FONT_DIR")
    if env:
        dirs += [Path(p).expanduser() for p in env.split(os.pathsep) if p]
    cwd = Path.cwd()
    dirs += [cwd / "fonts", cwd / "charts", cwd, CACHE]
    dirs += [
        Path.home() / ".local/share/fonts",
        Path.home() / ".fonts",
        Path("/usr/share/fonts"),
        Path("/usr/local/share/fonts"),
        Path("/System/Library/Fonts"),
        Path("C:/Windows/Fonts"),
    ]
    seen, out = set(), []
    for d in dirs:
        if d not in seen:
            seen.add(d)
            out.append(d)
    return out


def _find(name: str, roots: list[Path]) -> Path | None:
    for root in roots:
        if not root.is_dir():
            continue
        direct = root / name
        if direct.is_file():
            return direct
        try:
            hit = next(root.rglob(name), None)
        except (OSError, PermissionError):
            hit = None
        if hit:
            return hit
    return None


def _instantiate_static(variable: Path) -> FontPair:
    """Build static Regular and Bold from a variable font (reportlab needs static)."""
    CACHE.mkdir(parents=True, exist_ok=True)
    out = {}
    for label, weight in (("Regular", 400), ("Bold", 700)):
        target = CACHE / f"{variable.stem}-{label}.ttf"
        if not target.is_file():
            font = _ttfont(str(variable))
            _instancer().instantiateVariableFont(font, {"wght": weight}, inplace=True)
            _retag(font, label, weight)
            font.save(str(target))
        out[label] = target
    return FontPair(regular=out["Regular"], bold=out["Bold"])


def _ttfont(path: str):
    try:
        from fontTools.ttLib import TTFont as FTFont
    except ImportError as exc:  # pragma: no cover
        raise FontError(
            "fontTools is required to build or repair static font weights "
            "(pip install fonttools)"
        ) from exc
    return FTFont(path)


def _instancer():
    """fontTools' variable-font instancer, wherever this version keeps it.

    The module's canonical home is ``fontTools.varLib.instancer``. Older releases
    re-exported it as ``fontTools.instancer``, and that alias is gone in current
    ones (4.59 raises ImportError), which broke the documented "drop a variable
    NotoSansSC.ttf on the search path" route with a traceback rather than the
    FontError this module otherwise raises for font problems. Try the real
    location first and keep the alias as the fallback.
    """
    try:
        from fontTools.varLib import instancer
    except ImportError:
        try:
            from fontTools import instancer
        except ImportError as exc:
            raise FontError(
                "fontTools is installed but its variable-font instancer is not "
                "importable, so static weights cannot be built from a variable "
                "font. Supply static Regular+Bold TTFs instead, or reinstall "
                "fonttools (pip install -U fonttools)."
            ) from exc
    return instancer


def _names(font) -> dict[int, str]:
    return {r.nameID: r.toUnicode() for r in font["name"].names}


def _ps_safe(family: str, style: str) -> str:
    """A PostScript name reportlab will accept.

    nameID 6 is spec-bound to printable ASCII without ``[](){}<>/%`` or spaces,
    and reportlab enforces it. A font whose family name is Chinese — 黑体, 宋体,
    微软雅黑, i.e. the most likely finds on a Chinese-configured machine — would
    otherwise reach ``registerFont`` as ``黑体-Regular`` and die with a raw
    ``TTFError: psName contains invalid character`` instead of this module's
    guided ``FontError``. Keeping only ASCII alphanumerics satisfies the spec and
    leaves the Unicode family name (nameID 1/4/16) intact for matplotlib.
    """
    kept = "".join(c for c in family if c.isascii() and c.isalnum())
    return f"{kept or 'CJKFallback'}-{style}"


def _retag(font, style: str, weight: int) -> None:
    """Make a font's name table and style bits agree with its actual weight.

    Instancing a variable font copies the source's name table verbatim, so a
    700-weight instance can still call itself "Thin" and leave the bold bit
    clear. Nothing warns you: reportlab is fine (it is handed an explicit path),
    but matplotlib resolves ``fontweight="bold"`` through the family+style
    metadata and silently picks whichever file it saw first.
    """
    family = _names(font).get(16) or _names(font).get(1) or "Noto Sans SC"
    family = family.strip()
    full = f"{family} {style}"
    postscript = _ps_safe(family, style)
    bold = weight >= 600

    name_table = font["name"]
    for record in list(name_table.names):
        value = {1: family, 2: style, 4: full, 6: postscript,
                 16: family, 17: style}.get(record.nameID)
        if value is not None:
            name_table.setName(value, record.nameID, record.platformID,
                               record.platEncID, record.langID)

    head = font["head"]
    head.macStyle = (head.macStyle | 0x01) if bold else (head.macStyle & ~0x01)

    os2 = font["OS/2"]
    os2.usWeightClass = weight
    # fsSelection bit 5 = BOLD, bit 6 = REGULAR; they are mutually exclusive.
    os2.fsSelection = (os2.fsSelection | 0x20) & ~0x40 if bold else (os2.fsSelection | 0x40) & ~0x20


def _mislabelled(path: Path, expect_bold: bool) -> bool:
    """True if a static font's metadata contradicts its real weight."""
    try:
        font = _ttfont(str(path))
    except Exception:
        return False
    try:
        weight = font["OS/2"].usWeightClass
        bold_bit = bool(font["head"].macStyle & 0x01)
        postscript = _names(font).get(6, "")
    finally:
        font.close()

    really_bold = weight >= 600
    if really_bold != expect_bold:
        return False  # a different problem; leave it to the caller's choice
    if really_bold and not bold_bit:
        return True
    keyword = "Bold" if really_bold else "Regular"
    return keyword.lower() not in postscript.lower()


def _repair(pair: FontPair) -> FontPair:
    """Return a pair whose metadata matches its weights, caching any repairs."""
    CACHE.mkdir(parents=True, exist_ok=True)
    fixed = {}
    for label, path, weight in (("Regular", pair.regular, 400), ("Bold", pair.bold, 700)):
        if not _mislabelled(path, expect_bold=(label == "Bold")):
            fixed[label] = path
            continue
        stat = path.stat()
        target = CACHE / f"{path.stem}-fixed-{label}-{stat.st_size}-{int(stat.st_mtime)}.ttf"
        if not target.is_file():
            font = _ttfont(str(path))
            _retag(font, label, weight)
            font.save(str(target))
        fixed[label] = target
    return FontPair(regular=fixed["Regular"], bold=fixed["Bold"])


def resolve(repair: bool = True) -> FontPair:
    """Find a usable Regular+Bold TTF pair, building or repairing as needed."""
    roots = search_dirs()
    for regular_name, bold_name in FAMILIES:
        regular = _find(regular_name, roots)
        bold = _find(bold_name, roots)
        if regular and bold:
            pair = FontPair(regular=regular, bold=bold)
            return _repair(pair) if repair else pair

    for candidate in VARIABLE_CANDIDATES:
        variable = _find(candidate, roots)
        if variable:
            return _instantiate_static(variable)

    raise FontError(
        "no CJK-capable TTF found. A Chinese PDF without one renders blank, so "
        "this is fatal rather than a fallback.\n"
        "Fix by either:\n"
        "  - setting FIN_REPORT_FONT_DIR to a directory holding "
        "NotoSansSC-Regular.ttf and NotoSansSC-Bold.ttf, or\n"
        "  - placing those two files in ./fonts/ beside the report, or\n"
        "  - placing the variable NotoSansSC.ttf on the search path (static "
        "weights are then built automatically).\n"
        f"Searched: {', '.join(str(d) for d in roots[:8])} ..."
    )


#: Non-CJK characters this package *draws itself*, so a font that lacks one
#: produces ⊠ in a place no author chose. `doc.bullets()` and `doc.callout()`
#: both emit `• `, and the numeric columns of every table carry a minus sign.
#:
#: A missing glyph is silent at render time: it lands in the PDF as `.notdef`,
#: shows as ⊠ on the page, and extracts as U+0000. `verify.py` fails on it — but
#: only after the document is built, and the symptom is easy to misread. Measured
#: on this repo's own `_fonts/NotoSansSC-Regular.ttf`: no U+2022 and no U+2212,
#: which printed ⊠ at the head of every callout item *and* made the pagination
#: case `a callout longer than a page still builds` fail, as though the layout
#: logic were broken. Diagnosing that cost a full pass over the wrong module.
#:
#: Reported as a warning rather than an error: a font missing `•` is still usable
#: for a report with no bullet list, and refusing to register it would take a
#: working font away for a defect that may never be reached.
DRAWN_GLYPHS = {
    0x2022: "• 项目符号 (doc.bullets / doc.callout)",
    0x2212: "− 负号 (数值列)",
}


def check_glyph_coverage(pair: FontPair | None = None) -> list[str]:
    """Which `DRAWN_GLYPHS` the resolved font cannot render.

    Checked at registration because that is the last moment the answer is cheap.
    Needs `fitz` (PyMuPDF) to inspect the glyph table; without it the check is
    skipped rather than guessed — a coverage claim nobody verified is worse than
    an absent one.
    """
    try:
        import fitz
    except ImportError:
        return []
    pair = pair or resolve()
    try:
        font = fitz.Font(fontfile=str(pair.regular))
    except Exception:
        return []
    return [f"U+{code:04X} {what}"
            for code, what in sorted(DRAWN_GLYPHS.items())
            if not font.has_glyph(code)]


def register_reportlab(pair: FontPair | None = None) -> FontPair:
    """Register the pair with reportlab under REGULAR / BOLD and map the family."""
    from reportlab.lib.fonts import addMapping
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    pair = pair or resolve()
    if REGULAR not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont(REGULAR, str(pair.regular)))
        pdfmetrics.registerFont(TTFont(BOLD, str(pair.bold)))
        pdfmetrics.registerFontFamily(REGULAR, normal=REGULAR, bold=BOLD, italic=REGULAR, boldItalic=BOLD)
        # Without the mapping, <b> inside a Paragraph silently renders regular.
        addMapping(REGULAR, 0, 0, REGULAR)
        addMapping(REGULAR, 1, 0, BOLD)
        missing = check_glyph_coverage(pair)
        if missing:
            warnings.warn(
                f"{pair.regular.name} is missing glyphs this package draws: "
                + "; ".join(missing)
                + ". They will render as ⊠ (.notdef) and verify.py will fail the "
                  "build. Point FIN_REPORT_FONT_DIR at a fuller CJK font.",
                stacklevel=2,
            )
    return pair


def register_matplotlib(pair: FontPair | None = None) -> str:
    """Register with matplotlib and return the family name to set on rcParams."""
    from matplotlib import font_manager

    pair = pair or resolve()
    for path in (pair.regular, pair.bold):
        font_manager.fontManager.addfont(str(path))
    return font_manager.FontProperties(fname=str(pair.regular)).get_name()
