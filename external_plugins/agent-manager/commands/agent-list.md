---
description: 盘点当前可用的智能体(subagent)定义
argument-hint: "[作用域: user | workspace | all,默认 all]"
---

按以下步骤盘点智能体定义:

1. 按参数确定扫描范围:未指定或 `all` 时扫描用户级 `~/.zcode/agents/*.md` 与工作区级 `<工作区>/.zcode/agents/*.md`;指定 `user` 或 `workspace` 时只扫对应目录(只统计真实存在的文件)。
2. 逐个读取 frontmatter,输出表格:名称 | 作用域 | 工具 | 一句话职责。
3. 同名出现在多个作用域时标 ⚠️;并与当前会话系统提示的可用 agent types 对账,说明差异(如运行时注入、磁盘无文件的情况)。
4. 最后一行给出统计:N 个用户级 + M 个工作区级。

范围:$ARGUMENTS
