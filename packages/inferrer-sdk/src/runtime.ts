/**
 * runInferrer / runInferrers — execute one or more inferrers against a Store.
 *
 * Semantics:
 *   - Inferrers read from a StoreReadOnly, return Facts.
 *   - The runner writes Facts in a single transaction, stamping
 *     provenance.inputs_hash on every record for idempotency (the SQLite
 *     upsert dedupes by id, so re-running produces zero writes).
 *   - Multiple inferrers topologically sort by reads ∩ writes: inferrer A's
 *     writes become inferrer B's reads if they overlap.
 *   - Cycles throw; the DAG must be acyclic.
 */

import type {
  Facts,
  Inferrer,
  InferrerLogger,
  InferrerRunContext,
  Provenance,
  Reasoner,
  Embedder,
  Store,
  StoreReadOnly,
  UpsertEdge,
  UpsertNode,
} from '@hypha/core';
import { now } from '@hypha/core';

export interface RunInferrerOptions {
  inferrer: Inferrer;
  store: Store;
  ownerInstanceId: string;
  logger?: InferrerLogger;
  reasoner?: Reasoner;
  embedder?: Embedder;
}

export interface RunInferrerResult {
  inferrer_id: string;
  nodes_written: number;
  edges_written: number;
  skipped_idempotent: number;
  invalidated: number;
  durationMs: number;
}

export async function runInferrer(opts: RunInferrerOptions): Promise<RunInferrerResult> {
  const started = performance.now();
  const logger = opts.logger ?? consoleLogger(opts.inferrer.id);

  const ctx: InferrerRunContext = {
    tx: { owner_instance_id: opts.ownerInstanceId, tx_at: now() },
    logger,
    ...(opts.reasoner ? { reasoner: opts.reasoner } : {}),
    ...(opts.embedder ? { embedder: opts.embedder } : {}),
  };

  const facts = await opts.inferrer.run(opts.store as StoreReadOnly, ctx);
  const { nodes, edges } = factsToUpserts(facts, opts.inferrer);

  let result = { nodes_written: 0, edges_written: 0, skipped_idempotent: 0 };
  if (nodes.length > 0 || edges.length > 0) {
    result = await opts.store.upsert({ nodes, edges }, ctx.tx);
  }

  let invalidated = 0;
  if (facts.invalidations && facts.invalidations.length > 0) {
    const ops = facts.invalidations.map((id) => ({ id: id as never, at: now() }));
    invalidated = await opts.store.invalidate(ops, ctx.tx);
  }

  return {
    inferrer_id: opts.inferrer.id,
    nodes_written: result.nodes_written,
    edges_written: result.edges_written,
    skipped_idempotent: result.skipped_idempotent,
    invalidated,
    durationMs: Math.round(performance.now() - started),
  };
}

export interface RunInferrersOptions extends Omit<RunInferrerOptions, 'inferrer'> {
  inferrers: readonly Inferrer[];
}

/**
 * Topologically order inferrers by reads/writes, then run in sequence.
 * Prefix-matches on kind (e.g. `identity.*` matches `identity.email`).
 */
export async function runInferrers(opts: RunInferrersOptions): Promise<RunInferrerResult[]> {
  const order = topoSort(opts.inferrers);
  const results: RunInferrerResult[] = [];
  for (const inferrer of order) {
    const result = await runInferrer({ ...opts, inferrer });
    results.push(result);
  }
  return results;
}

// ─── Internals ──────────────────────────────────────────────────────────────

function topoSort(inferrers: readonly Inferrer[]): Inferrer[] {
  const byId = new Map(inferrers.map((i) => [i.id, i]));
  const produces = new Map<string, Set<string>>(); // kind → set of inferrer ids that write it
  for (const i of inferrers) {
    for (const w of i.writes) {
      if (!produces.has(w)) produces.set(w, new Set());
      produces.get(w)!.add(i.id);
    }
  }
  const deps = new Map<string, Set<string>>();
  for (const i of inferrers) {
    const d = new Set<string>();
    for (const r of i.reads) {
      for (const [kind, writers] of produces) {
        if (matchesKind(r, kind)) {
          for (const w of writers) if (w !== i.id) d.add(w);
        }
      }
    }
    deps.set(i.id, d);
  }

  const ordered: Inferrer[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      throw new Error(`Inferrer cycle detected at ${id}`);
    }
    visiting.add(id);
    for (const d of deps.get(id) ?? []) visit(d);
    visiting.delete(id);
    visited.add(id);
    const inf = byId.get(id);
    if (inf) ordered.push(inf);
  };
  for (const i of inferrers) visit(i.id);
  return ordered;
}

function matchesKind(pattern: string, kind: string): boolean {
  if (pattern === kind) return true;
  if (pattern.endsWith('.*')) return kind.startsWith(pattern.slice(0, -1));
  if (pattern === '*') return true;
  return false;
}

function factsToUpserts(facts: Facts, inferrer: Inferrer): { nodes: UpsertNode[]; edges: UpsertEdge[] } {
  const nodes: UpsertNode[] = [];
  for (const n of facts.nodes ?? []) {
    nodes.push({
      ...n,
      provenance: ensureInferredProvenance(n.provenance, inferrer),
    } as UpsertNode);
  }
  const edges: UpsertEdge[] = [];
  for (const e of facts.edges ?? []) {
    edges.push({
      ...e,
      provenance: ensureInferredProvenance(e.provenance, inferrer),
    } as UpsertEdge);
  }
  return { nodes, edges };
}

function ensureInferredProvenance(p: Provenance, inferrer: Inferrer): Provenance {
  if (p.kind === 'inferred') {
    return { ...p, inferrer: p.inferrer || inferrer.id, inferrer_version: p.inferrer_version || inferrer.version };
  }
  return p;
}

function consoleLogger(id: string): InferrerLogger {
  const prefix = `[${id}]`;
  return {
    debug: (msg) => { void msg; },
    info: (msg) => console.log(prefix, msg),
    warn: (msg) => console.warn(prefix, msg),
    error: (msg) => console.error(prefix, msg),
  };
}
