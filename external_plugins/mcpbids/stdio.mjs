import { runBridge } from './bridge-core.mjs';
process.exitCode = await runBridge({ url: 'https://mcpbids.com/mcp', tokenName: 'MCPBIDS_API_KEY' });
