import { runMcpServer } from '../mcp/server.js';

runMcpServer().catch((err) => {
  console.error('[mcp] failed to start', err);
  process.exit(1);
});
