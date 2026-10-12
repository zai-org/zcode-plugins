# security-cn-pack

[English](./README.md)

面向**授权**渗透测试、公开众测平台（SRC）与防御性安全教育的中文安全知识技能包。四个 skill，全部为纯 Markdown 方法论文档——不含可执行利用代码、无脚本、无网络请求。

> **用途声明**：适用于在授权范围内工作的安全从业者与学生（如明确授权范围的中国 SRC 平台）或防御性安全学习者。全部内容为公开方法论文档，不含武器化内容。

## 技能清单

| Skill | 内容 |
| --- | --- |
| `src-hunter` | 众测实战工作流：19 个攻击 playbook、305 个结构化 payload 模板、263 个 WAF 绕过变体、侦察流水线，以及用于优先级排序的 8.8 万条历史漏洞统计。 |
| `hw-hunter` | 护网红蓝对抗方法论：计分规则、检测与绕过理论、应急响应要点。 |
| `cnvd-cnnvd` | 国家级漏洞平台（CNVD/CNNVD）报送流程：报告结构、证据要求、计分规则。 |
| `vuln-methodology` | 11 类漏洞方法论（IDOR、SSRF、反序列化、JWT 攻击等），附真实案例拆解与工具清单。 |

## 目录结构

```text
security-cn-pack/
├── .zcode-plugin/
│   └── plugin.json
└── skills/
    ├── src-hunter/        # SKILL.md + references/
    ├── hw-hunter/         # SKILL.md + references/
    ├── cnvd-cnnvd/        # SKILL.md + references/
    └── vuln-methodology/  # SKILL.md + references/
```

## 副作用说明

| 副作用 | 详情 |
| --- | --- |
| 文件读取 | 除 agent 本已读取的项目上下文外无额外读取。 |
| 文件写入 | 无。 |
| 网络访问 | 无，纯知识型技能包。 |
| 命令执行 | 无，全部内容为 Markdown 文档。 |

## 许可与署名

MIT · wdfdsyhb 原创作品 · [源码仓库](https://github.com/wdfdsyhb/zcode-plugins-community)
