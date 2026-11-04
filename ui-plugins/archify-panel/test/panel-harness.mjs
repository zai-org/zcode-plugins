import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputDir = process.argv[2] || '/tmp/archify-panel-harness';
mkdirSync(outputDir, { recursive: true });

const artifactPath = process.argv[3];
if (!artifactPath) {
  console.error('用法：node test/panel-harness.mjs <输出目录> <产物 html>');
  process.exit(1);
}

const artifact = readFileSync(artifactPath, 'utf8');
const artifactBase64 = Buffer.from(artifact, 'utf8').toString('base64');
const panel = readFileSync(join(root, 'dist', 'ui', 'panel.html'), 'utf8');
writeFileSync(join(outputDir, 'panel.html'), panel, 'utf8');

const diagram = {
  id: 'test-diagram',
  title: '测试图',
  type: 'workflow',
  quality: 'showcase',
  bytes: artifact.length,
  createdAt: new Date().toISOString(),
  gates: { validate: 'pass', deliver: 'pass', check: 'pass', 'browser-check': 'pass' },
  degraded: false,
  htmlPath: artifactPath,
};

const harness = `<!doctype html>
<html><head><meta charset="utf-8"><title>WAITING</title></head>
<body>
<iframe id="panel" src="panel.html" width="1000" height="700"></iframe>
<script>
const artifact = new TextDecoder().decode(Uint8Array.from(atob(${JSON.stringify(artifactBase64)}), (c) => c.charCodeAt(0)));
const diagram = ${JSON.stringify(diagram)};
const events = [];
window.__events = events;
window.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || message.jsonrpc !== '2.0') return;
  const reply = (result) => event.source.postMessage({ jsonrpc: '2.0', id: message.id, result }, '*');
  if (message.method === 'ui/initialize') {
    events.push('ui/initialize');
    reply({ protocolVersion: '2026-01-26', hostInfo: { name: 'harness', version: '0.1.0' },
      hostCapabilities: {}, hostContext: { theme: 'light', locale: 'zh-CN' } });
    return;
  }
  if (message.method === 'resources/read') {
    const uri = message.params.uri;
    events.push('resources/read ' + uri);
    reply({ contents: [{ uri, mimeType: 'text/html', text: artifact }] });
    return;
  }
  if (message.method === 'tools/call') {
    const name = message.params.name;
    events.push('tools/call ' + name);
    if (name === 'get_current_diagram') reply({ content: [{ type: 'text', text: 'ok' }], structuredContent: { diagram } });
    else if (name === 'save_export') {
      events.push('save_export bytes=' + (message.params.arguments.data || '').length + ' name=' + message.params.arguments.name);
      reply({ content: [{ type: 'text', text: 'ok' }], structuredContent: { path: '.archify-panel/exports/test.png', uri: 'archify://file/token/0', name: message.params.arguments.name, mimeType: 'image/png' } });
    } else reply({ content: [{ type: 'text', text: 'ok' }], structuredContent: {} });
    return;
  }
  if (message.method === 'ui/download-file') {
    events.push('ui/download-file ' + JSON.stringify(message.params.contents));
    reply({ success: true, path: '/tmp/test.png' });
    return;
  }
  if (message.method === 'ui/update-model-context') {
    events.push('ui/update-model-context ' + JSON.stringify(message.params.structuredContent || {}));
    reply({});
    return;
  }
  if (message.id !== undefined) reply({});
});

const frame = document.getElementById('panel');
frame.addEventListener('load', () => {
  setTimeout(async () => {
    try {
      const doc = frame.contentDocument;
      const inner = doc.querySelector('.stage iframe');
      const innerDoc = inner ? inner.contentDocument : null;
      const innerWin = innerDoc ? innerDoc.defaultView : null;
      const hasArchify = !!(innerWin && innerWin.Archify);
      const theme = innerDoc ? innerDoc.documentElement.getAttribute('data-theme') : null;
      document.title = 'PART1|innerLoaded=' + (innerDoc ? 'yes' : 'no') +
        '|archify=' + hasArchify + '|theme=' + theme;
      if (!hasArchify) throw new Error('产物未暴露 Archify API');
      innerWin.Archify.exportMenu.run('png');
      await new Promise((r) => setTimeout(r, 12000));
      const afterPng = doc.querySelector('.status span')?.textContent || '';
      document.title = 'RESULT|innerLoaded=' + (innerDoc ? 'yes' : 'no') +
        '|archify=' + hasArchify + '|theme=' + theme +
        '|png=' + afterPng +
        '|events=' + events.join(' ; ');
    } catch (error) {
      document.title = 'ERROR|' + (error && error.message) + '|events=' + events.join(' ; ');
    }
  }, 2500);
});
</script></body></html>`;

writeFileSync(join(outputDir, 'harness.html'), harness, 'utf8');
console.log(join(outputDir, 'harness.html'));
