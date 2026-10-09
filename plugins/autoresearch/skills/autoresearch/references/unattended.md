# Unattended runs (scheduled self-wakeup)

Bounded unattended continuation for the experiment loop: the agent schedules its own wake-up turns with the host's `CronCreate` tool, so an experiment loop can keep iterating while the user is away. The Stop hook's 3-continuation window still applies inside every wake turn; the cron chain drives the turns across time. Source verdict and the runtime E2E gate are recorded in ADR-7 and the change design (all four gate points passed on the installed runtime: same-session wakes, exact intervals, maxRuns hard stop, MCP experiment tools visible in wake turns, Cron writes physically absent from the wake-turn tool list).

## Authorization comes first (hard requirement)

Only create a scheduled wakeup when the user explicitly asked for unattended operation in this session ("run overnight", "keep going unattended", "无人值守跑"). A scheduled task consumes real compute and model calls while nobody is watching; creating one unprompted is a scare behavior, not initiative. If the user only said "keep optimizing", use the normal Stop-hook continuation window and stop when it runs out.

## Creation timing: right after authorization

Create the CronCreate task immediately after the user authorizes. Do not wait for the Stop-hook window to be nearly exhausted: the hook payload carries no continuation counter, so "the last continuation" is not reliably detectable, and creating early costs nothing (idle wakes are cheap no-ops; see the cost note below).

## CronCreate parameters

- Recurring schedule, not `delayMinutes`: automation turns cannot write Cron, so a one-shot chain cannot re-arm itself; recurring + maxRuns is the only self-driving form.
- `interval`: 5 minutes is the default (one wake turn runs at most ~1-4 experiments inside the Stop window; a 2-minute interval mostly produces idle turns).
- `maxRuns`: 24 is the default (5 min × 24 ≈ 2 hours of unattended time). Scale to the ask ("overnight" → up to ~100; confirm the arithmetic with the user).
- Wake prompt: pass the template below as the task prompt. It must be self-contained: a wake turn may run after a compaction, so it may rely only on `.auto/` files, not on conversation memory.

## Wake prompt template (self-contained)

```text
[autoresearch wake] Automated continuation turn. Do exactly this, nothing else:
1. If .auto/log.jsonl exists and .auto/config.json does NOT set "autoresearchOff": true, run the autoresearch loop: follow the autoresearch skill's loop protocol (read .auto/prompt.md and the injected ledger memory; one focused change; run_experiment; log_experiment with asi).
2. If the session is inactive (no .auto/log.jsonl), or autoresearchOff is set, or the loop just summarized/stopped: output "idle-wake: no active experiment loop" and stop. Do not start a new loop on your own.
3. Never create, delete or modify scheduled tasks (Cron writes are not available in this turn by design).
4. Do not finalize or clear the session; leave that to the user.
```

Point 2 is the idle-wake contract: after the loop ends early (goal reached, cap hit, user off), the remaining scheduled turns no-op with one cheap model call until maxRuns runs out. This is the known cost of the host constraint; document it to the user when they authorize ("leftover wakes will idle until the run cap; or delete the task with CronDelete when you are back").

## Cleanup (user turns only)

Automation turns cannot touch Cron tasks (the wake-turn tool list has no Cron write tools - verified in the runtime E2E). Cleanup therefore lives in user-facing commands:

- `/autoresearch:off`, `/autoresearch:clear` and `/autoresearch:finalize` each include a cleanup step: run CronList, find tasks whose wake prompt carries the `[autoresearch wake]` marker (or match the current session), and CronDelete them.
- When the loop ends early and the user is away, leftover wakes idle until maxRuns is exhausted; when the user is back, deleting the task stops the cost immediately.
- Tell the user at authorization time how to stop it early: "说一声或用 /autoresearch:off，我会删掉定时任务"。
