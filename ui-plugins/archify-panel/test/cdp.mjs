import { spawn } from 'node:child_process';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export async function launchChrome(port = 9333) {
  const child = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      `--remote-debugging-port=${port}`,
      '--user-data-dir=/tmp/archify-cdp-profile',
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  const endpoint = await new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('Chrome 没有报告调试端口')), 30000);
    child.stderr.on('data', (chunk) => {
      buffer += String(chunk);
      const match = buffer.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
  });

  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  const listeners = [];

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
      return;
    }
    for (const listener of listeners) listener(message);
  });

  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });

  return {
    send,
    on(listener) {
      listeners.push(listener);
    },
    close() {
      socket.close();
      child.kill();
    },
  };
}

export async function openPage(client, url) {
  const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });
  const logs = [];
  client.on((message) => {
    if (message.sessionId !== sessionId) return;
    if (message.method === 'Runtime.consoleAPICalled') {
      logs.push(
        `${message.params.type}: ${message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' ')}`,
      );
    }
    if (message.method === 'Runtime.exceptionThrown') {
      logs.push(`exception: ${message.params.exceptionDetails.text} ${message.params.exceptionDetails.exception?.description ?? ''}`);
    }
  });
  await client.send('Runtime.enable', {}, sessionId);
  await client.send('Page.enable', {}, sessionId);
  await client.send('Page.navigate', { url }, sessionId);
  return { sessionId, logs };
}

export async function evaluate(client, sessionId, expression) {
  const result = await client.send(
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true },
    sessionId,
  );
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

export async function waitFor(client, sessionId, expression, timeoutMs = 30000, intervalMs = 300) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(client, sessionId, expression);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return undefined;
}
