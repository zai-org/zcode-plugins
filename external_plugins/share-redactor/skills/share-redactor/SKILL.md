---
name: share-redactor
description: 分享文件前脱敏：在 PDF / DOCX / XLSX / CSV / TXT / MD 里找手机号、身份证号、银行卡号、邮箱、金额（可选）和用户给的姓名/关键词，面板逐处确认后导出脱敏副本并自动自检。用户提到“脱敏 / 打码 / 涂黑 / 隐藏个人信息 / 发给外部前去掉手机号”时使用。
---

# 分享前资料脱敏

1. `redact_scan(settings: {files: [...], kinds?, keywords?, mask?})`
   - `kinds` 默认 phone、id、bank、email；金额 `amount` 要用户明确要求才加。
   - 用户提到的人名、公司名、项目代号放进 `keywords`。
   - `mask`：`label`（替换成 [手机号] 这类标签，默认）、`block`（███）、`partial`（138****5678）。PDF 一律涂黑。
   - 结果里每处命中写成 `[id] 类型 位置 部分遮盖的值 — 上下文`。不要向用户复述完整原值。
2. 向用户概括：每个文件找到几处、哪些类型。扫描件 PDF 没有文字层，只能让用户在面板里手动框选。
3. 用户说“某个值保留”（如公司客服电话）时调用 `redact_save(settings, keepIds: [...])`；保留按值生效，所有文件里同一个值都保留。`redactIds` 用来撤销保留。
4. `redact_export(settings)`：
   - DOCX / XLSX / 文本直接改写；默认清除作者等文档属性。
   - PDF 要在面板里逐页转成图片后涂黑，**面板需要保持打开**，完成后面板会报告自检结果。
   - 输出在 `redacted/`，另有 `redaction-log.csv`（只记录类型和位置，不含原值）。
5. 把每个输出文件的自检结果告诉用户。自检失败时说明原因，不要说文件已安全。
6. 不支持：图片里的文字（OCR）、旧版 .doc / .xls、PPTX。
