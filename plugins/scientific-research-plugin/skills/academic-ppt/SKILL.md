---
name: academic-ppt
description: >
  学术会议演讲 PPT/slides 制作 — 从论文稿件（LaTeX/PDF）到可现场演讲的完整流程：
  LaTeX Beamer 路线 + 视觉设计系统（有官方模板则提取背景复用，无模板则自建色板/版式）+
  数学公式与论文原图复用 + 讲稿撰写与时长控制 + PDF→图片→官方模板交付包装 + 演讲者备注与现场预案。
  IMHFC 2026 会议实战多轮迭代沉淀。
  触发词："会议PPT"、"演讲PPT"、"做幻灯片"、"把论文做成PPT"、"presentation"、"slides"、
  "Beamer"、"会议模板"、"讲稿"、"演讲稿"、"presentation speech"、"演讲者备注"、"贴回模板"。
  Use this skill whenever the user wants to turn a paper/manuscript into conference or seminar
  presentation slides, build a Beamer deck, fit slides into the official template,
  write a time-budgeted talk script, or package a slide PDF back into
  a pptx with speaker notes — even if they never say "PPT" (e.g. "下周要用这篇论文做口头报告",
  "15 分钟的 talk 怎么准备").
license: MIT
---

# Academic PPT Skill（论文 → 会议演讲）

从论文制作学术会议演讲材料。本技能是 IMHFC 2026 全流程（2026-08 两周、14 个会话、多轮修改）
沉淀的作业程序，核心价值在于路线已验证、坑已有数值级解法，不要重新试错。

## 0. 典型作业顺序

1. 收集输入：论文源文件（manuscript.tex）、会议官方模板（若有）、时长档位、语言（通常英文）。
2. 按 §1 定路线（结论优先，勿从零调研工具）。
3. Beamer 路线：§2 确立视觉设计系统（有官方模板则提取复用，无则自建）→ 写 tex → §4 验证循环 → §3 排版修法随改随查。
4. 讲稿：§5 配合时长撰写/精简，术语与幻灯片、论文三方一致。
5. 交付：§6 按会议要求包装（合规 pptx / 备注栏 / 现场预案）。

全程遵守 §7 协作红线。

## 1. 路线决策树（已验证的结论）

硬约束排序：**会议官方模板合规（若会议提供）> 数学公式/论文原图精度 > 可编辑性 > 制作速度**。
开工前先确认会议方是否提供官方模板——有则走提取复用（§2.1），没有就以自建设计系统顶上（§2.2）。

| 路线 | 结论 | 原因 |
|------|------|------|
| python-pptx 从零生成 | ❌ 放弃 | 逐元素排版代码量大；模板默认字体（如 Aptos）本机没有，渲染与真实 PowerPoint 不符 |
| officecli 生成 pptx | ❌ 放弃 | QA 用 HTML 渲染器，与真实 PowerPoint 渲染不一致，字体替换导致换行/溢出不可控 |
| 智谱清言 PPT / GLM Slide Agent | ❌ 不适合学术演讲 | 不能嵌入论文原图、公式失真；GLM Slide Agent 仅导出 PDF；只可做风格初稿参考 |
| **LaTeX Beamer（xelatex）+ 设计系统（模板提取或自建）** | ✅ 主力路线 | 原生数学公式、论文 PDF 图矢量嵌入、精确可控 |
| **最终 PDF→图片→套回官方 pptx** | ✅ 交付路线 | 会议要求官方模板 / 需要演讲者备注时的合规形态 |

- 不平行维护双格式：中期只留 Beamer，最后一步才包装回 pptx。
- 若必须原生 pptx 且要保真渲染验证：用 AppleScript（osascript）驱动真实 PowerPoint 导出 PDF/PNG 核对，不信任何 HTML 渲染器。

## 2. 视觉设计系统：先确立，再写内容帧

背景、色板、标题版式这套设计系统要在写内容之前定下来。来源有两条路，版式基座通用。

### 2.1 有官方 pptx 模板 → 提取复用

- pptx 即 zip：解压取 `ppt/media/` 内整页背景图，一般三张（封面 bg_cover / 内容页 bg_content / 封底 bg_closing）。
  - ⚠️ logo 和真页脚在 slide master 里，**不在**背景图片里；提取图可能带无意义淡色伪影条带。
- 用 analyze_image（或目测）标定安全区：正文可放区域、条带占页面高度的百分比。
- Beamer 挂背景：
  ```latex
  \documentclass[aspectratio=169,11pt]{beamer}   % pptx 13.33″×7.5″ = 16:9 = aspectratio=169，两边吻合无变形
  \usebackgroundtemplate{\includegraphics[width=\paperwidth,height=\paperheight]{figs/beamer_bg/bg_content}}
  ```
  封面/封底/转场页用 `{ ... }` 局部组覆盖为各自背景。
