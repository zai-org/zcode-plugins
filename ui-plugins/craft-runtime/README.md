# Craft UI adapter

Nine independent plugins embed the pinned Rust/egui Web applications: PhotoCraft, VectorCraft,
PdfCraft, DesignCraft, WordCraft, GridCraft, DeckCraft, CADCraft and SoundCraft. The root
`marketplace.json` remains the installation and build catalogue. This directory is a shared
build dependency, not an installable plugin or a second catalogue.

Each plugin has its own manifest, MCP server, `ui://` resource identity and runtime assets.
Its standalone installation needs Node.js 24 and a ZCode host that supports MCP Apps,
`zcode/csp.wasmUnsafeEval` and `ui/download-file`. It needs neither Rust nor a network server.
The official MCP Apps SDK connects the panel to its host once, before application loading.

## Build

`pnpm install --frozen-lockfile && pnpm build` builds every plugin. Neither the compiled Web
snapshot (`ui-plugins/<name>/web/`) nor the installation payload (`plugins/<name>/dist/`) is
committed: both are build outputs, ignored by Git and produced the same way in CI and locally.

For each Craft plugin the build needs the snapshot that matches its inputs: the pinned
`upstream.json` commit, the patches, the automation and font overlays, the compiler scripts and
`toolchain.json`. Their digest is recorded in `web/manifest.json` as `snapshotDigest`. The build
uses, in order:

1. `web/`, when it already holds that digest;
2. the snapshot cache, `<cache>/snapshots/<name>/<digest>/`;
3. a compilation of the pinned upstream, whose result is then stored in the cache.

The cache is `.craft-cache/` in the repository, or `CRAFT_BUILD_CACHE` (a leading `~` is
expanded). CI points it at a directory that outlives the job checkout, so one compilation serves
every later job. Because that directory is fixed, the patched source copy and the cargo target
directory keep the same absolute paths and a recompilation of the same inputs is byte-stable on
that machine. A lock per plugin lets concurrent jobs share one compilation. Snapshots for other
digests are kept: another branch may still pin them.

Compiling needs the toolchain in `toolchain.json` (Rust 1.95.0 with `wasm32-unknown-unknown`,
Trunk 0.21.14), Chrome for catalogue extraction (or `CHROME_PATH`), and network access to the
upstream repository, crates.io and Trunk's wasm-bindgen / wasm-opt downloads on GitHub. A missing
tool stops the build with the command that installs it; with `CRAFT_TOOLCHAIN_INSTALL=1` (set in
CI) the build installs rustup, the pinned toolchain and Trunk itself. Trunk goes into
`<cache>/tools`, and nothing edits shell profiles. Where the official hosts are slow, `CRAFT_RUSTUP_DIST_SERVER` names a rustup mirror, used only when its channel manifest is byte-identical to the official one, and `CRAFT_CARGO_REGISTRY` names a sparse crates.io mirror; `Cargo.lock` checksums still verify every crate. `pnpm --filter @zcode/plugin-cadcraft build:web`
(substitute the plugin name) forces a recompilation with whatever toolchain is on `PATH`.

The `upstream.json` repository and full commit are checked before compiling; tracked upstream
changes are rejected. A sibling checkout of the marketplace is used when present; otherwise the
compiler fetches the pinned commit into `<cache>/sources`. Set `CRAFT_SOURCE_ROOT` to another
parent directory or `TRUNK` to an executable path. `CARGO_TARGET_DIR` may select a shared target
directory; otherwise `<cache>/target` is shared between applications. Compilation is sequential.

The distributed bytes depend on the machine that compiled them: build-home paths are replaced
by equal-length placeholders, so their length shows. A published version must therefore keep
coming from the same cache or the same build machine; if the cache is lost and a recompilation
differs, the release pipeline refuses the changed bytes and the plugin version has to be bumped.

PdfCraft and DesignCraft include small checked-in patches that omit the separately licensed
ArtCraft brand artwork. Patches are applied to a generated source copy, leaving the original
checkout untouched. This is an independent ZCode integration based on the upstream projects,
not an official ArtCraft plugin. Patch hashes are checked together with each snapshot.

The versioned `prepare-automation.py` overlay adds a WASM entry point to each pinned UI
crate. It reuses upstream MCP tool definitions and dispatchers against the live UI's engine;
PhotoCraft shares upstream parameter schemas and provides browser implementations of its
native async facade. PdfCraft temporarily lends its UI session to the upstream Automation
engine and synchronizes document tabs afterwards. Original source checkouts stay clean.
`web/tools.json` is extracted from the compiled WASM, not maintained as a second manual list.
The snapshot records the overlay and catalogue hashes; stale snapshots cannot be packaged.

`prepare-fonts.py` adds the pinned OFL LXGW WenKai font to the existing document
font databases and every egui font stack, including stacks rebuilt after theme
or language changes. Font bytes are embedded in WASM; the build requires no
machine-installed Chinese font, and users need no runtime download. Font source,
hashes and license are retained in `fonts/` and copied into each installation.
The font inputs and overlay are included in the snapshot digest.

