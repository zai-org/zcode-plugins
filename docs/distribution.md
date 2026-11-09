# Public Distribution Format

[中文文档](./distribution_CN.md)

This document describes the public file format used by ZCode-compatible plugin clients. It intentionally covers the client contract only; deployment infrastructure and operational configuration are not part of the public interface.

## Directory Layout

Each distribution source exposes the same static layout under a base URL (`BASE`):

```text
BASE/
├── marketplace.json
├── assets/
│   └── <plugin-name>/
│       └── icon.png
└── plugins/
    └── <plugin-name>/
        └── <version>/
            └── plugin.zip
```

Official ZCode clients select an available trusted source automatically. Compatible clients should use a marketplace source explicitly provided by ZCode or by their host application; repository visibility and distribution endpoints may vary by release channel.

## Marketplace Document

`marketplace.json` uses the public ZCode marketplace structure and adds fields required for verified zip installation.

```json
{
  "name": "zcode-plugins-official",
  "description": "Official ZCode plugins marketplace.",
  "owner": { "name": "Z.ai", "url": "https://z.ai" },
  "plugins": [
    {
      "name": "example-plugin",
      "version": "0.1.1",
      "description": "A minimal template plugin.",
      "description_i18n": {
        "en": "A minimal template plugin.",
        "zh-CN": "一个最小模板插件。"
      },
      "source": {
        "source": "url",
        "type": "zip",
        "url": "https://example.invalid/plugins/example-plugin/0.1.1/plugin.zip",
        "sha256": "64-character lowercase hexadecimal digest",
        "path": "example-plugin"
      },
      "_artifact": {
        "path": "plugins/example-plugin/0.1.1/plugin.zip",
        "sha256": "64-character lowercase hexadecimal digest",
        "size": 12345
      }
    }
  ]
}
```

### Field Rules

- Source trees use `plugins/<name>` for officially maintained plugins and
  `external_plugins/<name>` for partner/community maintained plugins. Intake
  checks classify new external submissions before publication; fixes to an
  existing plugin retain its ownership. Usage `category` remains independent.
- The publisher derives `publisherType` (`official` or `community`) from the
  source root and preserves it when replacing `source` with the ZIP URL.
  Clients without this field retain legacy display behavior. Identity remains
  `<name>@zcode-plugins-official`; moving a source tree does not move installed
  data or change immutable artifact paths or bytes.
- Valid manifest `ui.surfaces` declarations produce `ui` in published
  `componentTypes`, allowing discovery before installation. The validator checks
  surface IDs, localized titles, declared MCP servers, `ui://` resources and
  session availability. These are capability metadata, not execution grants.

- `description` is the English compatibility fallback.
- `description_i18n` may provide localized descriptions. Clients should try the exact locale, language fallback, `en`, and finally `description`.
- `source: "url"` with `type: "zip"` means the URL points directly to a plugin archive.
- `sha256` is mandatory. Installation must stop if verification fails.
- `path` identifies the plugin directory inside the archive.
- `_artifact.path` is relative to `BASE`, allowing compatible trusted sources to serve the same versioned artifact.
- Plugin versions are immutable. A published version always represents the same bytes.

`type`, `sha256`, `path`, and `_artifact` are ZCode extensions used for secure archive installation. Clients that do not implement an extension should ignore the unsupported field rather than guessing its meaning.

## Installation Flow

1. Fetch `BASE/marketplace.json`.
2. Select the plugin and version.
3. Download the archive to a temporary location.
4. Calculate SHA-256 and compare it with the marketplace entry.
5. Stop and discard the file if verification fails.
6. Extract the declared plugin directory and install it with an atomic replacement.
7. Record the installed version for future update checks.

Clients should apply standard archive safety checks, including blocking absolute paths, parent-directory traversal, unsafe links, and writes outside the target plugin directory.

## Availability and Caching

- `marketplace.json` and shared assets may change and should use bounded caching.
- Versioned plugin archives are immutable and may use long-lived caching.
- A client may retry another trusted source when the selected source is unavailable.
- The marketplace document and downloaded archive must be obtained from trusted HTTPS endpoints.

Marketplace maintainers handle publication and service operations. Contributors only need to update the plugin source, manifest, documentation, version, and root marketplace entry in their pull request.

## Existing source classification

Existing plugins, including CloudBase Skills, Mimosa, and Hyper3D Rodin, remain under `plugins/` for now. This change introduces classification for new external submissions without migrating existing source trees. Their package contents, versions, IDs, and archive paths remain unchanged.
