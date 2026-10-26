# 工作流：常见错误对照

**覆盖**：几个最容易踩的失败形态，**左错右对**。错误在 stderr 输出，退出码非 0；成功写法在 stdout 返回 NDJSON。

**前置条件**：同 [README.md 的通用前置条件](../README.md#通用前置条件)。

```bash
# case 1: 试图用 -u 写 data.params —— 被拒绝
libtv node "剧情" -u params.prompt="走起"                # ❌ 非法：params 属于生成参数
libtv node "剧情" --set prompt="走起"                    # ✅ 用 --set

# case 2: 试图用 -u 改节点类型 —— 被拒绝
libtv node "剧情" -u type=image                          # ❌ data.type 不可通过 CLI 变更
# 如需换类型，删除重建：libtv node delete "剧情" && libtv node create …

# case 3: 同一命令同时写 --left 与 --left-add —— 被拒绝
libtv node "剧情" --left A --left-add B                  # ❌ 模式冲突
libtv node "剧情" --left A --left B                      # ✅ 整体对齐
libtv node "剧情" --left-add B                           # ✅ 仅追加

# case 4: --set 写到不属于当前节点类型 schema 的键 —— 被拒绝（校验期）
libtv node "剧情" --set ratio=16:9                       # ❌ text 没有 ratio
# 查该类型接受哪些键：libtv model search --type text

# case 5: 未登录或凭据过期
libtv node list                                          # ❌ 401 / AUTH_*
libtv login web --open                                   # ✅ 重新登录

# case 6: 未绑定项目又没给 -p
libtv node list                                          # ❌ PROJECT_NOT_BOUND
libtv project use <项目UUID>                             # ✅ 绑定后再跑
libtv -p <项目UUID> node list                           # ✅ 或临时覆盖
libtv status | jq '.binding'                             # 排查：看当前目录到底绑了什么

# case 7: --attachment 与 --link 同时给 —— 被拒绝（互斥）
libtv node "镜头B" --attachment ./剧本.pdf --link https://x  # ❌
libtv node "镜头B" --attachment none --link https://x       # ✅ 先清掉另一个

# case 8: -u 写了白名单外的键 —— 被拒绝（报错里带正确写法）
libtv node "镜头A" -u scriptRowHiddenUuid=abc            # ❌ 由画布维护，不可手写
# 各类型可写键见 node-types/README.md 的「-u 可写字段」

# case 9: Seedance 合规前置校验不通过 —— 不提交生成，退出码非 0
libtv node "镜头A" --run                                 # ❌ stderr 列出不合格的图片节点
# 换一张满足要求的参考图（300–6000px、宽高比 0.4–2.5、<30MB）后重跑

# case 10: 生成超时（status=4）—— 按失败处理，退出码非 0
libtv node "镜头A" --run || echo "生成失败或超时，见 stderr"
```
