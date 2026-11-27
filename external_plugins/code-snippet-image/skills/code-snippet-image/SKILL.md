---
name: code-snippet-image
description: 把代码做成适合放进幻灯片、文档和帖子的图片：支持 TypeScript/JavaScript、Python、Go、Rust、Java、C/C++、SQL、Shell、CSS、HTML、JSON、YAML 语法高亮，六种主题，带行号、高亮行、macOS 风格窗口和渐变背景。可以从文件里截任意行范围（一个文件可以出多张），自动去掉公共缩进，长行自动折行。分享前会提示代码里的 API 密钥、令牌、私钥、写死的密码和带账号密码的 URL，并可以在图片里打码。每段导出 PNG（默认 2 倍清晰度）和 SVG。在本地运行，不用登录，无需 API 密钥。 用户提到“代码截图 / 代码图片 / 代码美化 / 把代码做成图片 / carbon”时使用。
---

# 代码截图美化

1. `codeimg_open(inputs, settings?, project?)`：读取代码文件并排好代码图。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 传代码文件；每行一张图：file、from、to、highlight（如 3,5-7，用原文件行号）、title、lang。
   - 一个文件要出多段时用 add 加行。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `codeimg_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 改范围：`set: [{row, values: {from: 13, to: 17, highlight: "15-16"}}]`；打码：`settings: {redact: true}`；主题：`settings: {theme: "dracula"}`。
4. `codeimg_export(project, formats?)`：每段导出 <文件>[-L起-止].png 和 .svg。把文件路径告诉用户。
5. 发现密钥时提醒用户，并建议打开 redact。
