# free-guide

[English](./README.md)

ZCode 插件市场的社区指南插件：在**免费方案**上运行 ZCode 所需的一切——由 Tejas Lowanshi
与 ZCode 于 2026-10-07 在 Fedora 44 上端到端实测。

## 它能带给你什么

一条额度安全回退链，云额度用完时会话不会硬中断：

```
ZCode（默认：Z.ai 套餐）
   │  额度用尽时回退到…
   ▼
CCR Router（本地，127.0.0.1:3456）
   ├─ GPT 模型        （ChatGPT/Codex 账号登录 — 无需密钥）
   ├─ Claude 模型     （经 OmniRoute：GitHub Copilot + Kiro 池）
   ├─ Gemini 3.x      （Google AI Studio 密钥 — 免费，无需信用卡）
   ├─ Nemotron/Gemma  （OpenRouter 密钥 — 免费模型）
   └─ qwen2.5-coder:7b（本地 GPU — 无限量，永远不会用完）
```

## 文件说明

- **`docs-guide.md`** — 完整安装指南（请先阅读）
- **`skills/free-api-key-setup/`** — 把新 API 密钥正确接入 ZCode
- **`skills/auto-model-fallback/`** — 额度/鉴权报错时自动切换到下一个供应商
- **`skills/token-counter/`** — 统计各供应商额度已用多少
- **`README-FIRST.txt`** — 一页快速上手

## 免责声明

免费额度和模型阵容经常变化——本指南在 2026 年 10 月是准确的，并标注了需要复核的细节
（例如 DeepSeek `:free` 已下线、`gemini-2.5-pro` 对新用户已退役）。供应商额度上限
放在各技能内部，便于在不改动指南的情况下更新。

## 安装

ZCode 内：插件市场 → 搜索 **free-guide** → 安装。

## 作者

由 **Tejas Lowanshi** 与 ZCode 共同构建，作为"发给任何人"的免费 AI 方案包。
许可证与本仓库一致（Apache-2.0）。
