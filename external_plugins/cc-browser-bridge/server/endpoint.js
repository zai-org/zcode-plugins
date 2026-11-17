// 统一桥接端点解析（唯一实现；launcher / mcp-stdio / onboard 注入共用同一规范结果）
// 规则（R3 修复）：
//   - BRIDGE_PORT：必须是 1..65535 的十进制整数；非法即明确报错，绝不悄悄回退 8765
//   - BRIDGE_URL：用 URL 严格解析；协议仅 http/https；禁止凭据、查询、与非根路径
//   - 同时设置：远程/HTTPS URL 不能被本地端口覆盖、端口不一致 → 冲突报错；
//     本地 http 且端口一致（或 URL 未写端口）→ 合法，端口取 BRIDGE_PORT
//   - manageable（可管理）仅指「本地回环 http 明文端点」：只有它允许拉起/接管本地桥接与引导；
//     远程端点与 HTTPS（含本地回环 https）端点只连接、绝不 spawn 任何本地服务
//   - 规范 url：可管理端点固定 http://127.0.0.1:<port>（本地桥接绑定 127.0.0.1）；
//     远程/HTTPS（含 https://localhost、[::1]）保留原主机用于连接/TLS-SNI，IPv6 只保留一对括号
"use strict";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "0.0.0.0"]);

function bad(error) {
  return { ok: false, error, manageable: false, local: false, secure: false, host: null, port: null, url: null };
}

function parseEndpoint(env = process.env) {
  const rawUrl = env.BRIDGE_URL === undefined || env.BRIDGE_URL === null ? "" : String(env.BRIDGE_URL).trim();
  const rawPort = env.BRIDGE_PORT === undefined || env.BRIDGE_PORT === null ? "" : String(env.BRIDGE_PORT).trim();

  let port = null;
  if (rawPort !== "") {
    if (!/^\d{1,5}$/.test(rawPort)) return bad("BRIDGE_PORT 非法：「" + rawPort + "」必须是 1..65535 的十进制整数（不会回退默认端口）");
    port = Number(rawPort);
    if (port < 1 || port > 65535) return bad("BRIDGE_PORT 超出范围：「" + rawPort + "」必须是 1..65535 的整数（不会回退默认端口）");
  }

  if (rawUrl !== "") {
    let u;
    try { u = new URL(rawUrl); } catch (e) { return bad("BRIDGE_URL 无法解析：「" + rawUrl + "」（不会回退默认端口）"); }
    const secure = u.protocol === "https:";
    if (u.protocol !== "http:" && u.protocol !== "https:") return bad("BRIDGE_URL 协议非法：" + u.protocol + "（仅支持 http/https）");
    if (u.username || u.password) return bad("BRIDGE_URL 不得携带用户名/密码凭据");
    if (u.pathname.replace(/\/+$/, "") !== "") return bad("BRIDGE_URL 不支持路径：「" + u.pathname + "」（桥接端点位于根路径）");
    if (u.search || u.hash) return bad("BRIDGE_URL 不支持查询串/片段：" + rawUrl);
    // Node 的 URL.hostname 对 IPv6 含方括号（如 "[::1]"）：先归一化去括号再匹配 localhost 集合
    const hostRaw = u.hostname.toLowerCase();
    const host = hostRaw.startsWith("[") && hostRaw.endsWith("]") ? hostRaw.slice(1, -1) : hostRaw;
    let urlPort;
    if (u.port !== "") {
      if (!/^\d{1,5}$/.test(u.port)) return bad("BRIDGE_URL 端口非法：" + u.port);
      urlPort = Number(u.port);
      if (urlPort < 1 || urlPort > 65535) return bad("BRIDGE_URL 端口超出范围：" + u.port);
    } else {
      urlPort = secure ? 443 : 80;
    }
    const local = LOCAL_HOSTS.has(host);
    if (port !== null) {
      if (!local || secure) return bad("BRIDGE_URL 与 BRIDGE_PORT 冲突：远程/HTTPS 端点（" + u.protocol + "//" + u.hostname + "）不能由本地端口覆盖");
      if (u.port !== "" && urlPort !== port) return bad("BRIDGE_URL 与 BRIDGE_PORT 冲突：端口不一致（" + urlPort + " ≠ " + port + "）");
      urlPort = port; // URL 未写显式端口：按优先级 BRIDGE_PORT > BRIDGE_URL[:port] > 8765，由 BRIDGE_PORT 决定端口
    }
    // IPv6 主机组装时只保留一对括号
    const hostPart = host.includes(":") ? "[" + host + "]" : host;
    if (!local) {
      // 远程端点：保留原主机（连接语义），只连接、不管理
      return { ok: true, manageable: false, local: false, secure, host, port: urlPort, url: (secure ? "https://" : "http://") + hostPart + ":" + urlPort };
    }
    if (secure) {
      // HTTPS（含回环）：不可由本地明文 bridge 管理，但连接必须保留原主机（TLS/SNI）
      return { ok: true, manageable: false, local: true, secure: true, host, port: urlPort, url: "https://" + hostPart + ":" + urlPort };
    }
    // 可管理端点：规范化为 http://127.0.0.1:<port>（本地桥接固定绑定 127.0.0.1）
    return { ok: true, manageable: true, local: true, secure: false, host: "127.0.0.1", port: urlPort, url: "http://127.0.0.1:" + urlPort };
  }

  if (port !== null) return { ok: true, manageable: true, local: true, secure: false, host: "127.0.0.1", port, url: "http://127.0.0.1:" + port };
  return { ok: true, manageable: true, local: true, secure: false, host: "127.0.0.1", port: 8765, url: "http://127.0.0.1:8765" };
}

module.exports = { parseEndpoint, LOCAL_HOSTS };
