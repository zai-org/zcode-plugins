# video-agent-kit

`video-agent-kit` 以 `video-agent` 作为视频任务的总控，按任务调用各领域技能。目前已集成：视频理解、共享语音工具、多素材剪辑、单文件处理、字幕、口播精简、电影解说、视频创作、人物替换和录屏复刻。`video-edit` MCP 服务与 CLI 共用同一套工具。

## 首次使用（环境准备）

在新电脑上装好 ZCode 和本插件后，先运行 `/setup-guide`（即 [setup-guide](skills/setup-guide/SKILL.md) 技能）。它会检查并安装插件所需的环境：Python 3.10+ 及 `requirements.txt` 中的包、带 libx264/aac/libass 的 ffmpeg、中文字体、网页复刻用的 Node.js，以及 3D 动画用的 Blender（可选）。它会并行探测 pip、npm、Homebrew、conda-forge 和各安装源的国内镜像，选最快能连通的那个。Python 包自动安装；系统软件在用户同意后才安装，需要密码或手动操作的步骤会给出可复制的命令。会话开始时，`hooks/env_check.py` 按同一份清单报告缺失项。也可以直接运行：

```bash
python3 skills/setup-guide/scripts/env_doctor.py          # 检查
python3 skills/setup-guide/scripts/env_doctor.py --fix    # 检查并安装 Python 依赖
```

语音识别、配音、生图、生视频和 3D 生成都通过已登录的 ZCode 账号（ZCode ToolHub）提供，用户无需自备账号或 key。

## MCP 工具

- `transcribe`：转写本地视频/音频文件，输出带时间戳的文本。
- `tts_generate`：用预设音色生成旁白或配音；同一角色始终使用同一个音色 id。
- `video_observe`：本地/远程视频和图片的统一观察入口；按时间窗口返回逐帧图、联系表或转写证据。
- `video_search`：在支持的站点中检索视频；返回候选、分页和失败信息。
- `video_metadata`：读取本地媒体属性或远程来源的元数据。
- `video_download`：保存完整的远程视频并返回本地路径。
- `video_compare`：用感知哈希和时间对齐辅助比对素材。
- `timeline_validate` / `timeline_patch`：校验时间线；预览或应用结构化修改。
- `subtitle_layout` / `subtitle_build`：观察字幕区域并给出版式建议；根据当前转写生成可编辑的字幕条目和 ASS/SRT。
- `speech_index` / `speech_plan`：建立语音单元索引；把主 agent 的选择转换成精简方案、连贯脚本和方案转写。
- `speaker_audit` / `speaker_relabel`：找出有风险的说话人标签；对已核实的时间范围写出修正后的副本。
- `video_render`：`kind=timeline/subtitles/speech/narrated` 共用一个渲染入口；`narrated` 渲染解说 EDL（配音、句级字幕、可选 BGM、剪切点残帧检查）。也接受 `kind=match`（见「赛事解说」）。
- `video_qc`：`kind=video/subtitles/speech` 检查技术状态、字幕或接缝，并返回合适的图片证据。
- `detect_shots` / `build_film_index`：把整部影片切成镜头（PySceneDetect，帧级细化）；影片索引串起探测、转写、镜头检测和台词轴，并生成观看计划。
- `arrange_footage`：台词轴、按大纲编排素材（reel/brief）、解说锚定，以及按实测配音重新编排。
- `synthesize_narration`：按解说脚本批量合成分段配音，带缓存、句级时间轴和 ASR 回听校验。
- `bind_narration`：把配音句绑定到原片镜头并输出 EDL；`fit_mode=whole_shot`（默认：整镜头画面贴合，带复核队列）或 `legacy`（磁带式 DP）。
- `produce_film`：编排电影解说的整个生产流程（预检、配音、画面贴合、渲染和 QC，按阶段缓存）。
- `swap_scan`、`swap_plan`、`swap_storyboards`、`swap_generate`、`swap_assemble`、`swap_verify`：人物替换流水线（`swap` 工具组），说明见 [video-swap](skills/video-swap/SKILL.md)。

