#!/usr/bin/env node
/**
 * SessionStart hook for the superpowers plugin.
 *
 * Injects the `using-superpowers` skill as session context so the agent knows
 * the skills exist and must check for a relevant skill before acting. This
 * bootstrap is the entire integration: without it the skill files on disk are
 * never invoked.
 *
 * Protocol (ZCode):
 * - Read one JSON event object from stdin
 * - Write a single JSON object to stdout (must start with `{`)
 * - Put diagnostics on stderr only (never secrets / full prompts)
 *
 * Manual smoke test:
 *   printf '%s\n' '{"hook_event_name":"SessionStart","session_id":"manual","source":"startup"}' \
 *     | node hooks/session-start.mjs
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let raw = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) raw += chunk;

let input = {};
try {
  input = raw.trim() ? JSON.parse(raw) : {};
} catch (err) {
  process.stderr.write(`[superpowers] invalid SessionStart stdin: ${err}\n`);
  process.exit(1);
}

const eventName = input.hook_event_name || input.hookEventName || "SessionStart";
const source = input.source || "unknown";
const skillPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "skills",
  "using-superpowers",
  "SKILL.md",
);

let skillBody;
try {
  const rawSkill = readFileSync(skillPath, "utf8");
  // Strip the YAML frontmatter; the body is what carries the instructions.
  const withoutFrontmatter = rawSkill.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  skillBody = withoutFrontmatter.trim();
} catch (err) {
  // Missing/unreadable skill must not break session start; degrade silently.
  process.stderr.write(`[superpowers] cannot read ${skillPath}: ${err}\n`);
  process.exit(0);
}

process.stderr.write(`[superpowers] SessionStart source=${source} session=${input.session_id || "?"}\n`);

const context =
  "<EXTREMELY_IMPORTANT>\n" +
  "You have superpowers.\n\n" +
  "**Below is the full content of your 'superpowers:using-superpowers' skill - your " +
  "introduction to using skills. It is already loaded - do not try to invoke it again. " +
  "For all other skills, use the 'Skill' tool:**\n\n" +
  skillBody +
  "\n</EXTREMELY_IMPORTANT>";

// Prefer hookSpecificOutput so the runtime can attribute the context to this event.
process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: eventName,
      additionalContext: context,
    },
  }),
);
