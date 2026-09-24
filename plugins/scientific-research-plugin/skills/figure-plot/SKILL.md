---
name: figure-plot
description: 数据可视化与绘图技能。用户要求画图、绘图、出图、作图、重画，或提到 figure、plot、matplotlib、数据图、示意图、算法流程图、框架图、拓扑图、柱状图、折线图、热力图、帕累托前沿、网络图、收敛曲线、中文图、学位论文图、海运航线、地理网络、世界地图、避陆，或问 drawio/math/数学公式/数学符号/LaTeX 渲染等任何图形与公式渲染问题时使用。覆盖数据图（Python/matplotlib）与示意图/流程图（drawio/TikZ）的完整规范：图契约、Times New Roman 字体（中文宋体回退）、色盲安全配色、图例强制审计（序列缺图例导出即报错）、矢量 PDF 导出与字体嵌入验证、脚本落盘与迭代约定、海运航线 searoute 避陆生成与穿陆检测。
license: MIT
---

# 绘图技能（figure-plot）

## 第 0 步：图契约（写代码之前）

动笔前先用两三行确认（可静默完成，复杂多面板图须向用户展示）：

1. **核心结论**：这张图要支撑的一句话论断（如「DDRO 在高扰动场景下成本低于 SAA 且更稳定」）。
2. **面板证据链**：每个子图对应结论的哪一部分证据；不承载独立证据的面板删掉。
3. **主角面板**：多面板时确定一个 hero panel（承载核心证据、占最大面积），其余为从属，不要平均填满画布。
4. **章节归属**：注明该图服务哪一章——第三章问题描述（示意图）、第四章算法设计（流程图）、第五章实验分析（数据图），据此走下方工具路由。

图服务于科学逻辑，美观和排版都从属于把结论画清楚。

## 工具选择（按论文章节路由）

| 章节 | 图型 | 首选工具 | 要点 |
|---|---|---|---|
| 第三章 问题描述 | 示意图：网络拓扑（港口/枢纽/弧）、供应链结构、时间窗 | drawio；需与正文数学符号严格一致时用 TikZ | 节点/弧/集合用论文记号（如 G=(N,A)）；决策变量、参数、扰动用色块区分并加图例 |
| 第四章 算法设计 | 算法流程图：C&CG/Benders 迭代、启发式主循环 | drawio（矩形=步骤、菱形=判断、圆角=起止，迭代用 loop frame） | 一个流程图只讲一个算法骨架；与伪代码行号对应（如有） |
| 第五章 实验分析 | 数据图：收敛曲线、方法对比、灵敏度、Pareto 等 | Python（matplotlib + figstyle 共享样式） | 见下方数据图规范与图型速查 |
| 跨章 | 方法总览/框架图 | drawio 或 TikZ | 同第三章要点 |

drawio/TikZ 示意图与流程图同样遵守硬性规范：Times 风字体（TikZ 经 `newtxtext` / `mathptmx` 宏包匹配）、矢量导出、最终印刷尺寸下字号不低于 6 pt。drawio 的完整工作流（凸包工具、导出、视觉验收）见下节。

## drawio 示意图工作流（第三章拓扑 / 第四章流程 / 框架图）

完整管线：**手写 .drawio XML → drawio-toolkit 生成凸包区域 → 桌面版 CLI 导出矢量 PDF → 渲染 PNG 视觉验收（至少两轮）→ `\includegraphics`**。导出成功不等于完成，验收通过才算。

### 1. 源文件与标签约定

