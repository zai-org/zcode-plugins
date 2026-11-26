# FancyCursive

[中文文档](./README_CN.md)

Convert plain text into copy-paste Unicode cursive and decorated fancy styles, search curated Unicode symbols, decorate display names with platform character-limit checks, and render true-outline connected-script PNG/SVG lettering directly inside ZCode.

## Components

- **MCP Server (`fancycursive`)**: Stateless, read-only Streamable HTTP MCP server at `https://mcp.fancycursive.com/mcp?source=zcode` exposing 5 tools:
  1. `convert_cursive` — Convert text (up to 500 chars) to Unicode Mathematical Script and Bold Script with unconverted-character reporting and accent preservation.
  2. `fancy_text` — Apply up to 10 decorated cursive variants across `elegant`, `cute`, `aesthetic`, and `bold` themes with visible character lengths.
  3. `find_symbols` — Search and filter curated copy-paste Unicode symbols by keyword or group with compatibility notes.
  4. `decorate_name` — Wrap display names in decorative frames and check display-name length and symbol rules for Instagram, TikTok, Discord, X, YouTube, and Roblox.
  5. `render_lettering` — Shape connected-script lettering with HarfBuzz and return transparent PNG and/or font-independent outline `<path>` SVG using 8 SIL OFL 1.1 script fonts (Alex Brush, Allura, Dancing Script, Great Vibes, Italianno, Parisienne, Pinyon Script, Sacramento).
- **Skill (`fancy-text`)**: Guides tool selection and accurate capability boundaries.

## Network, Permissions & Side Effects

- **Network access**: Connects only to `https://mcp.fancycursive.com/mcp?source=zcode` over HTTPS (Streamable HTTP JSON-RPC). No authentication or API key is required. Rate-limited at 60 requests per 60 seconds per IP.
- **Privacy**: Completely stateless. User input text is processed strictly in memory to generate responses and is never stored, logged, or used for training. See [fancycursive.com/privacy#ai-apps](https://fancycursive.com/privacy#ai-apps).
- **Local side effects**: None. This plugin executes no local shell commands, registers no hooks, and writes no local files.

## Example Prompts

- `Convert "Hello José!" into copy-paste cursive and bold script text.`
- `Decorate the display name "Amelia" with frames for an Instagram profile.`
- `Render "Amelia Rose" in Alex Brush connected-script lettering as PNG and SVG.`

## License & Provenance

- Plugin manifest, skill, and metadata: MIT © Nurul Widad ([fancycursive.com](https://fancycursive.com/?utm_source=zcode&utm_medium=plugin)).
- Script fonts rendered server-side by `render_lettering` are licensed under the **SIL Open Font License 1.1**.
- Support: `support@fancycursive.com`
