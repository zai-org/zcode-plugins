---
description: Show the routing plan for a task — which GLM engine and thinking effort each sub-task would get — without executing it.
argument-hint: "[task to analyze]"
---

Routing analysis only — do NOT execute, edit files, or dispatch any engine agent.

Apply STEP 1 and STEP 2 of the glm-orchestrator protocol to this task:

$ARGUMENTS

Decompose it into atomic sub-tasks and output, as a compact table plus the orchestration_plan JSON: each sub-task, its target engine (GLM_VISION / GLM_TURBO / GLM_MAIN), the model and thinking effort the engine would run with, and a one-line routing rationale. Apply the routing decision tree in order — first match wins — and mark any GLM_TURBO step `main-thread until a verified PASS this session` while the slot is unverified. Flag any sub-task you would answer directly on the main thread per the zero-waste rule. Then stop.
