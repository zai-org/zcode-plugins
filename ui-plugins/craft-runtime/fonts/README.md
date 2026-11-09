# Chinese fallback font

This distribution bundles the unmodified Regular face of
[LXGW WenKai](https://github.com/lxgw/LxgwWenKai), derived from Fontworks' Klee One
and distributed under SIL OFL 1.1. The copyright notices and license are retained
in `OFL-LXGWWenKai.txt`. `provenance.json` pins the source commit, URLs and SHA-256
of the original font and license. It is an independent typeface, not Source Han
or a rebranded Noto CJK face.

`manifest.txt` uses the upstream craft-fonts input format. `compile.mjs` sets
`CRAFT_FONTS_DIR` to this runtime directory and explicitly allows this face in
the seven apps with document font databases. GridCraft and SoundCraft render
text through egui; all nine egui interfaces receive the same fallback at every
font-stack installation. Existing Latin fonts stay first in each stack.

The font is embedded in the WASM snapshot and distributed through verified MCP
resource chunks. There is no runtime network request, OS font dependency or
font installation step. Font and license bytes are part of the snapshot overlay
digest; changes require recompiling the snapshots. The license and provenance
also ship under each plugin's `dist/licenses/fonts/` directory.

Chinese support is bounded by the bundled font's character coverage. This does
not promise every script, proprietary font, or exact typography of an imported
document whose original font is unavailable.