- `.drawio` 与导出 PDF 同目录（论文 `figs/`）；cell 用语义化 id（`nH1`、`eG_L4`、`lgHub`），文件头写 design tokens 注释（字号阶梯、Okabe-Ito 映射、线宽分级）。
- 所有 cell `fontFamily=Times New Roman`；**数学符号一律用 drawio 内置 LaTeX 语法**：`mxGraphModel` 设 `math="1"`，标签里反引号包裹公式（`` `H_1` ``、`` `y^{\text{in}}_{1,t}` ``），可与 HTML（`<span>`/`<i>`/`<br>`）混排。纯文本里禁止 `H^hub`、`xi_n,t` 这类字面量——会按原样印出来。**从第一版就用 math=1**：不要先用 Unicode 下标（`H₁`）凑合再迁移——迁移时 toolkit 匹配串、regions.json 全部要跟着改，成本高（fsm Figure 1 实测）。
- **drawio 桌面版（30.x）MathJax 宏支持范围**（2026-09-16 逐变体实测）：`\omega \pi \lambda \eta \xi \kappa \mathcal{A} \in \Omega` 及上下标均正常；**upright 文本必须用 `\text{...}`**；`\mathrm{...}` 与 `\rm` 不被识别（宏名按字面排出，且 `in` 被解析成 ∈）；`{=}` 按字面输出括号（用 `=`）；裸多字母（`y^{in}`）被解析为变量积或 ∈。统一用 `\text{}` 包多字母词。
- **要被 drawio-toolkit 匹配的节点，value 就是含反引号的完整字符串**（`` `L_1` ``），`regions.json` 的 `nodes` 必须逐字符相同（含反引号）；只供展示的标签无此约束。

### 2. 凸包 / 服务区多边形（drawio-toolkit，零安装）

```bash
uv run --project <drawio-programmatic 路径> drawio-toolkit upsert-buffered-regions \
  --drawio <fig.drawio> --parent 1 --after <锚点cell id> --config <regions.json>
```

- 语义与坑：节点按 `parent` 属性过滤、按 **value 精确匹配**取中心；`remove_id_prefix` 幂等删除重建（`hull_` 前缀的标签 cell 也会被删，需重加）；锚点 cell 决定 z-order——插在锚点后 = 底色带之上、节点之下。
- 生成的凸包 cell 自带 value 会**居中渲染**压住内容：生成后把 value 置空，标签另加 text cell 放角落或 hull 外上方。
- `regions.json` 是凸包唯一事实源，与 `.drawio` 同目录入库；**节点坐标改动后必须重跑工具包**。
- 工具包位于 mako 仓库 `tools/drawio-programmatic/`；论文需跨机器自包含时整目录拷入论文仓库（同 figstyle 的自包含逻辑）。

### 3. 导出与字体核对

- WSL（无本地 drawio）借 Windows 桌面版：`"/mnt/c/Program Files/draw.io/draw.io.exe" -x -f pdf -crop -o "$(wslpath -w <out.pdf>)" "$(wslpath -w <in.drawio>)"`；macOS 或有本地 CLI 时直接 `drawio -x -f pdf -crop`。
- **CLI 能渲染 MathJax 数学式**（渲染为矢量路径，因此 PDF 字体清单里不会出现 MathJax_* 字体，属正常）。关键防坑：math 标签渲染后的实际宽度可超过 cell 宽度且导出不裁剪标签——内容顶到画布右缘会被**水平分成两页**。画布 `pageWidth` 要比最右内容多留 ~60px，配合 `-crop` 收回白边。
- **验证分层**：文本层（`mutool draw -F text`）能抓到完全未渲染的标签（含反引号原文），但**抓不到宏级失败**——`\mathrm` 不被识别时 MathJax 会把宏名字母排版成矢量路径，文本层同样干净。宏级正确性只能目检渲染图，且必须用开放式提问（"列出上标文字"）而非确认式提问（"是否渲染正确？"会得到顺从的"是"）。怀疑某宏有毒时，把变体写进同一文件的带行号标记行，一次导出目检对比。
- pdflatex 报 "PDF version 1.7, but at most 1.5 allowed" 无害；字体嵌入核对：无 pdffonts 的环境用 `mutool info -F <pdf>`（TimesNewRoman 子集 + 个别 Type3 矢量字形均属正常）。
- 不要试图 SendKeys 自动化 Windows 桌面版 GUI 导出：中文输入法候选框会吞键（Enter 确认的是候选而非对话框），且保存对话框焦点不可靠——CLI 渲染已够用。

### 4. 字号换算（drawio px → 印刷 pt）

