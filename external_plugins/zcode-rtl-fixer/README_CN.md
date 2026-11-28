# ZCode RTL Fixer（波斯语/英语混排修复）

修复 ZCode Desktop 聊天框中**波斯语/英语**混排（双向文本）的显示问题：段落自动
右到左、波斯语友好字体、表格与列表标记右到左——代码块、内置终端和编辑器保持不变。

English documentation: [README.md](./README.md)

## 功能

- **段落自动方向** — 每个段落按首字符确定方向（`unicode-bidi: plaintext`）：
  波斯语段落右对齐，英语段落保持左对齐，同一条消息内也可以混排。
- **波斯语字体** — 含阿拉伯字母的文本块使用波斯语字体（默认 Vazirmatn），
  并支持可选的字号补偿。
- **表格与列表标记 RTL** — 波斯语为主的表格列顺序翻转；列表的圆点/编号
  移到右侧。
- **代码不受影响** — `<code>`、`<pre>`、`language-*` 代码块和行内代码不重排。
- **流式输出安全** — 基于 requestAnimationFrame 批处理的 MutationObserver，
  令牌流式生成时不卡顿。

## 命令

| 命令 | 用途 |
|---|---|
| `/rtl:install` | 安装/重新应用补丁（ZCode 每次更新后再执行一次） |
| `/rtl:status` | 查看安装与设置状态 |
| `/rtl:font` | 安装波斯语字体（默认从 GitHub 下载 Vazirmatn）并启用 |
| `/rtl:settings` | 修改设置（`enabled`、`fontFamily`、`fontSizeScale`、`fixTables`、`fixLists`、`probe`） |
| `/rtl:uninstall` | 还原原始 ZCode Desktop |

## 工作原理

AppImage 本体永远不会被修改。插件把 ZCode AppImage 解压到
`~/.local/share/zcode-rtl-fixer/app`，只修补**解压副本**的
`resources/app.asar`（向 `out/renderer/index.html` 注入一个轻量渲染引导脚本），
并创建启动器：

- `~/.local/bin/zcode-rtl` 与桌面入口 "ZCode RTL"
- 原始归档始终保留为 `app.asar.orig`；重新打补丁前先还原它，因此补丁
  幂等且可撤销。

设置保存在 `~/.zcode/rtl-fixer/settings.json`，打补丁时烘焙进引导脚本
（修改设置后需要一次快速 re-patch）。

## 副作用与依赖（供评审参考）

- **网络**：仅字体安装时从 GitHub 下载 [Vazirmatn](https://github.com/rastikerdar/vazirmatn)
  的发布包（api.github.com + release 资源）。无其他网络访问，无遥测。
- **文件写入**：`~/.local/share/zcode-rtl-fixer/`（解压副本与状态）、
  `~/.local/bin/zcode-rtl`、`~/.local/share/applications/zcode-rtl.desktop`、
  `~/.fonts/`（仅 `/rtl:font` 时）、`~/.zcode/rtl-fixer/settings.json`。
- **命令执行**：解压时使用 `--appimage-extract`、`unzip`、`fc-cache`/`fc-list`、
  `mv`；所有 Node 脚本零依赖。
- **第三方素材**：Vazirmatn 字体（SIL Open Font License 1.1）仅在用户要求
  安装字体时于运行时下载。插件代码均为原创，MIT 许可。
- **平台**：Linux，ZCode Desktop AppImage。运行中的实例不会被修改——补丁在
  下次从 "ZCode RTL" 启动器启动时生效。

## 测试

```shell
node tests/run-tests.mjs
```

23 个零依赖单元测试：双向文本启发式、ASAR 读取/修补/提取往返（含 symlink
条目与头部长度变化）、修补器单元测试（index.html 注入幂等、设置烘焙），以及
引擎、插件清单与市场目录之间的版本一致性。

## 许可证

MIT — 见 [LICENSE](./LICENSE)。
