# 案例：白居易《忆江南》· 竖版立轴

- **日期**：2026-10-14
- **风格**：jiangnan-muke（江南春·水印木刻）
- **原始输入**：
  江南好，风景旧曾谙。
  日出江花红胜火，春来江水绿如蓝。
  能不忆江南？
- **意象清单**：
  - 主体：纯风景（江南晨江）
  - 景物：朝阳、江边红花、江水、远岸低山、江畔屋舍、小舟
  - 动作：日出、江花映水
  - 色彩：红胜火（江花）/ 绿如蓝（江水）—— 两条主色
  - 情绪：明媚而眷恋、怀念
  - 时空：春 · 清晨 · 江南
- **最终提示词**：
  ```
  A vertical hanging-scroll illustration of Bai Juyi's poem '忆江南' (Remembering Jiangnan): a spring sunrise over the southern river. Under the rising sun a flat pale disc low on the horizon; the riverside blossoms glow red like fire as sparse flat red blocks with a few short carved marks; the spring river water is a deep blue-green drawn with only a few short horizontal strokes and generous cream negative space; distant low hills recede as flat pale blocks; a few riverside houses are summarized as complete solid dark roof silhouettes with walls left as cream paper negative space; one small boat as a simple cream-paper shape on the water.

  Rendered in a refined flat color-block hand-printed woodblock style (套色木刻 / 水印木刻) -- planar, graphic, no realistic rendering. Use the provided reference image ONLY for its style: its flat color-block language, short carved marks, cream paper ground and hand-printed texture. Do NOT copy its composition or subject.

  BACKGROUND: a clean, warm off-white cream rice-paper color filling the whole image; paper texture fine and subtle, only a slight natural printing grain -- no coarse fibers, no stains, no yellowing spots, no over-aging.

  COMPOSITION: highly simplified flat shapes organized into large color areas; forms natural with a slight handmade irregularity but clearly recognizable; color blocks primary, carving lines secondary; generous cream negative space, especially at the top.

  TEXTURE: inside color blocks keep tiny sparse white ink-skipping spots and slight ink starvation; block edges with a slightly hand-printed feel; texture only an accent and never covering the graphics.

  COLOR: low-saturation muted palette overall, but let the 江花 red and the 江水 green-blue read clearly as the poem's two color notes.

  MOOD: bright yet serene, nostalgic, quiet.
  ```
- **负向**：见 `prompt.negative.txt`（当次完整负向：no drawing every roof tile, every brick or every leaf one by one; no dense hatching or cross-hatching; no realistic sketch shading; no photographic light-and-shadow modelling; no photo tracing; no woodcut filter effect; no complex gradients; no realistic shadows; no heavy thick black outlines; no watercolor bleeding; no 3D texture; no coarse paper fibers, stains, yellowing spots or over-aging; no text, no lettering, no characters, no signature, no seal.）
- **参数**：size=1024x1536（2:3 竖版立轴） quality=high 张数=1
- **参考图**：`assets/styles/jiangnan-muke/ref.jpg`（以 image1 传入，提示词内明确「只借风格、不抄构图」）
- **成图**：`assets/cases/images/2026-10-14-yijiangnan.jpg`（技能内自包含副本）
- **原始输出文件名**：`A_vertical_hanging_scroll_illu_2026-10-14T04-37-31.png`（生成工具按提示词自动命名；原图留在作者本地，未随包发布）
- **是否采纳**：是
- **用户评价 / 可提炼的规则**：
  1. 用户直接采纳，无修改意见 —— 说明 `jiangnan-muke` 配方首次跨题材复用成功（从《江南春》→《忆江南》）。
  2. **可提炼**：本风格配方具备**跨题材可移植性**，不只适用于「江南春」这一首。后续可作为该风格的通用能力记录。
  3. **可提炼**：参考图以 `image1` 传入 + 明确「只借风格不抄构图」的措辞，**未出现构图照抄** —— 证明这条防线有效，应保留为固定做法。
  4. **可提炼**：原文有明确色彩词时（红胜火 / 绿如蓝），在提示词中把这两色「点出来并要求读得清」，能让成图忠实还原诗眼，同时整体仍保持低饱和。此技巧可推广到其他含色彩词的诗。
