// stdout 只留给 MCP 协议；依赖库的日志改写到 stderr。
console.log = (...args: unknown[]) => process.stderr.write(`${args.map(String).join(" ")}\n`);
console.info = console.log;
console.warn = console.log;
console.debug = console.log;
