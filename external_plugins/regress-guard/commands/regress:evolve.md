---
description: 遇到难点时查社区经验→适配项目→沉淀为知识库（不再重复查）
argument-hint: <遇到的问题描述>
allowed-tools: Read, Write, Edit, Bash, WebSearch, WebFetch, Grep
---

# /regress:evolve — 查攻略·适配·沉淀

遇到不熟悉的难题，查社区最佳实践，**适配当前项目**（不盲目照搬），沉淀到知识库。下次同样的问题直接读知识库，不再查。

参数 `$ARGUMENTS` 是遇到的问题描述。

## 流程

### 1. 先查知识库
读 `.regress/knowledge-base.json`。如果已有匹配的 → 直接用，不查社区，
**并给该条记一笔**（v1.24 代谢链：`hits` +1、`last_hit` 今天——命中是留存的证据，
半年零命中的条下次提示复验，知识库也要新陈代谢）。

### 2. 查社区（WebSearch）
搜索关键词，读 2-3 个高赞结果，提取社区公认的解法 + 坑 + 适用条件。

### 3. 适配当前项目
**社区方案再好也要适合当前情况。** 对每个方案问：
- 本项目技术栈匹配？
- 改动量可接受？
- 和已有代码冲突？
不完全适配 → 怎么调整？

### 4. 沉淀
写入 `.regress/knowledge-base.json`：
```json
{
  "question": "遇到的问题",
  "answer": "社区的解法",
  "adaptation": "针对本项目的调整",
  "verified": true/false,
  "captured_at": "首次沉淀日期",
  "hits": 0,
  "last_hit": ""
}
```
同时把适配后的经验写入项目 AGENTS.md。

## 自主决策
- 能从代码推断解决 → 不查社区
- 知识库里已有 → 直接用
- 查到后 → 必须适配，不照搬
- 同一问题已沉淀 → 不再查
