import { runBridge } from './bridge-core.mjs';
process.exitCode = await runBridge({ url: 'https://mcptender.ru/mcp', tokenName: 'MCPTENDER_API_KEY' });