`printed_pt = px × 0.75 × (版心 mm ÷ (画布 px ÷ 96 × 25.4))`。先从编译日志拿真实版心（`grep textwidth manuscript.log`）再定画布与字号阶梯。例：cas-sc 版心 468pt≈165mm、画布 1060px → 缩放 0.61 → 最小字号 **14px** 才满足 6 pt 下限。

### 5. 视觉验收闭环

- gs 渲染 PNG（`gs -dSAFER -dBATCH -dNOPAUSE -sDEVICE=png16m -r150 -o out.png fig.pdf`）交视觉模型审查，跑两轮：第一轮要**具体缺陷清单**（标签压线、箭头擦边、tofu、拥挤、空白失衡）；逐条修复后，第二轮只要 **SHIP/FIX 判定**，并要求判定放在回答第一行（防回复被截断看不到结论）。
- 提防视觉模型的顺从性幻觉：诱导式提问（“是否看到反引号？”）可能得到顺着问句编造的答案。凡有客观判据的判断（math 是否渲染、页数、字体嵌入）一律用文本层/工具输出核实，视觉审查用开放式描述型提问。
- 每轮渲染的 PNG **换新文件名**，避免上传缓存命中旧图误判。
- 常用修复手法：边标签压线 → 摘成独立 text cell 垂直偏移放置；箭头贴节点边缘 → 加显式 exit/entry 锚点（菱形用顶点 `(0.5,0)/(0,0.5)/(0.5,1)/(1,0.5)`）；区域空洞 → 用实例中真实存在的弧穿过填充，不硬挪节点凑布局。

### 6. 预览与设计经验

- 给用户实时预览：`@drawio/mcp`（ZCode 已注册）的 `open_drawio_xml` 可把当前 XML 在浏览器 draw.io 编辑器打开；`search_shapes` 可查 stencil，但工业风 stencil 慎用于学术图——两篇论文（mako、fsm-stackelberg）的图均为纯几何词汇。
- 实例带真实地理坐标（港口/城市经纬度）时，**按相对方位布局 + 底色带（海域等）**远比抽象分层框图有说服力（已验证：mako `ecr_schematic`、fsm `fig_ecr_schematic`）。
- **图内不放成段文字**：注释性长句（"stage-1 sea moves / vessel call…"、"Representative arcs —…"这类）一律不进图，全部写在 LaTeX `\caption{}` 里；图内只留图形、数学符号、短标注和图例。画完自检：数一数图里超过一行的文字块，有就搬进 caption。
- 手绘感来自层级：主角节点加大加深（更粗描边、更深填充），主流程弧加粗，注记一律细线斜体；全员同权重 = 自动生成感。
- **程序化改 XML 的防截断**：`ET.tree.write()` 先清空文件再序列化，任何属性值忘了 `str()`（如 float 的 `-0.5`）都会留下截断损坏且无备份。改 .drawio 一律先写临时文件再 `os.replace()` 原子替换；损坏后若节点几何未变，删掉生成性 cell（凸包）按补丁历史重建、toolkit 重跑即可恢复。
- **新建 cell 必须带 `as="geometry"`**：`<mxGeometry>` 缺 `as` 属性时 XML 仍良构、ET 不报错，但 drawio 导出时该 cell 几何失效，内容 bbox 被算到远处 → PDF 平铺成 N 页（表现为"只有最后一页有内容"）。症状性修法：遍历所有 mxGeometry 补 `as="geometry"`。另：浮动边（sourcePoint/targetPoint 式）加 Array 路径点同样会触发 bbox 爆炸，曲线/折线要用 `shape=mxgraph.basic.polygon` + `polyline=1` 的开放折线替代。

## 硬性规范（每张图必须满足）

1. **矢量 PDF**：默认导出 PDF（出版质量）；仅用户明确要求时才用 SVG（网页用途）或 PNG。
2. **字体**：Times New Roman，缺字体环境按回退链 `Times New Roman → Times → Liberation Serif → Nimbus Roman`（样式文件已内置，WSL/Linux 不再静默换成 DejaVu）。中文图（中文期刊/学位论文）用 `load_style(zh=True)`：拉丁字符与数字走 Times，中文走宋体（`SimSun → Songti SC → Noto Serif CJK SC` 按平台回退）。
3. **标签默认英文**（国际投稿），即使数据包含中文；中文论文场景用户明说后才切中文模式，中文一律宋体，不混入黑体/楷体。
4. **图例**：同一子图内 ≥2 组视觉可分的序列（靠颜色 / 线型 / marker / 填充任一维度区分）必须配图例且逐组完整；`save_fig` 内置图例审计，缺失或不完整会报错拒绝导出。

