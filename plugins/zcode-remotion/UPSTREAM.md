# Upstream and provenance

This Marketplace package is a **curated distribution adaptation**, not a byte-for-byte mirror, of:

- Source repository: https://github.com/AIwork4me/zcode-remotion
- Source version: `0.2.5`
- Source main commit used as the functional baseline: `2a9903c2cfc167f11cbec3009a2d7b2161b03492`

The product boundary is unchanged: Remotion's official Agent Skills provide Remotion domain knowledge; zcode-remotion adds ZCode-specific bootstrap, environment checks, routing, autonomous representative-frame visual QA, output verification, and compatibility awareness.

## Marketplace-specific adaptations

The official Marketplace package intentionally excludes repository-maintenance assets such as CI workflows, demos, verification reports, source-project unit tests, release checks, and upstream-drift automation.

The installable layer is adapted for Marketplace distribution in these ways:

1. Add the bilingual `description_i18n` metadata required by this Marketplace.
2. Provide Marketplace-specific English and Chinese READMEs that disclose network access, local command execution, file writes, dependencies, side effects, and licensing.
3. Refactor helper-script instructions so they resolve the installed plugin root through `ZCODE_PLUGIN_ROOT` instead of assuming the user's current workspace is the source repository.
4. Tighten and de-duplicate the Agent-facing skill / command instructions while preserving the same official-first workflow and reliability gates.
5. Use the Marketplace plugin ID `zcode-remotion` rather than the bare upstream product name `remotion`; the bundled auto-trigger skill remains named `remotion`.

Because this is not byte-identical to the source repository release, source-project E2E / CI evidence is background evidence only. The official Marketplace artifact must pass this repository's own validation/build/tests and a live ZCode install check before the submission is considered verified.

## Third-party material

No Remotion Agent Skill is vendored in this package. The plugin asks the user's machine to fetch official skills from `remotion-dev/skills` using the official installer. See `NOTICE.md` for licensing details.
