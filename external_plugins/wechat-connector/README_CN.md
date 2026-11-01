# wechat-connector — ZCode 微信接入插件

通过企业微信群机器人**官方 webhook 接口**发送群通知的 ZCode 插件。不碰逆向协议、不做客户端自动化——只是向你自己在群里创建的群机器人发一条 HTTPS 请求,没有封号风险。

[English](README.md)

## 功能

- 向一个或多个企业微信群发送**文本**和 **Markdown** 消息
- 多渠道配置:多个群 / webhook 地址以命名渠道管理
- 频控感知:每个机器人 20 条/分钟,skill 内置退避重试指引
- 全程官方 API,出站通知零常驻服务(一次 `curl` 调用)
- 以 ZCode skill(`wechat-send`)形式提供,安装后任何 ZCode 会话都能用

## 安装

**方式 A —— 官方社区市场(评审通过后推荐):** 在 ZCode 客户端添加 `zcode-plugins-official` 市场,安装"微信接入(WeChat Connector)"。

**方式 B —— 从本仓库安装:** 若你的客户端版本支持 git 源,直接把本仓库添加为插件市场;或先克隆再添加本地目录:

```bash
git clone https://github.com/zhaohongjun20-creator/wechat-connector.git
# 然后在 ZCode:插件市场 → 添加 → 添加插件市场 → 选择克隆出的文件夹
```

## 配置

webhook 地址视同密码,按以下优先级读取:

1. 环境变量 `WECHAT_WEBHOOK_URL`
2. 配置文件 `~/.zcode/wechat/config.json`(Windows:`C:\Users\<用户名>\.zcode\wechat\config.json`):

```json
{
  "default_channel": "default",
  "channels": {
    "default": { "webhook": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=***" }
  }
}
```

对 agent 说"发到 XX 群",会按渠道名匹配 `channels` 下的键。

### 创建群机器人(手机版即可)

企业微信群聊 → 右上角"…" → **群机器人 → 添加机器人** → 复制 webhook 地址。机器人必须留在群里;一旦被移出,webhook 立即失效(接口返回 `errcode 93000`)。

## 用法

安装后对 ZCode 说:

> 往企业微信群发:今晚 8 点发布

agent 会解析 webhook、发送消息并回报接口结果(`errcode 0` 即送达)。

## 副作用与安全声明

按社区插件要求,完整披露本插件的一切外部影响:

- **网络访问**:skill 会向 `https://qyapi.weixin.qq.com`(腾讯官方接口)发起 HTTPS `POST`,内容为 webhook 地址与消息文本。
- **命令执行**:skill 指示 agent 运行 `curl` 完成 HTTP 调用。
- **文件写入**:消息 payload 以临时 JSON 文件写入系统临时目录。
- **凭据**:webhook 地址(以及后续的 API token)只保存在本机 `~/.zcode/wechat/config.json` 或环境变量中,绝不写入插件源码,除腾讯接口外不发送到任何地方。
- **没有** MCP 服务、**没有** hooks、**没有**第三方代码或素材。

## 工作原理

插件只包含一个 skill:`skills/wechat-send/SKILL.md`。其中记录了官方 webhook 的消息格式(text / markdown / image、@提及、频控、错误码),并指示 agent:从配置解析 webhook → 以 UTF-8 写出 JSON payload(规避 Windows 代码页问题)→ 用 `curl --data-binary` 发送 → 校验响应中的 `errcode`。

## 路线图

- **M1(已交付)**:企业微信群机器人出站通知
- **M2(规划中)**:公众号双向对话 + 可插拔回复引擎(方案 A:ZCode 会话当大脑;方案 B:任意 OpenAI 兼容接口,默认 DeepSeek)
- **M3(规划中)**:富消息(图片 / 模板卡片)、渠道管理、消息日志查询

设计细节见 [DESIGN.md](DESIGN.md)。

## 许可证

[MIT](LICENSE)
