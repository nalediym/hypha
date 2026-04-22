/**
 * assertAdapterContract — six-assertion contract test.
 *
 * Every adapter must pass this before being considered shippable. The
 * assertions cover the full surface the runtime depends on:
 *
 *   1. id stability       — same fixture → same ids across runs
 *   2. idempotent ingest  — re-running produces no net new records
 *   3. capabilities match — declared `supports_dry_run`, `idempotent`, etc.
 *                           reflect actual behavior
 *   4. edge kinds declared — every emitted edge.kind is in manifest.emits.edges
 *   5. facets validate    — every emitted facet parses against the Zod schema
 *                           registered for its kind
 *   6. emits match manifest — every emitted node.kind is in manifest.emits.kinds
 */

import { SQLiteStore } from '@hypha/store-sqlite';
import type { AdapterEvent, HyphaAdapter } from '@hypha/core';
import { runAdapter } from './runtime.ts';

export interface AdapterContractOptions<Inputs> {
  adapter: HyphaAdapter<Inputs>;
  inputs: Inputs;
  /** Optional: fixture fingerprint for human debugging output. */
  fixtureLabel?: string;
}

export interface AdapterContractReport {
  passed: boolean;
  assertions: AssertionResult[];
}

export interface AssertionResult {
  name: string;
  passed: boolean;
  detail?: string;
}

/**
 * Run the adapter against the given inputs twice (using an in-memory store
 * for each run) and verify the six contract assertions. Throws on failure
 * with a detailed message; returns a report for programmatic inspection.
 */
