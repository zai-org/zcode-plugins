# 案例：杜牧《江南春》· 竖版 risograph 版画

- **日期**：2026-10-14
- **风格**：riso-print（江南春·risograph 版画）
- **原始输入**：
  千里莺啼绿映红，水村山郭酒旗风。
  南朝四百八十寺，多少楼台烟雨中。
- **意象清单**：
  - 主体：纯风景（无人物主体）
  - 景物：莺鸟、绿树红花、水村、山郭、酒旗、寺庙楼台群、烟雨、江水、小舟
  - 动作：莺啼 / 飞、酒旗随风
  - 色彩：绿、红（诗眼）；调色板锁定深墨绿、雾蓝、草绿、米白纸色
  - 情绪：怀旧、清新、安静、文艺手账感
  - 时空：春、江南、雨天
- **最终提示词**：见本风格 `prompt.positive.txt`（`{SUBJECT}` 填入以下英文主体描述）
  - 主体英文：A vertical hanging-scroll illustration of Du Mu's poem "Jiangnan Chun / Spring in the South": orioles singing for miles, green set off by red, waterside villages and hillside towns with wine flags in the wind, four hundred eighty Southern-Dynasty temples, pavilions half-hidden in misty rain.
  - 完整正向（本次实际调用）：上方大量米白留白 + 枝头莺鸟剪影；中景雾蓝几何平山 + 深墨绿南朝楼台屋顶群半隐烟雨横带；下景水村坡顶屋块（墙留白）+ 倾斜酒旗 + 疏密绿树块带稀疏红点；前景短促密集方向性笔触（草丛/水波）。平涂色块+粗犷笔触，无渐变无描边；两色叠印做中间调；高光云雾用米白留白；颗粒噪点、油墨不均、套色错位、粗糙色块边缘。
- **负向**：见本风格 `prompt.negative.txt`
- **参数**：size=1024x1536（2:3 竖版立轴） quality=high 张数=1
- **参考图**：本风格目录 `ref.jpg`（= 本次成图，仅借风格不抄构图）
- **成图**：`assets/cases/images/2026-10-14-jiangnanchun-riso.jpg`（技能内自包含副本）
- **原始输出文件名**：`A_vertical_hanging_scroll__竖版立_2026-10-14T04-46-05.png`（生成工具按提示词自动命名；原图留在作者本地，未随包发布）
- **是否采纳**：是
- **用户评价 / 可提炼的规则**：
  1. 用户明确认可并指令归档入库，作为 `riso-print` 风格的第 1 条案例。
  2. **可提炼**：用户从参考图提取「版画/risograph 丝网印刷」风格后，用文字配方（而非参考图构图）直接生图，证明该风格已可脱离参考图独立复现 —— 与 jiangnan-muke 同属「部件级指令 + 显式负向」路线。
  3. **可提炼**：调色板采用「3-4 色 + 米白纸留白」的有限结构，且可整体替换（用户备注橘红+藏蓝+米白），已写入 meta.yaml notes 作为该风格的可移植规则。
  4. **可提炼**：诗眼色彩（「绿映红」之红、酒旗之红）可保留少量红点作点缀，或按用户要求严格只用调色板色 —— 列为该风格的可调参数。
  5. 竖版立轴 + 上方大量留白，延续为 riso-print 风格默认版式。
