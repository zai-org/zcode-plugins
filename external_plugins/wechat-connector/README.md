# wechat-connector — WeChat Connector for ZCode

A ZCode plugin that sends notifications to WeCom (WeChat Work / 企业微信) group robots through Tencent's **official webhook API**. No reverse-engineered protocols and no client automation — just an HTTPS call to the group robot webhook you create in your own group, so there is no account-ban risk from unofficial clients.

[中文说明](README_CN.md)

## Features

- Send **text** and **Markdown** messages to one or more WeCom groups
- Multi-channel configuration: several groups / webhook URLs as named channels
- Rate-limit aware: 20 messages/minute per robot, with retry guidance built into the skill
- Official API only, zero background services for outbound notifications (a single `curl` call)
- Ships as a ZCode skill (`wechat-send`), so any ZCode session can use it once installed

## Install

**Option A — from the official community marketplace (recommended after review):**
add the `zcode-plugins-official` marketplace in your ZCode client, then install *WeChat Connector (微信接入)*.

**Option B — from this repository:**
add this repository as a plugin marketplace in your ZCode client (if your version supports git sources), or clone it and add the local directory:

```bash
git clone https://github.com/zhaohongjun20-creator/wechat-connector.git
# then in ZCode: Plugin Marketplace → Add → Add Plugin Marketplace → select the cloned folder
```

## Configuration

The webhook URL is treated as a secret. It is read from (in priority order):

1. Environment variable `WECHAT_WEBHOOK_URL`
2. Config file `~/.zcode/wechat/config.json` (Windows: `C:\Users\<you>\.zcode\wechat\config.json`):

```json
{
  "default_channel": "default",
  "channels": {
    "default": { "webhook": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=***" }
  }
}
```

Ask the agent to "send to channel XX" and it matches the key under `channels`.

### Create a group robot (mobile app is enough)

WeCom group chat → top-right "…" → **Group robots (群机器人) → Add robot** → copy the webhook URL. The robot must stay in the group; if it is removed, the webhook is invalidated and the API returns `errcode 93000`.

## Usage

After installing, say to ZCode:

> Send to the WeCom group: release tonight at 8 PM

The agent resolves the webhook, posts the message, and reports the API result (`errcode 0` means delivered).

## Side effects & security

This section discloses everything the plugin touches, as required for community plugins:

- **Network access**: the skill sends HTTPS `POST` requests to `https://qyapi.weixin.qq.com` (Tencent's official endpoint) containing the webhook URL and the message content.
- **Command execution**: the skill instructs the agent to run `curl` for the HTTP call.
- **File writes**: message payloads are written as temporary JSON files in the system temp directory.
- **Credentials**: webhook URLs (and future API tokens) live only in `~/.zcode/wechat/config.json` or environment variables on your machine. They are never committed to the plugin source, and are sent nowhere except Tencent's API endpoint.
- **No** MCP server, **no** hooks, **no** third-party code or assets.

## How it works

The plugin ships one skill, `skills/wechat-send/SKILL.md`. It documents the official webhook message format (text / markdown / image, mention lists, rate limits, error codes) and instructs the agent to resolve the webhook from config, write a UTF-8 JSON payload (avoiding Windows codepage issues), post it with `curl --data-binary`, and verify the `errcode` in the response.

## Roadmap

- **M1 (shipped)**: outbound group notifications via WeCom group robot webhook
- **M2 (planned)**: two-way conversation via a WeChat Official Account (test account for development) + pluggable reply engine — option A: ZCode session as the brain; option B: any OpenAI-compatible API (default target: DeepSeek)
- **M3 (planned)**: rich messages (images / template cards), channel management, message log queries

Design details: [DESIGN.md](DESIGN.md) (in Chinese).

## License

[MIT](LICENSE)