export async function assertAdapterContract<Inputs>(
  opts: AdapterContractOptions<Inputs>,
): Promise<AdapterContractReport> {
  const { adapter, inputs } = opts;
  const manifest = adapter.manifest;
  const declaredKinds = new Set(manifest.emits.kinds.map((k) => k.kind));
  const declaredEdges = new Set(manifest.emits.edges);
  const assertions: AssertionResult[] = [];

  // First pass — collect events without writing, so we can inspect emits.
  const firstEvents = await collectEvents(adapter, inputs);
  const nodeIds = firstEvents.filter((e) => e.type === 'node').map((e) => (e as Extract<AdapterEvent, { type: 'node' }>).node.id);
  const edgeIds = firstEvents.filter((e) => e.type === 'edge').map((e) => (e as Extract<AdapterEvent, { type: 'edge' }>).edge.id);

  // Assertion 6 — emits match manifest (node kinds).
  const undeclaredNodeKinds = new Set<string>();
  for (const event of firstEvents) {
    if (event.type === 'node' && !declaredKinds.has(event.node.kind)) {
      undeclaredNodeKinds.add(event.node.kind);
    }
  }
  assertions.push({
    name: 'emits-match-manifest',
    passed: undeclaredNodeKinds.size === 0,
    ...(undeclaredNodeKinds.size > 0
      ? { detail: `undeclared kinds emitted: ${[...undeclaredNodeKinds].join(', ')}` }
      : {}),
  });

  // Assertion 4 — edge kinds declared.
  const undeclaredEdgeKinds = new Set<string>();
  for (const event of firstEvents) {
    if (event.type === 'edge' && !declaredEdges.has(event.edge.kind)) {
      undeclaredEdgeKinds.add(event.edge.kind);
    }
  }
  assertions.push({
    name: 'edge-kinds-declared',
    passed: undeclaredEdgeKinds.size === 0,
    ...(undeclaredEdgeKinds.size > 0
      ? { detail: `undeclared edge kinds emitted: ${[...undeclaredEdgeKinds].join(', ')}` }
      : {}),
  });

  // Assertion 5 — facets validate against Zod schemas.
  const facetFailures: string[] = [];
  for (const event of firstEvents) {
    if (event.type !== 'node' || !event.node.facets) continue;
    const schema = adapter.facetSchemas[event.node.kind];
    if (!schema) continue;
    const parsed = schema.safeParse(event.node.facets);
    if (!parsed.success) {
      facetFailures.push(`${event.node.id} (${event.node.kind}): ${parsed.error.message}`);
    }
  }
  assertions.push({
    name: 'facets-validate',
    passed: facetFailures.length === 0,
    ...(facetFailures.length > 0 ? { detail: `facet failures: ${facetFailures.slice(0, 3).join('; ')}` } : {}),
  });

  // Second pass — run through the actual runtime twice against the same store.
  const store2 = new SQLiteStore({ path: ':memory:', ownerInstanceId: 'contract-test' });
  const runA = await runAdapter({ adapter, inputs, store: store2, ownerInstanceId: 'contract-test' });
  const runB = await runAdapter({ adapter, inputs, store: store2, ownerInstanceId: 'contract-test' });

  // Assertion 1 — id stability: an independent third collection yields the same ids.
  const secondEvents = await collectEvents(adapter, inputs);
  const secondNodeIds = secondEvents
    .filter((e) => e.type === 'node')
    .map((e) => (e as Extract<AdapterEvent, { type: 'node' }>).node.id);
  const idsEqual = setsEqual(new Set(nodeIds), new Set(secondNodeIds));
  assertions.push({
    name: 'id-stability',
    passed: idsEqual,
    ...(idsEqual ? {} : { detail: 'node ids differ between runs over the same inputs' }),
  });

  // Assertion 2 — idempotent ingest: runB against the same store writes nothing new.
  const idempotent =
    runB.nodes_written === 0 &&
    runB.edges_written === 0 &&
    runB.skipped_idempotent === runA.nodes_written + runA.edges_written;
  assertions.push({
    name: 'idempotent-ingest',
    passed: idempotent,
    ...(idempotent
      ? {}
      : {
          detail: `re-run wrote ${runB.nodes_written} nodes / ${runB.edges_written} edges (expected 0)`,
        }),
  });
  await store2.close();

  // Assertion 3 — capabilities match behavior. Today we check the two cheap ones:
  //   - emits_content_addressed_ids implies ids look like content hashes (adapter:kind:hex)
  //   - idempotent implies the re-run was actually idempotent (already verified above)
  const capNotes: string[] = [];
  if (manifest.capabilities.emits_content_addressed_ids) {
    const malformed = nodeIds.filter((id) => !/^[a-z0-9_-]+:[a-z0-9.\-_/]+:[a-f0-9]{8,}$/i.test(id));
    if (malformed.length > 0) capNotes.push(`${malformed.length} node ids don't look content-addressed`);
  }
  if (manifest.capabilities.idempotent && !idempotent) {
    capNotes.push('manifest declares idempotent=true but re-run was not idempotent');
  }
  assertions.push({
    name: 'capabilities-match-behavior',
    passed: capNotes.length === 0,
    ...(capNotes.length > 0 ? { detail: capNotes.join('; ') } : {}),
  });

  // Dead-code sink for edge ids — future assertions (edge uniqueness) will use.
  void edgeIds;

  const passed = assertions.every((a) => a.passed);
  if (!passed) {
    const failed = assertions.filter((a) => !a.passed);
    const label = opts.fixtureLabel ? ` (${opts.fixtureLabel})` : '';
    throw new Error(
      `Adapter contract failed for ${manifest.id}@${manifest.version}${label}:\n` +
        failed.map((f) => `  ✗ ${f.name}${f.detail ? ` — ${f.detail}` : ''}`).join('\n'),
    );
  }
  return { passed, assertions };
}

async function collectEvents<Inputs>(
  adapter: HyphaAdapter<Inputs>,
  inputs: Inputs,
): Promise<AdapterEvent[]> {
  const events: AdapterEvent[] = [];
  const ctx = {
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    state: undefined,
    dryRun: true,
  };
  for await (const event of adapter.ingest(inputs, ctx)) {
    events.push(event);
  }
  return events;
}

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
