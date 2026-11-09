# video2code

[English](./README.md)

`video2code` 把一段网页录屏复刻成可运行的网页。给它一个网站的 `.mp4` / `.webm`，或者直接给网站 URL，它会逐帧观察录屏、写出显式的复刻契约、脚手架出一个 React + TypeScript + Tailwind 项目、构建、本地部署、给自己的成果录像，再把两段录像对照验证之后才算收尾。

录制由 ZCode 内置的 Browser Use WebView 完成（原生产出 WebM），再用 `ffmpeg` 转成 MP4。**不使用也不安装 Playwright 或独立的 Chromium。**

## 快速开始

1. 从 ZCode 插件管理器安装本插件。
2. 首次运行前检查机器环境：

   ```text
   /video2code:env-check
   ```

   `/video2code:env-check --fix` 会额外把体检脚本能安全处理的项装上（pip 包、`node_modules` 预热）。它不会擅自安装 `ffmpeg`、Node.js 这类系统软件——那些只会打印安装命令，由你自己执行。
3. 从本地录屏复刻：

   ```text
   /video2code:replicate recordings/landing.mp4
   ```

   也可以直接从 URL 开始——插件会先录制该网站，再走复刻流程：

   ```text
   /video2code:replicate https://example.com
   ```
4. 检查 `out/` 下的三件套：`plan.md`（复刻契约）、`verify.jsonl`（逐项验证证据）、`report.md`（最终报告）。构建出的应用在 `app/`，录像在 `recordings/`。

## 命令

| 命令 | 作用 |
| --- | --- |
| `/video2code:env-check [--fix]` | 环境体检：Python 视频包、`ffmpeg`/`ffprobe`、Node/npm、npm registry 连通性、webapp 模板缓存。 |
| `/video2code:record <url> [输出名]` | 用内置 WebView 把网站动效录成 WebM，再转码成 `recordings/<name>.mp4`。 |
| `/video2code:replicate <视频或URL> [catalog.json]` | 前端复刻：观察 → 切片 → 计划 → 构建 → 给自己的成果录像对照验证。 |
| `/video2code:replicate-fullstack <视频或URL> [catalog.json]` | 全栈复刻：在上面流程之上加一个 Express/SQLite 后端，用录像和 `curl` 双叉验证。 |

## Skills

| Skill | 职责 |
| --- | --- |
| `env-setup` | 环境体检与安装的唯一入口。 |
| `url2video` | URL → WebM（内置 WebView）→ MP4（`ffmpeg`），含踩点、编排、审片闭环。 |
| `video2code` | 基础复刻工作流：布局、视觉风格、交互、动画。 |
| `video2code-3d` | 面向 WebGL/three.js 页面的叠加扩展：效果配方库、无 GPU 软渲染预算、3D 专属验证规则。 |
| `video2fullstack` | 把操作录屏复刻成前后端俱全的可运行项目。 |
| `web-replicate` | 脚手架 React + TypeScript + Vite + Tailwind v4 + shadcn/ui 项目。 |

`video2code` 与 `web-replicate` 设计为成对加载。只有在参考页面确认是真 WebGL 场景时，才把 `video2code-3d` 作为第三个 skill 加载。

## MCP 服务与工具

两个 stdio MCP 服务，在 [`.mcp.json`](./.mcp.json) 和插件清单里都有声明。拆成两个的理由：CPU 密集的抽帧不会堵住部署工具的单线程队列。

**`video`**（工具超时 300 秒）—— 读视频，产图即内联给模型看：

- `ingest_video` —— 整片摄入：按确定性时间点抽帧，拼成带时间戳的 contact sheet。
- `clip_video` —— 对指定时间窗做更高密度的复看。
- `still_crops` —— 从静帧上裁出局部区域。裁剪矩形使用源图像素坐标，越界部分会截去；完全位于图外的区域不生成图片或素材。`still.py` 命令行脚本采用相同边界。
- `composite_view` —— 源视频与复刻结果的对照拼图。

**`runtime`**（工具超时 600 秒）—— 伺服与供料：

- `deploy_website` —— 用本地 `http.server` 伺服构建产物 `dist/`。重部署复用同一端口和 URL，避免浏览器反复重新导航；产物里引用了不存在的 `/assets/...` 图片时会拒绝上线。
- `get_asset` —— 从素材清单取资产。**只有存在素材清单时才注册**（项目里的 `assets_catalog.json`、`V2C_CATALOG_PATH`，或 `V2C_HAS_CATALOG=1`）；否则这个工具根本不暴露。

## Hooks

