import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  createArtifactDir,
  diagramTypes,
  finalizeDiagram,
  type DiagramType,
} from './archify.js';
import { archifyRoot, assetRoot, workspaceRoot } from './paths.js';
import {
  addDiagram,
  getCurrentDiagram,
  getDiagram,
  getFileHandle,
  putFileHandle,
  setCurrentDiagram,
  type DiagramRecord,
} from './store.js';

const PLUGIN_NAME = 'archify-panel';
const PLUGIN_VERSION = '0.1.0';
const SURFACE_ID = 'archify';
const PANEL_URI = `ui://${SURFACE_ID}/panel.html`;
const HTML_MIME = 'text/html;profile=mcp-app';
const FILE_PREFIX = `archify://file/`;
const CHUNK_BYTES = 4 * 1024 * 1024;

const server = new McpServer({ name: PLUGIN_NAME, version: PLUGIN_VERSION });

type Visibility = 'model' | 'app';

function uiMeta(visibility: Visibility[]) {
  return {
    ui: {
      resourceUri: PANEL_URI,
      surface: SURFACE_ID,
      visibility,
    },
    // 声明全屏面板展示：画图需要大空间，避免宿主把图形内嵌在会话里
    'openai/ui': { preferredModelDisplayMode: 'fullscreen' },
  };
}

function textResult(text: string, structuredContent?: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text }],
    ...(structuredContent ? { structuredContent } : {}),
  };
}

function mimeTypeFor(name: string): string {
  const extension = name.toLowerCase().split('.').pop();
  if (extension === 'pdf') return 'application/pdf';
  if (extension === 'svg') return 'image/svg+xml';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'jpeg' || extension === 'jpg') return 'image/jpeg';
  return 'image/png';
}

function diagramSummary(record: DiagramRecord) {  return {
    id: record.id,
    title: record.title,
    type: record.type,
    quality: record.quality,
    bytes: record.bytes,
    createdAt: record.createdAt,
    gates: record.gates,
    degraded: record.degraded,
    htmlPath: record.htmlPath,
  };
}

server.registerTool(
  'render_diagram',
  {
    description:
      '把一份 Archify JSON IR 渲染成可交互的单文件 HTML 图形，并登记到侧栏面板。可用类型：' +
      diagramTypes.join('、') +
      '。渲染完成后产物会显示在 ZCode 侧栏，用户可以在图形自带的导出菜单里导出 PNG/SVG/分享卡片。',
    inputSchema: {
      type: z.enum(diagramTypes as [DiagramType, ...DiagramType[]]),
      spec: z.union([z.string(), z.record(z.string(), z.unknown())]),
      title: z.string().max(200).optional(),
      quality: z.enum(['standard', 'showcase']).optional(),
      repoRoot: z.string().max(400).optional(),
    },
    _meta: uiMeta(['model', 'app']),
  },
  async (input) => {
    let spec: unknown = input.spec;
    if (typeof spec === 'string') {
      try {
        spec = JSON.parse(spec);
      } catch {
        return textResult('spec 不是合法 JSON', { error: { code: 'invalid_spec', message: 'spec 不是合法 JSON' } });
      }
    }
    const title = input.title?.trim() || '未命名图形';
    const { dir, slug } = await createArtifactDir(input.type, title);
    const result = await finalizeDiagram({
      type: input.type,
      spec,
      dir,
      slug,
      quality: input.quality ?? 'showcase',
      repoRoot: input.repoRoot,
    });
    if (!result.ok) {
      return textResult(`渲染失败：${result.error ?? '未知错误'}`, {
        error: { code: 'render_failed', message: result.error ?? '未知错误' },
        diagnostics: result.diagnostics,
      });
    }
    const record = await addDiagram({
      title,
      type: result.type,
      quality: result.quality,
      htmlPath: result.artifactPath,
      bytes: result.artifactBytes,
      gates: result.gates,
      degraded: result.degraded,
    });
    const gateText = Object.entries(result.gates)
      .map(([name, state]) => `${name}=${state}`)
      .join(', ');
    const note = result.degraded ? '；浏览器校验被跳过，产物仍然交付' : '';
    return textResult(
      `已生成 ${result.type} 图：${title}（${gateText}${note}）`,
      { diagram: diagramSummary(record) },
    );
  },
);

