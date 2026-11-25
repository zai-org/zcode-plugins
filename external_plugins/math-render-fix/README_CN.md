# math-render-fix

[English](./README.md)

让 ZCode 聊天界面的数学公式保持可读。

ZCode 用 KaTeX 渲染聊天里的 Markdown，只识别美元符分界符。写成 `\( ... \)` 或 `\[ ... \]` 的公式，反斜杠会被 Markdown 转义吃掉，显示成原始 LaTeX：`\(P_{\mathrm{total}}\)` 变成 `(P_{\mathrm{total}})`。这个插件引导模型使用渲染器认识的分界符，接住漏掉的部分，并提供一个可选的渲染层补丁。

## 目录结构

```text
math-render-fix/
├── .zcode-plugin/plugin.json
├── commands/
│   ├── mathfix.md            # /mathfix
│   └── mathfix-patch.md      # /mathfix-patch
├── hooks/
│   ├── hooks.json            # 自动加载的 Hook 配置
│   ├── math-rules.mjs        # SessionStart：说明支持的分界符写法
│   └── stop-check.mjs        # Stop：要求把其他写法的公式重新输出
├── scripts/
│   └── patch-renderer.mjs    # 可选的渲染层补丁：status / apply / restore
├── tests/
│   ├── run.mjs               # Hook 回归测试
│   └── verify-patch.mjs      # 针对 ZCode 安装包的补丁端到端检查
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

已被 Hook 要求续写的那一次停止会被放行，所以每轮最多多续写一次。

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
- `/mathfix-patch` 应用下文的可选渲染层补丁。它会先请求确认。

ZCode 按文件名注册这两个命令（已在 ZCode 4.0.0 上验证，官方的 `zcode-site` 插件的命令也是这样列出的）。ZCode 的文档也把插件命令描述为 `/<插件名>:<命令名>` 的形式，那样的话就是 `/math-render-fix:mathfix` 和 `/math-render-fix:mathfix-patch`。输入 `/`，以你的版本列出的形式为准。

### 可选的渲染层补丁

`scripts/patch-renderer.mjs` 让 `\(...\)` 和 `\[...\]` 直接显示，不需要改变模型的写法，所以旧消息里的公式也会正常显示。

ZCode 在解析每条消息之前，会先对美元符做一次消歧处理。补丁改写这段处理里两个函数的头部（共 127 字节，替换为等长内容），让 `\(`、`\)`、`\[`、`\]` 先被换成 `$$`。`app.asar` 的大小和头部不变，是原地写入。

```shell
node scripts/patch-renderer.mjs status    # 只读：ZCode 版本、目标文件、当前状态
node scripts/patch-renderer.mjs apply     # 写入；之后需完全退出并重启 ZCode
node scripts/patch-renderer.mjs restore   # 还原
```

- 不带 `--asar <路径>` 时，脚本先从正在运行的 ZCode 进程定位安装目录，再查卸载注册表项，最后尝试常见安装位置。
- 只有两个函数都恰好各找到一处时才写入，写入前会确认改后的文件仍能通过语法检查，其余情况一律拒绝。遇到不认识的 ZCode 版本不会动任何东西。
- `apply` 和 `restore` 会把写入的字节记录到 `~/.zcode/math-render-fix-renderer.txt`。`Stop` Hook 每次运行都会读它：补丁还在时，渲染层自己就能显示 `\(...\)`，Hook 保持沉默；字节一旦对不上，Hook 就恢复工作。
- ZCode 升级会覆盖 `app.asar`，补丁随之消失，需要重新应用。
- 这是对已安装应用的本地修改，是否使用由你决定。

## 依赖、权限与副作用

- **网络**：无。插件不发起任何网络请求，也不下载任何东西。
- **模型、API 与服务**：无。
- **运行时**：PATH 上有 `node`，供 Hook、补丁脚本和测试使用。不需要其他任何东西。
- **Hook 会执行本地代码**（插件启用后），所以请先审查 `hooks/`。两个 Hook 都会读取 ZCode 写入其 stdin 的内容；`stop-check.mjs` 还会读取上文提到的状态文件，以及它在 `app.asar` 中指向的那几个字节。Hook 只向 stdout 写一个 JSON 对象，不写任何文件。
- **`Stop` 可能让模型多续写一轮**，当回答里用了不支持的写法时。这会让这类回答多一次模型请求。
- **写入的文件**：默认不写任何文件。只有在应用渲染层补丁时，补丁脚本才会修改 ZCode 安装目录里的 `resources/app.asar`，并写入 `~/.zcode/math-render-fix-renderer.txt`。
- **MCP server**：无。
- **第三方代码、素材与服务**：无。`tests/verify-patch.mjs` 从被检查的 ZCode 安装包里加载 Markdown 解析器和 KaTeX，本身不捆绑任何副本。

## 测试

```shell
node tests/run.mjs                            # Hook 回归测试
node tests/verify-patch.mjs [app.asar 路径]    # 补丁的端到端检查，只读
```

`verify-patch.mjs` 从 `app.asar` 里读出渲染层代码，把一组消息分别用打补丁前、后的 ZCode 预处理函数跑一遍，再核对解析出的公式与每条消息的预期是否一致。ZCode 升级之后可以再跑一次：结果为“不适用”或有用例失败，说明补丁需要重新适配。

用 ZCode 实际发送的载荷手工冒烟：

```shell
printf '%s\n' '{"hook_event_name":"SessionStart","session_id":"manual","source":"startup"}' \
  | node hooks/math-rules.mjs

printf '%s\n' '{"hook_event_name":"Stop","session_id":"manual","stop_hook_active":false,"last_assistant_message":"value \\(P_1\\)"}' \
  | node hooks/stop-check.mjs
```

stdout 必须是以 `{` 开头的单个 JSON。诊断信息只写 stderr。

如果本机已经打了渲染层补丁，第二条命令不会有输出：此时 `Stop` Hook 按设计保持沉默。把家目录环境变量指向一个空目录（macOS 和 Linux 上是 `HOME`，Windows 上是 `USERPROFILE`）再运行，就能看到它的返回。

## 已知局限

- `\( ... \)` 里的内容没有任何公式特征时（例如 `\(x\)`），`Stop` 检查不会处理它。它显示成 `(x)`，读起来没有障碍，不必重发。
- 打了渲染层补丁之后，正文里没有放进代码格式的 `find \( -name a \)` 会被当成公式。代码块和行内代码不受影响。
- 补丁写于 ZCode 4.0.0（build 3bc8a247）。其他版本上脚本会报告不适用。

## 许可证

[MIT](./LICENSE)
