# zcode-wakatime

[WakaTime][wakatime] plugin for [ZCode][zcode].

The plugin installs [wakatime-cli][wakatime-cli] into `~/.wakatime/`, checks for wakatime-cli updates on session start, and syncs AI heartbeats after user prompts and file-edit tool events.

Derived from [wakatime/codex-cli-wakatime][wakatime/codex-cli-wakatime], adapted for ZCode.

## Install

In ZCode: **Settings → Plugins → Create → Add marketplace** → add `RoiexLee/zcode-wakatime` → install **zcode-wakatime**.

## Configuration

The plugin reads standard WakaTime settings from `~/.wakatime.cfg`.

Useful settings:

```ini
[settings]
api_key = XXXX
debug = true ; verbose plugin logging to ~/.wakatime/zcode.log
proxy = https://127.0.0.1:8080 ; optional, used for wakatime-cli downloads
```

Logs are written to `~/.wakatime/zcode.log`.

## License

[BSD-3-Clause](LICENSE)

[wakatime]: https://wakatime.com
[zcode]: https://zcode.z.ai
[wakatime-cli]: https://github.com/wakatime/wakatime-cli
[wakatime/codex-cli-wakatime]: https://github.com/wakatime/codex-cli-wakatime
