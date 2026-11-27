# Acceptance cases (optional)

Use this when one video covers two or more acceptance cases. It is a working
list, not a gate: keep the same case ids in the take filenames and in
`segments[].case`. Keep the file in the target project, not in the plugin.

Feature: order owner assignment
Audience: operations staff
Problem this demo covers: handing an order to another owner without losing the saved state

| Case | Proves | Entry | Precondition / data | Expected observable result | Result |
| --- | --- | --- | --- | --- | --- |
| F-01 | main flow works end to end | order detail page | test order `T-1001` | saved owner is shown after refresh | PASS |
| F-02 | empty selection is rejected | same page | clear the owner field | inline validation appears, nothing is saved | PASS |

Takes: `F-01-entry.mp4`, `F-01-result.mp4`, `F-02-validation.mp4`.
Each case starts from a known state and is recorded as its own real run.