录屏复刻通过 `runtime` MCP 客户端获得 `deploy_website`（把构建产物挂在一个稳定的本地 URL 上）；打开、截图、交互和录制页面都通过 ZCode 内置浏览器（官方 `control-browser` 技能，见 `skills/video2code/references/browser-checks.md`），插件不会启动 Playwright/Chromium。只有当工作区里存在托管运行时端点（`.v2c/runtime/endpoint.json`）时才会提供 `preview_build` 和 `browser_capture`；普通的 ZCode 会话里，`runtime` 服务只提供 `deploy_website`。

## 技能

总控入口：

```text
skills/video-agent/SKILL.md
```

总控按任务组织流程：

- **视频通用理解**：复看、深度研究。
- **视频剪辑**：字幕、多素材剪辑、长视频剪辑。
- **视频创作**：单集作品和连续剧集；时长、画幅和类型由项目配置。
- **视频转代码**：根据录屏复刻网页、游戏或全栈应用。

流程根据任务和实际可用的能力来选择，各领域的详细方法按需读取。总控负责共享的素材来源、证据、时间基准和路由规则；各领域的入口、工作流和参考文档负责各自的方法。检查与修复贯穿每条主线；创作时长由任务决定，单集作品和连续剧集不按时长划分。电影、足球、篮球和英雄联盟解说均已集成。赛事解说复用 `arrange_footage mode=match`、`synthesize_narration mode=match` 和 `video_render kind=match`，并共用现有的 MCP/CLI 和语音服务。

插件提供以下技能。`video-agent` 是所有视频任务的总控，兼容用的 `/video-edit` 命令也指向它。

| 技能 | 职责 |
| --- | --- |
| [video-agent](skills/video-agent/SKILL.md) | 总控与共享证据规则 |
| [video-edit-agent](skills/video-edit-agent/SKILL.md) | 对单个已有视频/音频文件做本地处理（裁剪、转码、压缩、GIF、改尺寸、变速、音轨调整、遮挡、ffmpeg 修饰） |
| [video-understanding](skills/video-understanding/SKILL.md) | 视频复看与深度研究 |
| [video-edit-assembly](skills/video-edit-assembly/SKILL.md) | 多素材剪辑 |
| [video-speech-workflows](skills/video-speech-workflows/SKILL.md) | 字幕与口播精简 |
| [video-creation](skills/video-creation/SKILL.md) | 单集作品与连续剧集 |
| [video-recap-workflows](skills/video-recap-workflows/SKILL.md) | 电影与赛事解说 |
| [video2code](skills/video2code/SKILL.md) | 录屏复刻的通用方法 |
| [video2game](skills/video2game/SKILL.md) | 游戏交互与验证 |
| [video2fullstack](skills/video2fullstack/SKILL.md) | 全栈交互与后端验证 |
| [web-replicate](skills/web-replicate/SKILL.md) | 可选的网页项目模板 |

ZCode 桌面端还提供 [setup-guide](skills/setup-guide/SKILL.md)：新电脑首次使用时的环境检查与安装。

`skills/` 下还有两个上表未列出的技能。`skills/video-agent/SKILL.md` 中的总控会把人物替换路由到第一个；另一个直接进入：[video-swap](skills/video-swap/SKILL.md)（在已有视频中整体替换人物，使用 `swap_*` 工具）和 [code2video](skills/code2video/SKILL.md)（根据文字说明制作 2D 或 3D 动画并渲染成视频，使用 `image_generate` / `model3d_generate`）。

`agents/` 下有七个子 agent 定义：`recap-observer`、`recap-text-reviewer` 和 `recap-final-reviewer`（电影解说，见「电影解说工具」），`creation-verifier`（为 `video-creation` 评判一个候选镜头），`v2c-verifier`（对比源录屏与构建结果），以及 `c2v-reviewer` / `c2v-3d-reviewer`（对 `code2video` 渲染结果和 3D 动作录制做视觉审查）。

## 赛事解说

足球先按事件窗口编排素材再配音；篮球和英雄联盟按实际配音时长挑选素材。三者都经 `video-recap-workflows` 路由。完整的源文件按半场、节或局登记，观察和转写复用共享工具。

