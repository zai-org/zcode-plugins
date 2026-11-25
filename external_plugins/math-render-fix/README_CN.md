# math-render-fix

[English](./README.md)

让 ZCode 聊天界面的数学公式保持可读。

ZCode 用 KaTeX 渲染聊天里的 Markdown，只识别美元符分界符。写成 `\( ... \)` 或 `\[ ... \]` 的公式，反斜杠会被 Markdown 转义吃掉，显示成原始 LaTeX：`\(P_{\mathrm{total}}\)` 变成 `(P_{\mathrm{total}})`。这个插件引导模型使用渲染器认识的分界符，并接住漏掉的部分让它重新输出。它不改动 ZCode 本身。

## 目录结构

```text
math-render-fix/
├── .zcode-plugin/plugin.json
├── commands/
│   └── mathfix.md            # /mathfix
├── hooks/
│   ├── hooks.json            # 自动加载的 Hook 配置
│   ├── math-rules.mjs        # SessionStart：说明支持的分界符写法
│   └── stop-check.mjs        # Stop：要求把其他写法的公式重新输出
├── tests/
│   └── run.mjs               # Hook 回归测试
├── LICENSE
├── README.md
└── README_CN.md
```

## 功能

### Hook

插件启用后自动运行。ZCode 在 session 启动时对 Hook 做快照，所以启用插件或修改 `hooks/` 之后请新建 session。

| 事件 | Matcher | 行为 |
| --- | --- | --- |
| `SessionStart` | 不设，即所有来源 | 运行 `hooks/math-rules.mjs`，以 `additionalContext` 注入一条简短规则：行内公式在同一行用 `$$...$$` 包裹，独立公式放在两行 `$$` 之间，聊天回复中不使用 `\(...\)` 或 `\[...\]`。 |
| `Stop` | 不设 | 运行 `hooks/stop-check.mjs`。它读取最终回答，忽略代码块和行内代码。如果回答里仍有用 `\(...\)` 或 `\[...\]` 包裹的公式，Hook 返回 `decision: "block"`，并在 `reason` 里按支持的写法列出这些公式，让模型只重新输出它们。 |

已被 Hook 要求续写的那一次停止会被放行，所以每轮最多多续写一次。这个检查是本地脚本里的纯文本匹配，不调用模型，也不发起网络请求。

Hook 要求的写法就是 ZCode 能原生渲染的写法：

- 行内：`其中 $$P_{\mathrm{total}}$$ 为总功率`
- 独立公式：

  ```markdown
  $$
  S = 4\lambda\frac{P_2}{P_{\text{total}}}
  $$
  ```

刻意不用单美元符：`$2x$`、`$vout$` 这类纯文本内容 ZCode 会原样打印。

### 命令

- `/mathfix [范围]` 把上一条回答里的公式，或指定范围内的公式，用支持的写法重新输出。

ZCode 按文件名注册这个命令（已在 ZCode 4.0.0 上验证，官方的 `zcode-site` 插件的命令也是这样列出的）。ZCode 的文档也把插件命令描述为 `/<插件名>:<命令名>` 的形式，那样的话就是 `/math-render-fix:mathfix`。输入 `/`，以你的版本列出的形式为准。

## 依赖、权限与副作用

- **网络**：无。插件不发起任何网络请求，也不下载任何东西。
- **模型、API 与服务**：无。
- **运行时**：PATH 上有 `node`，供 Hook 和测试使用。不需要其他任何东西。
- **Hook 会执行本地代码**（插件启用后），所以请先审查 `hooks/`。两个 Hook 只读取 ZCode 写入其 stdin 的内容，只向 stdout 输出一个 JSON 对象，不读取也不写入任何文件。
- **`Stop` 可能让模型多续写一轮**，当回答里用了不支持的写法时。这会让这类回答多一次模型请求。
- **写入的文件**：无。
- **MCP server**：无。
- **第三方代码、素材与服务**：无。

## 测试

```shell
node tests/run.mjs    # Hook 回归测试
```

用 ZCode 实际发送的载荷手工冒烟：

```shell
printf '%s\n' '{"hook_event_name":"SessionStart","session_id":"manual","source":"startup"}' \
  | node hooks/math-rules.mjs

printf '%s\n' '{"hook_event_name":"Stop","session_id":"manual","stop_hook_active":false,"last_assistant_message":"value \\(P_1\\)"}' \
  | node hooks/stop-check.mjs
```

stdout 必须是以 `{` 开头的单个 JSON。诊断信息只写 stderr。

## 已知局限

- 那条规则只是对模型的请求。模型仍可能用别的写法回答，这时 `Stop` 检查会让它多重写一轮。
- `\( ... \)` 里的内容没有任何公式特征时（例如 `\(x\)`），`Stop` 检查不会处理它。它显示成 `(x)`，读起来没有障碍，不必重发。

## 许可证

[MIT](./LICENSE)
