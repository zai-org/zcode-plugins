---
name: vuln-methodology
description: 漏洞挖掘方法论参考手册。覆盖 11 种漏洞类型的完整测试方法、绕过技术、真实案例和工具清单。当用户提到"怎么挖 XX 漏洞 / XX 漏洞怎么测 / IDOR 怎么找 / SSRF 怎么绕 / JWT 怎么破 / 竞态条件怎么测 / 原型污染怎么打 / 请求走私怎么测 / XSS 怎么绕 / SQLi WAF 绕过 / API 安全怎么测 / IoT 设备怎么渗透 / 认证绕过 / 业务逻辑漏洞"或问某种漏洞的测试方法时触发。
argument-hint: "<vuln-type-or-question>"
level: 2
---

# 漏洞挖掘方法论手册

这是**参考手册**，不是工作流。用户问某种漏洞怎么测时，按需 Read 对应章节文件。

## 触发条件

命中任一即进入：
- "怎么挖 / 怎么测 / 怎么打 + 某漏洞类型"
- "IDOR / BOLA / SSRF / XSS / SQLi / JWT / 竞态 / 原型污染 / 请求走私 / API 安全 / IoT / 认证绕过 / 业务逻辑"
- "XX 漏洞怎么绕 / 怎么 bypass"
- 用户描述了一个场景，需要判断属于哪类漏洞

**不应触发**：SRC 全流程工作流 → `src-hunter` skill；CTF → 通用对话。

---

## 反幻觉硬约束

1. **不准凭记忆出 payload**。给任何 payload 前，先 Read 对应 `references/<type>.md`。
2. **不准编造案例**。引用真实案例前必须 Read `references/cases/` 下的实际文件。
3. **无证据不下结论**。无 HTTP 包/截图时只能写"待验证 / 假设"。

---

## 漏洞类型索引

| # | 类型 | 参考文件 | 触发关键词 |
|---|------|----------|-----------|
| 1 | IDOR/BOLA | `references/idor.md` | 越权、IDOR、BOLA、水平越权、垂直越权 |
| 2 | SSRF | `references/ssrf.md` | SSRF、服务端请求伪造、DNS重绑定 |
| 3 | 业务逻辑 | `references/business-logic.md` | 业务逻辑、逻辑漏洞、折扣码、退款 |
| 4 | 竞态条件 | `references/race-condition.md` | 竞态、race condition、并发、单包攻击 |
| 5 | 原型污染 | `references/prototype-pollution.md` | 原型污染、prototype pollution、__proto__ |
| 6 | 请求走私 | `references/request-smuggling.md` | 请求走私、request smuggling、CL.TE、TE.CL |
| 7 | XSS | `references/xss.md` | XSS、跨站脚本、DOM XSS、mXSS、CSP绕过 |
| 8 | SQL注入 | `references/sqli.md` | SQLi、SQL注入、时间盲注、WAF绕过 |
| 9 | API安全 | `references/api-security.md` | API安全、Mass Assignment、GraphQL、速率限制 |
| 10 | IoT/嵌入式 | `references/iot-security.md` | IoT、嵌入式、固件、UART、JTAG、故障注入 |
| 11 | 认证绕过/JWT | `references/auth-bypass.md` | JWT、认证绕过、kid注入、密钥混淆、HPP |

---

## 使用方式

1. 用户提问 → 查上表确定漏洞类型
2. Read 对应的 `references/<type>.md`
3. 按文件中的方法论回答，payload 必须来自文件
4. 如需真实案例 → Read `references/cases/` 下对应文件

---

## 工具清单

详见 `references/tools.md`。
