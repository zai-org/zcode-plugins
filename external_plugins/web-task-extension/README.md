# Web Task Extension

Turn a chore you repeat in the browser into a **Chrome / Edge extension** you run with one click. Describe the routine; the agent writes it as steps and this plugin generates, validates and zips a **Manifest V3** extension with **minimal, explained permissions**.

## What it does

- **Steps**:
  - `open` a URL, `click` (by selector, optionally by text), `fill` text / `<select>` / checkboxes (optionally submit), `wait` for an element (or until it disappears, or a delay).
  - `extract` one record per element with named fields (`".price"`, `"a@href"`, `"@data-id"`), following a **next-page** link up to N pages.
  - `download` an extracted dataset as **CSV** (UTF-8 with BOM, safe against spreadsheet formulas) or **JSON**, or the files that links point to.
  - **Settings** the user fills in on the options page (text, number, date, select), used as `{{key}}`; built-ins `{{today}}`, `{{now}}`. Optional steps, per-step timeouts and notes.
- **Generates** `extensions/<name>/`:
  - Popup: a **Run task** button, live step progress, a results preview and CSV / JSON re-download.
  - Options page: settings, the step list and the permission table.
  - Service worker that runs the steps in a tab with `chrome.scripting`. Generated icons, English and Chinese UI (`_locales`), `PERMISSIONS.md` and `README.md` with load instructions.
  - A store-ready zip: `extensions/<name>-<version>.zip`.
- **Minimal permissions**:
  - Always `storage` and `scripting`.
  - `downloads` only with a download step.
  - Host access only to the sites the steps open, plus any extra sites you list. With no Open step it uses `activeTab` instead and has no host access.
  - Never `tabs`, `<all_urls>`, cookies, history, webRequest or always-on content scripts. Each permission is explained in plain English and Chinese.
- **Validation**:
  - Manifest: V3; name / description / version rules; all referenced files exist; icons are PNGs of the declared sizes.
  - Permissions: known, minimal, and exactly the ones the steps need; host patterns valid and covering every Open URL.
  - Code: no inline or remote scripts, inline handlers or `javascript:` URLs (MV3 CSP); every script parses; no `eval`.
  - Locales are complete, and the task is consistent: placeholders are defined, downloads follow an extract, and placeholders can't change the site.
  - Use `ext_check` to re-run it after hand edits.

## Usage

Ask the agent in ZCode Desktop:

- "Every morning I search our supplier portal for brake parts and copy the in-stock ones into a spreadsheet; make that an extension"
- "Make an extension that saves this table as CSV"
- "Add a step that also downloads the spec sheets"

Then on `chrome://extensions`: turn on **Developer mode**, click **Load unpacked**, choose the folder, pin the extension and press **Run task**. In the panel you can see the steps, permissions, a popup preview and the checks. **Edit steps** (JSON) regenerates the extension and bumps its version.

## Tools

| Tool | Purpose |
|---|---|
| `ext_new` | Create an extension from steps and settings: generate, validate, zip |
| `ext_update` | Change steps / settings / sites / name, regenerate, bump the version |
| `ext_check` | Re-validate the folder as it is on disk, re-zip when clean |
| `ext_list` | List generated extensions |

## Scope (v0.1)

- Chrome / Edge (Manifest V3, Chrome 110+). Firefox is not targeted.
- Logging in is not automated: sign in yourself before running. Don't put passwords in settings (the plugin warns).
- Sites that block automation, CAPTCHAs, iframes from other sites and shadow DOM selectors aren't handled.
- Publishing to the Chrome Web Store is up to you (the zip is ready).
- The extension runs when you press Run; scheduling is not included.

## Privacy, network and files

- The plugin runs locally with no network access and no API keys. It writes `extensions/<name>/`, the zip and `.web-task-extension/extensions.json`.
- The generated extension sends nothing anywhere. It only drives the listed sites when you press Run and keeps settings and results in the browser.

## License

MIT. Uses [fflate](https://github.com/101arrowz/fflate) (MIT) for the zip.
