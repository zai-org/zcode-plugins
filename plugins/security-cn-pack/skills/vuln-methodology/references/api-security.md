# API 安全

## Mass Assignment
- 攻击者修改不应访问的对象属性（如 `is_admin: true`）
- 测试：每个 JSON body 都试加额外字段
- 预防：白名单允许字段

## GraphQL 漏洞
- **内省暴露**：生产环境应禁用（允许 schema 枚举）
- **嵌套查询攻击**：需查询深度限制
- **资源耗尽**：需查询成本分析
- **未授权查询执行**：生产环境白名单允许的查询

## 速率限制
- 按 API key + IP 限流
- 滑动窗口优于固定窗口
- 指数退避
- 可疑活动后 CAPTCHA/proof-of-work

## 信息泄露
- 移除响应头：`X-Powered-By`、`Server`、`X-AspNet-Version`
- 不返回过于具体的错误信息
- 生产环境关闭 DEBUG 模式

## SRC 实战要点
- API 是 SRC 新战场，很多大厂 API 防护弱于主站
- GraphQL 内省没关 = 低垂果实
- Mass Assignment 在现代 API 中仍然常见
