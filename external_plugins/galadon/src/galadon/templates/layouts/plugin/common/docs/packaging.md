# Packaging

This scaffold stops at the code: a runnable CLI and a bundled skill. Distribution
metadata is a release decision, not an init decision.

To publish:

1. Choose the channels and add only the manifests they need:
   - DeepSeek Harness: `package.json` with `dsh.bundle` and `index.js`;
   - ZCode: `.zcode-plugin/plugin.json` plus a 512x512 icon;
   - Codex: `.codex-plugin/plugin.json`.
2. Keep `version` identical across every manifest and the changelog.
3. Put the skill at `skills/<name>/SKILL.md` with a description that states the
   trigger conditions, not the implementation.
4. Run the full suite, then pack and inspect the tarball for bytecode and local
   paths.

Do not ship a placeholder icon or an empty manifest: both pass a naive check and
fail the first real install.
