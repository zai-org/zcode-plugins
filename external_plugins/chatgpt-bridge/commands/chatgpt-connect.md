---
description: 打开本机 ChatGPT 订阅桥接控制台，完成授权或查看连接配置
---
使用终端执行下面的命令，打开独立的本地控制台。登录由用户在 OpenAI 官方浏览器页面完成，不要代填账号密码，不读取或输出 state.json、OAuth token、本地 API Key 或管理密钥。

```sh
node "$HOME/Library/Application Support/ZCode ChatGPT Bridge/app/bin/bridge.mjs" open
```

向用户说明：控制台可登录 ChatGPT、刷新账号模型目录，并提供添加 ZCode 自定义供应商所需的信息；接口格式选 OpenAI Responses。若服务没有安装，指出需要先运行发行包中的“安装.command”。不要把本插件描述为已替换当前会话主模型。