四个都是 `command` 类型，用 `python3` 执行 [`hooks/`](./hooks) 下的脚本。

| 事件 | 脚本 | 行为 |
| --- | --- | --- |
| `SessionStart`（`startup\|clear\|compact`） | `env_check.py` | 把插件根路径和缺失依赖清单输出进会话上下文，并在后台预热 webapp 模板。**从不阻塞。** |
| `UserPromptSubmit` | `check_video_input.py` | prompt 里出现本地视频路径时注入摄入引导。只做检测和廉价探测，不抽帧。仅提示。 |
| `UserPromptSubmit` | `check_url_input.py` | prompt 里同时出现网站 URL **和**任务词（复刻/录制/replicate/record…）时注入 `url2video` 引导。仅提示；本地视频路径与 URL 并存时不注入。 |
| `PreToolUse`（`Write\|Edit`） | `check_plan_first.py` | `out/plan.md` 不存在时**拦住**对 `app/src/` 的写入，保证组件代码不会先于契约落地。其余写入一律放行；同规则连拦 3 次后自动放行。 |
| `Stop` | `check_closeout.py` | 复刻契约未闭环时**拦住**收尾，规则复用 `skills/video2code/scripts/contract_audit.py`，避免两份实现漂移。`out/plan.md` 不存在或 `V2C_NO_CLOSEOUT_HOOK=1` 时整体跳过。 |

## 环境要求

- Python 3.10 或更高版本，以及 [`requirements.txt`](./requirements.txt) 里的包：`mcp==1.9.0`（2.x 删除了本插件使用的 `Server` decorator API）、`opencv-python-headless`、`numpy`、`pillow`。
- `PATH` 上要有 `ffmpeg` 和 `ffprobe` —— 摄入、抽帧、时长探测、WebM → MP4 转码都依赖它。版本不挑，4.x 起都行。
- Node.js 20 或更高版本（Vite 7 要 20.19+/22.12+）和自带的 npm，用于构建 webapp 模板。
- npm registry 可达。
- 浏览器交互和录制不需要额外安装：跑在 ZCode 内置的 Browser Use WebView 上。

不要手工逐项确认，直接跑体检脚本：

```bash
python3 skills/env-setup/scripts/env_doctor.py
python3 skills/env-setup/scripts/env_doctor.py --fix
```

## 副作用、网络访问与数据

启用本插件等于授予代码执行信任。具体地，它会：

- **执行命令** —— `ffmpeg`/`ffprobe` 做转码与抽帧；`skills/web-replicate/scripts/init-webapp.sh` 会执行 `npm install` 拉起 `node_modules`。
- **写文件** —— `recordings/`（WebM 与 MP4）、`app/`（脚手架项目）、`out/`（`plan.md`、`verify.jsonl`、`report.md`，以及 `out/cmp/` 下的对照图）、`.v2c/`（插件根路径指针与 hook 状态，含 `.v2c/hook_state/interceptions.jsonl`），以及 `/tmp/webapp-node-modules` 下的 `node_modules` 缓存（可用 `NM_LOCAL_ROOT` 改）。
- **监听本地端口** —— `deploy_website` 在 8765 或之后第一个空闲端口起 `http.server`，只监听本地，MCP 服务进程退出时统一清理。
- **访问网络** —— 安装模板依赖时访问 npm registry；以及你让它录制的目标网站。
- **不上报任何遥测**，不需要 API key、token 或账号。插件里没有任何凭据，也不会把内容上传到任何地方。

## 用户配置

| 配置项 | 默认值 | 作用 |
| --- | --- | --- |
| `media_resolution` | `medium` | `clip_video` 内联给模型的每帧分辨率档位：`low`（约 70 token/帧）、`medium`（约 256）、`high`（约 786）。 |
| `clip_max_frames` | `400` | 一次 `clip_video` 调用所有 segment 累计抽帧上限；超出后按比例降帧。 |

两者以 `V2C_MEDIA_RESOLUTION` 和 `V2C_CLIP_MAX_FRAMES` 传给 MCP 服务。

## 第三方内容

`skills/web-replicate/templates/default/` 和 `templates/default-3d/` 是内置到本插件的项目模板。它们的 `package.json` 声明了 React 19、Vite 7、TypeScript、Tailwind CSS v4、Radix UI / shadcn/ui 组件、framer-motion、lucide-react、recharts、zod，`default-3d` 还额外包含 three.js。这些依赖均为 MIT 许可，且在脚手架时从 npm registry 安装；插件包里只包含模板源文件本身。

## 许可

MIT，见 [`LICENSE`](./LICENSE)。