PhotoCraft, VectorCraft, PdfCraft, DesignCraft, WordCraft and GridCraft start in
Simplified Chinese through small Web-only patches to their own initial settings.
Existing preference-loading and language-switching behavior stays upstream-owned.
No translations are added; incomplete catalogs keep their upstream fallbacks.
CADCraft, DeckCraft and SoundCraft keep their existing interface language.

Each `web/manifest.json` records source provenance and the SHA-256 of every uncompressed file.
`web/*.gz` holds the compiled snapshot. `dist/BUILD.json` records provenance and packaged
asset hashes; `dist/licenses` retains upstream, branding and dependency notices.
Build-home paths in Rust diagnostic strings are normalized within the WASM data section using
equal-length replacements, preserving instructions and offsets. The manifest records both the
original compilation hash and the distributed hash; real WASM validation/rendering covers the
normalized artifact.

## Runtime

The MCP HTML resource declares WASM support. Static resources are compressed on disk and read
in 2 MiB chunks, keeping the base64 MCP response below the host's 8 MiB limit. The server and
client both verify hashes. Generated wasm-bindgen JavaScript is bundled into a single module;
the panel supplies the WASM bytes directly, so it does not assume a static HTTP file server.

`open_editor` optionally reads a workspace file (128 MiB maximum, real-path containment check).
The panel transfers it into the application's existing file-drop path after initialization.
After the panel attaches, all 334 upstream MCP tools are available across the nine plugins.
Calls are queued by the stdio server, polled by the panel, and executed on the UI thread against
the visible document. No TCP control server or separate headless document session is involved.
Browser file pickers and drag-and-drop remain available. The editor fills the panel; loading
and error notices appear only when needed, with no extra file-path toolbar.

Save/download anchors are bridged to `App.downloadFile`. Native Save File Picker is disabled
so upstream uses that existing download fallback. The host owns its Save As dialog and 50 MiB
limit. Failed/cancelled exports stay available for retry while the panel remains open. Saving a
file manually does not overwrite its source path automatically. MCP saves use the explicit
workspace path, 2 MiB output chunks and host-side atomic replacement (128 MiB per file).
A panel lease and operation IDs prevent duplicate replies and replay after disconnect.
Cancellation after dispatch cannot roll back an edit; the result explicitly tells the Agent
to inspect state before retrying. Input files are released when each call finishes. Unsaved document recovery, native-only
features, printing/fullscreen and complete font coverage are not promised by this adapter.

## MCP coverage and platform boundary

| Plugin | Upstream tools |
| --- | ---: |
| PhotoCraft | 25 |
| VectorCraft | 32 |
| PdfCraft | 159 |
| DesignCraft | 25 |
| WordCraft | 16 |
| GridCraft | 21 |
| DeckCraft | 25 |
| CADCraft | 14 |
| SoundCraft | 17 |

These counts exclude `open_editor` and the five App-only transport tools. Generic command
tools retain upstream command discovery and validation. Editing, inspection, file import,
workspace save/export, previews and UI control use the running application. MCP operations
require a live panel. There is no independent background editor after the panel closes.

The WASM platform boundary still applies: OS printer drivers, macOS Keychain / Windows
certificate stores, native audio plugins/devices, and native process/window integrations are
not provided by this bridge. Their upstream tools remain discoverable and retain the Web
build's errors or empty platform inventory. PdfCraft can still write a print-ready PDF via
`doc_print` with `path`; selecting a physical printer requires a native application. File
access is confined to staged workspace inputs, not arbitrary system paths. Linked media must
be available within the workspace; SoundCraft also stages media referenced by a `.scraft`
session. Exports are bounded to 128 MiB per operation.

## Validation

- `pnpm --filter @zcode/craft-ui-runtime test`: chunk boundaries, corruption/decompression bounds,
  workspace path and symlink containment.
- `node ui-plugins/craft-runtime/browser-smoke.mjs [plugin ...]`: real compiled WASM in a
  Chromium iframe under the supported CSP, through official App/AppBridge and an isolated
  stdio server; resource transfer and export/cancellation checks for all nine applications,
  plus tool-catalogue parity and MCP edit/save/reopen checks. Requires
  Chrome (or `CHROME_PATH`) and Python 3 to inspect Office/archive outputs.
- `ZCODE_SOURCE_ROOT=/path/to/z-code node ui-plugins/craft-runtime/electron-smoke.mjs [plugin ...]`:
  optional check with the source checkout's actual Electron sandbox registry, protocol and CSP;
  secure custom-scheme origins, isolated partitions, real WASM rendering, MCP edit/save/reopen
  and binary download transport. It uses a generated test shell and profile, not the full production renderer or
  the user's installed profile. The checkout must have its Electron dependencies installed.
- `pnpm test:artifacts`: copied standalone installation payloads.
- `python3 scripts/validate.py`, `python3 scripts/build_dist.py`: marketplace and ZIP validation.

Browser protocol tests are not a claim of installation into the user's running ZCode profile.
