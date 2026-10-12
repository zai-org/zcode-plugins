# IDOR/BOLA 越权漏洞

## 核心原理
应用允许用户通过输入直接访问/修改对象，没有正确的权限校验。

## 测试方法

### 1. 数字参数递增/递减
```
GET /api/orders/287789  →  287790, 287791, 287792
```

### 2. 常见标识符猜测
- 用户名/邮箱：`john`, `john.doe@mail.com`
- Base64 编码：`am9obi5kb2VAbWFpbC5jb20=`

### 3. 弱伪随机数生成器
- **UUID v1**：包含时间戳，可预测（`95f6e264-bb00-11ec-8833-00155d01ef00`）
- **MongoDB ObjectId**：含时间戳+机器ID+进程ID+计数器（`5ae9b90a2c144b9def01ec37`）

### 4. 哈希参数
- MD5/SHA1/SHA2 弱哈希标识符

### 5. 通配符参数
```
GET /api/users/*
GET /api/users/%
GET /api/users/_
```

### 6. 请求操纵技巧
- 切换 HTTP 方法：`POST → PUT`
- 修改 Content-Type：`XML → JSON`
- 值转数组：`{"id":19} → {"id":[19]}`
- 参数污染：`user_id=hacker_id&user_id=victim_id`

## 工具
- **Authz**（PortSwigger BApp Store）— 自动对比不同用户权限
- **AuthMatrix**（PortSwigger BApp Store）— 矩阵式权限测试
- **Autorize**（PortSwigger BApp Store）— 自动检测越权

## SRC 实战要点
- 用 A/B 账号对照测试
- **错误消息是金矿** — 无效值常返回有效值列表（Airbnb/Facebook 都这样）
- **新功能 = 新漏洞** — 新代码没经过加固
- **移动端 API 通常比 Web 防护弱**
- **推送/短信通知也是攻击面**，不仅是 web 端点
- **写操作（删除/修改）往往比读操作更容易找到**
- **跨应用 IDOR** — 同一 ID 空间跨多个应用（Harvest 案例）
- 不仅测 GET，POST/PUT/DELETE 同样可能越权
- 数组参数 `{"id":[19]}` 经常绕过校验

## 真实案例
→ Read `cases/idor-cases.md`
