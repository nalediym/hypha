#!/usr/bin/env bun
/**
 * Hypha MCP server — stdio entry point.
 *
 * Usage (claude-desktop_config.json):
 *   {
 *     "mcpServers": {
 *       "hypha": {
 *         "command": "bun",
 *         "args": ["/abs/path/to/packages/mcp/src/bin.ts"],
 *         "env": { "HYPHA_DB": "/abs/path/to/.hypha/store.sqlite" }
 *       }
 *     }
 *   }
 */

import { resolve } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createHyphaMcpServer } from './server.ts';

async function main(): Promise<void> {
  const dbPath = process.env.HYPHA_DB ?? resolve('.hypha/store.sqlite');
  const { server, close } = createHyphaMcpServer({
    dbPath,
    instance_id: process.env.HYPHA_INSTANCE_ID ?? 'local',
    instance_label: process.env.HYPHA_INSTANCE_LABEL ?? 'Personal',
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = async (): Promise<void> => {
    await close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[hypha-mcp] fatal:', err);
  process.exit(1);
});
