---
name: setup-guide
description: First-run environment guide for the video-agent-kit plugin on a new computer — checks and installs what the plugin needs (Python 3.10+ and its packages, ffmpeg with x264/aac/libass, a Chinese font, Node.js for web replication, optional Blender for 3D), picking a reachable China mirror/CDN automatically, and walks a beginner through the steps only they can do. Use FIRST after the plugin is installed, when the session-start check says the environment is not ready or this computer has not been checked yet, when the user asks to 安装环境 / 配置环境 / 装依赖 / 换国内源 / 环境体检 / setup, or when a tool fails for an environment reason (ModuleNotFoundError, `ffmpeg not found`, `Unknown encoder`, `No such filter: 'subtitles'`, 字幕显示成方块).
---

# Setup Guide

This skill gets a fresh computer ready for the plugin. The person on the other side is usually a beginner: they installed ZCode and this plugin and may never have opened a terminal. Do the work for them where it is safe, ask before anything system-level, and explain each step in plain language.

## Step 0: start the doctor

The doctor is `scripts/env_doctor.py` next to this file, in this skill's base directory (the host shows it when the skill loads; the plugin root is two levels up). It is also announced by the session-start check (`[video-agent-kit] plugin_root: ...`) and written to `.video_agent/plugin_root`. Always call it by absolute path.

```bash
python3 "<skill_dir>/scripts/env_doctor.py"                          # check only
python3 "<skill_dir>/scripts/env_doctor.py" --fix                    # + install the plugin's Python packages
python3 "<skill_dir>/scripts/env_doctor.py" --fix --system --only ffmpeg   # + system software the user agreed to
python3 "<skill_dir>/scripts/env_doctor.py" --fix --with web         # + pre-install web-replication packages
```

- Run it with `python3`, the command ZCode starts the plugin with. The doctor checks that `python3` and the environment it installs into are the same; dependencies installed anywhere else are useless.
- If `python3` itself cannot run, the session-start check printed nothing and no plugin tool exists. Then:
  - macOS: if a dialog asks to install the command line developer tools, the user can click Install, but that Python is 3.9, too old. Run the doctor with `/usr/bin/python3` anyway; it prints a download link for Python 3.12 from a mirror.
  - Windows: `python3` is often the Microsoft Store placeholder. Run the doctor with `python` or `py -3` if either works. Otherwise have the user install Python 3.12 from the Microsoft Store (it provides `python3`), restart ZCode, and type `/setup-guide` again.
- A check takes 5–20 s (it probes download sources); give Bash at least 180000 ms. Installs take minutes: use the maximum timeout (600000 ms), and for long `--system` installs (Homebrew pulls many libraries for ffmpeg) run in the background and read the output file.
- Exit code 1 means the base group is not ready yet, not that the script crashed; read its output.
- `--json` gives the same result machine-readably for a read-only check. The run writes `.video_agent/env_report.json` in the project and `~/.video_agent/env_report.json` for the machine; read those instead of re-checking every turn.

## Workflow

1. **Say what will happen** in one or two sentences: you will check what this computer is missing, install the plugin's Python packages yourself, and ask before installing system software.
2. **Run the check.** Read `能力汇总` (capability summary) first, then `待处理`; each item shows its id.
3. **Match the scope to the user.** The base group is always needed. The web group matters only if they want to replicate websites, games or full-stack apps; the 3D group only for code2video 3D animation. Do not push optional items on someone who does not need them; mention them in one line.
4. **Install Python packages with `--fix`.** It installs the base group's packages into the plugin's Python using the chosen mirror, and switches to the user directory automatically when the system Python is externally managed (PEP 668). Optional groups need `--with <group>`.
5. **System software** (ffmpeg, Node.js, a newer Python, Git Bash on Windows): tell the user what it is for, roughly how long it takes and what they will see (on Windows a permission prompt to click 是; `brew install` asks for nothing). Only after they agree, run `--fix --system --only <the ids they agreed to>`; `--system` never goes beyond the base group unless `--with` or `--only` says so.
6. **Steps marked `需要用户手动完成`** (installing Homebrew, which asks for the login password; `sudo` commands; downloading an installer; changing a user environment variable) cannot be done from here. Give the exact steps from the doctor output; when it lists alternatives, tell the user to pick one. Wait for them to say they are done.
7. **After installing system software or Python, ZCode must be restarted** (fully quit and reopen) before the new program is on `PATH`. Tell the user to type `/setup-guide` again after reopening so you continue where you stopped. If the check still cannot find something the user just installed, that is the reason; do not reinstall.
8. **Re-run the check at the end** rather than trusting install exit codes; the doctor imports every package, so a broken install shows up. Report in capability terms: what works now, what does not, and anything the user still has to do.
9. **Stop after setup.** Start a video task only if the user asked for one; then continue with it once the base group is ready.

## Download sources (mirrors / CDN)

Official download servers are often slow or blocked from mainland China, and a slow download looks like "the install ran for ten minutes and failed". The doctor therefore probes the candidates for each kind of download in parallel, checks that each answer is real content (a 200 placeholder page does not count), and uses the fastest reachable one, preferring domestic mirrors unless they are clearly slower. Outside China it ends up on the official source by itself. The choice is printed on the `下载源` line.

