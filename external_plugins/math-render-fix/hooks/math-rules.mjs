#!/usr/bin/env node
// SessionStart hook of math-render-fix.
//
// ZCode renders chat Markdown with KaTeX and only recognizes dollar delimiters, so a formula written as
// \( ... \) or \[ ... \] appears as raw LaTeX. This hook states the delimiters the renderer understands
// at the start of every session, which keeps formulas readable without changes to the model or the app.
//
// Input:  the SessionStart JSON line on stdin. It is drained but not needed.
// Output: one JSON object carrying the rule as additionalContext. Nothing else is written to stdout.

const RULE = [
  "Math in ZCode chat replies: ZCode renders math with KaTeX and only recognizes dollar delimiters.",
  "1. Inline math: wrap it in double dollars on the same line, for example: where $$P_{\\mathrm{total}}$$ is the total power.",
  "2. Display math: a line containing only $$, then the formula, then a line containing only $$.",
  "3. Never delimit math with \\(...\\) or \\[...\\] in chat replies: the UI cannot render those and shows raw LaTeX.",
  "4. Prefer $$...$$ over single dollars. ZCode treats plain single-dollar content such as $2x$ or $vout$ as ordinary text and prints it literally.",
  "5. This applies to chat replies only. Inside files, documents and code, follow that format's own math convention.",
].join("\n");

let raw = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) raw += chunk;

// The hook is registered for SessionStart only; the event name is echoed so the answer is never
// attributed to the wrong event if the registration ever changes.
let eventName = "SessionStart";
try {
  const input = JSON.parse(raw);
  if (typeof input.hook_event_name === "string") eventName = input.hook_event_name;
} catch {
  // An empty or malformed payload still gets the rule.
}

// The process then ends by itself; no exit() call, so the write is never cut short on a pipe.
process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: eventName, additionalContext: RULE } })}\n`);
