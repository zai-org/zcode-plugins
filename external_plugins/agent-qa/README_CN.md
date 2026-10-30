# agent-qa

[English documentation](./README.md)

使用 vostride 的 [agent-qa](https://github.com/vostride/agent-qa) 进行自然语言 Web、Android 和 iOS 测试，查看运行证据，并利用先进的 memidex 记忆引擎和自我改进能力。

## 在 ZCode 中使用

从市场安装并启用 **agent-qa**，然后在应用项目中开启新会话。明确提到 agent-qa 的请求，或相关配置和测试文件，会触发 `agent-qa` 技能。例如：

- “使用 agent-qa 验证并运行本项目的结账测试。”
- “只查看已有的 agent-qa 结账运行证据，不要启动测试或修改知识。”
- “解释这次 agent-qa 运行使用和学到了哪些 memidex 知识。”
- “为已配置的 komazon 目标编写 agent-qa 测试，检查商品目录是否可见。”

技能会区分准备检查与实际执行结果。试运行或缺少已完成的运行记录都不代表测试通过。编写测试时使用已安装版本支持的接口，验证过程可能执行测试。

## 前置条件

单独安装的 agent-qa 0.2.3 运行时要求 Node.js 24+。项目已有运行时版本和配置时，应沿用现有设置。首次配置请在目标应用项目中按照[快速入门](https://vostride.com/docs/agent-qa/quickstart)操作：

```bash
npm install -D agent-qa
npx agent-qa init --help
```

通过所选模型提供方支持的凭据流程完成配置。使用 Claude 或 Codex 订阅登录时，还需运行 `npm install -D @vostride/agent-qa-subscription-auth`。Web 测试需要配置相应浏览器；Android/iOS 测试需要 Appium 以及对应设备和驱动。查看已保存的运行记录无需新建浏览器会话。

插件提供技能指令，不打包 agent-qa，不会自动安装依赖、注册 MCP 或启动服务。如需连接测试编写工具，请按照[编码代理指南](https://vostride.com/docs/agent-qa/coding-agents)单独配置 agent-qa MCP，使用正确的项目配置，并根据测试或套件时长设置工具调用超时。未连接工具时，应查阅已安装版本的能力接口，而不是猜测测试编写命令。

## 依赖与副作用

- 技能可引导 ZCode 在用户请求范围内执行已安装的 agent-qa CLI，或使用已配置的 MCP 工具。插件不含可执行 Hook，也不捆绑 MCP 服务。
- 安装软件包会访问 npm。测试执行会连接已配置的应用和模型提供方；移动端测试还会使用已配置的 Appium 与设备服务。可能产生模型费用或消耗订阅额度。
- 初始化、编写测试和执行可能在应用项目中创建配置、YAML 测试、本地运行记录、截图、日志和知识。只读证据查看不会调用编写或执行操作，也不会修改结果标记或知识。
- 运行时的分析统计、身份认证与数据处理遵循已安装的 agent-qa 版本及项目设置。只有配置的秘密值会被遮蔽；分享前应检查证据。不要提交凭据或将其粘贴到聊天中。
- 修正结果可能修改可追溯的知识或预期，需要明确的修正任务并检查其影响。修正后的判定不等于重新执行测试的证据。

## 内容与许可证

插件包含一个技能以及两份参考文档，分别介绍项目设置与运行、证据与记忆。指令和清单由 vostride 按本市场的 Apache-2.0 许可证贡献。单独安装的 [agent-qa 运行时使用 FSL-1.1-ALv2](https://github.com/vostride/agent-qa/blob/main/LICENSE.md)，不包含在此插件中。
