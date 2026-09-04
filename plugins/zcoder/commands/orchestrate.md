---
description: Run the full GLM orchestration pipeline (decompose → route → dispatch engines → synthesize) on a task.
argument-hint: "[task to orchestrate]"
---

Execute the GLM multi-model orchestration protocol (glm-orchestrator skill) for this task:

$ARGUMENTS

Follow the full chain and show the ORCHESTRATION BLOCK: (0) lazy preflight — the first dispatch of an engine doubles as its probe; classify config-class failures (zero tokens, instant, never retried); batch-probe untested engines in parallel only before a large multi-engine fan-out, (1) decompose the task into atomic sub-tasks, (2) emit the routing plan JSON mapping each sub-task to GLM_VISION / GLM_TURBO / GLM_MAIN (only per the skill's STEP 2 emission conditions), (3) dispatch each sub-task to the matching engine agent with a self-contained message, (4) synthesize engine outputs into the final solution and run the Principal Engineer audit before presenting, reporting any engine substitutions. Do not skip the supervision checklist or substitution reporting even when only one engine dispatched.
