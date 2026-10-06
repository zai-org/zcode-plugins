---
description: "Explicit İAA orchestration entry point. Runs the current task under the iaa delegation policy."
argument-hint: "[task or instructions]"
skills: iaa
disable-model-invocation: true
---

Use the `iaa` skill for this request:

$ARGUMENTS

Apply the bundled `iaa` skill as the sole orchestration authority for the current
task. That skill defines all behavior — including the zero-agent fallback for
small work and when to yield to an explicitly user-named workflow. This command
is an entry point, not a second implementation.
