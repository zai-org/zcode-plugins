"""Add the distribution's pinned Chinese font to archived upstream Web builds.

Use the apps' existing CRAFT_FONTS document databases. Keep a fallback in every
egui font stack, including stacks rebuilt after a theme or language change.
No locale persistence or translation catalog is changed here.
"""
from pathlib import Path
import re
import sys

root = Path(sys.argv[1])
name = sys.argv[2]
runtime = Path(__file__).resolve().parent


def replace(path, old, new):
    p = root / path
    source = p.read_text()
    if source.count(old) != 1:
        raise RuntimeError(f'{name}: font overlay anchor is not unique: {path}: {old}')
    p.write_text(source.replace(old, new, 1))


# The upstream Web size budgets excluded Chinese faces. The plugin distributes
# its own chunked assets, so explicitly allow this one pinned OFL face.
if name == 'photocraft':
    replace('crates/text/build.rs', '!d.is_empty() && !wasm', '!d.is_empty()')
elif name == 'vectorcraft':
    replace('crates/text/build.rs', 'if wasm && !(*family == WEB_FONT.0 && *style == WEB_FONT.1)',
            'if wasm && *family != "LXGW WenKai" && !(*family == WEB_FONT.0 && *style == WEB_FONT.1)')
elif name in ('designcraft', 'wordcraft'):
    replace('crates/fonts/build.rs', 'if wasm && !(*family == "BIZ UDPGothic" && *style == "Regular")',
            'if wasm && *family != "LXGW WenKai" && !(*family == "BIZ UDPGothic" && *style == "Regular")')
elif name == 'pdfcraft':
    replace('crates/fonts/build.rs', 'if wasm && !web_face', 'if wasm && *family != "LXGW WenKai" && !web_face')
elif name == 'deckcraft':
    replace('crates/fonts/build.rs', 'if wasm && !matches!', 'if wasm && *family != "LXGW WenKai" && !matches!')

if name == 'cadcraft':
    replace('crates/ui-egui/src/theme.rs', 'let _ = ctx;', 'ctx.set_fonts(egui::FontDefinitions::default());')

ui = root / 'crates/ui-egui/src'
count = 0
for p in ui.rglob('*.rs'):
    source = p.read_text()
    # Pinned upstream calls each occupy a single line; greedy capture retains
    # nested constructor arguments. Fail below if an unhandled call appears.
    source, n = re.subn(r'\.set_fonts\(([^\n]+)\);',
                        r'.set_fonts(crate::craft_fonts::definitions(\1));', source)
    if n:
        p.write_text(source)
        count += n
    for line in source.splitlines():
        if '.set_fonts(' in line and 'crate::craft_fonts::definitions(' not in line:
            raise RuntimeError(f'{name}: unhandled font stack: {p}: {line}')
if not count:
    raise RuntimeError(f'{name}: no egui font installation found')
(ui / 'craft_fonts.rs').write_text((runtime / 'rust/fonts.rs').read_text())
with (ui / 'lib.rs').open('a') as f:
    f.write('\nmod craft_fonts;\n')
print(f'{name}: Chinese fallback added to {count} font stack installations')
