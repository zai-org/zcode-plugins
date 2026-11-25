---
name: doc-compare
description: 对照两个版本的文件（DOCX / PDF / Markdown / TXT，可跨格式），逐词（中文逐字）列出增删改，标出涉及数字的改动，左右对照审阅、标记确认/疑问，导出 HTML/CSV 报告。用户提到“对比 / 比较两个版本 / 改了什么 / 合同修订 / redline / diff”时使用。
---

# 文档版本对照

1. `compare_open(old, new)`：old 是旧版，new 是新版。
   - 结果里每条改动的格式是 `[id] 类型 (旧位置 → 新位置): 摘要`。`#` 表示涉及数字。
   - 位置的写法：`¶n` 是 DOCX 第 n 段，`p.n` 是 PDF 第 n 页，`Ln` 是文本第 n 行。
2. 向用户概括重点：
   - 先说涉及数字（金额、日期、比例、期限）的改动，再说新增和删除的条款。不要逐条念完。
3. 用户要求时调用 `compare_review(old, new, reviews: [{id, status: "ok" | "question" | "open", note}])`。
   - 例如“把涉及付款的改动标成有疑问”，备注写清楚原因或要问对方的问题。
4. `compare_export(old, new, format?: "html" | "csv" | "both", only?: "all" | "open" | "question")`。
   - 告诉用户报告路径。HTML 可以直接打印成 PDF。
5. 扫描件 PDF 没有文字层，不支持。`.doc`、`.pages` 请先另存为 DOCX。
