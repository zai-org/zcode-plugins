---
name: cycle-doctor
description: Use when diagnosing ZCode Cycle problems - control plane unreachable, workflow stuck, roles misbehaving, ledger doubts. Read-only diagnostics with a symptom-to-check workflow and plain reporting of findings.
---

# ZCode Cycle Doctor

Read-only diagnostics. Work symptom to check, in this order.

1. Control plane unreachable: call `cycle_health`. If it fails, the native
   package may be missing (reinstall `@zcode-cycle/native-<platform>`) or
   the data directory may be blocked. Report the exact error.
2. Workflow stuck: call `cycle_control` operations `status` then `recovery`
   for the project. Report state, repair budget and the recovery result.
3. Role misbehaving: call `cycle_role_list`. A role session that should be
   gone but is still registered must be revoked with `cycle_role_revoke`.
4. Ledger doubts: call `cycle_history` with `{ "type": "verify" }`. Report
   chain and checkpoint integrity plainly.
5. General health: call `cycle_control` with operation `doctor`.

Report findings as a numbered list: check, outcome, recommended fix. Do not
apply fixes yourself beyond revoking stale role registrations; everything
else belongs to the user or a governed workflow.