| Kind | Candidates (in preference order) |
| --- | --- |
| pip | Aliyun, Tsinghua, Tencent Cloud, Huawei Cloud, PyPI |
| npm | npmmirror, npmjs |
| Homebrew bottles and API | USTC, Tsinghua, Tencent Cloud, Aliyun |
| Python / Node.js / Blender installers | Huawei Cloud or npmmirror, Aliyun, Tsinghua, then the official site |

- Some mirrors reject some networks (in testing Tsinghua answered 403 to a direct connection and worked through a proxy; Huawei Cloud's Blender folder is a placeholder page). That is why the doctor probes and checks content instead of assuming; never hard-code one mirror.
- Mirrors are passed per command (`pip -i`, `HOMEBREW_*` variables, `npm_config_registry`), not written into the user's global configuration. `pip config set`, `npm config set registry` and `setx` change every project on their machine, so ask first.
- `VE_PIP_INDEX` and `VE_NPM_REGISTRY` override the choice. A source the user already configured (`pip config` index-url, `PIP_INDEX_URL`, a non-default `npm config` registry) is used when it answers: a company network often allows only its internal mirror, and a public mirror passed with `-i` would bypass it. When the configured source does not answer (an old mirror that now refuses this network, a retired registry), the doctor says so on the `下载源` line and uses the auto-picked source for its own install commands only; the user's configuration is left untouched. Tell the user, and ask before changing their configuration.
- A mirror fixes slowness; a proxy fixes blockage. If every candidate fails, it is a network problem: show the `代理` line and ask whether they use a proxy or VPN.

## External services

Speech recognition, voice-over, image and video generation are external services that the platform provides. For now they show as `未接入` until they are connected. Never ask the user to apply for, buy or paste an API key or account. If a feature needs a service that is not connected, say it is not available yet and carry on with what works.

## Rules

- Run the doctor first and install only what it flags; on a ready machine the correct action is nothing.
- Never uninstall packages without asking; an OpenCV GUI build may belong to another project.
- Keep `scenedetect` on `--no-deps`; its declared `opencv-python` dependency overwrites the headless build. It lives in `requirements-nodeps.txt` for that reason, and the doctor's command already installs it that way.
- On macOS install `ffmpeg-full`, not `ffmpeg`: Homebrew's `ffmpeg` has no libass, so subtitles cannot be burned in. The doctor's command installs and links it.
- A missing capability is a report line, not a workaround: no Chinese font does not mean rendering subtitles in English, and no ffmpeg libass does not mean skipping subtitles.
- `–` (`暂未检查`) means a prerequisite failed: fix that first and re-run. `·` means not needed on this OS.
- When the plugin gains a dependency, add it to `requirements.txt` (Python packages; `requirements-nodeps.txt` only for packages that must skip their declared dependencies) or as a `Check` in `env_doctor.py` (system software). The session-start hook reads `cheap_missing()` from the doctor, so the doctor is the single list.

## Talking to beginners

- Use plain Chinese and explain a term in a few words the first time (ffmpeg：处理视频的工具；Node.js：运行网页工程的工具).
- One action at a time, with the expected time and what they will see.
- When they must act, say exactly where: which app to open (终端 / Terminal), what to paste, which button to click, and to tell you when it is done.
- Summarize the doctor output; do not paste it whole.

## Troubleshooting

| Symptom | Cause | What to do |
| --- | --- | --- |
| pip runs for minutes then fails or times out | Slow or blocked download source | Re-run the check so it picks another source; if all fail, it is the network or proxy |
| `externally-managed-environment` | System Python under PEP 668 | The doctor already adds `--user --break-system-packages`; if it still fails, install Python from the python.org installer |
| Every download source "connects to nothing" right after installing Python from python.org on macOS | That Python has no CA certificates yet | Run `Install Certificates.command` in Applications → Python 3.12 (the doctor's 证书 item) |
| Something was installed but is still "not found" | `PATH` not refreshed | Fully quit and reopen ZCode, type `/setup-guide`, re-check |
| `python3` points to an old Python (macOS ships 3.9) | `PATH` order | Install Python 3.12, make sure its directory comes first on `PATH`, reopen ZCode |
| ffmpeg is present but `ffmpeg 字幕/文字滤镜` fails | Build without libass (Homebrew's plain `ffmpeg`) | Install `ffmpeg-full` with the doctor's command |
| Chinese subtitles render as boxes | Font without Chinese glyphs | Follow the doctor's Chinese font item |
| Windows: `python3` opens the Microsoft Store | App execution alias placeholder | Follow the doctor's `python3` item |
| Windows: the web scaffold says `node_modules 不是软链` | Git Bash copies instead of linking | Developer Mode plus `MSYS=winsymlinks:nativestrict` (the doctor's 软链 item) |
| `brew` hangs on "Updating Homebrew" | Auto-update goes to GitHub | The doctor's brew commands set `HOMEBREW_NO_AUTO_UPDATE=1`; use them as printed |