- `arrange_footage mode=match action=ingest/dialogue/arrange`：素材入库、解说轴、比赛素材编排。
- `synthesize_narration mode=match`：在共享 TTS 上逐句配音，保留实际时长以及脚本/音频摘要。
- `video_render kind=match`：保留足球/篮球/英雄联盟内核的动作对齐和原声混音；输出 1280×720、25 fps 的成片，以及同名的 `.qc.json`、`.placement.json` 和 `.render_report.json`。

动作定位使用显式的 `event_t`；跨节、跨局时按片段和片段内时间排序。较长的解说空档是复看的线索；编排冲突以及过期的脚本或音频会报错。技术 QC 之后，仍要检查画面、动作完整性和实际声音。参数和示例见 [赛事工作流共享说明](skills/video-recap-workflows/references/match-editing.md)。

## 观察与研究

视频问答先按问题定位，再对缩短后的窗口密集观看；深度研究结合输入观察、检索、候选核实和证据整理。所有观察都用 `video_observe`，无需在本地与远程工具之间选择。转写继续复用共享实现。

`video-edit` MCP 返回 `structuredContent`、`isError` 和实际图片。`image_delivery` 列出已返回、因预算省略或读取/解码失败的图片；`image_delivery_status=partial` 表示交付不完整。损坏的图片不会作为 ImageContent 返回，MIME 类型取自实际解码的格式。转写和创作引语保留源的原始措辞；服务诊断使用中性名称。CLI 输出相同的业务状态和数据，图片以路径给出，供本地查看。时间参数一律以秒为单位；`fps` 与 `num_frames` 互斥。帧标签和 `time_s` 对应实际解码帧的源时间（误差在一个源帧以内）。`include_transcript` 的整文件识别结果按源文件字节和语言缓存在 `.video_agent/observe_transcripts/` 下，同一来源的后续窗口不会再次识别；同一来源的多个窗口并行观察时，会等待同一次识别完成。`video_compare` 的 `crop` 只接受 `default` 或形如 `w:h[:x[:y]]` 的算术表达式。

插件的 hook 包括启动时的环境检查、媒体路径提示和长时间创作的会话计时；录屏复刻任务还会额外启用专用 hook。复刻时最终构建必须通过，视觉和交互质量仍需单独验证。

审查类子 agent（`c2v-reviewer`、`c2v-3d-reviewer`、`v2c-verifier`）有边界约束：不调用 MCP、不委派、只能写 `out/reviews/` 下的文件，并有轮次预算。这些约束只有在 Claude Code 和任务 harness 下才由 hook 强制执行，因为它们会把子 agent 事件和 agent 身份传给 hook。ZCode 不发送 `SubagentStart`/`SubagentStop`，也不提供 `agent_id`/`agent_type`，所以在 ZCode 下这些边界只是 agent 提示词里的要求，而不是强制限制。审查者保留了 `Bash`，因为要用 PIL 裁剪和放大图片。

## 长任务与恢复

通过 MCP 首次调用 `transcribe`、`tts_generate`、`image_generate`、`video_generate`、`video_render`、`detect_shots`、`build_film_index`、`synthesize_narration`、`produce_film`、`model3d_generate`、`swap_storyboards` 或 `swap_generate` 时，会立即返回 `data.job_id` 和任务状态。此时只是完成了提交，还没有最终媒体。用同一个工具传 `job_action=status, job_id=...` 查询；任务完成后会返回完整的业务结果和实际图片。任务的终态在 `data.job.status`；首次提交的状态在 `data.status`，业务结果里的同名字段不是任务终态。`job_action=list` 列出本项目该工具的任务，每行只有 `job_id`、`status` 和 `job` 状态，业务结果仍需用 `status` 获取。`job_action=cancel` 把任务标记为已取消：正在进行的调用无法中止，会在后台跑完，结果被丢弃。其他工具默认等待完成，也可以用 `job_action=submit` 显式提交。

