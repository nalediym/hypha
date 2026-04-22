import { resolve } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createHyphaMcpServer } from '@hypha/mcp';

export interface ServeArgs {
  db?: string;
  instanceId?: string;
  instanceLabel?: string;
}

/**
 * `hypha serve` — run the MCP server on stdio. Suitable for a Claude Desktop
 * mcpServers entry. Use this when you want Claude to query your Hypha graph
 * directly.
 */
export async function serveCommand(args: ServeArgs): Promise<void> {
  const dbPath = args.db ?? resolve('.hypha/store.sqlite');
  const { server, close } = createHyphaMcpServer({
    dbPath,
    instance_id: args.instanceId ?? 'local',
    instance_label: args.instanceLabel ?? 'Personal',
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
