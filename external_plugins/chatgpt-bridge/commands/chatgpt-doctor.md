---
description: 诊断 ChatGPT 桥接服务、登录授权与模型目录
---
执行 `node "$HOME/Library/Application Support/ZCode ChatGPT Bridge/app/bin/bridge.mjs" doctor`。区分本地服务、账号授权、模型目录和真实推理状态。doctor 不会发起付费推理，也不能证明工具调用已验证。需要完整推理验证时，由用户在 ZCode 选择桥接模型并发送任务。不要输出凭据或读取 state.json。