任务在 MCP 服务进程内的后台线程中运行：没有子工作进程，也不依赖 `/proc`，因此 Linux、macOS 和 Windows 行为一致。任务记录在 `.video_agent/jobs/`；运行中的任务每 5 秒写一次心跳，其他进程（CLI、重启后的 MCP 服务）据此判断任务是否仍在运行；心跳超过 30 秒未更新则报告为 `interrupted`。重启 MCP 服务会中断正在运行的任务：用相同参数再调用一次即可；视频镜头、3D、TTS 和人物替换窗口会从各自的记录中恢复已提交的任务，图片和 ASR 则重新执行。每个项目同时最多运行 2 个长任务（`VE_MCP_WORKERS`）；达到上限时，新的长工具调用或显式 `submit` 会排队等待空闲槽位，最长 `VE_MCP_QUEUE_SECONDS`（默认 120 秒），超时则返回 `project job worker limit reached`。短工具在线程中内联执行，不占任务槽位。命令行是一次性进程：在命令行里 `job_action=submit` 会一直运行到结束。单个 MCP 请求的上限是 900 秒；生成、ASR 和渲染的等待都在后台任务中进行。

发给 MCP 客户端的工具 `inputSchema` 根部是普通对象（没有 `anyOf`/`oneOf`/`allOf`，也没有根级 `required`）；`job_action` 和 `job_id` 是普通的可选属性。必填的业务参数写在工具描述里，由服务端校验：`status`/`cancel` 只接受 `job_id`（同时传业务参数会被拒绝，报 `job controls cannot include business arguments`），`list` 不接受其他参数，新的调用不能带 `job_id`。违反时返回单行的 `invalid arguments: ...` 或相应的互斥错误。

CLI 默认同步运行。业务失败或参数读取/校验失败会打印结构化错误并以 1 退出；成功以 0 退出。schema 中声明为字符串的参数（如 `--query 2024`、`--source 12345`、`--job-id`）保留字面文本，不会转换成数字。`--job-action submit/status/list/cancel` 使用同一套任务协议。中断不会自动产生新请求：已有任务 id 的视频候选会用原来的 take_id 恢复；缺少任务 id 或无法确认上游结果时，该镜头保持 reserved/interrupted 状态，需要先核对服务端记录。没有可恢复任务 id 的图片和语音接口同样需要人工核对；取消本地等待不会取消服务端计费。

ASR 派生音频缓存绑定源文件 SHA、转换参数和实际音频 SHA；没有绑定或被修改过的旧缓存会重新抽取。实际上传的字节会被冻结并与绑定核对。输出包含 `asr_audio_sha256` 和识别前的源文件 SHA-256；识别结束时会再次检查源文件，若已变化则保留旧输出并报错。字幕和语音索引会拒绝缺少摘要或已过期的转写；旧转写需要对当前源文件重新识别。默认的 ASR 输出使用独立目录；显式重叠的输出由文件锁保护。最终带字幕的成片可以经渲染溯源链追溯到时间线、原始剪辑、转写和字幕条目，并可直接进入 `creation_review`。

在当前的创作方案中，请求未显式指定关键帧时，关键帧会自动进入生成；方形画布使用 1:1。导演目标改变后要重新评审已有镜头，需要 `creation_verify action=prepare reassess=true`；原始生成配方保留，证据和结论按修订版本存储。过长或冲突的配音会明确失败；图片画幅不对不会自动触发第二次提交。

提交账本中的派生音频和链式引用只能按原始 SHA 只读复用；引用损坏或被改动时，请恢复原始字节或新建候选，不要删除账本后重试。实际补过静音的音频按源/输出 SHA 绑定，并在提交时按最终时长检查限制。编译器升级后，如果请求身份的其余部分完全相同，仍可收取原先提交的任务，不会自动产生新请求。

预算以一个项目、一个候选目录和一套固定上限为单位；生成和编辑共享预留额度，恢复原任务不会再次预留。只有一个旧候选账本时可以自动采用；有多个账本时，需要先核对累计预留额度和服务端任务。独立的生产预算使用独立的项目；移动方案或更改输出目录不能重置预算。

旧的评审证据缺少修订版本/语音 SHA 绑定，或证据依赖已变化时，需要重新执行 prepare/record，旧的通过结论不能沿用。`unavailable`、`skipped` 或 `excluded_thin` 不能证明音色一致、音频静音或没有台词。单元 ID 不能包含绝对路径、路径分隔符或控制字符。

## 兼容性与已知限制

- 文件锁、暂存和回滚能处理普通异常；在 SIGKILL 或断电时，不保证多个文件作为整体原子发布。恢复时仍会核对 SHA 和来源绑定。
- verdict/evidence 签名用于发现过期或不匹配的证据，无法防止恶意伪造；结构校验和本地回归测试也不能证明内容、审美或音色判断是正确的。
- 时间线音频渲染仍会为每条声音轨道构建完整长度的音频底；在多轨长项目上的资源开销还需要专门的压力测试和优化。