- ⚠️ **`\usebackgroundtemplate` 优先级高于 `\setbeamercolor{background canvas}`**——分隔页深蓝底上白字"消失"的根因即此。
- ⚠️ **单位换算坑**：pptx 物理高 19.05cm，Beamer `aspectratio=169` 纸面高只有 **9cm**。背景图里的条带高度必须按百分比换算（底部 9.76% 条带 ≈ **8.8mm**），绝不能拿 pptx 绝对尺寸直接预留（曾误留 21mm 压缩正文区，引发大面积溢出）。
- 条带避让最终解法：footline 精确预留条带高度，正文永不进入条带区；不是删背景。
- 转场页复用 bg_cover 照片时，按照片亮度调文字配色（亮照片上标题白→navy）。
- 色板从模板主题色提取进 `\definecolor`（IMHFC 实例）：navy `0E2841`、orange `E97132`、teal `156082`、gray `5A6B7B`、light `F2F6F9`。

### 2.2 无官方模板 → 自建设计系统

- 原则：学术场合克制。白底黑字正文为基调；**单一主色（深蓝/navy 类）+ 单一强调色（橙/teal 类）+ 灰色辅助**，全部 `\definecolor` 落地后再动手写帧。
- 色板来源：学校 VI、论文图表既有配色、或高对比经典组合；上面 IMHFC 那套五色已实战验证，可直接沿用换色值。
- 明度对比全局一致：反白字色块只用于少量强调且成体系出现，不要与白底黑字正文大面积混排（可读性冲突，用户实测提出过）。
- 可选起点：成熟 Beamer 主题（如 metropolis，可选字体一律 `\IfFontExistsTF` 守护、缺字体自动回退）；或直接复用资产索引里 presentation_beamer.tex 的 preamble——frametitle/divider/callout 整套已验证，换色板即换风格。
- 无背景图就**不挂** `\usebackgroundtemplate`：白底是 Beamer 默认，天然避开 2.1 的优先级坑与单位换算坑；分隔页用主色纯填充即可。

### 2.3 版式基座（两条路通用）

- 去导航符号 `\setbeamertemplate{navigation symbols}{}`、`\usefonttheme{professionalfonts}`；amsmath + unicode-math，数学字体（如 Fira Math）用 `\IfFontExistsTF` 守护。
- frametitle 自定义模板：主色粗体大标题 + 强调色细线（如 13mm×1.1pt），眉注见 §3。
- `\divider`（分隔页：大编号 + 标题）与 `\callout`（强调卡片）沉淀为可复用宏，宽度规则见 §3。

## 3. Beamer 排版坑与修法（实际发生过的问题）

- **includegraphics 调大小没反应**：`keepaspectratio` 下先诊断约束瓶颈是宽还是高——
  用 `pdfcrop` 验证图本身留白；若图已被列宽卡住，调 `height` 无效，要改 `column` 宽度
  （实例：0.46→0.54\textwidth 后图放大 37%）。
- **色块(callout)溢出/贴边**：色块文本宽 + 2×内边距 必须 < 所在列宽（实例：78mm 块塞 68mm 列，直抵页面右缘）。
- **纯文字页不配色块**：文字栏用普通段落 + 橙色小标题点缀即可，色块会压过旁边的图。
- **图文页布局约定**：左文右图（阅读顺序自然）；元素随语义走（流程条放到讲该流程的那页）。
- **多列长文字**：四列横排文字长 → 改通栏纵排（每行 = 大编号 + 粗标题 + 灰色小注）。
- **overfull hbox 逐条清零**：overfull pt 数 ≈ 溢出 mm × 2.85，直接量出要收多少；收窄一侧后检查另一侧是否超高（字号 \small→\footnotesize、行距 1mm→0.6mm）。
- **数学页必须与论文逐项核对**：曾抓出悬空成本系数（`+ c^fold/unfold` 无求和项，数学上不成立）；
  补整型约束 x,w,r,y∈Z₊；符号密集页加一行灰色图例；约束分块打小标签（demand-side / capacity-side coupling、boundary condition）。
- **"改了没变"两种病因**：①编辑没真正落盘/没重编译——说"改好了"之前必须确认 PDF mtime 已更新；②PDF 阅读器缓存——提示用户重新打开文件。
- 章节眉注：内容页大标题上方加 `SECTION N: <转场页标题>` 橙色小字眉注，导航感好。

## 4. 视觉验证循环（每次改版的标准动作）

