# Command Reference

Every command runs through the main ZCode session against the Cycle control plane.
Operations that the flow needs are executed automatically when their
preconditions are met; the commands remain available for inspection,
control, recovery and expert use.

## Workflow

| Command | What it does | When it runs automatically |
|---|---|---|
| `/cycle:run [auto\|quick\|full]` | Arm the next exact request in this session with a routing preference | On explicit implementation intent |
| `/cycle:resume` | Reconcile paused, interrupted or blocked work and continue | After recovery preconditions are met |
| `/cycle:status` | Latest workflow state, mode, candidate, repair budget | Native status updates |
| `/cycle:tasks` | Durable task identifiers and states | Scheduler operations |
| `/cycle:evidence` | Recorded candidate gates without raw output | Verification pipeline |
| `/cycle:pause` | Pause the active workflow at its next safe boundary | Resource or compatibility pause |
| `/cycle:cancel --confirm` | Cancel authorized work safely; requires explicit `--confirm` | Never automatic |
| `/cycle:retry` | Retry a classified failure or blocked cycle | Transient retry policy |

## Single-role consultation (bounded, never a full cycle)

| Command | What it does |
|---|---|
| `/cycle:architect [topic]` | Read-only planning consultation with the architect |
| `/cycle:feasibility [question]` | Read-only architecture feasibility analysis; executor is not dispatched |
| `/cycle:review-implementation [scope]` | Functional review, read-only, advisory |
| `/cycle:review-security [scope]` | Security review, read-only, advisory |
| `/cycle:arbiter [question]` | Advisory verdict — final approval exists only inside a governed workflow |

## Configuration and inspection

| Command | What it does |
|---|---|
| `/cycle:models [role] [model-ref\|inherit] [thought-level]` | Inspect or safely configure a managed project role profile |
| `/cycle:permissions` | Show the immutable role boundaries and enforcement layers |
| `/cycle:limits` | Show adaptive admission and repair limits |

## Data

| Command | What it does |
|---|---|
| `/cycle:history [verify]` | Query the project audit ledger; `verify` proves the hash chain and signed checkpoints |
| `/cycle:memory <insert\|search\|explain\|remove>` | Manage durable project knowledge (insert cites ledger events as provenance) |
| `/cycle:export --confirm` | Export workflow state or ledger; requires explicit `--confirm` |

## Goals

| Command | What it does |
|---|---|
| `/cycle:goal <create\|list\|status\|amend\|focus\|plan\|link\|control>` | Manage persistent goals with versioned plans, milestone links and completion gates |

## System

| Command | What it does |
|---|---|
| `/cycle:setup [install\|repair\|remove]` | Inspect or explicitly manage project role profiles and run compatibility checks |
| `/cycle:doctor` | Read-only installation and project diagnostics |
| `/cycle:browser` | Managed browser QA status and limits |
| `/cycle:help` | This reference |
