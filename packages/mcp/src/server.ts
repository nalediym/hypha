/**
 * Hypha MCP server — six tools + resource templates + one prompt.
 *
 * v1-B ships stdio transport (Claude Desktop); Streamable HTTP + OAuth
 * 2.1 + PKCE land later.
 */

import { Database } from 'bun:sqlite';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Store, StoredEdge, StoredNode } from '@hypha/core';
import { SQLiteStore } from '@hypha/store-sqlite';
import { AllowAllPolicy, AuditLog, type PolicyEngine } from '@hypha/governance';
import {
  FetchInput,
  FetchOutput,
  NeighborhoodInput,
  NeighborhoodOutput,
  RecordInput,
  RecordOutput,
  SearchInput,
  SearchOutput,
  TimelineInput,
  TimelineOutput,
  WhyInput,
  WhyOutput,
  fetchTool,
  neighborhoodTool,
  recordTool,
  searchTool,
  timelineTool,
  whyTool,
  type HyphaToolContext,
} from './tools.ts';
import { AskInput, AskOutput, askTool } from './ask.ts';

export interface HyphaServerOptions {
  dbPath: string;
  instance_id: string;
  instance_label: string;
  actor_kind?: 'owner' | 'agent' | 'system';
  actor_id?: string;
  policy?: PolicyEngine;
}

/**
 * Build a configured McpServer. Caller wires up the transport.
 */
export function createHyphaMcpServer(opts: HyphaServerOptions): {
  server: McpServer;
  close: () => Promise<void>;
} {
  const store = new SQLiteStore({ path: opts.dbPath, ownerInstanceId: opts.instance_id });
  const rawDb = new Database(opts.dbPath);
  const audit = new AuditLog(rawDb);
  const policy = opts.policy ?? new AllowAllPolicy();

  const ctx: HyphaToolContext = {
    store,
    audit,
    policy,
    instance_id: opts.instance_id,
    instance_label: opts.instance_label,
    actor_kind: opts.actor_kind ?? 'owner',
    actor_id: opts.actor_id ?? 'local-owner',
  };

  const server = new McpServer({
    name: 'hypha',
    version: '0.1.0-dev',
    title: `Hypha — ${opts.instance_label}`,
  });

  // ─── Tools ────────────────────────────────────────────────────────────

  server.registerTool(
    'search',
    {
      title: 'Search',
      description:
        'FTS5 full-text search over the graph. Returns hits with inline provenance (ingested adapter or inferrer + confidence). Supports kind filters with "foo.*" patterns, include_inferred, min_confidence, and a needs_review flag for reviewing ambiguous inferences.',
      inputSchema: SearchInput.shape,
      outputSchema: SearchOutput.shape,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      const out = await searchTool(ctx, args);
      return asToolResult(out, `${out.hits.length} hits for "${args.q}"`);
    },
  );

  server.registerTool(
    'neighborhood',
    {
      title: 'Neighborhood',
      description:
        '1-3 hop subgraph around a node. Filters by edge_kinds + direction. Truncated true when a level hits its limit.',
      inputSchema: NeighborhoodInput.shape,
      outputSchema: NeighborhoodOutput.shape,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      const out = await neighborhoodTool(ctx, args);
      return asToolResult(
        out,
        `neighborhood of ${out.center.kind} (${out.nodes.length} nodes, ${out.edges.length} edges)`,
      );
    },
  );

  server.registerTool(
    'timeline',
    {
      title: 'Timeline',
      description:
        'Events over time, optionally restricted to a subject node. Sorted by event time, cursor-paginated.',
      inputSchema: TimelineInput.shape,
      outputSchema: TimelineOutput.shape,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      const out = await timelineTool(ctx, args);
      return asToolResult(out, `${out.events.length} events`);
    },
  );

  server.registerTool(
    'why',
    {
      title: 'Why',
      description:
        'Walk the provenance tree of a record. Returns the derivation tree + citations to ingested leaves. Answers "why does Hypha believe this?"',
      inputSchema: WhyInput.shape,
      outputSchema: WhyOutput.shape,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      const out = await whyTool(ctx, args);
      return asToolResult(
        out,
        out.inferred
          ? `inferred; ${out.citations.length} source citations`
          : 'ingested directly from adapter',
      );
    },
  );

  server.registerTool(
    'fetch',
    {
      title: 'Fetch',
      description: 'Resolve a hypha://node/{id} or hypha://edge/{id} URI into its full record.',
      inputSchema: FetchInput.shape,
      outputSchema: FetchOutput.shape,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      const out = await fetchTool(ctx, args);
      return asToolResult(out, `${out.kind} ${args.uri}`);
    },
  );

  server.registerTool(
    'ask',
    {
      title: 'Ask (natural language)',
      description:
        'Compile a natural-language question into a structured search. If ANTHROPIC_API_KEY is set, Claude Haiku compiles the query; otherwise the question is used as a plain FTS text query. The compiled query is always returned in structuredContent so the agent sees exactly what Hypha asked for.',
      inputSchema: AskInput.shape,
      outputSchema: AskOutput.shape,
      annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: false },
    },
    async (args) => {
      const out = await askTool(ctx, args);
      return asToolResult(
        out,
        `${out.hits.length} hits via ${out.compiler}: ${JSON.stringify(out.compiled_query)}`,
      );
    },
  );

  server.registerTool(
    'record',
    {
      title: 'Record',
      description:
        'Create a new node asserted by the calling agent. Requires an idempotency_key for safe retries. Subject to Cedar policy (default-deny for non-owner agents).',
      inputSchema: RecordInput.shape,
      outputSchema: RecordOutput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const out = await recordTool(ctx, args);
      return asToolResult(out, out.created ? `created ${out.id}` : `exists ${out.id}`);
    },
  );

  // ─── Resources ────────────────────────────────────────────────────────

  server.registerResource(
    'node',
    new ResourceTemplate('hypha://node/{id}', { list: undefined }),
    {
      title: 'Hypha node',
      description: 'A single node rendered as markdown with a YAML-frontmatter meta block.',
      mimeType: 'text/markdown',
    },
    async (_uri, variables) => {
      const id = variables.id as string;
      const node = await store.getNode(id as Parameters<Store['getNode']>[0]);
      if (!node) throw new Error(`Node not found: ${id}`);
      return {
        contents: [
          {
            uri: `hypha://node/${id}`,
            mimeType: 'text/markdown',
            text: renderNodeMarkdown(node),
          },
        ],
      };
    },
  );

  server.registerResource(
    'edge',
    new ResourceTemplate('hypha://edge/{id}', { list: undefined }),
    {
      title: 'Hypha edge',
      description: 'A single edge rendered as markdown (kind, endpoints, confidence).',
      mimeType: 'text/markdown',
    },
    async (_uri, variables) => {
      const id = variables.id as string;
      const edge = await store.getEdge(id as Parameters<Store['getEdge']>[0]);
      if (!edge) throw new Error(`Edge not found: ${id}`);
      return {
        contents: [
          {
            uri: `hypha://edge/${id}`,
            mimeType: 'text/markdown',
            text: renderEdgeMarkdown(edge),
          },
        ],
      };
    },
  );

  // ─── Prompt ───────────────────────────────────────────────────────────

  server.registerPrompt(
    'weekly-digest',
    {
      title: 'Weekly digest',
      description: 'Summarize the last week of the graph — people, threads, key events.',
      argsSchema: {},
    },
    () => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text:
              'Use the Hypha MCP tools to produce a weekly digest: call timeline() with since=last week, ' +
              'group by subject kind, highlight the top 3 threads by activity, and cite each item with its ' +
              'hypha://node/{id} URI. Call why() on any inferred fact the digest relies on.',
          },
        },
      ],
    }),
  );

  return {
    server,
    async close() {
      try {
        await server.close();
      } catch { /* ignore */ }
      await store.close();
      rawDb.close();
    },
  };
}