## 尺寸与字号（按最终印刷尺寸设计）

- 先问目标版面：单栏图宽约 3.5 in / 89 mm，双栏约 7.2 in / 183 mm（EJOR、TRE 等 Elsevier 期刊同此标准）；`figsize` 按此设定，不先画大图再缩。
- 最终印刷尺寸下：轴标签 7–9 pt、刻度 6–8 pt、面板字母 8–12 pt 加粗；字号不得小于 6 pt。

## 配色（色盲安全，默认执行）

- 离散类别：默认 Okabe-Ito 色板——`['#0072B2', '#D55E00', '#009E73', '#E69F00', '#56B4E9', '#CC79A7', '#000000']`。
- 连续 / 热力图：感知均匀色图 `viridis` / `plasma` / `cividis`；**禁用 jet / rainbow**。
- 发散型数据（如改善/恶化）：`RdBu_r` / `PuOr`，并以 0 为中心。
- 曲线较多时叠加冗余编码（不同 linestyle + marker），保证灰度打印下也可区分。
- 每张图克制用色：中性色 + 一个信号色系 + 一个强调色，不追求最大色彩区分度。

## 版面细节

- 去掉上、右边框（`spines['top'/'right'].set_visible(False)`），图例无边框（`frameon=False`）。
- **图例是默认要求，不是可选项**：凡靠颜色、线型、marker 形状、实心/空心、填充任一维度区分出 ≥2 组序列的子图，必须配图例逐项说明每组的语义；只有全部序列都已在数据旁就地标注（direct label）时才可免图例。轴标签、行标签（如 y 轴刻度写行名）只定位不释义，不能替代图例（实测教训：fsm Figure 4 面板 b 双行散点只有行标签、实心/空心语义无图例，被用户退回补加，且两状态合并成两 entry 仍被要求拆全四项——每个 (形状×填充) 组合一个 entry，不要合并语义）。
- **写法约定**：每条 `plot` / `scatter` / `bar` / `fill_between` 调用都带 `label=`；不进图例的辅助元素（参考线、显著性括号、误差棒帽）显式 `label="_nolegend_"`；收尾统一 `ax.legend(loc=...)`。多面板共享一套序列语义时，图例可只放主角面板一个，其余面板不重复——`save_fig` 的图例审计按全图颜色/款式匹配识别这种共享图例，不会误报。图例位置与样式跨面板一致（如统一轴内右上、顶边同高）。
- 窄面板放多列图例极易横向越界压到纵轴（相邻面板的轴）：导出前在脚本内 `fig.canvas.draw()` 后用 `legend.get_window_extent()` 与 `ax.get_window_extent()` 比对四边 slack，为负即 fail 报错（fsm fig5 实测：单行四项越界约 4pt 被用户发现；收敛方案是改 2×2 按 marker 形状分组——上圆下方对应数据行——而非缩字号）。
- 多面板：用 `GridSpec` 对齐；每个面板左上角加粗体字母 A、B、C…；各面板样式保持一致。
- 轴标签必须带单位，如 `Cost ($10^6$ USD)`、`Time (h)`。

## 数据图图型速查（第五章实验分析）

| 数据模式 | 图型 | 建议宽度 |
|---|---|---|
| 求解收敛 / optimality gap 随迭代 | 折线（必要时对数轴） | 89 mm |
| 方法 × 单指标对比 | 柱状 + 柱顶数值标注 | 89 mm |
| 场景 × 方法大表 | 热力图 | 183 mm |
| 成本–服务双目标权衡 | Pareto 散点 + 支配区底纹 | 89 mm |
| 双参数灵敏度 | 等值线 / 热力图 | 89 mm |
| 网络方案可视化 | networkx + netgraph（静态出版）/ kepler.gl（探索） | 183 mm |
| 分布对比（多场景成本） | 箱线/小提琴 + 个体散点 | 89 mm |

