# 节点类型：`video-clip` — 视频合成（时间线 / 剪辑类）节点

## 整体节点用途

**视频合成节点**：把若干 `video` / `audio` 等上游素材按时间线组合成一条视频。**核心编辑对象在 `data` 顶层**（而非 `params`）——**`cropRange` / `clipTimelineData` / `saveToNodeOnComplete` / `url` / `poster`** 等。本节点**不**走「`model` + `tool_spec`」schema 校验，对 `params` 做 **JSON patch 式浅合并**；`--run` 走视频合成任务链路，与 `text` / `image` 等选 `modelKey` 拉 schema 的流程不同。

**通用约定**：[README.md](./README.md)。其它节点涉及的 **`schema` 各块释义**：[../model-schema/README.md](../model-schema/README.md)。

## 案例

见[示例](../SKILL.md)。

## 常见生成器参数（`-s / --set`）

写入 **`data.params`**，**不**做生成器 schema 校验；具体可填键以网页合成面板为准。新建默认 `params` 为 **`{}`**，展示名位置参数为「视频合成」或用户自定义。

> 本类型 **没有统一「全站」字段表**；若产品后续为 `video-clip` 增加表单字段，可先 `libtv node "<显示名>"`（仅查询）打出节点 JSON，对照网页 / 接口文档再填 `-s`。

## 常见属性参数（`-u / --update`）

写入 **`data`** 顶层，**不**经生成器 schema 校验——本类型的核心写入入口。

| 键                     | 类型                            | 说明                                               |
| ---------------------- | ------------------------------- | -------------------------------------------------- |
| **`cropRange`**        | `[number, number]`              | 裁剪区间（秒）。                                   |
| **`clipTimelineData`** | `SerializedClipTimelineDataCli` | 时间线序列化数据；剪辑的核心结构，**字段见下表**。 |

> 展示名用 `--name`，不要用 `-u` 改名。完整 `-s` vs `-u` 区分见 [README.md](./README.md)。

### `clipTimelineData` 字段（`SerializedClipTimelineDataCli`）

时间线持久化数据；实际内容在 `clips[]`。

> **来源 id 自动维护**：`videoSourceNodeIds` / `audioSourceNodeIds` 无需手填——`--left*` 连线 / 断线时，会按当前入边自动重算并写回（以画布连线为准，即使手写也会被覆盖）。下表不再列出这两个字段。

| 字段               | 类型                              | 必填 | 说明                                                                |
| ------------------ | --------------------------------- | ---- | ------------------------------------------------------------------- |
| `clips`            | `SerializedClipTimelineClipCli[]` | 是   | 时间线上的片段数组，**字段见下表**；空数组表示空时间线。            |
| `videoAudioMuted`  | `boolean`                         | 否   | 视频轨原声整体静音（true 时该轨音量按 0 合成，优先级高于 volume）。 |
| `videoAudioVolume` | `number`                          | 否   | 视频轨原声音量，取值 0–1（会被 clamp），缺省 1。                    |
| `audioTrackMuted`  | `boolean`                         | 否   | 音频轨整体静音（true 时按 0 合成，优先级高于 volume）。             |
| `audioTrackVolume` | `number`                          | 否   | 音频轨音量，取值 0–1（会被 clamp），缺省 1。                        |
| `cropRange`        | `{ start: number; end: number }`  | 否   | 时间线整体裁剪区间（秒）；与 `data.cropRange` 数组形式区分。        |

### `clips[*]` 字段（`SerializedClipTimelineClipCli`）

时间线上的单个片段——把某个来源素材（`sourceNodeId`）的 `[sourceOffset, sourceOffset+sourceDuration]` 段，放到时间线 `startTime` 处、占 `duration` 秒。

| 字段             | 类型     | 必填 | 说明                                                                           |
| ---------------- | -------- | ---- | ------------------------------------------------------------------------------ |
| `id`             | `string` | 否   | 时间线内片段唯一 id；同源多段（分割）时用于对齐，缺省可由应用补。              |
| `sourceNodeId`   | `string` | 否   | 该片段的来源素材节点 id（须为已连到本节点左侧的 `video` / `audio` 素材节点）。 |
| `type`           | `string` | 否   | 片段类型（应用侧 `ClipType` 的序列化值，如视频 / 音频）。                      |
| `startTime`      | `number` | 是   | 片段在**时间线**上的起始位置（秒）。                                           |
| `duration`       | `number` | 是   | 片段在时间线上的占用时长（秒）。                                               |
| `sourceOffset`   | `number` | 是   | 从**来源素材**的第几秒开始取（入点）。                                         |
| `sourceDuration` | `number` | 是   | 从来源素材取用的时长（秒）。                                                   |
| `decibel`        | `number` | 否   | 音频推子分贝，范围约 -60～+20，缺省 0dB。                                      |

## 特殊用法

- **不在 `libtv model` 的节点类型范围**：`libtv model search --type video-clip` 会被拒绝——`video-clip` 不在可选 `--type` 枚举（`text` / `image` / `video` / `audio` / `script` / `storyboard`）内，见 [../commands/model.md](../commands/model.md)。
- **上游素材**：先用 [`upload`](../commands/upload.md) 或 `node create -t video/audio ...` 建资源节点，再用 `node --left/--left-add` 连到本节点的左侧。连线后 `clipTimelineData.videoSourceNodeIds` / `audioSourceNodeIds` 会自动写回，**无需手填**。
- **两种合成路径**：
  - **简单首尾拼接**：只连线、不写 `clipTimelineData`，直接 `--run` 即按入边顺序把各上游视频/音频首尾相接合成。
  - **精细剪辑**：需要裁剪 / 分割 / 多片段 / 调音量时，用 `-u clipTimelineData={...}` 写 `clips[]`（来源 id 仍由连线自动维护，写了也会被覆盖）。
- **`--run`**：在 `data` 顶层时间线数据就位后触发合成，任务进度与结果约定见[使用说明](../SKILL.md)。
