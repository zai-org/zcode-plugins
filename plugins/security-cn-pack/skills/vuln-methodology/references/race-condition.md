# 竞态条件

## 核心原理
多请求并发时，开发者假设框架/服务器/语言处理了并发，但实际没有。

## 攻击类型

### 限制超越
- 超额提现
- 多次投票
- 重复礼品卡兑换
- 绕过邀请限制

### 速率限制绕过
- 绕过防爆破保护
- 绕过 2FA 机制

## 技术

### HTTP/1.1 最后字节同步（Turbo Intruder）
```python
engine.queue(request, gate='race1')
engine.queue(request, gate='race1')
engine.openGate('race1')
```

### HTTP/2 单包攻击
- 利用 HTTP/2 多路复用，一个连接发 20-30 个请求
- 消除网络抖动，请求同时到达服务器
- Burp Suite：Repeater → 复制 20 次 → 分组 → 单包攻击

## 真实案例
- 礼品卡竞态 → 免费钱（HackerOne #759247）
- 邀请限制绕过（HackerOne #115007）
- Instagram 密码重置竞态
- GitLab CVE-2022-4037

## 工具
- **Turbo Intruder**（Burp 扩展）
- **Raceocat**
- **h2spacex**（基于 Scapy 的 HTTP/2 单包攻击）

## SRC 实战要点
- 所有"限制一次"的功能都测竞态
- 礼品卡/优惠券/邀请码是高频目标
- HTTP/2 单包攻击比 HTTP/1.1 更可靠
