---
description: 让桌宠小栖说一句话
---

让小栖桌宠把下面这句话显示为桌面气泡：

$ARGUMENTS

按 xiaoqi-pet 技能中的互动事件约定执行：向 `~/Library/Application Support/XiaoqiPet/emote/` 写入一个 `{"v":1,"type":"emote","speech":"…","seconds":6}` 事件文件（先写临时文件再原子改名）。把用户的话整理成一句不超过 60 字的短句，不要改动原意；若参数为空，让小栖打一声招呼。
