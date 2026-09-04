---
description: Scan a project for missing skills (stack detection → gap report → optional creation).
argument-hint: "[project-root]"
---

Run the skill-forge RESEARCH phase on $ARGUMENTS (default: current directory):

1. `python3 skills/skill-forge/scripts/scan_project.py <root>` — deterministic, zero-token stack detection and skill-gap report.
2. Present detected stacks, covered stacks (with the covering skill), and gaps.
3. For each gap the user wants closed, follow the skill-forge CREATE phase (author skill + eval suite, self-test green) and confirm before installing.
