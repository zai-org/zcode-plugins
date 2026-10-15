---
description: 把任务派给 DSH（DeepSeek Harness，headless，按 [Project: X] 路由）
argument-hint: "<project> <任务描述>"
---
用 `dispatch_to_dsh` 工具把下面的任务派给 DSH。第一个参数是 ~/Projects 下的项目名（$1），其余是任务正文；正文开头必须是 `[Project: $1]`（工具会自动补）。派完把返回的 job_id 告诉我，之后可用 `dispatch_status` 查结果；不要自己去做这个任务。

参数：$ARGUMENTS
