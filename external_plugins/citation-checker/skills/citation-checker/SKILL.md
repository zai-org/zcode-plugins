---
name: citation-checker
description: 核对报告里的数字、引文和出处是否与参考资料一致（PDF、保存的网页、Word、Markdown、TXT），标出找不到依据的说法，并能跳回资料原文。用户提到“核对引用 / 查出处 / 事实核查 / 数据对不对 / 引文是否准确 / 哪些没有来源”时使用。
---

# 引用来源核对

1. `cite_check(report, sources?)`：`sources` 是资料文件或文件夹；不给时取报告所在文件夹里的全部 PDF / HTML / DOCX / MD / TXT。
   - 只核对“可核对”的句子：含数字（年份、日期、序号除外）、引号原话（≥ 8 字）或引用标记（[1]、[^1]、【1】、(Smith, 2020)）。
   - 状态：`number` 数字不符（会给出资料里的数字）、`quote` 引文不逐字一致（给出最接近的原文）、`missing` 资料里找不到依据、`weak` 只部分吻合或跨语言转述（数字一致但措辞不同）、`ok` 有依据。
   - 参考文献表（[1] …）里写了资料文件名或标题时，会检查依据是否出自所引的那份资料（`citeMismatch`）。
2. 逐条复核需要看的（number / quote / missing / weak / citeMismatch）：
   - 读给出的资料原文判断；`weak` 常见于中文报告引用英文资料，自己对照意思。
   - `missing` 用 `cite_search(report, query)` 换关键词、换语言再找；找到就把位置写进 `evidence`。
   - 用 `cite_review(report, reviews)` 记录结论：supported / partly / wrong / unsupported / open，`note` 写正确数字或缺的出处。重新核对时，句子没改的结论会保留。
3. 向用户汇报：先列有误和无依据的（报告原句、位置、资料怎么说、出处页码/段落），再说需确认的；不要替用户改报告，除非用户要求。
4. `cite_export(report, format?)`：导出核对表（html 默认，可选 csv / md），写在报告旁边 `<报告名>.citations.html`。
5. 限制：扫描版 PDF 没有文字层，需要先 OCR；只比对字面与数值，不判断推理是否成立；跨页断开的句子按页分别匹配。
