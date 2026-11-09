# Mimosa（代码安全防护）

[English](./README.md)

Mimosa 为 ZCode 提供本地优先的代码安全防线：在候选代码写入前检查高风险问题，在单轮任务结束时复查改动，在 commit/push 前执行 Git 门禁，并通过可选 MCP 服务提供显式触发的密封仓库深扫。

## 平台支持

本交付包是**纯 Node.js 跨平台构建**，不包含原生可执行文件，面向当前 ZCode 的 macOS、Linux 和 Windows 版本；要求 `node` 可从 `PATH` 访问。本地 Hook 和原生扫描引擎不需要额外配置模型 API Key。

厂商载荷在 `payload/` 目录中保持原样。受保护代码加载前会校验 Ed25519 签名清单；外层目录只提供 ZCode 标准 manifest 和不依赖 shell 语法的跨平台进程 Hook 配置。

## 包含的能力

- 针对文件编辑和 Shell 命令的 `PreToolUse`、`PostToolUse` 检查；
- `UserPromptSubmit`、`SessionStart`、`Stop` 生命周期 Hook；
- `/mimosa-scan`、`/mimosa-status`、`/mimosa-deep-audit` 命令；
- 显式深度安全审计使用的 `mimosa-security-scan` Skill；
- 用于显式密封仓库深扫的 `mimosa` stdio MCP 服务；插件不覆盖宿主的启用状态。

## 安装

正式发布后，在 ZCode **设置 → 插件** 中搜索“代码安全防护”，从官方市场安装 `mimosa`。本地验证时，通过“创建 → 添加插件市场”选择 `zcode-plugins` 仓库根目录，再从该市场安装 `mimosa`。

安装、启停或修改插件选项后需要**新建任务**，因为 ZCode 会在任务启动时形成 Hook 和 MCP 配置快照。

## 基础验收

1. 执行 `/mimosa-status`，查看当前项目最近一次 Mimosa 状态；
2. 在一次性测试项目中让 ZCode 写入明显不安全的 SQL 拼接或命令执行代码。写入前 Hook 应阻断确定的高风险候选，并把修复上下文返回给模型；
3. 确认 ZCode 中的 `mimosa` MCP 处于活动状态，新建任务后执行 `/mimosa-deep-audit`，触发显式密封深扫。

写入前检查、任务收尾复查和 Git 门禁不依赖主动调用 MCP 深扫。

## 可选 Semgrep 引擎

内置原生引擎不依赖 Semgrep。仅当需要显式使用 Semgrep CE 时，运行：

```bash
node payload/dist/cli.js semgrep install --accept-license
```

该可选安装会访问网络，不使用 `sudo`，也不会修改系统 Python。

## 配置

- `engine`：可选 MCP 服务使用的静态扫描引擎，默认 `native`；
- `MIMOSA_HOOK_FAILURE_MODE=open|strict`：编辑 Hook 基础设施异常时的行为；
- `MIMOSA_GIT_GATE_FAILURE_MODE=open|strict`：Git 门禁基础设施异常时的行为；
- `MIMOSA_HOOK_STATUS=quiet|important|all`：Hook 状态输出级别；
- `MIMOSA_HOOK_PROJECT=1`：启用非阻断的跨文件风险提示。

插件在项目内只向 `.mimosa/` 写入状态，在项目外的用户 Mimosa 数据目录保存持久扫描历史；不会把运行数据写回插件安装目录。

## 安全说明

Hook 会以当前用户权限执行本地代码，启用第三方插件前应先审查内容。静态扫描结果只代表已扫描范围的证据，不能承诺项目不存在漏洞；覆盖不完整时必须明确报告为无法下结论。

## 许可证

MIT，详见 [LICENSE](./LICENSE)。

## 1.0.4：可靠传递 Hook 安全判定

Hook 入口改为轻量 Node.js 输出适配器。供应商签名载荷保持原样，先将判定写入私有临时文件，再等待完整 JSON 送达宿主管道后退出，避免立即退出在 stdout 背压下丢失阻断结果。适配器失败会阻止 PreToolUse，不会以成功空输出放行；每次运行后清理临时输出文件。升级后请新建 ZCode 任务，使新 Hook 入口生效。
