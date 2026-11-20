import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { evaluate, launchChrome, openPage, waitFor } from './cdp.mjs';

const harnessDir = process.argv[2] || '/tmp/archify-panel-harness';

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const server = createServer(async (request, response) => {
  const name = (request.url ?? '/').split('?')[0] === '/' ? '/harness.html' : request.url;
  try {
    const body = await readFile(join(harnessDir, name));
    response.writeHead(200, { 'content-type': types[extname(name)] ?? 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end('not found');
  }
});
await new Promise((resolve) => server.listen(8732, '127.0.0.1', resolve));

const client = await launchChrome();
const { sessionId, logs } = await openPage(client, 'http://127.0.0.1:8732/harness.html');

const title = await waitFor(
  client,
  sessionId,
  "document.title.startsWith('RESULT') || document.title.startsWith('ERROR') ? document.title : ''",
  60000,
);
console.log('面板结果：', title);
console.log('控制台输出：');
for (const line of logs.slice(0, 25)) console.log('  ', line);

const status = await evaluate(client, sessionId, 'document.title');
console.log('最终标题：', status);

client.close();
server.close();
process.exit(0);
