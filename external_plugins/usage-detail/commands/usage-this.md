---
description: 查看当前会话的本地用量汇总、模型/来源分组及最近失败或取消请求。
argument-hint: "[--session 会话ID | --directory 项目绝对路径]"
skills: usage-detail
---

用户要查看当前会话用量。按 `usage-detail` 技能的「当前会话」流程运行插件脚本的 `this` 子命令，参数为 $ARGUMENTS。

以中文表格报告会话标题、ID、最近请求、定位方式，以及汇总、模型/来源、失败/取消请求。自动定位是基于最近请求的推断，多窗口时可能定位到其他会话，须提示用户核对标题；用户提供 `--session ID` 时使用指定会话。结果来自本地记录，套餐配额余量请查看 ZCode 的 Usage Stats → Coding Plan。
