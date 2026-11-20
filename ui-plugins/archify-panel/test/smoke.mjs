import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const workspace = process.argv[2] || root;
await mkdir(workspace, { recursive: true });

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, 'dist', 'server.mjs')],
  cwd: workspace,
  env: { ...process.env, ZCODE_WORKSPACE_ROOT: workspace },
});

const client = new Client({ name: 'smoke', version: '0.1.0' });
await client.connect(transport);

const tools = await client.listTools();
console.log('工具：', tools.tools.map((tool) => tool.name).join(', '));

const spec = JSON.parse(
  await readFile(join(root, 'vendor', 'archify', 'examples', 'agent-tool-call.workflow.json'), 'utf8'),
);
const rendered = await client.callTool({
  name: 'render_diagram',
  arguments: { type: 'workflow', spec, title: '冒烟测试图' },
});
console.log('渲染：', JSON.stringify(rendered.structuredContent));

const diagramId = rendered.structuredContent?.diagram?.id;
const artifact = await client.readResource({ uri: `archify://artifact-interactive/${diagramId}` });
const html = artifact.contents[0]?.text ?? '';
console.log('产物长度：', html.length, '含导出菜单：', html.includes('exportMenu'));

const current = await client.callTool({ name: 'get_current_diagram', arguments: {} });
console.log('当前图：', JSON.stringify(current.structuredContent));

const saved = await client.callTool({
  name: 'save_export',
  arguments: {
    name: '冒烟测试.png',
    data: Buffer.from('png-bytes').toString('base64'),
    encoding: 'base64',
    directory: '.archify-panel/exports',
  },
});
if (saved.isError) throw new Error(`save_export 失败：${JSON.stringify(saved.content)}`);
console.log('导出：', JSON.stringify(saved.structuredContent));

await client.close();
