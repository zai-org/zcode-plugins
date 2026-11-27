---
name: resume-screener
description: 在自己电脑上，用岗位说明对一文件夹简历做初筛。从岗位说明（Markdown 或文本）读出必须项、加分项、最低年限和学历，再给每份简历打分——支持 Word、有文字层的 PDF、Markdown、文本，中英文均可——列出命中了哪些要求、缺了哪些必须项、按工作经历时间合并算出的年限、学历、邮箱和电话。中英文关键词互认（A/B 测试 = A/B test，餐饮 = restaurant 等）。岗位说明里的年龄、性别、婚育等要求会被提示，且不参与打分。还会发现重复投递（邮箱或电话相同）、读不出文字或扫描版的简历和缺少联系方式。可以给每位候选人记状态和备注，导出按分数排序的 Excel 筛选表和 Markdown 汇总。关键词匹配只用于加快初筛，最终由人来判断。不用登录，无需 API 密钥，简历不离开本机。 用户提到“简历筛选 / 筛简历 / 初筛 / 候选人排序 / 招聘”时使用。
---

# 简历初筛

1. `screen_open(inputs, settings?, project?)`：读取岗位说明和简历，给每位候选人打分。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 传包含岗位说明和简历的文件夹；每行一位候选人：include、name、_score、_years、_degree、_matched、_missing、email、phone、status、note。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `screen_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 标记面试：`set: [{row, values: {status: "面试"}}]`；去掉重复：`values: {include: false}`；改要求：`settings: {must: "SQL; Python; Tableau|Power BI"}`。
4. `screen_export(project, formats?)`：导出 shortlist.xlsx（按分数排序）和 shortlist.md。把文件路径告诉用户。
5. 不要按年龄、性别、婚育等筛选；岗位说明里有这类要求时提醒用户。分数只是参考。
