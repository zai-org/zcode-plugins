---
description: 校验所有智能体定义文件是否规范
---

1. 扫描用户级 `~/.zcode/agents/*.md` 与工作区级 `<工作区>/.zcode/agents/*.md`。
2. 逐文件检查:frontmatter 可解析;name、description 非空;name 与文件名一致(否则警告);正文非空;tools 均为本环境真实工具名;无未解析占位符或编码异常。
3. 每个文件输出一行:通过 / 警告 / 失败 + `文件:行号` 证据。只报告,不擅自修复。
