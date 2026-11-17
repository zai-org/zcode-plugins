# Browser Bridge

[English](README.md)

Browser Bridge 让 ZCode 连接你日常使用的 Chrome，保留已有登录态。15 个 MCP 工具支持列出标签页、读取正文、截图、导航、点击、滚动、输入和执行网页 JavaScript。**0.6.0-rc.2 是社区测试候选版。**

## 依赖与安装

- 客户端 PATH 中须有可运行的 `node`，要求 Node.js 18 或更新版本。
- Google Chrome 116 或更新版本；扩展采用 Manifest V3。
- 插件本身不要求另购模型账号、API Key、付费服务或打开 Chrome 远程调试端口。ZCode 使用用户在客户端配置的模型及服务商。

1. 在 ZCode 插件市场安装并启用 **Browser Bridge**，然后新建会话。如果投稿还在审核，请使用本仓库构建的本地市场，不要假定已经公开上架。
2. 激活后自动准备本地桥接和稳定扩展目录。扩展未连接且引导从未展示时，打开一次安装引导。也可运行 `/cc-browser-setup` 主动打开。
3. 在 Chrome 打开 `chrome://extensions`，开启**开发者模式**，点**加载已解压的扩展程序**，选择引导显示的目录，通常为 `~/.browser-bridge/extension`；Windows 对应 `%USERPROFILE%\.browser-bridge\extension`。macOS 在文件选择窗口按 Cmd+Shift+G 粘贴路径，Windows 使用地址栏或 Ctrl+L。
4. 等待扩展显示已连接，然后回到 ZCode 说：**列出我当前 Chrome 中的标签页。** 收到真实工具结果才表示客户端到浏览器的链路通过；引导页显示已连接不代表客户端调用已经通过。

本投稿提供扩展源代码，**不会自动安装 Chrome 扩展，也不等于在 Chrome 网上应用店上架**。引导成功打开后单独记录“已展示”，与用户点“完成引导”分开。展示过的引导不因新会话、经过一段时间或升级再次弹出；扩展已经连接时也不自动打开。打开失败会按有界退避重试，`/cc-browser-setup` 始终允许主动重开。

## 使用示例与控制

- “读取当前网页并总结。”
- “截取当前标签页的画面。”
- “填写这个表单，提交前等我确认。”

Chrome 扩展弹窗可查看连接状态、修改桥接地址和暂停浏览器控制。插件不会自动解除暂停。操作使用真实登录态，可能改变网站内容；涉及提交表单、发送消息、购买或删除，请要求 AI 等你确认。插件不会为每个操作额外添加独立确认对话框。

桥接跟随浏览器当前活动标签页；运行连续操作时切换活动页可能改变目标。请保持目标页选中。每个桥接实例同时只支持一份 Chrome 扩展连接。

## 权限、数据流与副作用

- **Chrome 权限：** `debugger`、`tabs`、`scripting`、`storage` 和 `<all_urls>`，用于截图、查看标签、DOM 操作和脚本执行。Chrome 可能显示正在调试的横幅。浏览器内部页和其他受限页面仍受 Chrome 限制。
- **本地进程：** MCP 激活运行 `server/mcp-stdio.js`；自动发现的 `SessionStart` Hook 运行 `hooks/session-start.js`，预热同一启动层。健康桥接会复用，否则可能启动脱离客户端生命周期的 Node 后台桥接。macOS/Windows 首次引导可打开系统浏览器；用户明确触发的引导动作可打开 Chrome 扩展管理页或定位扩展目录。网页输入不能指定任意本机命令或路径。
- **本地写入：** 默认在 `~/.browser-bridge/` 写入受管扩展、锁、展示/完成状态和日志。单独手动运行引导时，还可能写临时引导会话文件及插件目录中的 `.onboard-state.json`。扩展配置使用 `chrome.storage`。同步会保留未知文件，无法识别的已有扩展目录会拒绝接管。
- **网络：** 默认只在 `127.0.0.1:8765` 传输 HTTP/WebSocket 桥接数据；引导使用从 `8791` 开始的回环端口。Chrome 按用户要求访问目标网站。插件没有统计上报、云服务、运行时依赖下载或专用模型/API 请求，包内带有 `ws` 源码依赖。ZCode 可能把网页正文、标签元数据、截图和 JavaScript 结果等工具输出发送给用户在客户端配置的模型/服务商。若明确设置远程 `BRIDGE_URL`，工具流量会发往该端点；远程/HTTPS 端点禁用自动本地准备。
- **信任边界：** 回环访问不等于按用户身份认证，其他受信任本机进程也可调用桥接。Host/Origin 检查拒绝网页调用并防范 DNS 重绑定，不隔离恶意本地程序。请在受信任工作站使用。引导 API 还要求短期会话令牌。
- **凭据：** 插件没有专门导出网站密码或 Cookie 的接口，但按要求读取的页面或 JavaScript 结果可能包含敏感信息，请按实际需要授权页面和操作。

需要停止桥接时，根据 `~/.browser-bridge/state/` 的 PID 与 `logs/` 日志核实归属，只停止确认过的桥接进程。禁用插件会阻止后续客户端激活，不会自动终止已脱离客户端的后台桥接。

## 配置与排障

`BROWSER_BRIDGE_HOME` 修改受管目录，`BRIDGE_PORT` 或 `BRIDGE_URL` 选择端点；冲突或非法值会明确报错。换本地端口时，扩展弹窗中的 WebSocket 地址也要一致。其他程序占用端口会明确报告，不会杀掉占用者。

引导中断可运行 `/cc-browser-setup`。缺少 Node 时先安装，再重启客户端使 PATH 生效；插件不安装运行时。控制失败请检查 Chrome 正在运行、扩展已启用并连接、目标页仍是活动标签，且没有暂停控制。

## 验证范围

在插件目录运行 `node --test tests/*.test.js`。包内冒烟测试使用隔离目录和端口；打开浏览器的回归使用 macOS 假 `open` 命令，在其他平台跳过。

此前 macOS/ZCode/Chrome 构建实际验证过原生引导和真实浏览器工具。当前源码包含重复弹引导修复和回归验证。Windows 启动、包装与引导另有此前后台检查。当前候选版的 ZCode 新装/更新/重启原生终验仍未完成，不宣称所有客户端兼容或无系统 Node 时开箱即用。当前具体检查结果见投稿 PR。

## 许可证与来源

Browser Bridge 源码、文档及原创图标采用 Apache-2.0，copyright 2026 lihytaihe-lang，见 [LICENSE](LICENSE)。`server/vendor/ws/` 是未修改的 `ws` 8.22.0 源码，遵循 MIT 并保留原许可证，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。Google Chrome 和 ZCode 是独立产品，遵循其各自条款；本插件由社区维护，不代表 Google 或 Z.ai 官方产品。
