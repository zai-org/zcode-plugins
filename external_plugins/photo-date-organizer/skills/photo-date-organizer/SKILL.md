---
name: photo-date-organizer
description: 把乱七八糟的手机照片、截图和视频，按拍摄日期整理进“年/月”文件夹——日期取自 EXIF、视频创建时间或文件名里的日期，最后才用文件修改时间——还可以统一改名成 20261002_091500.jpg。每个文件都标明日期来源，日期可以手动改正，移动后还能撤销。在本地运行，无需 API 密钥。 用户提到“整理照片 / 按日期归档 / 拍摄时间 / 相册分文件夹 / 照片改名成日期”时使用。
---

# 照片按日期整理

1. `photos_open(inputs, settings?, project?)`：读取文件夹里每张照片和每个视频的日期，规划日期文件夹。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 传一个文件夹；settings 可设 folders（如 "yyyy/yyyy-MM"）、naming（keep/date/date-name）、mode（move/copy）。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `photos_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 改日期：`set: [{row, values: {date: "2024-02-02 12:00"}}]`。
4. `photos_export(project, formats?)`：导出 organize-plan.csv，再把文件移动或复制到日期文件夹（organize-log.csv）；undo 可移回原处。把文件路径告诉用户。
5. 来源是“文件修改时间”的要提醒用户核对。先导出 plan 给用户看，同意后再导出 organize。