server.registerTool(
  'get_authoring_assets',
  {
    description:
      '返回 Archify 的 schema、用例与写作参考的绝对路径。写图前先调用它，拿到路径后读取对应 schema 再编写 JSON IR。',
    inputSchema: {},
    // 只关联 visibility，不带面板 surface，避免宿主在产物还没生成时就打开空画布
    _meta: { ui: { visibility: ['model' as Visibility] } },
  },
  async () => {
    const schemas = (await readdir(join(archifyRoot, 'schemas')))
      .filter((name) => name.endsWith('.schema.json'))
      .map((name) => join(archifyRoot, 'schemas', name));
    const examples = (await readdir(join(archifyRoot, 'examples')))
      .filter((name) => name.endsWith('.json'))
      .map((name) => join(archifyRoot, 'examples', name));
    const references = (await readdir(join(archifyRoot, 'references')))
      .filter((name) => name.endsWith('.md'))
      .map((name) => join(archifyRoot, 'references', name));
    return textResult(`Archify 写作资源根目录：${archifyRoot}`, {
      root: archifyRoot,
      schemas,
      examples,
      references,
    });
  },
);

server.registerTool(
  'open_diagram',
  {
    description: '把指定的 Archify 图形设为侧栏面板当前显示的图。',
    inputSchema: { id: z.string().min(1) },
    _meta: uiMeta(['model', 'app']),
  },
  async (input) => {
    const record = await setCurrentDiagram(input.id);
    if (!record) {
      return textResult('找不到这张图', { error: { code: 'not_found', message: input.id } });
    }
    return textResult(`侧栏已切换到：${record.title}`, { diagram: diagramSummary(record) });
  },
);

server.registerTool(
  'get_current_diagram',
  {
    description: '返回侧栏面板当前显示的 Archify 图形信息，面板刷新后用它恢复现场。',
    inputSchema: {},
    _meta: uiMeta(['app']),
  },
  async () => {
    const record = await getCurrentDiagram();
    return textResult(record ? `当前图：${record.title}` : '当前没有图', {
      diagram: record ? diagramSummary(record) : null,
    });
  },
);

server.registerTool(
  'save_export',
  {
    description: '把面板导出的图片或 PDF 字节写进工作区文件。',
    inputSchema: {
      name: z.string().min(1).max(200),
      data: z.string().min(1),
      encoding: z.enum(['base64', 'text']).default('base64'),
      directory: z.string().max(400).optional(),
    },
    _meta: uiMeta(['app']),
  },
  async (input) => {
    try {
      const directory = resolve(workspaceRoot, input.directory ?? '.archify-panel');
      if (!directory.startsWith(workspaceRoot + sep)) {
        return {
          isError: true,
          ...textResult('导出目录必须位于工作区内', {
            error: { code: 'invalid_path', message: input.directory ?? '' },
          }),
        };
      }
      const target = resolve(directory, basename(input.name));
      if (!target.startsWith(directory + sep)) {
        return {
          isError: true,
          ...textResult('导出文件名非法', { error: { code: 'invalid_path', message: input.name } }),
        };
      }
      const bytes = Buffer.from(input.data, input.encoding === 'text' ? 'utf8' : 'base64');
      await mkdir(directory, { recursive: true });
      await writeFile(target, bytes);
      const token = putFileHandle({
        name: basename(input.name),
        mimeType: mimeTypeFor(input.name),
        bytes,
      });
      return textResult(`已保存：${relative(workspaceRoot, target)}`, {
        path: relative(workspaceRoot, target),
        bytes: bytes.byteLength,
        name: basename(input.name),
        mimeType: mimeTypeFor(input.name),
        token,
        uri: `${FILE_PREFIX}${token}/0`,
      });
    } catch (error) {
      // 把真实失败原因带回面板，不留兜底文案
      const message = error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        ...textResult(`保存失败：${message}`, {
          error: { code: 'save_failed', message },
        }),
      };
    }
  },
);

server.registerResource(
  'panel',
  PANEL_URI,
  { mimeType: HTML_MIME },
  async () => ({
    contents: [
      {
        uri: PANEL_URI,
        mimeType: HTML_MIME,
        text: await readFile(join(assetRoot, 'panel.html'), 'utf8'),
      },
    ],
  }),
);

server.registerResource(
  'artifact-interactive',
  new ResourceTemplate(`archify://artifact-interactive/{id}`, { list: undefined }),
  {},
  async (uri, { id }) => {
    const record = await getDiagram(String(id));
    if (!record) throw new Error(`找不到图形 ${id}`);
    const html = await readFile(record.htmlPath, 'utf8');
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/html',
          text: html,
        },
      ],
    };
  },
);

server.registerResource(
  'file',
  new ResourceTemplate(`${FILE_PREFIX}{token}/{index}`, { list: undefined }),
  {},
  async (uri, { token, index }) => {
    const handle = getFileHandle(String(token));
    if (!handle) throw new Error('导出文件已过期');
    const position = Number(index);
    const start = position * CHUNK_BYTES;
    const slice = handle.bytes.subarray(start, start + CHUNK_BYTES);
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: handle.mimeType,
          blob: slice.toString('base64'),
        },
      ],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[${PLUGIN_NAME}] 已启动，工作区 ${workspaceRoot}，资产目录 ${dirname(assetRoot)}`);