## 统计要素（有实验数据时）

- 误差棒注明类型（SD / SEM / 95% CI），并在图注中说明；多次运行的收敛曲线用均值 + 置信带（`fill_between`）。
- 柱状图 y 轴从零开始；离散点少时同时展示个体点（散点 + 汇统计）。

## 共享样式模块（样式唯一事实源）

样式集中在技能目录 `assets/publication.mplstyle`，加载与验证经 `scripts/figstyle.py`；图脚本禁止再复制 rcParams 块。每个图脚本开头：

```python
import sys
from pathlib import Path

sys.path.insert(0, str(Path.home() / ".agents/skills/figure-plot/scripts"))
from figstyle import load_style, save_fig

load_style()            # 中文图：load_style(zh=True)
# 绘图：每条序列带 label=；辅助元素显式 label="_nolegend_"
ax.plot(iters, ddro, color="#0072B2", marker="o", markevery=10, label="DDRO")
ax.plot(iters, saa, color="#D55E00", marker="s", markevery=10, label="SAA")
ax.set_xlabel("Iteration")
ax.set_ylabel("Optimality gap (%)")
ax.legend(loc="upper right")
save_fig(fig, "fig5_convergence", outdir="figures")
```

- `save_fig` 导出前先做**图例审计**：同轴 ≥2 组视觉可分的序列无图例、或图例缺 entry（有序列没写 `label=`）都报错拒绝导出；`check_legends=False` 豁免仅限单序列或全部序列已就地标注的图。随后导出 `figures/<name>.pdf`、校验非空、核对字体全部嵌入（pdffonts emb=yes），通过后回显绝对路径。
- 论文仓库需脱离本机自包含（合作者复现/投稿）时，把 `figstyle.py` 与 `publication.mplstyle` 拷入仓库 `figures/` 目录，此后以仓库内副本为该论文的唯一事实源。

## 执行约定

- **脚本落盘**：生成脚本保存到项目内 `figures/scripts/<fig_name>.py`，不要只在临时目录跑一次性命令。
- **运行方式**：项目内有 pyproject.toml 用 `uv run --no-sync python figures/scripts/<fig_name>.py`；否则用 `python3`。
- **输出验证**：数据图统一走 `save_fig`（内置图例审计、非空与字体嵌入校验）；drawio/TikZ 导出后须 `ls -la` 确认存在且非空，drawio 图另走上方工作流的视觉验收闭环。两类都在回复中报告**绝对路径**，再让用户查看。
- **迭代请求**（改字号、配色、图例位置等）：先读 `figures/scripts/` 下的原脚本 → 修改 → 重跑；文件名保持不变，保证 LaTeX 中的 `\includegraphics` 引用稳定。

## 交付前检查清单

- [ ] 矢量 PDF；任何情况下不用 JPEG（有压缩伪影）
- [ ] Times New Roman（中文图：中文宋体），最终印刷尺寸下字号 ≥ 6 pt
- [ ] 字体已嵌入：pdffonts 核对 emb 全 yes（drawio/TikZ 导出的 PDF 同样检查；无 pdffonts 环境用 `mutool info -F`）
- [ ] 图内无标题——标题只写在 LaTeX `\caption{}`，删除 `plt.title`
- [ ] 色盲安全配色 + 灰度可辨
- [ ] 轴标签齐全、带单位
- [ ] 误差棒 / 置信带有定义
- [ ] 多面板有 A/B/C 标签且样式一致
- [ ] 每个子图的分类标记（实心/空心、形状、颜色）都有图例逐项说明语义
- [ ] 图例审计通过（`save_fig` 导出即验证）：每个含 ≥2 组可分序列的子图都有完整图例，辅助元素已标 `_nolegend_`
- [ ] 无 3D 效果、无多余网格线和装饰
- [ ] 图的内容能独立支撑图契约中的核心结论
