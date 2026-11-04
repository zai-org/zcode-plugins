import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';

interface DiagramMeta {
  id: string;
  title: string;
  type: string;
  quality: string;
  bytes: number;
  createdAt: string;
  gates: Record<string, string>;
  degraded: boolean;
  htmlPath: string;
}

const app = new App(
  { name: 'archify-panel', version: '0.1.0' },
  { tools: { listChanged: true }, availableDisplayModes: ['inline', 'fullscreen'] },
  { autoResize: false },
);

const state = {
  diagram: null as DiagramMeta | null,
  theme: 'light' as 'light' | 'dark',
};

const INTERACTIVE_URI = (id: string) => `archify://artifact-interactive/${id}`;

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string> = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, value);
  }
  for (const child of children) {
    node.append(child);
  }
  return node;
}

const root = document.getElementById('root');
if (!root) throw new Error('面板缺少根节点');

const stage = element('iframe', {
  sandbox: 'allow-scripts allow-same-origin',
  referrerpolicy: 'no-referrer',
  title: 'Archify 图形',
});

const statusText = element('span', {}, ['就绪']);
const statusPath = element('span', {});

const status = element('footer', { class: 'status' }, [statusText, statusPath]);
root.replaceChildren(element('main', { class: 'stage' }, [stage]), status);

function setStatus(message: string, path?: string, isError = false): void {
  statusText.textContent = message;
  statusText.className = isError ? 'error' : '';
  statusPath.textContent = path ?? '';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 宿主按内容高度摆放面板时，靠这个通知保持面板撑满 */
function reportSize(): void {
  void app
    .sendSizeChanged({ width: window.innerWidth, height: window.innerHeight })
    .catch(() => undefined);
}

async function callTool(name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const result = await app.callServerTool({ name, arguments: args });
  const structured = result.structuredContent as Record<string, unknown> | undefined;
  if (result.isError) {
    const error = structured?.error as { message?: string } | undefined;
    throw new Error(error?.message ?? `${name} 调用失败`);
  }
  return structured ?? {};
}

function applyTheme(): void {
  document.documentElement.setAttribute('data-theme', state.theme);
  const inner = stage.contentDocument;
  if (inner?.documentElement) {
    inner.documentElement.setAttribute('data-theme', state.theme);
  }
}

function describeGates(gates: Record<string, string>): string {
  const browser = gates['browser-check'];
  const degraded = browser === 'skipped';
  const summary = Object.entries(gates)
    .map(([name, state]) => `${name}=${state}`)
    .join('，');
  return degraded ? `${summary}（未做浏览器校验）` : summary;
}

function renderDiagramMeta(diagram: DiagramMeta): void {
  state.diagram = diagram;
  setStatus(describeGates(diagram.gates), diagram.htmlPath);
}

async function loadArtifact(diagram: DiagramMeta): Promise<void> {
  const result = await app.readServerResource({ uri: INTERACTIVE_URI(diagram.id) });
  const content = result.contents[0];
  if (!content || !('text' in content) || typeof content.text !== 'string') {
    throw new Error('产物内容为空');
  }
  stage.addEventListener(
    'load',
    () => {
      applyTheme();
      installExportBridge();
    },
    { once: true },
  );
  stage.srcdoc = content.text;
}

async function showDiagram(diagram: DiagramMeta): Promise<void> {
  try {
    renderDiagramMeta(diagram);
    await loadArtifact(diagram);
    await sleep(120);
    applyTheme();
    await reportContext();
  } catch (error) {
    setStatus(`载入失败：${(error as Error).message}`, undefined, true);
  }
}

async function reportContext(): Promise<void> {
  if (!state.diagram) return;
  const diagram = state.diagram;
  try {
    await app.updateModelContext({
      content: [
        {
          type: 'text',
          text:
            `侧栏当前显示 Archify 图形：${diagram.title}（类型 ${diagram.type}，id ${diagram.id}）。` +
            '需要细节时用 render_diagram 的同一份 JSON IR 或直接问这张图。',
        },
      ],
      structuredContent: {
        kind: 'active-diagram',
        diagramId: diagram.id,
        title: diagram.title,
        type: diagram.type,
        htmlPath: diagram.htmlPath,
      },
    });
  } catch {
    // 宿主不支持上下文回注时静默降级
  }
}

async function saveAndOffer(blob: Blob, name: string, mimeType: string): Promise<void> {
  try {
    const base64 = await blobToBase64(blob);
    const structured = await callTool('save_export', {
      name,
      data: base64,
      encoding: 'base64',
      directory: '.archify-panel/exports',
    });
    const uri = structured.uri as string | undefined;
    const path = structured.path as string | undefined;
    setStatus(`已导出 ${name}`, path);
    if (uri) {
      try {
        await app.downloadFile({ contents: [{ type: 'resource_link', uri, mimeType, name }] });
      } catch {
        setStatus(`已导出 ${name}（宿主未弹出另存为）`, path);
      }
    }
  } catch (error) {
    setStatus(`导出失败：${(error as Error).message}`, undefined, true);
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** 产物自带导出在沙箱 iframe 里会被浏览器拦截，截获导出二进制并转交宿主保存 */
function installExportBridge(): void {
  const frame = stage.contentWindow as (Window & typeof globalThis) | null;
  if (!frame) return;
  const blobsByUrl = new Map<string, Blob>();
  const originalCreateObjectURL = frame.URL.createObjectURL;
  frame.URL.createObjectURL = function patched(blob: Blob | MediaSource): string {
    const url = originalCreateObjectURL.call(frame.URL, blob);
    // 产物在内层框架的另一个 realm 里创建 Blob，跨 realm 的 instanceof 恒为假，只能按结构判断
    if (blob && typeof (blob as Blob).type === 'string') blobsByUrl.set(url, blob as Blob);
    return url;
  };
  const originalAnchorClick = frame.HTMLAnchorElement.prototype.click;
  frame.HTMLAnchorElement.prototype.click = function patched(this: HTMLAnchorElement): void {
    const name = this.getAttribute('download');
    const href = this.getAttribute('href') ?? '';
    const blob = name ? blobsByUrl.get(href) : undefined;
    if (!blob || !name) {
      originalAnchorClick.call(this);
      return;
    }
    blobsByUrl.delete(href);
    void saveAndOffer(blob, name, blob.type || 'application/octet-stream');
  };
}

app.ontoolresult = (result) => {
  const structured = result.structuredContent as { diagram?: DiagramMeta } | undefined;
  if (structured?.diagram) {
    void showDiagram(structured.diagram);
  }
};

app.onhostcontextchanged = () => {
  const theme = app.getHostContext()?.theme;
  if (theme === 'light' || theme === 'dark') {
    state.theme = theme;
    applyTheme();
  }
};

async function boot(): Promise<void> {
  try {
    await app.connect(new PostMessageTransport(window.parent, window.parent));
  } catch (error) {
    setStatus(`连接宿主失败：${(error as Error).message}`, undefined, true);
    return;
  }
  const theme = app.getHostContext()?.theme;
  if (theme === 'light' || theme === 'dark') state.theme = theme;
  applyTheme();
  reportSize();
  window.addEventListener('resize', reportSize);
  try {
    const structured = await callTool('get_current_diagram');
    const diagram = structured.diagram as DiagramMeta | undefined;
    if (diagram) {
      await showDiagram(diagram);
    } else {
      setStatus('还没有图形，请让 Agent 生成一张');
    }
  } catch (error) {
    setStatus(`读取当前图失败：${(error as Error).message}`, undefined, true);
  }
}

void boot();
