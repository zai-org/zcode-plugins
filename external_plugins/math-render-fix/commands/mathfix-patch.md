---
description: Patch the ZCode chat renderer so \(...\) and \[...\] formulas display directly (needs a ZCode restart, reversible)
---
The user asked to apply the ZCode formula renderer patch. The patch edits `resources/app.asar` in the ZCode installation in place: it replaces 127 bytes in the heads of two renderer functions with text of the same length, so the chat UI recognizes `\(...\)` and `\[...\]` as formulas. The file size and everything else stay the same, `restore` reverts it, it takes effect after ZCode is fully restarted, and a ZCode update overwrites it.

Follow these steps:

1. Locate this plugin's `scripts/patch-renderer.mjs`. It runs with Node. Search the plugin cache for it (`~/.zcode/cli/plugins/cache` on macOS and Linux, `%USERPROFILE%\.zcode\cli\plugins\cache` on Windows), or ask the user for the path. If `node` is not available, say that this step cannot run; do not install anything.
2. Run `node <script path> status` and report the output as is: the ZCode version, the target file and the current state.
3. Tell the user plainly that this modifies the installed application, and ask for confirmation with the question tool. Do not write anything before the user agrees; if the user declines, stop here.
4. Run `node <script path> apply` and report the output as is. If the script refuses to write (target code not found, length mismatch, syntax check failed), report the reason; never edit `app.asar` by hand.
5. Remind the user to quit and restart ZCode completely. Formulas in older messages will then display as well. To undo: `node <script path> restore`.

Answer in the user's language.
