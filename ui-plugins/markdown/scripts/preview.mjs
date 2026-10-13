// 隔离的本地预览：真实 MCP 服务 + 临时工作区，不写用户文档。
import { startFixture } from "./browser-fixture.mjs";
const fixture = await startFixture();
const payload = await fixture.call("new_document", {
  path: "docs/writing.md",
  content:
    '# 写作与思考\n\n让文字成为主角。编辑、切换与保存应当安静而可靠。\n\n## 今天的计划\n\n- [ ] 整理想法\n- [ ] 完成初稿\n\n## 一段引用\n\n> 好的工具，让人专注于内容本身。\n\n```typescript\nconst message = "Hello, Markdown";\n```\n\n| 功能 | 状态 |\n| --- | --- |\n| 自动保存 | 可用 |\n| 冲突保护 | 可用 |\n',
});
console.log(`${fixture.url}/?doc=${payload.document.id}`);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await fixture.close();
    process.exit();
  });