## 环境变量

对外的 ASR provider 名为 `asr`，使用已登录 ZCode 账号的语音识别服务，无需 key：本地音频先上传（mp3/wav 每个不超过 10 MiB；其他格式或更大的文件先抽成 16 kHz 单声道 mp3），再提交识别；超过 30 分钟的素材按约 28 分钟分片识别后合并。该服务没有语言参数，`language` 只会被记录。TTS 使用已登录 ZCode 账号的配音服务（24 kHz WAV），无需 key：`VE_TTS_VOICE` 设置默认音色（默认 `zixinnansheng`），共有 12 个预设音色，列在 `tts_generate` 的工具描述里。服务不接受风格指令，所以 `style_instructions` 只会被记录，不起作用；语速用 ffmpeg 在本地调整。长文本按句切分，逐段合成后拼接。复用音色并不意味着支持用提供的样本克隆音色。TTS 请求按内容记账：相同的请求会复用已记录的音频。

配置从进程环境变量和 `.env` 文件读取。优先级为：进程环境 > 项目目录的 `.env` > 插件目录的 `.env`。ZCode 服务地址（`ZCODE_BASE_URL`）由宿主注入，从不从 `.env` 读取。插件没有内置代理；网络代理取自进程环境。模板见 `.env.example`。

常用变量：

- `VE_TTS_VOICE`：默认配音音色
- `VE_NARRATION_TTS_RATE`：电影解说配音的语速覆盖（音色始终取自 `VE_TTS_VOICE`）
- `VE_BGM_DIR`：`video_render kind=narrated` 使用的音乐库
- `VE_PROJECT_DIR`
- `VE_MCP_WORKERS`：每个项目同时运行的长任务上限（默认 2）
- `VE_MCP_QUEUE_SECONDS`：达到上限时，长任务等待空闲槽位的时长（默认 120 秒）
- `VE_OBSERVE_MAX_FRAMES` / `VE_OBSERVE_FRAME_WIDTH`
- `VE_MAX_INLINE_IMAGES` / `VE_MAX_INLINE_IMAGE_BYTES`
- `VE_VIDEOSITES_MEDIA_DIR`
- `VE_FONT_DIRS` / `VIDEO_EDIT_FONT_DIRS`：字体目录，用操作系统的路径分隔符分隔

## CLI

CLI 与 MCP 共用同一套实现：

```bash
python plugins/video-agent-kit/cli/video_agent_tool.py transcribe --input_path input.mp4 --language zh --pretty
python plugins/video-agent-kit/cli/video_agent_tool.py tts_generate --text "旁白文本" --voice zixinnansheng --output_path out/narration.wav --pretty
```

观察与检索示例：

```bash
python plugins/video-agent-kit/cli/video_agent_tool.py video_observe --source input.mp4 --start-s 10 --end-s 20 --fps 2 --layout frames --pretty
python plugins/video-agent-kit/cli/video_agent_tool.py video_search --query "waterfall landscape" --pretty
```

剪辑示例：

```bash
python plugins/video-agent-kit/cli/video_agent_tool.py timeline_validate --timeline-path out/timeline.json --pretty
python plugins/video-agent-kit/cli/video_agent_tool.py video_render --kind timeline --timeline-path out/timeline.json --output-path out/preview.mp4 --pretty
python plugins/video-agent-kit/cli/video_agent_tool.py video_qc --source out/preview.mp4 --timeline-path out/timeline.json --pretty
```

共享渲染器目前输出 MP4。时间线渲染支持多条视频/音频/文字/图片轨道、位置、变速、音量、不透明度以及片段淡入淡出（作用于视频、图片叠加和音轨片段）。画布取自 `sequence.width/height`（或 `output_canvas`）；两者都未声明时，才使用第一个视频源的尺寸。片段或轨道上的效果数组、全局转场、fade/crossfade/dissolve 以外的转场类型、文字片段上的转场、启用的未知类型轨道，以及指向无音频源的音轨，都会被拒绝而不是静默忽略。口播渲染复用时间线执行；目前使用硬切、保留源帧率，并输出与实际剪辑和方案绑定的 `.transcript.json`。字幕阶段使用返回的 `output_transcript`。partial 单元必须修正并核实，否则需要对成片重新转写。

