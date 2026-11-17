# RFAuto · ZCode 插件

在 ZCode 会话里驱动 [RFAuto/rfauto](https://github.com/geer1895/rfauto) 射频/微波 EDA 框架，做闭式综合、多引擎仿真作业、质量门和结果判读。所有物理数字（频率、损耗、几何尺寸）都来自 rfauto 确定性内核与求解器，不由大语言模型生成。

- 作者：[geer1895](https://github.com/geer1895)
- 许可证：GPL-3.0-only

## 组件

| 组件 | 用途 |
|---|---|
| MCP 服务器（`rfauto`） | rfauto 的 208 个工具：器件综合、仿真作业、指标读取、质量门、报告。另以资源形式提供工具集目录和 7 张器件卡 |
| `rfauto-mcp-navigator` 技能 | 选工具用。先列出 18 个常用工具，其余工具按 14 个工具集归类，放在参考文件里。会话开始时，或不确定该调哪个工具时用 |
| `rf-verdict` 技能 | 判读任意来源（人工、脚本、其他 agent）的仿真结果，给出 TRUSTED / SUSPECT / STALE / UNVERIFIABLE 四态判定，每道门附证据。要判断某个结果能不能采信时用 |
| `rf-judge` 子代理 | 只读判读裁判，只能调用固定的质量门工具（runs_verify、em_doctor_check、em_metrics_from_run 等）。需要一个独立的判定结论时派发 |
| `/rf-check` 命令 | 对一个 run 目录或一个 Touchstone 文件执行判读流程 |
| 7 张器件技能卡 | Wilkinson 功分器、branchline 耦合器、矩形贴片天线、PIFA、CPW、微带线综合、Verilog-A 编写，来自 rfauto 仓库。遇到这些器件或 Verilog-A 模型的任务时用 |

## 使用

给人：

1. 在会话里输入 `/rf-check <run 目录或 .sNp 文件>`，得到判定报告。
2. 说“用 rfauto doctor 工具体检”。调用成功会返回 rfauto 的环境信封。
3. 提出设计需求，例如“用 rfauto 设计一个 2.4 GHz 的 Wilkinson 功分器”。匹配的器件技能卡会自动加载。

给 Agent：

- 技能按描述自动加载，触发词写在各自的 `SKILL.md` 里。
- 要独立判定一个 run 时，说“派 rf-judge 判读某某 run”。
- 工具名形如 `mcp__plugin_rfauto_rfauto__<tool>`，`tools/list` 返回全部 208 个。

## 环境要求

- 支持插件与 MCP 的 ZCode 客户端。
- Python 3.10–3.12，并装好 rfauto v0.14.0（只需一次）。下面的命令安装公开仓 v0.14.0 的源码包（提交 `3d7b15d`，并校验 SHA256），不包含本地尚未发布的开发改动：

  ```bash
  pip install "rfauto[mcp] @ https://github.com/geer1895/rfauto/releases/download/v0.14.0/rfauto-0.14.0-source.zip#sha256=47b2a7db4a6345d1d92cd038d275d75be3edbd8f40ecd5db327a79c05b8ebe6d"
  ```

  从 rfauto 仓库的克隆安装时，上游文档的做法是在仓根执行 `pip install -e ".[mcp]"`。也可以直接用标签安装：`pip install "rfauto[mcp] @ git+https://github.com/geer1895/rfauto.git@v0.14.0"`（需要 git 且能连通 github.com，本机未验证）。
- 启动器由 `PATH` 中的 `python` 启动，只用标准库。请确认该 `python` 是 Python 3。
- HFSS 需要 Ansys AEDT 2025 R1 及其许可证；ADS 是 Keysight 的商用软件。两者都不随插件分发。
- openEMS 是开源（GPL）软件，不随插件分发，需按上游文档 `docs/openems_build_guide.md` 从源码编译。内置的 `fake` 通道不需要许可证和外部引擎，可跑通全流程，但它是闭式解析模型，只用来检查流程，不用于物理结论。

## 安装与配置

1. 从插件市场或本地目录安装本插件。
2. 指定解释器，两种方式任选其一：
   - 在插件设置里填写 **rfauto Python 解释器**（`pythonPath`），即装有 rfauto 的 Python 路径；留空则使用启动器自身的解释器。如要锁定某份源码，再填 **rfauto 源码目录**（`rfautoSrc`），指向检出目录下的 `src/`。
   - 或在插件数据目录下写一个 `launcher.json`：`{"pythonPath": "...", "rfautoSrc": "..."}`，确切路径见 `rf_env_doctor` 的报告。两处同时设置时以 userConfig 为准。
3. 重启会话，发一句“用 rfauto doctor 工具体检”。返回 rfauto 环境信封，说明配置生效。
4. MCP 服务器起不来时，插件会降级为只提供 `rf_env_doctor` 的诊断服务器。调用它，按报告修复；报告里有确切的安装命令和需要配置的项。

## 权限、网络与副作用

- **插件网络**：插件本身不发起任何网络请求。唯一的联网步骤是上面的 pip 安装。
- **MCP 服务器网络**：rfauto 的工具只在以下几种情况下建立网络连接，且都需要你自己配置：
  - 远程主机工具（`remote_probe_machine`、`remote_machine_status`）访问你登记过的主机（TCP 探测，或经 paramiko 的 SSH）；
  - 分发到远程机器的 campaign 阶段（SFTP 上传下载、SSH 执行命令）；
  - 指向已登记远程 AEDT 主机的 HFSS 运行；
  - 设置了许可证服务器环境变量时，对该服务器做 TCP 探测。

  rfauto 的其他网络路径（大模型对话、文献和模型下载、通知 webhook）只出现在它的命令行、工作台或脚本中，MCP 工具不会触发。
- **遥测**：上游代码中未发现遥测。
- **凭据**：插件不读取也不保存凭据。登记远程主机的 SSH 认证由 rfauto 通过 paramiko 完成，使用你本机的 SSH 配置。
- **依赖**：MCP 服务器依赖 rfauto 的 `[mcp]` 可选依赖（fastmcp、mcp）。numpy、scipy、scikit-rf、pydantic 等其他运行时包由 pip 安装，不随插件分发。
- **文件写入**：仿真 run 的产物（`runs/`、数据集与数据库文件）按 rfauto 的正常行为写入当前工作区。远程 campaign 还会在本机与远程机器之间复制文件。判读三件套（`rf-verdict`、`rf-judge`、`/rf-check`）只读。
- **命令执行**：启动器 `scripts/serve_mcp.py` 找到配置的解释器，以 `python -m rfauto.mcp_server` 启动子进程，stdio 直接透传。启动失败时降级为诊断服务器。
- **Hook**：本插件不注册任何 hook。

## 第三方材料来源与许可证

- 本插件包装的是 [geer1895/rfauto](https://github.com/geer1895/rfauto)（GPL-3.0-only）的公开能力。随包分发的 7 张器件技能卡（`skills/rfauto-*`、`skills/veriloga-authoring`）复制自该仓库的 `skills/` 目录：正文与参考文件保持不变，各自保留 `LICENSE.txt`；仅 frontmatter 的 `description` 与 `compatibility` 译成了中文。MCP 服务器进程就是 rfauto 自带的 `rfauto.mcp_server`，本插件不改动它。
- 插件本体（导航与判读技能、agent、命令、启动器脚本、图标）以 GPL-3.0-only 分发，与上游 `LICENSE` 一致。
- 上游的部分文档（包括 `THIRD_PARTY_NOTICES.md`）把 rfauto 写成 MIT。这与上游的 `LICENSE` 文件和 `pyproject.toml`（均为 GPL-3.0-only）矛盾。本插件以 `LICENSE` 文件为准。
- 上游的第三方清单并不完整，各依赖的许可证以安装包的元数据为准。

## 铁律 7

所有技能和 agent 都遵守 rfauto 的核心约定：agent 负责编排、解读和判定，每个物理数字都能追溯到某次工具调用。判定为 FAIL 就如实报 FAIL，不凑绿。

## 已知限制

- 公开仓以 GitHub Release 发布 v0.14.0（源码包），未记录 PyPI 发布。安装命令固定到 v0.14.0 的 Release 源码包（校验 SHA256）；插件升级到新版本时，需同时修改 `.zcode-plugin/plugin.json` 与 `scripts/serve_mcp.py` 中的命令。
- 四态判定（TRUSTED、SUSPECT、STALE、UNVERIFIABLE）是本插件的约定，rfauto 中没有同名定义。
- 本机测试中，MCP 服务器从启动到握手完成约 30 秒（rfauto 的导入链较重）。会话里第一次调用时请留出这段时间。
