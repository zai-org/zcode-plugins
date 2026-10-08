// 性能与内存检查（可发布门槛）：
// - 服务端 RSS：开关 100 份文档后 < 120MB（watcher/timer 已释放）
// - 大文档（5MB）读/写/patch 延迟在可接受范围
// 直接运行：node scripts/perf.mjs（需先 pnpm build）
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readFile } from "node:fs/promises";

const ws = mkdtempSync(join(tmpdir(), "md-perf-"));
const dataDir = mkdtempSync(join(tmpdir(), "md-perf-data-"));
// 与安装清单一致：限制老生代，让大对象空间及时回收。
const manifest = JSON.parse(await readFile("../../plugins/markdown/.zcode-plugin/plugin.json", "utf8"));
const serverArgs = manifest.mcpServers.markdown.args.map((arg) =>
  arg.replaceAll("${ZCODE_PLUGIN_ROOT}", resolve(".")),
);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: serverArgs,
  cwd: ws,
  env: {
    PATH: process.env.PATH ?? "",
    ZCODE_WORKSPACE_ROOT: ws,
    ZCODE_PLUGIN_DATA: dataDir,
    MARKDOWN_IDLE_GC_MS: "2000",
  },
  stderr: "ignore",
});
const started = Date.now();
const c = new Client({ name: "perf", version: "1" });
await c.connect(transport);
console.log(`server ready: ${Date.now() - started}ms`);

const call = async (name, args) => {
  const result = await c.callTool({ name, arguments: args });
  if (result.isError) throw new Error(`${name}: ${JSON.stringify(result.content)}`);
  return result;
};

// 1. 开关 100 份文档 → RSS 增长（通过 ps 读取子进程 RSS）
const { execFile } = await import("node:child_process");
const { promisify } = await import("node:util");
const exec = promisify(execFile);
const childPid = transport._process?.pid ?? (transport).pid;
async function serverRssMb() {
  if (!childPid) return -1;
  const { stdout } = await exec("ps", ["-o", "rss=", "-p", String(childPid)]);
  return Number(stdout.trim()) / 1024;
}

for (let i = 0; i < 100; i += 1) {
  const created = await call("new_document", { path: `doc-${i}.md`, content: `# 文档 ${i}\n\n内容。` });
  const id = created.structuredContent.document.id;
  await call("commit_draft", { id, content: `# 文档 ${i} v2\n\n更多内容。`, expectedRevision: 1 });
  await call("close_document", { id });
}
await new Promise((r) => setTimeout(r, 300));
const rssAfterDocs = await serverRssMb();
console.log(`RSS after 100 open/close cycles: ${rssAfterDocs.toFixed(1)} MB`);

// 2. 大文档 5MB 读写 patch
const bigParagraph = "这是一段用于性能测试的中文文本，重复填充到目标体积。".repeat(40);
let big = "# 大文档\n\n";
while (Buffer.byteLength(big, "utf8") < 5 * 1024 * 1024) big += `${bigParagraph}\n\n`;
const t0 = Date.now();
const bigDoc = await call("new_document", { path: "big.md", content: big });
const tCreate = Date.now() - t0;
const t1 = Date.now();
await call("read_document", { path: "big.md" });
const tRead = Date.now() - t1;
const bigId = bigDoc.structuredContent.document.id;
const t2 = Date.now();
const patched = await call("patch_document", { path: "big.md", ops: [{ find: "性能测试", replace: "效能测试", all: true }] });
const tPatch = Date.now() - t2;
const t3 = Date.now();
await call("commit_draft", { id: bigId, content: big.replace(/性能测试/g, "回写测试"), expectedRevision: patched.structuredContent.document.revision });
const tWrite = Date.now() - t3;
console.log(`5MB doc — create: ${tCreate}ms, read: ${tRead}ms, patch: ${tPatch}ms, write: ${tWrite}ms`);

// 大文档重复三轮：区分 GC 余量（趋于平稳）与真泄漏（线性增长）。
const rounds = [];
for (let round = 0; round < 3; round += 1) {
  const tr = Date.now();
  await call("open_document", { path: "big.md" });
  const edited = await call("patch_document", {
    path: "big.md",
    ops: [{ find: "回写测试", replace: `第${round}轮`, all: true }],
  });
  await call("commit_draft", {
    id: bigId,
    content: `${big.replace(/性能测试/g, "回写测试")}
<!-- round ${round} -->`,
    expectedRevision: edited.structuredContent.document.revision,
  });
  rounds.push({ round, ms: Date.now() - tr, rss: await serverRssMb() });
  console.log(`round ${round}: ${rounds[round].ms}ms, RSS ${rounds[round].rss.toFixed(1)} MB`);
  await new Promise((r) => setTimeout(r, 1500));
}
// 3. 关闭大文档后：RSS 不再增长（V8 不把页还给 OS，但必须停止增长）
await call("close_document", { id: bigId });
await new Promise((r) => setTimeout(r, 5000));
const idleRss = await serverRssMb();
const rssFinal = rounds[rounds.length - 1].rss;
const growthPerRound = (rounds[2].rss - rounds[0].rss) / 2;
console.log(
  `small-doc RSS: ${rssAfterDocs.toFixed(1)} MB; peak: ${rssFinal.toFixed(1)} MB; growth/round: ${growthPerRound.toFixed(1)} MB; after close: ${idleRss.toFixed(1)} MB`,
);

// 门槛（内存）：常规负载（小文档）< 120MB；大文档压力有界（< 400MB）且平稳（非泄漏）；关闭后不再增长
const ok =
  rssAfterDocs < 120 &&
  rssFinal < 400 &&
  Math.abs(growthPerRound) < 20 &&
  idleRss <= rssFinal + 5 &&
  tRead < 2000 &&
  tPatch < 3000;
await c.close();
await import("node:fs/promises").then(async ({ rm }) => {
  await rm(ws, { recursive: true, force: true });
  await rm(dataDir, { recursive: true, force: true });
});
console.log(ok ? "PERF OK" : "PERF CHECK FAILED");
process.exit(ok ? 0 : 1);
