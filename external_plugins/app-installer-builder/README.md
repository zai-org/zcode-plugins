# App Installer Builder

Wrap an existing **website or Node project** as a desktop app with **Electron + electron-builder**. The plugin detects the project, generates a `desktop/` folder next to it, shows which installers this computer can build, and runs the build with a live log.

## Defaults (v0.1)

- **Tooling**: electron-builder (MIT) packages an Electron shell. Both are installed into `desktop/` with `npm install` on the first build, which downloads Electron (about 150 MB).
- **Targets**: macOS **dmg** and Windows **nsis** by default. Linux AppImage and an unpacked "dir" build (for testing) are also available.
  - dmg can only be built on macOS.
  - nsis needs Windows, or Wine on macOS/Linux.
  - The panel shows what this computer can build. The generated config can be copied to another computer, where you run the README command.
- **Signing**: optional, and **only with a certificate you provide**.
  - macOS: the name of a keychain identity ("Developer ID Application: …").
  - Windows: a `.pfx` file path. The password is read from the `WIN_CSC_KEY_PASSWORD` environment variable and is never stored.
  - Without a certificate the builds are **unsigned**, and the README explains what users will see (macOS right-click → Open; Windows SmartScreen → Run anyway).
  - No Apple notarization.

## Features

- **Detect** (`app_scan`):
  - Static site: a folder with `index.html` such as dist/, build/ or out/.
  - Node server: the start script or entry calls `listen()`. The plugin also checks whether it reads `process.env.PORT`.
  - Name, version and author from package.json, and square PNG icon candidates.
- **Generate** (`app_setup`) creates `desktop/` containing:
  - `main.cjs`:
    - Static sites are served at `app://local/`, so absolute `/assets/…` paths and client-side routes work (SPA fallback).
    - Node servers are started with Electron's own Node (no Node install needed) on a free port. They get `APP_DATA_DIR` for data and log to `server.log`.
    - Single instance, external links open in the browser, and sandboxed renderer.
  - `package.json` with pinned electron and electron-builder.
  - `electron-builder.yml`: appId, productName, dmg, nsis (assisted installer with shortcuts), AppImage, and the website or server copied as extra resources.
  - `build/icon.png`: your PNG (≥512 px square) or a generated icon.
  - `README.md` with build commands and the signing status.
- **Check** (`app_check`): config validation and a per-target "can build here" matrix.
  - Validation covers reverse-DNS appId, semver version, web folder or entry present, icon size, fixed-port warning and certificate file present.
- **Build** (`app_build` / `app_status`): `npm install` the first time, then `electron-builder --publish never`. The log streams to the panel, and outputs in `desktop/release/` are listed.

## Usage

Ask the agent in ZCode Desktop:

- "Turn this web app into a Mac and Windows desktop app"
- "Package my Node server as a desktop app"
- "Which installers can I build on this computer?"

## Tools

| Tool | Purpose |
|---|---|
| `app_scan` | Detect the project type, entry, port and icons |
| `app_setup` | Generate / update `desktop/` (shell, electron-builder.yml, icon, README) |
| `app_check` | Validate the config; which targets this computer can build |
| `app_build` | Run electron-builder for one target |
| `app_status` | Build progress and log |

## Scope (v0.1)

- No auto-update server, no app store submission, and no notarization (it needs an Apple account).
- Server-rendered Next/Nuxt apps are not supported; use a static export. Servers must start with `node <entry>`.
- For Node servers, the whole project folder, including `node_modules`, is packaged.

## Privacy, network and files

- No API keys and no accounts. The only network use is `npm install` in `desktop/` during the first build, which downloads Electron and electron-builder from npm and GitHub.
- Writes `<project>/desktop/` and `.app-installer/state.json`. Certificate passwords are never written to disk.
