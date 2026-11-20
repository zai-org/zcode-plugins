---
description: 用 rfauto 门禁工具链判读一个 run/Touchstone 的可信度(四态判定)
argument-hint: "[run_id 或 run 目录或 Touchstone 文件路径]"
allowed-tools: mcp__plugin_rfauto_rfauto__runs_verify,mcp__plugin_rfauto_rfauto__em_doctor_check,mcp__plugin_rfauto_rfauto__em_metrics_from_run,mcp__plugin_rfauto_rfauto__em_diff_runs,mcp__plugin_rfauto_rfauto__touchstone_info,mcp__plugin_rfauto_rfauto__explain_run,mcp__plugin_rfauto_rfauto__diagnose,mcp__plugin_rfauto_rfauto__rf_env_doctor,Read,Glob
---

按 rf-verdict 技能的判读流程，对目标 `$ARGUMENTS` 做可信度判读：

1. 目标为空时，列出当前工作区 `runs/` 下最近的 run 目录，请用户选一个。仍找不到 run 目录，就如实说明，并以 UNVERIFIABLE 结束。
2. 依次执行 `runs_verify`（新鲜度）→ 有清单则 `em_doctor_check` → `em_metrics_from_run`（裸 Touchstone 用 `touchstone_info`）。有两个目标时加 `em_diff_runs`。
3. 输出固定格式的判定报告：四态判定（TRUSTED/SUSPECT/STALE/UNVERIFIABLE）加门级证据表。每个物理数字都括注来源工具调用，不得产生工具没有返回的数字。
4. 判定为 SUSPECT 或 STALE 时，给出 1–3 条下一步建议（对照 em_diff_runs、找 manifest、换引擎仲裁等）。服务器未能启动、只剩 `rf_env_doctor` 时，调用它输出环境报告。
