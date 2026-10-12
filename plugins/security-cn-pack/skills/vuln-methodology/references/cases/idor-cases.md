# IDOR 真实案例

## Airbnb — 推送通知 IDOR（buer.haus）

### 步骤
1. 发现新功能 "Experiences" 引入新代码
2. 找到两个新 API：`/api/v2/air_sms_notifications` 和 `/api/v2/air_push_notifications`
3. 传无效 `template` 值 → 返回所有有效模板列表
4. 传缺失属性 → API 告诉你缺什么字段
5. 发现 `object_id` 是顺序数字标识符，无权限校验
6. 递增 `object_id` → 读取 Airbnb 所有私信

### 关键洞察
- 推送通知通道优于短信：无长度限制、无限流
- 错误消息泄露有效值列表

## Facebook — 支付卡信息 IDOR（Josip Franjkovic）

### 步骤
1. 拦截 Android 应用所有请求
2. 发现 `payment_modules_options` 字段
3. 构造 Graph API 查询：`graph.facebook.com/v2.8/USER_ID?fields=payment_modules_options.payment_type(...)`
4. 无效 `payment_type` 返回所有可能的支付类型
5. 有效类型返回：BIN、后四位、有效期、持卡人姓名、邮编、国家

### 关键洞察
- 移动端 API 比 Web 防护弱
- 无效参数值返回有效值列表

## 其他高价值案例
| 目标 | 漏洞 | 赏金 |
|------|------|------|
| Uber | 修改任意用户密码 | — |
| Uber | 改 paymentProfileUuid 免费乘车 | — |
| Facebook | 暴露主邮箱 | $4,500 |
| Facebook | 任意用户好友列表+部分卡信息 | — |
| Facebook | 删除任意用户视频 | — |
| Twitter | 以任意用户发推 | — |
| Vimeo | 所有私有视频泄露 | — |
| Airbnb | 查看私信（web-to-app 通知 IDOR） | — |
| PayPal | 绕过 2FA | — |
