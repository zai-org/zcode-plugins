# Design To Components

Turn a design or screenshot into a **React component kit**. The panel keeps the design tokens and a component checklist. The agent writes the TSX components. The plugin type-checks them, renders every state next to the design, and builds an interactive catalog page.

## Features

- **Design tokens** (`dc_tokens`): colours, fonts, font sizes, radii, spacing and shadows in `tokens.json`. They generate `tokens.css` (`--color-primary`, `--font-size-md`, `--radius-md`, `--space-4`, …) and a typed `tokens.ts`. You can edit them in the panel with colour pickers.
- **Component checklist** (`dc_plan`): each component lists the states it needs (for example Button: primary, secondary, disabled, loading). The panel shows which are written and compile (✓ / ✗ / ○).
- **Components** (`dc_write`): `src/<Name>.tsx` (+ `src/<Name>.css`). Each file exports the component and `examples`, one per state. Files live directly in `src/`; `src/components/<Name>/<Name>.tsx` is accepted and flattened.
- **Checks** on every write:
  - **TypeScript strict** type-check with React 19 types.
  - esbuild bundling (only `react` / `react-dom` and kit files can be imported).
  - Every example is rendered (render errors are shown).
  - The named export must exist, and each planned state needs an example.
  - **Hard-coded colours** that should be tokens are flagged.
- **Preview**: every example rendered with the real CSS, next to the design image.
- **Catalog**: `catalog/index.html` is a self-contained interactive page (React + your components, bundled with esbuild-wasm) that works from `file://`. Plus `index.ts`, which re-exports everything.

## Usage

Ask the agent in ZCode Desktop:

- "Build React components from this design"
- "Pull the colours and type scale from the screenshot into tokens"
- "Add a loading state to the Button and check it compiles"

To use the kit in your app (React 18/19), copy `src/`, `tokens.css`, `tokens.ts` and `index.ts`, import `tokens.css` once, and let your bundler (Vite, Next, …) handle the CSS imports.

## Tools

| Tool | Purpose |
|---|---|
| `dc_new` | Create a kit (tokens files, README) and link design images |
| `dc_tokens` | Set / remove tokens; regenerates tokens.css / tokens.ts |
| `dc_plan` | Component checklist with required states |
| `dc_write` | Write / delete component files and rebuild |
| `dc_build` | Type-check, render examples and rebuild the catalog |

## Scope (v0.1)

- React + TypeScript with plain CSS files. No Vue, no Figma import, and no Tailwind or CSS-in-JS setup.
- Components can import only React and files in the kit. Third-party UI libraries are not available in the preview.
- The panel preview is static (each state is its own example). Hover, focus and typing can be tried in `catalog/index.html`.

## Privacy, network and files

- Runs locally with no network access and no API keys. esbuild (WebAssembly), TypeScript and the React types are bundled with the plugin.
- Writes only `ui-kit/<name>/` and `.design-to-components/project.json`.
