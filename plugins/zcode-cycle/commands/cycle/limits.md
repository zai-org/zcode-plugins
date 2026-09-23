---
description: Inspect adaptive admission and repair limits
---

Report ZCode Cycle's resource limits as fixed facts: maximum five repair
cycles before a recoverable blocked state; bounded concurrent workflows per
project through admission permits; resource-aware scheduling. Add the live
permit state via the `cycle_control` tool (operation `status`) if a workflow
is active.
