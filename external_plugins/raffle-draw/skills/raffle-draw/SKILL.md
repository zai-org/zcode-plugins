---
name: raffle-draw
description: 做谁都能核对的抽奖和随机分组。选上参与者名单，设好奖项（如 一等奖×1, 二等奖×3, 三等奖×5）和随机种子，就用基于 SHA-256 的随机数抽出中奖者——同样的名单和种子永远得到同样的结果，过程记录写下每一步，事后可以验证。可以按抽奖券数加权、排除某些人、锁定某个中奖者后重抽其余名额。也可以把所有人随机分组，并让每个部门平均分到各组。在本地运行，不用抽奖服务，无需 API 密钥。 用户提到“抽奖 / 年会抽奖 / 随机抽人 / 抽签 / 随机分组 / 分组”时使用。
---

# 抽奖分组工具

1. `raffle_open(inputs, settings?, project?)`：读取参与者名单并抽奖。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - settings: {mode: "raffle", seed, prizes: "一等奖×1, 二等奖×3", order: "reverse", weighted: true, repeat: false}；分组用 mode: "groups" 加 groups 或 groupBy: "size" + groupSize。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `raffle_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 锁定中奖者：`set: [{row, values: {fixed: "一等奖"}}]`；重抽：`settings: {seed: "新的种子"}`；排除某人：include 设为 false。
4. `raffle_export(project, formats?)`：导出 result.xlsx 和 audit.json。把文件路径告诉用户。
5. 不要自己挑中奖者或编造结果；结果只来自插件。公开抽奖时建议提前公布种子。
