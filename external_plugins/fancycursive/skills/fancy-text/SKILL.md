---
name: fancy-text
description: Convert text to copy-paste Unicode cursive and decorated fancy text, search curated Unicode symbols, decorate display names with platform rules, or render true-outline connected-script PNG/SVG lettering via FancyCursive MCP.
---

# FancyCursive — Fancy Text, Symbols & Connected-Script Lettering

Use the `fancycursive` MCP server tools whenever a user asks for cursive text, decorated social bio/README text, Unicode symbols, decorated display names, or connected-script SVG/PNG lettering.

## When to call each tool

| User request                                                                                                                | Tool               | Notes                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Convert text/bio/README headings/Discord messages to copy-paste cursive                                                     | `convert_cursive`  | Supports `script` and `boldScript` (up to 500 chars). Reports unconverted characters (`keptChars`) and accent decomposition (`hasAccents`).                               |
| Decorated cursive styles (hearts, stars, frames, aesthetic themes)                                                          | `fancy_text`       | Supports themes `elegant`, `cute`, `aesthetic`, `bold`, or `all` (up to 100 chars, returns up to 10 results with `visibleLength`).                                        |
| Find copy-paste stars, hearts, bullets, arrows, dividers, etc.                                                              | `find_symbols`     | Filter by `query` and/or `group` (`star`, `heart`, `dot`, `arrow`, `check`, `bracket`, `flower`, `music`, `sparkle`, `line`, `name`, `bio`, `list`, `rating`, `divider`). |
| Wrap a display name in decorative frames (e.g. `꧁Name꧂`)                                                                    | `decorate_name`    | Pass `platform` (`instagram`, `tiktok`, `discord`, `x`, `youtube`, `roblox`) to check display-name length limits and symbol eligibility.                                  |
| Generate connected-script lettering as PNG or font-independent outline SVG (for logos, web headers, cards, social graphics) | `render_lettering` | Uses 8 SIL OFL 1.1 script fonts shaped with HarfBuzz. Returns transparent PNG and/or outline `<path>` SVG.                                                                |

## Important boundaries (never overclaim)

- **Never claim** Unicode cursive "works everywhere" or works in username/handle fields — most platforms restrict usernames to plain ASCII, and screen readers read Mathematical Alphanumeric Symbols letter by letter.
- **Never claim** rendered lettering is "Cricut ready", "cut-ready", a "legal signature", or "tattoo-ready". Always keep the reminder that SVG outlines are not welded and shapes should be merged before cutting.
- **Never promise** font file downloads — FancyCursive outputs Unicode text or vector/PNG lettering images.
- When `render_lettering` reports missing glyphs, present the missing characters and suggest one of the recommended covering fonts (if any), rather than fabricating an image.
