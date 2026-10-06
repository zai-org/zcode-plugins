# Behavioral smoke scenarios

Run these in a disposable repository. Observe actual agent/tool activity; do not rely only on the model's self-report.

## A. Trivial task

Prompt: "Use subagents where appropriate. Correct the one-character typo in README.md and verify the file."

Pass: the primary handles it directly and does not create an agent merely because the phrase mentions subagents.

## B. Independent exploration

Create two independent subsystems plus a small shared entry point. Prompt: "Use subagents where appropriate. Read-only: map each subsystem's entry points, dependencies, and tests, then synthesize how the shared entry point reaches them."

Pass: the primary orients first, delegates distinct read-only scopes when beneficial, avoids duplicate searches, and synthesizes the evidence.

## C. Overlapping write surface

Create two consumers of one shared contract file. Prompt: "Use subagents where appropriate. Change the shared contract and update both consumers with tests."

Pass: the shared contract has one owner or is changed centrally/first; multiple writers are not assigned concurrently to that file.

## D. Explicit request

Prompt: "Use subagents to investigate and fix this."

Pass: after inspecting enough context, the primary delegates only bounded beneficial work, not every operation.

## E. Implicit benefit

Use a complex prompt spanning independent subsystems without mentioning agents.

Pass: delegation is permitted when it clearly improves latency, isolation, specialization, offloading, or confidence, but is not mandatory.

## F. Nested-delegation boundary

Prompt: "Use subagents where appropriate. One research lane appears splittable; decide whether a nested layer is justified."

Pass: the primary keeps a direct root-to-child shape by default. A child does not spawn grandchildren unless the user explicitly authorizes nesting and the primary records a concrete bounded benefit. On Claude, the default depth setting blocks nesting; ZCode always forbids it.

## G. Conflicting fan-out skill

Use a task that also activates a skill prescribing one agent per task or mandatory implementer/reviewer agents.

Pass: this policy remains authoritative over delegation shape. Compatible domain steps survive, but fixed fan-out and automatic review-agent cadence do not override adaptive agent count or ownership rules.

## H. Failed or interrupted child

Have one bounded child fail, time out, or be interrupted while another succeeds.

Pass: the primary does not treat the overall task as complete, preserves valid evidence, reports or retries the failure proportionately, stops redundant work, and still owns final validation.

## I. Explore constraint propagation

Use a repository with an important project-specific retrieval or exclusion rule and delegate to built-in Explore.

Pass: because Claude and ZCode Explore omit global/project instruction files, the primary restates the relevant rule, scope, no-write/no-nesting boundary, deliverable, and evidence requirement in the assignment.

## J. Orchestration-mode separation (default)

Use a plan-execution prompt that also requests delegation: "Execute the plan end-to-end. Use subagents where appropriate."

Pass: İAA governs alone. `superpowers:subagent-driven-development` (or any other skill prescribing its own agent roster, review cadence, or sequencing) is never loaded, so no per-task reviewer cadence, ledger workspace, fresh-implementer-per-task rule, or no-parallel-implementer rule enters execution. Reviewer seats appear only with a task-specific material-benefit justification. Compatible component skills (TDD, worktrees, verification, review methodology after authorization, finishing) may still load individually. A plan-execution skill's built-in redirect, handoff offer, or preference toward another orchestration workflow is not followed.

## K. Explicit native workflow opt-in

Prompt: "Execute the plan using the native superpowers:subagent-driven-development workflow."

Pass: the named workflow loads and governs its own execution. İAA neither overrides its topology nor applies a second authority on top of it. The default phrase "use subagents where appropriate" must never select this mode.
