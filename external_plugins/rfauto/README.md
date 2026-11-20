# RFAuto · ZCode plugin

[简体中文](README_CN.md)

Drives the [RFAuto/rfauto](https://github.com/geer1895/rfauto) RF/microwave EDA
framework from a ZCode session: closed-form synthesis, multi-engine simulation
jobs, quality gates and result verdicts. Every physical number (frequency, loss,
geometry) comes from the rfauto deterministic kernel and solvers. The language
model does not generate them.

- Author: [geer1895](https://github.com/geer1895)
- License: GPL-3.0-only

## Components

| Component | Purpose |
|---|---|
| MCP server (`rfauto`) | The rfauto MCP server with 208 tools: device synthesis, simulation jobs, metric readout, quality gates, reports. It also exposes the toolset directory and the 7 device cards as resources |
| `rfauto-mcp-navigator` skill | Tool navigation. Lists 18 commonly used tools up front; the other tools are grouped into 14 toolsets in a reference file. Use at session start or when unsure which tool to call |
| `rf-verdict` skill | Judges simulation results from any origin (human, script or agent) and returns TRUSTED / SUSPECT / STALE / UNVERIFIABLE with per-gate evidence. Use when deciding whether a result can be trusted |
| `rf-judge` agent | Read-only verdict sub-agent with a fixed whitelist of quality-gate tools (runs_verify, em_doctor_check, em_metrics_from_run, ...). Dispatch it for an independent verdict |
| `/rf-check` command | Runs the verdict workflow on one run directory or Touchstone file |
| 7 device skill cards | Wilkinson power divider, branchline coupler, rectangular patch antenna, PIFA, CPW, microstrip synthesis, Verilog-A authoring (from the rfauto repo). Use when a request names one of these devices |

## Usage

For a person:

1. In a session, type `/rf-check <run directory or .sNp file>` to get a verdict report.
2. Ask: "run the rfauto doctor tool". A successful call returns rfauto's environment envelope.
3. Ask for a design, for example "Design a 2.4 GHz Wilkinson power divider with rfauto". The matching device card loads automatically.

For an agent:

- Skills load on their own when a request matches their description. The trigger terms are listed in each `SKILL.md`.
- Ask it to "use rf-judge" to get an independent verdict on a run.
- Tools are named `mcp__plugin_rfauto_rfauto__<tool>`. `tools/list` returns all 208.

## Requirements

- A ZCode client with plugin and MCP support.
- Python 3.10–3.12 with rfauto v0.14.0 installed, once. The command below installs the public release source archive v0.14.0 (commit `3d7b15d`), with its SHA256 checked, so unreleased local changes are not included:

  ```bash
  pip install "rfauto[mcp] @ https://github.com/geer1895/rfauto/releases/download/v0.14.0/rfauto-0.14.0-source.zip#sha256=47b2a7db4a6345d1d92cd038d275d75be3edbd8f40ecd5db327a79c05b8ebe6d"
  ```

  From a clone of the rfauto repository, the upstream route is `pip install -e ".[mcp]"` in the repository root. Alternatively, install the tag directly with `pip install "rfauto[mcp] @ git+https://github.com/geer1895/rfauto.git@v0.14.0"` when git can reach github.com (not verified on the maintainer machine).
- The launcher is started by `python` from `PATH` and needs only the standard library. Make sure that `python` is a Python 3 interpreter.
- HFSS needs Ansys AEDT 2025 R1 and its own license. ADS is a commercial Keysight tool. Neither is bundled.
- openEMS is open source (GPL) and not bundled. Build it from the upstream sources (`docs/openems_build_guide.md`). The built-in `fake` channel needs no license and no external engine. It is a closed-form model, so use it to check the pipeline, not for physics.

## Setup

1. Install the plugin from a marketplace or a local directory source.
2. Point the plugin at an interpreter, either way:
   - In the plugin settings, fill in **rfauto Python 解释器** (`pythonPath`) with a Python that has rfauto installed. Leave it empty to use the launcher's own interpreter. Optionally set **rfauto 源码目录** (`rfautoSrc`) to a checkout's `src/` directory to pin an exact source tree.
   - Or write `launcher.json` into the plugin data directory: `{"pythonPath": "...", "rfautoSrc": "..."}`. The exact path is printed in the `rf_env_doctor` report. If both are set, userConfig wins.
3. Restart the session and ask for "the rfauto doctor tool". You should get rfauto's environment envelope.
4. If the MCP server cannot start, the plugin falls back to a diagnostic server that exposes only `rf_env_doctor`. Call it and follow the report, which gives the exact install command and the setting to change.

## Permissions, network and side effects

- **Plugin network**: none. The plugin makes no network requests itself. The only online step is the pip install above.
- **MCP server network**: rfauto's MCP tools open network connections only in these cases, and each needs your own configuration:
  - remote-machine tools (`remote_probe_machine`, `remote_machine_status`) contact machines you registered (a TCP probe, or SSH through paramiko);
  - campaigns whose stages are routed to remote machines (SFTP upload and download, SSH commands);
  - HFSS runs that target a registered remote AEDT host;
  - a TCP probe of a license server, when a license-server environment variable is set.

  Other network paths in rfauto (LLM chat, literature and model downloads, notification webhooks) exist only in its CLI, workbench or scripts. The MCP tools do not trigger them.
- **Telemetry**: none found in the upstream code.
- **Credentials**: the plugin neither reads nor stores credentials. SSH authentication for registered machines is handled by rfauto through paramiko, using your local SSH setup.
- **Dependencies**: the MCP server needs rfauto's `[mcp]` extra (fastmcp, mcp). Other runtime packages (numpy, scipy, scikit-rf, pydantic and so on) are installed by pip and are not distributed with the plugin.
- **File writes**: simulation runs write their artifacts (`runs/`, dataset and database files) into the current workspace, as rfauto normally does. Remote campaigns also copy files to and from the remote machines. The verdict components (`rf-verdict`, `rf-judge`, `/rf-check`) are read-only.
- **Command execution**: `scripts/serve_mcp.py` finds the configured interpreter and starts `python -m rfauto.mcp_server` as a child process, with stdio passed straight through. If that fails, it falls back to the diagnostic server.
- **Hooks**: none.

## Third-party material: source and license

- This plugin wraps the public capabilities of [geer1895/rfauto](https://github.com/geer1895/rfauto) (GPL-3.0-only). The 7 device skill cards (`skills/rfauto-*`, `skills/veriloga-authoring`) are copied from that repository's `skills/` directory. Their bodies and reference files are unchanged, each keeps its own `LICENSE.txt`, and only the frontmatter `description` and `compatibility` are translated into Chinese. The MCP server process is rfauto's own `rfauto.mcp_server`, unmodified.
- The plugin itself (navigator and verdict skills, agent, command, launcher script, icon) is distributed under GPL-3.0-only, the same as the upstream `LICENSE`.
- Some upstream documents, including `THIRD_PARTY_NOTICES.md`, describe rfauto as MIT. That contradicts the upstream `LICENSE` file and `pyproject.toml`, which both say GPL-3.0-only. This plugin follows the `LICENSE` file.
- The upstream third-party list is incomplete. The license of each installed dependency is in its package metadata.

## Iron rule 7

Every skill and agent here enforces rfauto's core rule: the agent orchestrates, interprets and judges, and every physical number traces back to a tool call. A FAIL is reported as FAIL and is never massaged into a pass.

## Known limitations

- The public repository publishes v0.14.0 as a GitHub Release (source zip) and does not document a PyPI release. The install command is pinned to the v0.14.0 release archive, with its SHA256 checked. When the plugin moves to a newer release, update the command in `.zcode-plugin/plugin.json` and `scripts/serve_mcp.py` together.
- The four verdict states (TRUSTED, SUSPECT, STALE, UNVERIFIABLE) are this plugin's own convention. rfauto has no definition with these names.
- In our test, the MCP server took about 30 seconds from launch to a completed handshake, because the rfauto import chain is heavy. Allow for that on the first call of a session.
