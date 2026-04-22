/**
 * Hypha MCP tool definitions — six intent-shaped tools. Each returns
 * `structuredContent` with inline provenance; prose `content` is short.
 * Tool annotations (`readOnlyHint`, `idempotentHint`, `openWorldHint`) let
 * hosts make auto-approval decisions.
 */

import { z } from 'zod';
import type { Store, StoredEdge, StoredNode } from '@hypha/core';
import { AuditLog, hashQuery, type PolicyEngine } from '@hypha/governance';

export interface HyphaToolContext {
  store: Store;
  audit: AuditLog;
  policy: PolicyEngine;
  instance_id: string;
  instance_label: string;
  actor_kind: 'owner' | 'agent' | 'system';
  actor_id: string;
}

// ─── search ─────────────────────────────────────────────────────────────────

export const SearchInput = z.object({
  q: z.string().describe('Free-text query. FTS5-backed; supports phrase matching via quotes.'),
  kinds: z.array(z.string()).optional().describe('Filter by node kinds. Supports "foo.*" prefix patterns.'),
  limit: z.number().int().min(1).max(100).optional().default(20),
  min_confidence: z.number().min(0).max(1).optional().describe('Minimum provenance confidence for inferred hits.'),
  include_inferred: z.boolean().optional().default(true),
  needs_review: z.boolean().optional().describe('Only records flagged for human review.'),
});

export const SearchOutput = z.object({
  instance_id: z.string(),
  instance_label: z.string(),
  hits: z.array(z.object({
    id: z.string(),
    kind: z.string(),
    title: z.string(),
    at: z.string(),
    score: z.number(),
    provenance: z.object({
      kind: z.enum(['ingested', 'inferred']),
      adapter: z.string().optional(),
      inferrer: z.string().optional(),
      confidence: z.number().optional(),
    }),
    uri: z.string(),
  })),
});

export async function searchTool(
  ctx: HyphaToolContext,
  args: z.infer<typeof SearchInput>,
): Promise<z.infer<typeof SearchOutput>> {
  const started = performance.now();
  const result = await ctx.store.search({
    ...(args.q ? { text: args.q } : {}),
    ...(args.kinds ? { kinds: args.kinds } : {}),
    ...(args.limit ? { limit: args.limit } : {}),
    ...(args.include_inferred !== undefined ? { include_inferred: args.include_inferred } : {}),
    ...(args.needs_review !== undefined ? { needs_review: args.needs_review } : {}),
    ...(args.min_confidence !== undefined ? { min_confidence: args.min_confidence } : {}),
  });
  const hits = result.hits.map((h) => ({
    id: h.node.id as string,
    kind: h.node.kind,
    title: h.node.title,
    at: h.node.at as string,
    score: h.score,
    provenance: summarizeProvenance(h.node),
    uri: `hypha://node/${h.node.id}`,
  }));
  ctx.audit.write({
    actor_kind: ctx.actor_kind,
    actor_id: ctx.actor_id,
    action: 'mcp.search',
    resource_kind: 'query',
    query_hash: hashQuery(args),
    result_count: hits.length,
    duration_ms: Math.round(performance.now() - started),
  });
  return { instance_id: ctx.instance_id, instance_label: ctx.instance_label, hits };
}

// ─── neighborhood ──────────────────────────────────────────────────────────

export const NeighborhoodInput = z.object({
  id: z.string().describe('Node id or hypha:// URI.'),
  depth: z.number().int().min(1).max(3).optional().default(1),
  edge_kinds: z.array(z.string()).optional(),
  direction: z.enum(['in', 'out', 'both']).optional().default('both'),
  limit: z.number().int().min(1).max(200).optional().default(50),
});

export const NeighborhoodOutput = z.object({
  instance_id: z.string(),
  instance_label: z.string(),
  center: z.object({ id: z.string(), kind: z.string(), title: z.string() }),
  nodes: z.array(z.object({ id: z.string(), kind: z.string(), title: z.string(), uri: z.string() })),
  edges: z.array(z.object({
    id: z.string(),
    kind: z.string(),
    from_id: z.string(),
    to_id: z.string(),
    confidence: z.number().optional(),
  })),
  truncated: z.boolean(),
});