字幕支持 burn/soft/both；软字幕文件名带 `_softsubs`，请从结果中读取实际路径。渲染会根据字幕包中记录的 `ass_path`/`srt_path` 重建附属文件；报告里的路径是已发布的文件。字幕文本中的反斜杠和花括号按字面显示；软字幕轨的语言标签写在新加的轨道上（两字母代码会转换为 ISO 639-2）。带旋转元数据的源按显示尺寸排版。软字幕 QC 检查的是实际的定时文本轨，但显示效果仍需在播放器里确认。普通视频技术 QC、字幕 F/T 和精简 S/A/V 内容检查遵循各领域工作流；看图片和波形不等于听过音频。

默认每次调用使用独立的产物目录（未写入任何内容的默认目录会被清理，渲染暂存文件在发布后删除）。通过 MCP 时，长工具在 MCP 服务进程内以后台任务运行（见「长任务与恢复」；直接调用 CLI 时在 CLI 进程内运行），输出路径由跨进程文件锁保护：并发写同一输出的后一次调用会立即失败，报 `output is owned by another active job`，调用方应换一个路径或串行重试。渲染在校验输入快照后发布成片；QC 会拒绝已记录的源文件、方案、字幕条目或成片发生变化，只检查字幕数据时，也会核对字幕包中记录的转写和来源。`timeline_validate` 和 `video_qc` 的失败结论，以及被拒绝的 `timeline_patch` 差异，会写入 `output_json` 并保留（结果同时标记为失败）；只有执行错误才会回滚到调用前的文件。报告路径不能指向已存在的非 JSON 文件。依赖文件需要随项目保存；输入被移走后，旧报告就无法再证明完整的绑定关系。

安装依赖：

```bash
python3 -m pip install -r plugins/video-agent-kit/requirements.txt
python3 -m pip install --no-deps -r plugins/video-agent-kit/requirements-nodeps.txt
```

第二条命令安装镜头检测（`scenedetect>=0.7`）。它必须使用 `--no-deps`：scenedetect 声明依赖桌面版 `opencv-python`，会覆盖插件使用的 `opencv-python-headless`。`/setup-guide` 已经按这种方式安装。中文解说字幕需要 CJK 字体，可以通过 `VE_FONT_DIRS` 提供。

## 聚合的子方向工具

MCP 和 CLI 都读取 `mcp/ve_tools/catalog.py` 中的工具目录。目录目前包含 `speech`、`understanding`、`editing`、`creation`、`model3d`、`recap` 和 `swap` 工具组，两个入口默认读取同一套工具。新实现应优先复用共享能力；功能相近的工具在注册前要统一语义、参数和名称。

接入新的子方向时，把对齐后的 schema 和实现组织成一个 `ToolGroup`，注册到 `catalog.py` 的 `TOOL_GROUPS` 中。注册时会检查 schema 与实现的名称是否一致、实现是否可调用，并拒绝不同组中的同名工具；同名能力必须先去重或改成兼容的名称再注册。

新增能力后，要同时更新相关的技能、命令、hook、环境配置和依赖说明。

## 创作工具与配置

`creation_plan_validate`、`image_generate`、`image_crop`、`video_generate`、`creation_verify`、`creation_timeline_build`、`creation_review` 和 `voice_compare` 是对外的创作接口。`creation` 组还注册了 `title_cards`（`action=plan|render`），用于在渲染好的成片上合成人名/地名卡。`video_generate` 根据 `action` 生成或编辑不可变的候选；`creation_verify` 根据 `action` 准备或记录候选的证据、状态或额外诊断；`creation_review` 准备真实的剪切点图片，并校验整片结论。ASR/TTS、观察、时间线校验、渲染和 QC 共用现有工具。

图片和视频来自已登录 ZCode 账号的生成服务，无需配置（视频 4–30 秒、480p、无音轨）。不包含私有网关、凭据、歌曲或自动下载的人脸模型。普通代理由 HTTP(S)_PROXY/NO_PROXY 控制。项目之间通过 `VE_PROJECT_DIR` 隔离；同一项目内的创作操作互斥。

