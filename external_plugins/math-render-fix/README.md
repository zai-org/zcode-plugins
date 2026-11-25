# math-render-fix

[中文文档](./README_CN.md)

Keeps math formulas readable in ZCode chat.

ZCode renders chat Markdown with KaTeX and only recognizes dollar delimiters. A formula written as `\( ... \)` or `\[ ... \]` loses its backslashes to Markdown escaping and shows up as raw LaTeX: `\(P_{\mathrm{total}}\)` becomes `(P_{\mathrm{total}})`. This plugin steers the model toward the delimiters the renderer understands, catches whatever slips through, and offers an optional patch for the renderer itself.

## Structure

```text
math-render-fix/
├── .zcode-plugin/plugin.json
├── commands/
│   ├── mathfix.md            # /mathfix
│   └── mathfix-patch.md      # /mathfix-patch
├── hooks/
│   ├── hooks.json            # Auto-loaded hooks config
│   ├── math-rules.mjs        # SessionStart: state the supported math delimiters
│   └── stop-check.mjs        # Stop: have formulas with other delimiters re-output
├── scripts/
│   └── patch-renderer.mjs    # Optional renderer patch: status / apply / restore
├── tests/
│   ├── run.mjs               # Hook regression tests
│   └── verify-patch.mjs      # End-to-end check of the patch against a ZCode archive
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

A stop that a hook already forced is accepted, so the model continues at most once per turn.

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
- `/mathfix-patch` applies the optional renderer patch described below. It asks for confirmation first.

ZCode registers both under their file names (verified in ZCode 4.0.0, where the official `zcode-site` plugin's commands are listed the same way). ZCode documentation also describes plugin commands as `/<plugin name>:<command name>`, which would make them `/math-render-fix:mathfix` and `/math-render-fix:mathfix-patch`. Type `/` to see which form your build lists.

### Optional renderer patch

`scripts/patch-renderer.mjs` makes `\(...\)` and `\[...\]` display without any change in how the model writes, so formulas in older messages show correctly too.

ZCode runs a dollar-disambiguation pass over each message before parsing it. The patch rewrites the heads of two functions in that pass (127 bytes, replaced by text of exactly the same length) so that `\(`, `\)`, `\[` and `\]` are turned into `$$` first. The size and header of `app.asar` are unchanged and the edit is made in place.

```shell
node scripts/patch-renderer.mjs status    # read-only: ZCode version, target file, current state
node scripts/patch-renderer.mjs apply     # writes; quit and restart ZCode afterwards
node scripts/patch-renderer.mjs restore   # reverts
```

- Without `--asar <path>`, the script locates the installation from the running ZCode process, then from its uninstall registry entry, then from common install folders.
- It writes only when both functions are found exactly once, checks that the patched file still parses, and refuses anything else. A ZCode build it does not know is left untouched.
- `apply` and `restore` also refresh `~/.zcode/math-render-fix-renderer.txt` with the bytes they wrote. The `Stop` hook reads that file on every run. While the patch is in place the renderer handles `\(...\)` itself and the hook stays silent; as soon as the bytes no longer match, the hook is active again.
- A ZCode update overwrites `app.asar`, which removes the patch. Apply it again.
- This is a local modification of an installed application. Decide for yourself whether to use it.

## Dependencies, permissions and side effects

- **Network**: none. The plugin makes no network request and downloads nothing.
- **Model, API and services**: none.
- **Runtime**: `node` on `PATH`, for the hooks, the patch script and the tests. Nothing else is needed.
- **Hooks execute local code** once the plugin is enabled, so review `hooks/` first. Both hooks read what ZCode writes to their stdin. `stop-check.mjs` also reads the state file described above and the bytes it points to in `app.asar`. The hooks write one JSON object to stdout and no files.
- **`Stop` can continue the model for one more round** when an answer uses unsupported delimiters. That costs one extra model request for such an answer.
- **Files written**: nothing, unless the renderer patch is applied. The patch script edits `resources/app.asar` in the ZCode installation and writes `~/.zcode/math-render-fix-renderer.txt`.
- **MCP servers**: none.
- **Third-party code, assets and services**: none. `tests/verify-patch.mjs` loads the Markdown parser and KaTeX from the ZCode archive it checks; it bundles no copy.

## Testing

```shell
node tests/run.mjs                            # hook regression tests
node tests/verify-patch.mjs [app.asar path]   # end-to-end check of the patch, read-only
```

`verify-patch.mjs` reads the renderer code from `app.asar`, runs a set of messages through ZCode's own preprocessing functions in the stock and in the patched state, and compares the math the parser finds with what each message expects. Run it again after a ZCode update: a "not applicable" result or a failing case means the patch needs adapting.

Manual smoke test of the hooks, with the payloads ZCode sends:

```shell
printf '%s\n' '{"hook_event_name":"SessionStart","session_id":"manual","source":"startup"}' \
  | node hooks/math-rules.mjs

printf '%s\n' '{"hook_event_name":"Stop","session_id":"manual","stop_hook_active":false,"last_assistant_message":"value \\(P_1\\)"}' \
  | node hooks/stop-check.mjs
```

Stdout must be a single JSON object starting with `{`. Put diagnostics on stderr only.

Where the renderer patch is in place, the second command prints nothing: the `Stop` hook is silent by design then. Run it with an empty home directory (`HOME` on macOS and Linux, `USERPROFILE` on Windows) to see the answer.

## Known limitations

- The `Stop` check ignores a `\( ... \)` pair whose content carries no math marker, such as `\(x\)`. It reads well enough as `(x)` without being re-output.
- With the renderer patch applied, `find \( -name a \)` written in plain prose rather than in code formatting is treated as a formula. Code fences and code spans are not affected.
- The patch was written for ZCode 4.0.0 (build 3bc8a247). On another build the script reports that it does not apply.

## License

[MIT](./LICENSE)
