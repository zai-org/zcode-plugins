# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-23

### Added

- 首版：respire（rsrs）记忆层接入 ZCode——SessionStart 简则注入、UserPromptSubmit 每轮标题档召回、「记：」一前缀落库回执、Stop 存储检查（block 续跑一轮）。
- ZCode 协议适配（对照 respire-qoder 0.6.3 骨架）：
  - 输出走严格 JSON：文本 → `{"additionalContext":…}`（ZCode 忽略纯文本 stdout，已核 runtime 源码）；
  - Stop 阻塞用 `{"decision":"block","reason":…}`（ZCode 枚举 approve|block，不收 `deny`）；
  - 数据目录探测 `RESPITE_DATA` → `ZCODE_PLUGIN_DATA` → 脚本目录；hooks.json 仅 ZCode schema 收录字段，不带 `commandWindows`。
- `scripts/validate_plugin.py`（结构/清单/hooks/输出契约/敏感扫描）、`scripts/package.sh`＋`release.yml`（tag→release，与 dimcode 同口径）、`tests/test_hooks.sh`（stdin 模拟断言＋`--store` 写探针自清理）。