生成候选需要 v2/v3/v4 方案和固定的累计预算；失败和中断都计入预留额度，已提交的任务不会自动重新提交。候选、评审图片和方案绑定当前的参考字节；只有当前评审通过的源片段才能进入创作时间线。片内字幕需要真实的转写时间；失败或预算耗尽时保留未完成状态。结构校验不能证明内容或审美判断是正确的。

核心依赖都在共享的 requirements 中。创作的音色卡检查默认使用 CAM++：有挂载的 ONNX 图（`VE_SPEAKER_MODELS_DIR`）时使用它，否则用 numpy 运行来自 ModelScope 的同一份官方权重，首次使用时自动下载（约 28 MB，缓存在 `~/.video_agent/models`），无需安装任何东西。可选的 `requirements-voice.txt`（librosa）只用于较早的 mfcc_f0 / resemblyzer 评分器。可选的 `requirements-face.txt` 配合显式 `VE_FACEQC_DIR` 中的 ONNX 模型，提供人脸参考诊断。这些没有安装时，对应能力会明确标为缺失；请通过实际观看和收听来评审，不要把 skipped 当作 pass。

## 3D 资产工具

`model3d_generate`（`model3d` 工具组）调用已登录 ZCode 账号的 3D 生成服务。`operation` 选择一个步骤：`generate`（前、左、后、右四视图或单张图片 → 带贴图的 GLB）、`rig`（自动绑骨；`rig_type=auto` 会先免费检查能否绑骨）、`animate`（对绑骨结果应用最多 5 个预设动画）。每次调用只创建一个任务；产物在 `out/model3d/<output_name>/`（`model.glb`、`preview`、`task.json`），后续步骤通过上一步的 `output_name` 引用它。

不需要 key。提交前会记录请求 key 和请求体，所以中断后用相同参数再次调用，会用原来的 key 找回原任务；任务 id 落盘后，用相同参数再次调用会复用已完成的文件，或收取仍在运行的任务，不会创建新任务；同名下的不同请求需要换一个名字或使用 `force`。项目内的用量记录在 `.video_agent/model3d_usage.json`；达到项目上限 `VE_MODEL3D_USAGE_CAP`（默认 1000）后，新的调用会被拒绝。

## 电影解说工具

`recap` 工具组由同一个 `video-edit` MCP 服务和 CLI 提供：`detect_shots` → `build_film_index` → `arrange_footage`（dialogue/arrange/anchor）→ `synthesize_narration` → `bind_narration` → `video_render kind=narrated` → `video_qc`（`timeline_path` 指向 shots.json，用于检查渲染溯源），或由 `produce_film` 编排整个流程。镜头检测、编排和绑定不调用模型；配音调用 TTS；回听校验和索引调用 ASR。`bind_narration fit_mode=whole_shot` 补进来的填充镜头和长镜头部分会放在 `data.needs_review` 中，等待对照预览实际复核，并通过 `produce_film approve_segments` 或 `avoid_shot_ids_by_seg` 处理。

电影解说的文本审查、画面检查和成片抽查由运行时的子 agent 完成（插件 `agents/` 下的 `recap-observer`、`recap-text-reviewer` 和 `recap-final-reviewer`）：`recap/` 下的阶段脚本写出任务文件，并校验子 agent 写回的报告。它们不调用独立的审查模型，也不作为 MCP 工具暴露。方法见 [video-recap-workflows](skills/video-recap-workflows/SKILL.md)。

## 第三方代码与许可

本插件采用 MIT 许可（[LICENSE](LICENSE)）。第三方内容及其许可和修改说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)：

- `mcp/ve_tools/campplus_net.py` 和 `campplus_numpy.py`：来自 ModelScope 的 CAM++ 说话人验证网络（Apache-2.0，全文见 [LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt)），经过精简并用 NumPy 重新实现。
- CAM++ 权重（`iic/speech_campplus_sv_zh-cn_16k-common`，Apache-2.0）：不随插件分发；首次使用音色卡检查时从 ModelScope 下载一次。
- `skills/web-replicate/templates/*/template/src/components/ui/*`：shadcn/ui 组件（MIT）。
