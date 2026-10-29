---
description: 用 argo 搜索、抓取或核验，并按证据纪律作答
argument-hint: "[查询词或 URL]"
---

按 argo 技能的纪律处理：$ARGUMENTS

先判断输入类型再动手：

- 查询词 → `argo search`（Agent 消费档 `--json --fields agent`）；高后果问题（金融/医疗/法律/事实核查）先 `--verify` 再下结论，`fetch_required=true` 禁止跳过核验
- URL → `argo fetch`（要正文）或 `argo extract`（要表格/结构化数据）
- 需要多视角对比或引用账本 → 不在本命令处理，改走 wide-research 命令

事实必须带 URL 出处；结果异常少时查 funnel 六格计数定位塌陷点。

载入 argo 技能获取完整命令表与执行纪律。
