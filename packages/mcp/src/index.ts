/**
 * @hypha/mcp — Hypha's MCP server.
 *
 * Six intent-shaped tools + two resource templates + one prompt. Currently
 * stdio-only; Streamable HTTP + OAuth 2.1 + PKCE land in a later milestone.
 */

export const MCP_VERSION = '0.1.0-dev';
export { createHyphaMcpServer } from './server.ts';
export type { HyphaServerOptions } from './server.ts';
export * as tools from './tools.ts';
