---
name: jupyter-notebook
description: Work with Jupyter notebooks (.ipynb) in the Jupyter Notebook side panel — create, read, edit and run cells on a Jupyter Server, together with the user. Use when the user wants a notebook, asks to analyse data or prototype in Jupyter, mentions a .ipynb file or a running JupyterLab / Jupyter Server, or when the panel sends a message about a notebook cell.
---

# Jupyter Notebook

Notebooks live on a Jupyter Server and are shown in the Jupyter Notebook side panel, where the user can edit and run cells too. Use this plugin's tools for .ipynb files: never edit .ipynb JSON with file tools, and do not start `jupyter` yourself in a shell.

## 1. Get a server

1. Call `list_servers`. It shows connected servers and Jupyter servers running on this machine.
2. If the user named a server or pasted a URL (with or without `?token=…`), call `connect_server` with it. A server listed as running on this machine needs no token.
3. Otherwise, if a running server's root contains the notebooks you need, offer to use it; if there is none or the user wants a private one, call `start_server`. It needs a Python with `jupyter-server` and `ipykernel`. On `jupyter_not_installed`, show the user the message and ask whether to install them into the project environment (or retry with `useUv: true` if they use uv); the panel also lists what is missing and can send you a setup request. Do not install packages without asking — a message from the panel starting *Set up Jupyter for the Jupyter Notebook panel* is such a request (see section 6).

Paths are relative to the server root. For a server from `start_server` that is the workspace.

## 2. Open and read

- `open_notebook` opens a notebook in the panel and returns its cells; pass `create: true` for a new one. `list_notebooks` browses folders.
- Cells are listed as `[index] type id=<id> rev=<revision>`. Always address cells by `id`; indexes shift.
- Call `read_notebook` before editing if anything may have changed — the user edits in the panel too. Use `cellIds` to read specific cells in full and `includeImages: true` to look at plots.

## 3. Edit

`edit_notebook` takes a list of operations applied together:

- `insert` with `source`, `type` (code / markdown / raw) and `after` / `before` a cell id or `index` (default: append),
- `update` with the cell's complete new `source` (add `expectedRevision` from your last read when the user may be editing the same cell),
- `move`, `delete`, `set_type`, `clear_outputs`.

Keep cells focused: imports and setup first, one step per cell, markdown cells to explain the analysis. Prefer editing an existing cell to adding near-duplicates. On `revision_conflict`, read the notebook again and redo the edit on the current content; never overwrite the user's work blindly.

## 4. Run

- `execute_cells` with `cellIds` (in order) or `all: true`. It starts the kernel if needed, waits (default 300 s) and returns each cell's outputs, with plots attached as images. After an error, later cells in the batch are skipped — fix the failing cell and run again.
- If it returns "still running", the cells keep running in the background. Tell the user, check later with `read_notebook`, or stop with `interrupt_kernel`.
- `restart_kernel` clears all state (`runAll: true` reruns everything). Use it when imports or state are stale, after asking if long computations would be lost.
- `list_kernelspecs` / `set_kernel` switch to another kernel (language or environment).
- Missing packages: report the `ModuleNotFoundError` and ask before installing (for example `%pip install <package>` in a cell installs into the kernel's environment).

## 5. Report

Summarise results in a few sentences in the chat and refer to cells by their index; the outputs are visible in the panel, so do not paste whole tables or tracebacks. When the panel says the user ran into an error in a cell, read that cell, fix it with `edit_notebook`, and run it again.

Saving is automatic. On `save_conflict` the file changed on the server (for example in JupyterLab): ask the user whether to keep this version (`save_notebook` with `overwrite: true`) or load theirs (`open_notebook` with `reload: true`).

## 6. Setting up Jupyter

When the user asks you to set up Jupyter — usually with the panel's message, which names the project's Python, whether uv manages it and which packages are missing — follow its steps:

- Install `jupyter-server` and `ipykernel` into the workspace's environment with the command the message gives (`uv add --dev jupyter-server ipykernel` in a uv project, `uv pip install --python .venv …` for a uv environment without `pyproject.toml`, otherwise `<venv python> -m pip install …`). Never install into the system Python; if the workspace has no virtual environment, create one first (`uv venv`, or `python3 -m venv .venv`).
- Confirm with `<python> -c "import jupyter_server, ipykernel"`.
- Call `start_server`; the panel switches to the notebook list once the server is up.
