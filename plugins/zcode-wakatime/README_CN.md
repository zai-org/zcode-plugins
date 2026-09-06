# zcode-wakatime

[ZCode][zcode] 的 [WakaTime][wakatime] 插件。

将 [wakatime-cli][wakatime-cli] 安装到 `~/.wakatime/`，在会话启动时检查 wakatime-cli 更新，并在用户提交与文件编辑事件后同步 AI 编程心跳。

派生自 [wakatime/codex-cli-wakatime][wakatime/codex-cli-wakatime]，已适配 ZCode。

## 安装

在 ZCode 中：**Settings → Plugins → Create → Add marketplace** → 添加 `RoiexLee/zcode-wakatime` → 安装 **zcode-wakatime**。

## 配置

插件读取 `~/.wakatime.cfg` 中的标准 WakaTime 配置。

常用配置：

```ini
[settings]
api_key = XXXX
debug = true ; 详细插件日志写入 ~/.wakatime/zcode.log
proxy = https://127.0.0.1:8080 ; 可选，用于下载 wakatime-cli
```

日志写入 `~/.wakatime/zcode.log`。

## 许可

[BSD-3-Clause](LICENSE)

[wakatime]: https://wakatime.com
[zcode]: https://zcode.z.ai
[wakatime-cli]: https://github.com/wakatime/wakatime-cli
[wakatime/codex-cli-wakatime]: https://github.com/wakatime/codex-cli-wakatime