function asToolResult(
  structured: Record<string, unknown>,
  summary: string,
): {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent: Record<string, unknown>;
} {
  return {
    content: [{ type: 'text', text: summary }],
    structuredContent: structured,
  };
}

function renderNodeMarkdown(node: StoredNode): string {
  const meta = {
    id: node.id,
    kind: node.kind,
    at: node.at,
    adapter: node.adapter,
    provenance_kind: node.provenance.kind,
    ...(node.provenance.kind === 'inferred'
      ? { inferrer: node.provenance.inferrer, confidence: node.provenance.confidence }
      : {}),
  };
  const frontmatter = Object.entries(meta)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join('\n');
  const facetsBlock =
    node.facets && Object.keys(node.facets).length > 0
      ? `\n\n### facets\n\n\`\`\`json\n${JSON.stringify(node.facets, null, 2)}\n\`\`\``
      : '';
  const body = node.body ? `\n\n${node.body}` : '';
  return `---\n${frontmatter}\n---\n\n# ${node.title}${body}${facetsBlock}`;
}

function renderEdgeMarkdown(edge: StoredEdge): string {
  const meta = {
    id: edge.id,
    kind: edge.kind,
    from: edge.from_id,
    to: edge.to_id,
    at: edge.at,
    provenance_kind: edge.provenance.kind,
    ...(edge.provenance.kind === 'inferred'
      ? { inferrer: edge.provenance.inferrer, confidence: edge.provenance.confidence }
      : {}),
  };
  const frontmatter = Object.entries(meta)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join('\n');
  return `---\n${frontmatter}\n---\n\n# ${edge.kind} edge\n\n${edge.from_id} → ${edge.to_id}`;
}
