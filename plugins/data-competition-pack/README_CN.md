# data-competition-pack

[English](./README.md)

面向天池/Kaggle 类 AI 数据竞赛的全流程方法论技能包。一个 skill 贯穿竞赛全周期：赛道分析 → Baseline → 上探 → 模型融合 → 提交策略 → 复盘。

## 功能

- **六阶段工作流**（SKILL.md）— 可复用的竞赛打法：分析赛道、快速搭 baseline、推分、融合模型、规划提交、结构化复盘。
- **过拟合诊断清单**（overfit-checklist.md）— 提交前快速检查 LB/CV 分歧、数据泄露与过拟合模式，不浪费提交次数。
- **模型融合指南**（ensemble-guide.md）— 实用 blending/stacking 配方与适用场景说明。

全部内容为纯 Markdown 知识——无脚本、无网络请求、无依赖。对话进行到对应阶段时 agent 自动加载相关章节。

## 目录结构

```text
data-competition-pack/
├── .zcode-plugin/
│   └── plugin.json
└── skills/
    └── datascience-competition/
        ├── SKILL.md
        ├── overfit-checklist.md
        └── ensemble-guide.md
```

## 副作用说明

| 副作用 | 详情 |
| --- | --- |
| 文件读取 | 除 agent 本已读取的项目文件外无额外读取。 |
| 文件写入 | 无。 |
| 网络访问 | 无。 |
| 命令执行 | 无，纯知识型 skill。 |

## 作者

wdfdsyhb · [源码仓库](https://github.com/wdfdsyhb/zcode-plugins-community)
