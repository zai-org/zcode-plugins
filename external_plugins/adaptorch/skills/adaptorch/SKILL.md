---
name: adaptorch
description: Use when the user wants to hand a multi-step coding task to AdaptOrch, check or cancel an AdaptOrch run, fetch its artifacts, or see their AdaptOrch plan and usage. The tools come from this plugin's adaptorch MCP server.
---

# AdaptOrch

AdaptOrch runs a task on the hosted service at adaptorch.com and returns a run record with
artifacts and evidence. The plugin's MCP server is a thin client: it forwards calls to the
service and runs no orchestration locally. A submission can consume plan quota and model
tokens can be billed separately by the provider.

## Setup

If a tool returns `ADAPTORCH_CONTROL_PLANE_TOKEN is not configured`, no API key is set yet.
Tell the user:

1. Create an account at https://adaptorch.com/app/signup (the Starter plan is free).
2. Create a key at https://adaptorch.com/app/api-keys. It starts with `ado_`.
3. In Claude Code, run `/plugin configure adaptorch@adaptorch` and enter the key in the
   configuration dialog, then run `/reload-plugins`.
4. For model execution, configure the model provider, its exact model ID, and provider API
   key in that dialog. Leave all three empty for read-only queries. The current chat model
   is not automatically available to the hosted service.

Never ask the user to paste either key into chat, tool arguments or a committed file.

## Tools

| Tool | Use it to |
|---|---|
| `adaptorch_run` | Submit a task. Pass `prompt` for a single task, or `payload` with `subtasks` (and optional `dependencies` as `from`/`to` pairs) when the work has parts |
| `adaptorch_get_run` | Read a run's status and summary by `run_id` |
| `adaptorch_list_runs` | List recent runs, newest first |
| `adaptorch_get_artifacts` | Fetch a run's artifacts by `run_id` |
| `adaptorch_cancel_run` | Request cancellation of a run that is still in flight |
| `adaptorch_capabilities` | List the synthesis modes and options the service accepts right now |
| `adaptorch_usage` | Show the plan, period, runs used and runs remaining |
| `adaptorch_plan_catalog` | Show the current plans |
| `adaptorch_server_metrics` | Show call counts and latency for this MCP server |

The service may also advertise `adaptorch_verify_candidate` and
`adaptorch_get_verification_report`, which run checks against a candidate patch. Use them
only when they appear in the tool list.

## Running a task

- Submit a run only when the user asked for one. Explain potential plan and provider costs.
- Ask before sending private code or other sensitive context unless the user has already
  authorized that scope. The service receives submitted prompts and context.
- Keep secrets, credentials and private keys out of `prompt`, `context` and `payload`.
- Check `adaptorch_capabilities` before setting `synthesis_mode` or `output_extractor`
  instead of guessing values.
- For long work, set `wait_for_terminal` to `false`, then poll `adaptorch_get_run`. Use
  `adaptorch_cancel_run` if the user wants to stop.
- Do not blindly resubmit after a timeout: the original submission may have succeeded.
  Check existing runs first.
- If a call returns `QUOTA_EXCEEDED`, stop retrying. Show the usage from
  `adaptorch_usage` and point the user to https://adaptorch.com/pricing.

## Reporting results

- Report the status and fields the service returned. Don't infer success from a missing
  error.
- A completed run, a passed check or a receipt is evidence about what ran. It is not a
  proof that the code is correct, and it is not a release approval. Say so when it matters.
- Report failed, timed-out and unknown verification states as they are.
- Link the run on the dashboard at https://adaptorch.com/app/runs when the user wants to
  look at it there.