export async function neighborhoodTool(
  ctx: HyphaToolContext,
  args: z.infer<typeof NeighborhoodInput>,
): Promise<z.infer<typeof NeighborhoodOutput>> {
  const id = stripUri(args.id) as Parameters<Store['neighborhood']>[0]['id'];
  const result = await ctx.store.neighborhood({
    id,
    ...(args.depth ? { depth: args.depth as 1 | 2 | 3 } : {}),
    ...(args.edge_kinds ? { edge_kinds: args.edge_kinds } : {}),
    ...(args.direction ? { direction: args.direction } : {}),
    ...(args.limit ? { limit: args.limit } : {}),
  });
  ctx.audit.write({
    actor_kind: ctx.actor_kind,
    actor_id: ctx.actor_id,
    action: 'mcp.neighborhood',
    resource_kind: 'node',
    resource_id: id as string,
    result_count: result.nodes.length,
  });
  return {
    instance_id: ctx.instance_id,
    instance_label: ctx.instance_label,
    center: { id: result.center.id as string, kind: result.center.kind, title: result.center.title },
    nodes: result.nodes.map((n) => ({
      id: n.id as string,
      kind: n.kind,
      title: n.title,
      uri: `hypha://node/${n.id}`,
    })),
    edges: result.edges.map((e) => ({
      id: e.id as string,
      kind: e.kind,
      from_id: e.from_id as string,
      to_id: e.to_id as string,
      ...(e.provenance.kind === 'inferred' ? { confidence: e.provenance.confidence } : {}),
    })),
    truncated: result.truncated,
  };
}

// ─── timeline ──────────────────────────────────────────────────────────────

export const TimelineInput = z.object({
  subject: z.string().optional().describe('Node id or URI — restrict to events about this node.'),
  kinds: z.array(z.string()).optional(),
  since: z.string().optional().describe('ISO 8601 lower bound.'),
  until: z.string().optional().describe('ISO 8601 upper bound.'),
  limit: z.number().int().min(1).max(200).optional().default(50),
  cursor: z.string().optional(),
});

export const TimelineOutput = z.object({
  instance_id: z.string(),
  instance_label: z.string(),
  events: z.array(z.object({
    id: z.string(),
    kind: z.string(),
    title: z.string(),
    anchor: z.string(),
    uri: z.string(),
  })),
  nextCursor: z.string().optional(),
});

export async function timelineTool(
  ctx: HyphaToolContext,
  args: z.infer<typeof TimelineInput>,
): Promise<z.infer<typeof TimelineOutput>> {
  // TimelineQuery uses `range: { from, to }`; the MCP-facing arg uses
  // since/until for simpler agent prompting. Build the query imperatively
  // so exactOptionalPropertyTypes doesn't flag spread-of-conditional-object.
  const tq: Record<string, unknown> = {};
  if (args.subject) tq.subject = stripUri(args.subject);
  if (args.kinds) tq.kinds = args.kinds;
  if (args.since || args.until) {
    tq.range = {
      from: args.since ?? '1970-01-01T00:00:00Z',
      to: args.until ?? '2999-12-31T23:59:59Z',
    };
  }
  if (args.limit) tq.limit = args.limit;
  if (args.cursor) tq.cursor = args.cursor;
  const result = await ctx.store.timeline(tq as Parameters<Store['timeline']>[0]);
  ctx.audit.write({
    actor_kind: ctx.actor_kind,
    actor_id: ctx.actor_id,
    action: 'mcp.timeline',
    resource_kind: 'query',
    query_hash: hashQuery(args),
    result_count: result.events.length,
  });
  return {
    instance_id: ctx.instance_id,
    instance_label: ctx.instance_label,
    events: result.events.map((ev) => ({
      id: ev.record.id as string,
      kind: ev.record.kind,
      title: titleOf(ev.record),
      anchor: String(ev.anchor),
      uri: `hypha://node/${ev.record.id}`,
    })),
    ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
  };
}

// ─── why ────────────────────────────────────────────────────────────────────

export const WhyInput = z.object({
  id: z.string().describe('Node or edge id (or URI).'),
  depth: z.number().int().min(1).max(5).optional().default(3),
});

export const WhyOutput = z.object({
  instance_id: z.string(),
  instance_label: z.string(),
  subject: z.object({ id: z.string(), kind: z.string(), title: z.string() }),
  inferred: z.boolean(),
  derivation: z.unknown(),
  citations: z.array(z.object({ id: z.string(), kind: z.string(), title: z.string() })),
});

export async function whyTool(
  ctx: HyphaToolContext,
  args: z.infer<typeof WhyInput>,
): Promise<z.infer<typeof WhyOutput>> {
  const id = stripUri(args.id) as Parameters<Store['why']>[0];
  const result = await ctx.store.why(id, args.depth);
  ctx.audit.write({
    actor_kind: ctx.actor_kind,
    actor_id: ctx.actor_id,
    action: 'mcp.why',
    resource_kind: 'node',
    resource_id: id as string,
  });
  return {
    instance_id: ctx.instance_id,
    instance_label: ctx.instance_label,
    subject: {
      id: result.subject.id as string,
      kind: result.subject.kind,
      title: titleOf(result.subject),
    },
    inferred: result.inferred,
    derivation: result.derivation,
    citations: result.citations.map((c) => ({
      id: c.id as string,
      kind: c.kind,
      title: titleOf(c),
    })),
  };
}

// ─── fetch ──────────────────────────────────────────────────────────────────

export const FetchInput = z.object({
  uri: z.string().describe('hypha://node/{id} or hypha://edge/{id}.'),
});

