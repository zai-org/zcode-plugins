import { format } from "node:util";

// stdout 只走 MCP 协议。pdf.js 在加载时用 console.log 输出警告（如没有 canvas），
// 所以在导入任何其他模块之前把 console 的输出改到 stderr。
for (const method of ["log", "info", "warn", "debug"] as const)
  console[method] = (...args: unknown[]) => void process.stderr.write(`${format(...args)}\n`);
