# math-render-fix

[中文文档](./README_CN.md)

Keeps math formulas readable in ZCode chat.

ZCode renders chat Markdown with KaTeX and only recognizes dollar delimiters. A formula written as `\( ... \)` or `\[ ... \]` loses its backslashes to Markdown escaping and shows up as raw LaTeX: `\(P_{\mathrm{total}}\)` becomes `(P_{\mathrm{total}})`. This plugin steers the model toward the delimiters the renderer understands and has whatever slips through re-output. It changes nothing in ZCode itself.

## Structure

```text
math-render-fix/
├── .zcode-plugin/plugin.json
├── commands/
│   └── mathfix.md            # /mathfix
├── hooks/
│   ├── hooks.json            # Auto-loaded hooks config
│   ├── math-rules.mjs        # SessionStart: state the supported math delimiters
│   └── stop-check.mjs        # Stop: have formulas with other delimiters re-output
├── tests/
│   └── run.mjs               # Hook regression tests
├── LICENSE
├── README.md
└── README_CN.md
```

## What it does

### Hooks

They run once the plugin is enabled. ZCode takes a snapshot of hooks when a session starts, so open a new session after enabling the plugin or editing `hooks/`.

| Event | Matcher | Behavior |
| --- | --- | --- |
| `SessionStart` | none, so every source | Runs `hooks/math-rules.mjs`, which injects a short rule as `additionalContext`: inline math in `$$...$$` on the same line, display math between two lines of `$$`, and never `\(...\)` or `\[...\]` in chat replies. |
| `Stop` | none | Runs `hooks/stop-check.mjs`. It reads the final answer, ignoring code fences and code spans. If the answer still holds math delimited by `\(...\)` or `\[...\]`, the hook answers `decision: "block"` with a `reason` that lists those formulas in the supported form, so the model re-outputs only them. |

A stop that a hook already forced is accepted, so the model continues at most once per turn. The check is plain text matching in a local script; it calls no model and makes no network request.

The hooks ask for the math ZCode renders natively:

- Inline: `where $$P_{\mathrm{total}}$$ is the total power`
- Display:

  ```markdown
  $$
  S = 4\lambda\frac{P_2}{P_{\text{total}}}
  $$
  ```

Single dollars are avoided on purpose: ZCode prints plain single-dollar content such as `$2x$` or `$vout$` literally.

### Commands

- `/mathfix [scope]` re-outputs the formulas of the previous answer, or of the given scope, with supported delimiters.

ZCode registers it under its file name (verified in ZCode 4.0.0, where the official `zcode-site` plugin's commands are listed the same way). ZCode documentation also describes plugin commands as `/<plugin name>:<command name>`, which would make it `/math-render-fix:mathfix`. Type `/` to see which form your build lists.

## Dependencies, permissions and side effects

- **Network**: none. The plugin makes no network request and downloads nothing.
- **Model, API and services**: none.
- **Runtime**: `node` on `PATH`, for the hooks and the tests. Nothing else is needed.
- **Hooks execute local code** once the plugin is enabled, so review `hooks/` first. Both hooks read only what ZCode writes to their stdin. They print one JSON object on stdout, read no files and write none.
- **`Stop` can continue the model for one more round** when an answer uses unsupported delimiters. That costs one extra model request for such an answer.
- **Files written**: none.
- **MCP servers**: none.
- **Third-party code, assets and services**: none.

## Testing

```shell
node tests/run.mjs    # hook regression tests
```

Manual smoke test of the hooks, with the payloads ZCode sends:

```shell
printf '%s\n' '{"hook_event_name":"SessionStart","session_id":"manual","source":"startup"}' \
  | node hooks/math-rules.mjs

printf '%s\n' '{"hook_event_name":"Stop","session_id":"manual","stop_hook_active":false,"last_assistant_message":"value \\(P_1\\)"}' \
  | node hooks/stop-check.mjs
```

Stdout must be a single JSON object starting with `{`. Put diagnostics on stderr only.

## Known limitations

- The rule is a request to the model. A model may still answer with other delimiters; the `Stop` check then costs one extra round.
- The `Stop` check ignores a `\( ... \)` pair whose content carries no math marker, such as `\(x\)`. It reads well enough as `(x)` without being re-output.

## License

[MIT](./LICENSE)
