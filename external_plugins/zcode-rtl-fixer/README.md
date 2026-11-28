# ZCode RTL Fixer

Fixes mixed **Persian/English** text rendering (bidi) in the ZCode Desktop chat box:
per-paragraph automatic right-to-left direction, a Persian-friendly font, RTL tables
and list markers — while code blocks, the terminal and editors stay untouched.

中文文档：[README_CN.md](./README_CN.md)

## What it does

- **Automatic paragraph direction** — each paragraph gets first-strong direction
  (`unicode-bidi: plaintext`), so Persian paragraphs align right and English
  paragraphs stay left-aligned, even inside one message.
- **Persian font** — blocks containing Arabic-script glyphs get a Persian font
  (default: Vazirmatn), with an optional size compensation factor.
- **RTL tables & list markers** — Persian-dominant tables flip column order;
  list bullets/numbers move to the right edge for Persian items.
- **Code stays code** — `<code>`, `<pre>`, `language-*` blocks and inline code are
  never re-flowed.
- **Streaming-safe** — a rAF-batched MutationObserver keeps up with token
  streaming without jank.

## Commands

| Command | Purpose |
|---|---|
| `/rtl:install` | Install / re-apply the patch (run again after every ZCode update) |
| `/rtl:status` | Installation + settings status |
| `/rtl:font` | Install a Persian font (default: Vazirmatn from GitHub) and set it |
| `/rtl:settings` | Change settings (`enabled`, `fontFamily`, `fontSizeScale`, `fixTables`, `fixLists`, `probe`) |
| `/rtl:uninstall` | Restore the original ZCode Desktop |

## How it works

The AppImage itself is never modified. The plugin extracts the ZCode AppImage once
into `~/.local/share/zcode-rtl-fixer/app`, patches the **extracted copy's**
`resources/app.asar` (injects a small renderer bootstrap script into
`out/renderer/index.html`), and creates a launcher:

- `~/.local/bin/zcode-rtl` + desktop entry "ZCode RTL"
- The pristine archive is kept as `app.asar.orig`; re-patching always restores it
  first, so patching is idempotent and reversible.

Settings live in `~/.zcode/rtl-fixer/settings.json` and are baked into the
bootstrap at patch time (a settings change needs a quick re-patch).

## Side effects & dependencies (reviewer notes)

- **Network**: optional font install downloads the [Vazirmatn](https://github.com/rastikerdar/vazirmatn) release zip from GitHub
  (api.github.com + release asset). No other network access; no telemetry.
- **File writes**: `~/.local/share/zcode-rtl-fixer/` (extracted app + state),
  `~/.local/bin/zcode-rtl`, `~/.local/share/applications/zcode-rtl.desktop`,
  `~/.fonts/` (only via `/rtl:font`), `~/.zcode/rtl-fixer/settings.json`.
- **Command execution**: `--appimage-extract`, `unzip`, `fc-cache`/`fc-list`,
  `mv` during extraction; all Node scripts are dependency-free.
- **Third-party material**: the Vazirmatn font (SIL Open Font License 1.1) is
  downloaded at runtime only when the user asks for a font install. All plugin
  code is original, MIT-licensed.
- **Platform**: Linux, ZCode Desktop AppImage builds. The running instance is
  never modified — the patch applies on the next launch from the "ZCode RTL" launcher.

## Tests

```shell
node tests/run-tests.mjs
```

23 dependency-free unit tests: bidi heuristics, ASAR read/patch/extract
round-trips (including symlink entries and header growth), patcher unit tests
(idempotent index.html injection, settings baking), and version sync between the
engine, plugin manifest and marketplace catalogs.

## License

MIT — see [LICENSE](./LICENSE).
