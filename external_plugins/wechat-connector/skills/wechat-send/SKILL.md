---
name: wechat-send
description: Send text or markdown notifications to a WeCom (企业微信) group robot via official webhook API. Use when the user asks to send a message / notice / notification to a WeCom group, 企业微信群, 群通知, or 企业微信机器人.
---

# wechat-send — 企业微信群机器人通知

通过企业微信群机器人 webhook 发送群通知,全程走官方 API,无需任何常驻服务。

## 1. 取 webhook 地址

按优先级:

1. 环境变量 `WECHAT_WEBHOOK_URL`;
2. 配置文件 `~/.zcode/wechat/config.json`(Windows 下通常是 `C:\Users\<用户名>\.zcode\wechat\config.json`),结构:

```json
{
  "default_channel": "default",
  "channels": {
    "default": { "webhook": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=***" }
  }
}
```

用户说"发到 XX 群"时,按渠道名匹配 `channels` 的键;未指明则用 `default_channel`。

**安全**:webhook URL 视同密码——不要在回复中原样展示 key,不要写入任何会提交到仓库的文件。

## 2. 发送(Windows / Git Bash 编码注意)

不要把含中文的 JSON 直接放进 curl 命令行参数(Windows 代码页会破坏 UTF-8)。先用 Write 工具把 payload 写成 UTF-8 临时文件,再发送:

文本消息(临时文件,如 `$TMP/wechat-payload.json`):

```json
{"msgtype": "text", "text": {"content": "今晚 8 点发布"}}
```

Markdown 消息:

```json
{"msgtype": "markdown", "markdown": {"content": "## 发布通知\n今晚 **8 点** 发布,请留意"}}
```

发送:

```bash
curl -sS -X POST -H "Content-Type: application/json" \
  --data-binary @"$TMP/wechat-payload.json" \
  "$WEBHOOK"
```

注意必须用 `--data-binary`(不要用 `-d`,它会剥掉换行);Git Bash 下路径用正斜杠。

**校验**:响应为 `{"errcode": 0, "errmsg": "ok"}` 才算成功。`errcode` 非 0 时:
- `45009`(接口超频):等 30 秒重试一次;
- `93000` 或 invalid webhook:提示用户检查 webhook 地址是否失效(机器人被移除会失效);
- 其他错误:把 errcode/errmsg 原样报告给用户。

## 3. 限制与礼仪

- 每个机器人 **20 条/分钟**:多条内容尽量合并为一条;确实要分批时每条间隔 3 秒以上。
- 单条 text / markdown 内容上限 4096 字节(UTF-8),超长先分段。
- 除非用户明确要求,不要用 `"mentioned_list": ["@all"]`。
- 这是群通知通道,不是个人聊天,不要用来做对话轮询。
