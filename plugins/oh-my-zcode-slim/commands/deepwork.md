---
description: Start a deepwork session for a complex coding task
argument-hint: <task description>
---

Activate the `deepwork` skill and begin a deepwork session for the following task:

$ARGUMENTS

Follow the deepwork skill's core contract: you are the scheduler, not the implementation worker. Create the progress file under `.slim/deepwork/`, draft a plan, request an `@oracle` review of the plan and revise until acceptable, then execute in phases — delegating bounded lanes to specialists (`@coder`, `@designer`) — with an `@oracle` review after each phase. Record librarian research and design decisions in the deepwork file as they are reconciled, and finish with final validation and a concise summary.
