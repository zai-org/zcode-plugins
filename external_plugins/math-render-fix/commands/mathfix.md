---
description: Re-output the formulas of the previous answer with delimiters the ZCode chat UI can render
argument-hint: "[optional: which part to rewrite]"
---
Re-output the math formulas of your previous answer (or of the part named by $ARGUMENTS) so that the ZCode chat UI can display them. ZCode only recognizes dollar delimiters; `\(...\)` and `\[...\]` are shown as raw LaTeX.

Scope: what $ARGUMENTS names when it is given, otherwise every formula in the previous answer.

Rules:

- Inline formula: on the same line as the text, wrapped in double dollars, for example `where $$P_{\mathrm{total}}$$ is the total power`.
- Display formula: a line with only `$$`, then the formula (it may span several lines), then a line with only `$$`.
- Change only the delimiters, never the formula itself. Keep the original numbering and order, and give each formula one line of context.
- Output only the formulas with that context; do not repeat the rest of the answer. Leave code blocks, inline code and file contents as they are.
- Answer in the user's language.

If the target contains no formula, say so plainly and do not invent one.