1. `latexmk -pdfxe presentation_beamer.tex`（或 xelatex ×3）编译至 0 error。
2. `pdftoppm -png -r 120` 渲染全部页；用 PIL 拼成 contact sheet。
3. analyze_image 先扫 contact sheet（prompt 只要求报问题：溢出/截断/压条带/空页），
   再对最密几页（数学、表格、图页）全分辨率逐页复核。
   - analyze_image 报 1210 图片解析错误 = 文件刚被刷新重传，重传即可。
4. 结论给量化证据（像素测量、MSE 对比背景一致性），不凭印象说"好了"。

## 5. 讲稿方法论（配合演讲时长）

- **用户定则：PPT 展示全一些，讲稿少讲**——精简讲稿时不动 PPT。
- 时间预算：15 分钟档 ≈ **1900 口语词 ≈ 13.25 min**（留 1.75 min 缓冲）；
  讲稿内嵌累计时间检查点（如 [04:00] [07:00] [09:30] [12:00] [13:15]），逐节核对。
- 精简原则：
  - 幻灯片上已展示的细节不念（口头只说"约四分之一个箱位，精确值见表"）；
  - Q&A 防御点保留口播（如"租赁无上限 ⇒ 模型恒有可行解"能当场挡住可行性质疑）；
  - 上一页刚说过的内容不重复列举；
  - 破折号要给读法（— includes …）；数字按口语写（62 percent）。
- 讲稿结构：逐页 `[Slide: 标题]` 标记对齐 + 头部全局节奏表 + 关键数字表 + Q&A 预案。
- **术语三方一致**（论文 / 幻灯片 / 讲稿同一次全局替换）；论文在审稿周期内时不能单方面改词，
  记入修回待办等同步替换。
- 叙事打磨：否定式对比（"not computation, but cognitive"）开场太冲——改为递进埋线，最后点题；deck 与讲稿同步改（一次 3+5 处）。

## 6. 交付包装与现场预案

先判断是否需要包装：**会议无官方模板、也不需要演讲者备注时，直接放映 Beamer PDF 即是交付**，
以下包装步骤仅在"要求官方模板 / 需要 pptx 备注栏"时执行。

### 6.1 合规 pptx 包装（PDF→图片→官方模板）
```bash
pdftoppm -png -r 300 presentation.pdf /tmp/imhfc-slide-png   # 300dpi，1890×1063
```
再用 python-pptx：备份原模板 → 从备份打开 → 删模板示例页 → 选空白版式（占位符最少）→
逐页贴整幅图片于 (0,0) 满幅 → 覆盖保存 → 重开验证页数与图片位置。
- 宽高比两边必须同为 16:9 才无变形。
- 目录里有 `~$xxx.pptx` 锁文件 = PowerPoint 正开着该文件，**不要写入**（会被旧窗口重存冲掉）。
- 此形态文字不可再编辑——只作为定稿交付，内容修改回到 Beamer 源。

### 6.2 备注
- 讲稿按 `[Slide: ]` 切分逐页贴入 pptx 备注栏；演讲者视图（Presenter View）一页一屏显示备注+计时。
- 演讲者视图需要**扩展显示**（非镜像）；只有镜像时的预案：关闭"使用演示者视图"+ 打印
  "备注页"版式做纸质提词 + 手机震动闹钟对准讲稿检查点。
- 公用电脑镜像风险：备注只存在演示者视图里，关掉该选项后观众绝对看不到。
- **别用 PDF 放映**——PDF 没有备注，这正是最终包装回 pptx 的原因。
- 给观众打印讲义时要"每页幻灯片"版式，别让工作人员选"备注页"（会把讲稿印出去）。

## 7. 协作红线

- **不得单方面删除用户点名的约束物**：为解决重叠曾把模板背景改成纯白，用户震怒
  （"你把模板背景删了？？？"）。正确做法：精确定位冲突高度并预留，或先问。
- 说"修好了"之前：改动落盘 + 重编译 + 确认输出文件 mtime + 渲染验证，四步缺一不可。
- 平行双格式是时间黑洞：中期砍、末期合。

## 8. 可复用资产索引

- WSL 真源仓库 `~/projects/research/imhfc-ecr-mcnf/`：
  - `presentation/`：presentation_beamer.tex（整套设计系统可直接改内容复用）、presentation_beamer.pdf、
    presentation_speech.md（讲稿范本：节奏表+检查点+Q&A）、模板及原始备份；
  - `figs/beamer_bg/`：bg_cover.jpg / bg_content.jpg / bg_closing.jpg（提取好的三张背景）。
- 新会议最快复用路径：有官方模板 → 解压取三张背景替换 beamer_bg/，并从模板主题色替换 `\definecolor` 色板；
  无模板 → 直接沿用 presentation_beamer.tex 的 preamble 设计系统、只换色板。
  之后重写 frames 内容 → 按 §4 循环验证 → 按 §6 交付。
