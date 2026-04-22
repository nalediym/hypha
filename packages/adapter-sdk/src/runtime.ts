/**
 * runAdapter — consume an adapter's AsyncIterable<AdapterEvent> stream and
 * batch-write nodes + edges to a Store in idempotent transactions.
 *
 * v1 responsibilities: validate facets against the adapter's Zod schemas,
 * batch records, persist atomically. Progress and log events are forwarded
 * to the provided logger. Blob events are currently dropped (blob storage
 * lands in W9-10 alongside adapters that emit attachments).
 */

import type {
  AdapterContext,
  AdapterEvent,
  HyphaAdapter,
  Provenance,
  Store,
  UpsertEdge,
  UpsertNode,
  WriteContext,
} from '@hypha/core';
import { now } from '@hypha/core';

export interface RunAdapterOptions<Inputs> {
  adapter: HyphaAdapter<Inputs>;
  inputs: Inputs;
  store: Store;
  ownerInstanceId: string;
  /** Batch size for upserts. Default 500. */
  batchSize?: number;
  /** Override the adapter context — if omitted, a default one is built. */
  context?: Partial<AdapterContext>;
}

export interface RunAdapterResult {
  nodes_written: number;
  edges_written: number;
  blobs_seen: number;
  skipped_idempotent: number;
  warnings: string[];
  durationMs: number;
}

export async function runAdapter<Inputs>(
  opts: RunAdapterOptions<Inputs>,
): Promise<RunAdapterResult> {
  const started = performance.now();
  const { adapter, inputs, store, ownerInstanceId } = opts;
  const batchSize = opts.batchSize ?? 500;
  const warnings: string[] = [];

  const ctx: AdapterContext = {
    logger: opts.context?.logger ?? createConsoleLogger(adapter.manifest.id),
    state: opts.context?.state,
    dryRun: opts.context?.dryRun ?? false,
    ...(opts.context?.httpClient ? { httpClient: opts.context.httpClient } : {}),
  };

  const writeCtx: WriteContext = { owner_instance_id: ownerInstanceId, tx_at: now() };

  let nodes: UpsertNode[] = [];
  let edges: UpsertEdge[] = [];
  let totalNodes = 0;
  let totalEdges = 0;
  let totalBlobs = 0;
  let totalSkipped = 0;

  const flush = async (): Promise<void> => {
    if (ctx.dryRun || (nodes.length === 0 && edges.length === 0)) {
      nodes = [];
      edges = [];
      return;
    }
    const res = await store.upsert({ nodes, edges }, writeCtx);
    totalNodes += res.nodes_written;
    totalEdges += res.edges_written;
    totalSkipped += res.skipped_idempotent;
    nodes = [];
    edges = [];
  };

  const defaultProvenance = (ext: string): Provenance => ({
    kind: 'ingested',
    adapter: adapter.manifest.id,
    adapter_version: adapter.manifest.version,
    external_id: ext,
  });

  for await (const event of adapter.ingest(inputs, ctx)) {
    switch (event.type) {
      case 'node': {
        const { node, provenance } = event;
        const facetSchema = adapter.facetSchemas[node.kind];
        if (facetSchema && node.facets) {
          const parsed = facetSchema.safeParse(node.facets);
          if (!parsed.success) {
            warnings.push(
              `node ${node.id}: facet validation failed for kind ${node.kind}: ${parsed.error.message}`,
            );
            continue;
          }
        }
        const upsert: UpsertNode = {
          ...node,
          ingested_at: now(),
          provenance: provenance ?? defaultProvenance(node.external_id),
        };
        nodes.push(upsert);
        if (nodes.length + edges.length >= batchSize) await flush();
        break;
      }
      case 'edge': {
        const { edge, provenance } = event;
        const upsert: UpsertEdge = {
          ...edge,
          provenance: provenance ?? defaultProvenance(edge.id),
        };
        edges.push(upsert);
        if (nodes.length + edges.length >= batchSize) await flush();
        break;
      }
      case 'blob':
        totalBlobs++; // TODO(W9-10): persist to content-addressed blob store
        break;
      case 'progress':
        ctx.logger.debug(`${event.stream}: scanned ${event.scanned}, emitted ${event.emitted}`);
        break;
      case 'state':
        // TODO(incremental): persist cursor state to ingest_cursor
        break;
      case 'log':
        ctx.logger[event.level](event.message, event.ctx);
        break;
    }
  }

  await flush();

  return {
    nodes_written: totalNodes,
    edges_written: totalEdges,
    blobs_seen: totalBlobs,
    skipped_idempotent: totalSkipped,
    warnings,
    durationMs: Math.round(performance.now() - started),
  };
}

function createConsoleLogger(adapterId: string): AdapterContext['logger'] {
  const prefix = `[${adapterId}]`;
  return {
    debug: (msg) => { /* silent by default */ void msg; },
    info: (msg) => console.log(prefix, msg),
    warn: (msg) => console.warn(prefix, msg),
    error: (msg) => console.error(prefix, msg),
  };
}
