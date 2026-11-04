---
name: colab-cli
description: Use when the user wants headless/terminal control of Google Colab - provisioning CPU/GPU/TPU runtimes, running scripts on Colab VMs, uploading/downloading files, or automating pipelines with the official google-colab-cli. Also use when the user says "colab new", "colab exec", or asks to run heavy code on Colab GPUs without a browser notebook. Does not cover the browser-paired colab-mcp workflow - that is the colab-mcp skill.
---

# colab-cli — headless Colab from the terminal

Official Google repo: https://github.com/googlecolab/google-colab-cli (Apache-2.0). The CLI controls
Colab runtimes via Jupyter/WebSocket protocols; session metadata lives in
`~/.config/colab-cli/sessions.json` (override with `--config`).

## Requirements and platform

- Install with `uv tool install google-colab-cli` (preferred) or `pip install google-colab-cli`.
- **Windows is NOT supported** — Linux/macOS only. On Windows, run it inside **WSL**
  (`wsl -d <distro>` then use `colab` there; files stay in the WSL filesystem for speed).
- Accelerators: T4, L4, G4, H100, A100 GPUs; TPU v5e1/v6e1. High-RAM shapes require
  Colab Pro/Pro+. L4/TPU shapes ignore `--high-mem`.
- Auth strategies via global option `--auth {oauth2,adc}` (default `adc`): OAuth opens a
  browser flow on first run (OAuth client config defaults to `~/.colab-cli-oauth-config.json`);
  ADC uses Application Default Credentials (e.g. `gcloud auth application-default login`).

## Command reference

**Global flags**: `-s NAME` selects a named session for any command; `--auth {oauth2,adc}`.

**Sessions**
- `colab new [-s NAME] [--gpu T4|L4|G4|H100|A100] [--tpu ...] [--high-mem]` — provision a runtime
- `colab sessions` — list sessions
- `colab status [-s NAME]` — show session state / wait until ready
- `colab url [-s NAME]`
- `colab restart-kernel`, `colab stop [-s NAME]` — release the VM
- `colab ssh [-s NAME]` — WebSocket shell, or OpenSSH ProxyCommand for IDEs

**Execution**
- For agent use, prefer `colab exec`: it transmits file contents directly to the kernel —
  no manual upload needed.
- `echo 'print(1)' | colab exec` — run code from stdin
- `colab exec -f script.py [-s NAME]` — run a .py or .ipynb file
- `colab run [--gpu T4] script.py [args...]` — ephemeral job: provisions VM, runs script, tears down
- `colab repl` — interactive; `colab console` — tmux TTY shell

**Files**
- `colab upload [-s NAME] local remote` / `colab download [-s NAME] remote local`
- `colab ls / rm / edit` — remote file management

**Automation**
- `colab install -s trainer torch transformers` — install packages (uv, pip fallback)
- `colab log [-s NAME]` — export session log to .ipynb/.md/.txt/.jsonl
- `colab usage`, `colab pay` — usage/compute points status
- `colab drivemount` — mount Google Drive

## Typical agent workflow (GPU job)

```bash
colab new -s trainer --gpu A100
colab install -s trainer torch transformers
colab exec -s trainer -f train.py
colab download -s trainer checkpoints/model.bin ./model.bin
colab stop -s trainer
```

## Agent tips

- **Always `colab stop -s NAME` when done** — releases the VM so the user's compute points aren't drained by idle time.
- `colab exec -f` sends file contents to the kernel (no upload step); use `colab upload/download` for artifacts like checkpoints.
- Shebang trick for runnable GPU scripts:
  `#!/usr/bin/env -S colab run --gpu L4 --keep`
- For interactive/inspect workflows in a notebook the user has open in their browser, prefer the [[colab-mcp]] skill instead.
