# Jupyter Notebook for ZCode

[简体中文](README_CN.md) | English

Work on Jupyter notebooks with the agent in the session side pane. The agent creates, edits and runs cells through MCP tools; you edit and run the same notebook in an interactive panel, and both see every change live.

The Git marketplace package contains the compiled MCP server and panel; users do not need to build anything. It needs Node.js 24+, a ZCode Desktop build with Plugin UI support in a local workspace, and a Jupyter Server — either one you already run, or one the plugin starts with a Python that has `jupyter-server` and `ipykernel`. Web, phone and remote workspaces show plain tool records instead of the panel.

## Use

Install and enable `jupyter-notebook`, then ask for example:

- "Create a notebook that loads data.csv and plots the monthly totals."
- "Connect to my JupyterLab at http://127.0.0.1:8888/lab?token=… and open analysis.ipynb."
- "Rerun the notebook from the top and tell me what changed."

You can also open the panel from the side pane "+" menu.

### Servers

- **Running servers**: JupyterLab, Notebook 7 and `jupyter server` instances on this machine are found automatically and connect without a token. Other servers, including remote ones, connect with a URL and token (`connect_server`, or the form in the panel). The token stays inside the plugin process and is never shown to the agent or the panel.
- **A server for the workspace**: `start_server` (or the panel's start button) runs `python -m jupyter_server` bound to `127.0.0.1` with a random token and the workspace as its root. It uses the first Python with `jupyter-server` and `ipykernel`: the plugin setting *Python interpreter*, the workspace `.venv` / `venv`, the active virtualenv or conda environment, then `python3` on PATH. Nothing is installed automatically; `start_server` with `useUv: true` runs it through `uv run --with jupyter-server --with ipykernel`. The server stops when the session ends.
- If a notebook is already open in JupyterLab on the same server, the panel joins its kernel.

### Panel

- **Setup** when no server is running and the workspace's Python lacks `jupyter-server` or `ipykernel`: the panel checks before you click Start and lists the project Python (and whether uv manages it) and each package. **Send to agent** posts a ready-made message with the right install command (`uv add --dev …` in a uv project, `pip` otherwise) so the agent installs them and starts a server; *Install them yourself* shows the command and *Use uv for this session only*. The panel checks again every few seconds and moves on as soon as the packages are there. Connecting to a running server by URL needs no local install.
- The panel follows ZCode's theme: colours, fonts and light / dark mode come from the host.
- One header row: the notebook name opens a switcher for open notebooks, opening and creating notebooks; the kernel status opens the kernel menu.
- Code, Markdown and raw cells with syntax highlighting; Markdown with LaTeX math.
- Each cell says when the agent changed it or is running it; the margin shows whether a cell ran, is running, is queued or failed.
- A running cell's run button turns into a stop button inside a turning ring; queued cells show their place in line. During Run all the kernel status reads "Running 3 of 5", and if the running cell is out of view, a small bar at the bottom of the panel takes you to it.
- Outputs: text with ANSI colours, HTML (tables such as pandas DataFrames), images, SVG, Markdown, LaTeX and JSON. Errors show the exception and the failing line of your cell; the full traceback is one click away. HTML is sanitized and output scripts do not run, so interactive JavaScript outputs (for example Plotly) and ipywidgets show their static fallback.
- Jupyter keyboard shortcuts: Shift+Enter / Ctrl+Enter / Alt+Enter run; Esc and Enter switch between command and edit mode; A / B insert, D D delete, M / Y / R change type, I I interrupt, 0 0 restart.
- Kernel menu: interrupt, restart, restart and run all, clear outputs, change kernel.
- **Reference in chat** (@) adds a cell to the agent's context; **Ask agent to fix** on a failing cell sends the error to the conversation.
- Notebooks save automatically through the server. If the file changes on the server while you have unsaved edits (for example in JupyterLab), the panel asks whether to keep your version or load theirs. If the agent changes a cell while you are typing in it, the panel lets you compare the two versions and pick one.

### Tools

| Tool | Purpose |
| --- | --- |
| `list_servers`, `connect_server`, `start_server`, `stop_server` | Find, connect, start and stop Jupyter Servers |
| `list_notebooks`, `open_notebook` | Browse, open or create notebooks (opens the panel) |
| `read_notebook`, `edit_notebook` | Read cells and outputs; insert, update, move, delete cells or change their type |
| `execute_cells` | Run cells and return outputs, with plots as images; long runs continue in the background |
| `interrupt_kernel`, `restart_kernel`, `list_kernelspecs`, `set_kernel` | Kernel control |
| `save_notebook` | Resolve save conflicts |

Running code in a kernel can do anything the kernel's user can; ZCode asks for approval before tool calls as configured.

## Build from source

The source is in `ui-plugins/jupyter-notebook`. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build
```

Add the absolute path of `dist/local-marketplace` as a local marketplace in the plugin store, then install and enable `jupyter-notebook`. After source changes, rebuild, refresh the source, reinstall the plugin and test in a new session.

Tests (from `ui-plugins/jupyter-notebook`; the integration, smoke and browser tests create a private Python environment with `uv`):

```sh
pnpm test               # unit tests
pnpm test:integration   # against a real Jupyter Server
pnpm smoke              # built MCP server over stdio
pnpm test:e2e           # panel in Chrome through the official AppBridge host
pnpm test:setup         # setup page in Chrome with a real uv environment that lacks the packages
```
