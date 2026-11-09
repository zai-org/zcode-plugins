# `video` — 视频节点（以 Seedance 2.0 `star-video2` 为例）

**覆盖**：混合模式（图+文 → 视频）建节点、挂两张参考图、触发生成、改封面；附文档上下文；生成后做高清、样片转正片、下载到本地。字段语义以 [`../../node-types/video.md`](../../node-types/video.md) 为准，后处理命令见 [`../../commands/video.md`](../../commands/video.md)。

**前置条件**：同 [../README.md 的通用前置条件](../README.md#通用前置条件)；本地有 `./refs/a.png` 和 `./refs/b.png`。

## 建节点、连参考图、生成

```bash
# 1) 先把参考图作为 image 资源节点挂上来
libtv upload "参考图1" -t image --resource ./refs/a.png
libtv upload "参考图2" -t image --resource ./refs/b.png

# 2) 新建视频节点（mixed2video 需要至少 1 张参考图）；新建用 node create，-t 只在 create 上可用
libtv node create "镜头A" -t video --prompt "无人机掠过海面" \
  --set "model=Seedance 2.0" \
  --set modeType=mixed2video \
  --set count=1 \
  --set ratio=16:9 \
  --set resolution=720p \
  --set duration=5 \
  --set enableSound=on \
  --set search_enabled=1 \
  --left 参考图1 --left 参考图2 \
  --run

# 3) 仅改封面缩略图（不影响生成）
libtv node "镜头A" -u poster='https://.../cover.jpg'
```

## 附文档 / 链接上下文（仅 schema 开启 `supportAttachment` 的模型，如 Wan 3.0）

```bash
# 附一份本地剧本文档后生成（自动上传）；模型是否支持先用 `libtv model <modelKey>` 看 supportAttachment
libtv node create "镜头C" -t video --prompt "雨夜街头追逐" --set "model=Wan 3.0" \
  --attachment ./docs/剧本.pdf --run

# 换成链接上下文：两者互斥，先清掉文档再给链接
libtv node "镜头C" --attachment none --link https://example.com/brief
```

## 后处理：高清 / 转正片 / 下载

```bash
# 对已生成的视频做高清（右侧新建高清节点，阻塞到终态）
libtv video hd -n "镜头A"

# Seedance 2.5 样片满意后转 1080P 正片（样片 7 天内有效）
libtv video final -n "镜头B"

# 下载到 ./out；stdout 是写出的文件路径
libtv download -n "镜头A" --watermark true -o ./out
```

关键点：

- `modeType` 决定 **`modeType.items`** 上限（参考图数量）；越界会在 CLI 校验期直接拒绝。
- 改封面请走 `-u poster=…`，不要用 `-s`。
- Seedance 家族模型 `--run` 前会自动做合规校验，已审核且在 60 天有效期内的素材会跳过；规则见 [`../../node-types/video.md`](../../node-types/video.md)。