export const FetchOutput = z.object({
  instance_id: z.string(),
  instance_label: z.string(),
  kind: z.enum(['node', 'edge']),
  record: z.record(z.string(), z.unknown()),
  related_uris: z.array(z.string()),
});

export async function fetchTool(
  ctx: HyphaToolContext,
  args: z.infer<typeof FetchInput>,
): Promise<z.infer<typeof FetchOutput>> {
  const id = stripUri(args.uri);
  const isEdge = args.uri.startsWith('hypha://edge/');
  const record = isEdge
    ? await ctx.store.getEdge(id as Parameters<Store['getEdge']>[0])
    : await ctx.store.getNode(id as Parameters<Store['getNode']>[0]);
  if (!record) {
    throw new Error(`Record not found: ${args.uri}`);
  }
  ctx.audit.write({
    actor_kind: ctx.actor_kind,
    actor_id: ctx.actor_id,
    action: 'mcp.fetch',
    resource_kind: isEdge ? 'edge' : 'node',
    resource_id: id,
  });
  const related: string[] = [];
  if (!isEdge) related.push(`hypha://why/${id}`, `hypha://timeline/${id}`);
  return {
    instance_id: ctx.instance_id,
    instance_label: ctx.instance_label,
    kind: isEdge ? 'edge' : 'node',
    record: record as unknown as Record<string, unknown>,
    related_uris: related,
  };
}

// ─── record (write) ─────────────────────────────────────────────────────────

export const RecordInput = z.object({
  kind: z.string(),
  title: z.string(),
  body: z.string().optional(),
  at: z.string().optional(),
  facets: z.record(z.string(), z.unknown()).optional(),
  idempotency_key: z.string().describe('Required for mutating operations.'),
});

export const RecordOutput = z.object({
  id: z.string(),
  uri: z.string(),
  created: z.boolean(),
});

export async function recordTool(
  ctx: HyphaToolContext,
  args: z.infer<typeof RecordInput>,
): Promise<z.infer<typeof RecordOutput>> {
  const decision = await ctx.policy.authorize({
    subject_kind: ctx.actor_kind,
    subject_id: ctx.actor_id,
    action: 'record',
    resource_kind: 'node',
  });
  if (decision.effect === 'deny') {
    ctx.audit.write({
      actor_kind: ctx.actor_kind,
      actor_id: ctx.actor_id,
      action: 'mcp.record',
      pdp_decision: 'deny',
      pdp_reason: decision.reason,
    });
    throw new Error(`permission_denied: ${decision.reason}`);
  }

  const { nodeIdFromExternal, now } = await import('@hypha/core');
  const at = args.at ?? now();
  const externalId = `agent:${ctx.actor_id}:${args.idempotency_key}`;
  const id = nodeIdFromExternal('agent', args.kind, externalId);

  const result = await ctx.store.upsert(
    {
      nodes: [{
        id,
        kind: args.kind,
        at: at as Parameters<Store['upsert']>[0]['nodes'] extends readonly (infer T)[] | undefined ? never : never extends never ? string : never,
        ingested_at: now(),
        adapter: 'agent',
        external_id: externalId,
        title: args.title,
        ...(args.body !== undefined ? { body: args.body } : {}),
        ...(args.facets ? { facets: args.facets } : {}),
        provenance: {
          kind: 'ingested',
          adapter: 'agent',
          adapter_version: '0.1.0',
          external_id: externalId,
        },
      } as unknown as Parameters<Store['upsert']>[0]['nodes'] extends readonly (infer T)[] | undefined ? T : never],
    },
    { owner_instance_id: ctx.instance_id, idempotency_key: args.idempotency_key },
  );
  ctx.audit.write({
    actor_kind: ctx.actor_kind,
    actor_id: ctx.actor_id,
    action: 'mcp.record',
    resource_kind: 'node',
    resource_id: id as string,
    pdp_decision: 'allow',
    result_count: result.nodes_written,
  });
  return { id: id as string, uri: `hypha://node/${id}`, created: result.nodes_written > 0 };
}

// ─── helpers ────────────────────────────────────────────────────────────────

function titleOf(record: StoredNode | StoredEdge): string {
  return 'title' in record ? record.title : `${record.kind} edge`;
}

function summarizeProvenance(record: StoredNode | StoredEdge): {
  kind: 'ingested' | 'inferred';
  adapter?: string;
  inferrer?: string;
  confidence?: number;
} {
  const p = record.provenance;
  if (p.kind === 'ingested') {
    return { kind: 'ingested', adapter: p.adapter };
  }
  return { kind: 'inferred', inferrer: p.inferrer, confidence: p.confidence };
}

function stripUri(idOrUri: string): string {
  if (idOrUri.startsWith('hypha://node/')) return idOrUri.slice('hypha://node/'.length);
  if (idOrUri.startsWith('hypha://edge/')) return idOrUri.slice('hypha://edge/'.length);
  return idOrUri;
}
