/**
 * Hypha core data model. Two primitives (Node, Edge) with open `kind` strings.
 *
 * The user-facing types (`Node`, `Edge`) are the minimal content-facing shapes
 * adapters emit. The Store wraps them with bitemporal + provenance metadata
 * (`RecordMeta`); queries return `StoredNode` / `StoredEdge`.
 */

import type { BlobRef, EdgeId, NodeId } from './id.ts';
import type { Iso8601 } from './time.ts';

// ─── Nodes ────────────────────────────────────────────────────────────────

export interface Node {
  /** Deterministic id. See packages/core/src/id.ts for strategies. */
  id: NodeId;
  /** Namespaced kind string. Open vocabulary. E.g. "gmail.message". */
  kind: string;
  /** Primary event (valid) time — ISO 8601 UTC. */
  at: Iso8601;
  /** When Hypha learned this fact — ISO 8601 UTC. */
  ingested_at: Iso8601;
  /** Adapter id that produced this node. */
  adapter: string;
  /** Vendor-native identifier (message-id, file-id, etc.). */
  external_id: string;
  /** Human-readable title for list views. */
  title: string;
  /** Optional full searchable body. FTS5 indexes this. */
  body?: string;
  /** Optional content-addressed refs to attached blobs. */
  blob_refs?: BlobRef[];
  /** Adapter-defined structured payload. Validated against a Zod schema keyed by kind. */
  facets?: Readonly<Record<string, unknown>>;
}

// ─── Edges ────────────────────────────────────────────────────────────────

export interface Edge {
  id: EdgeId;
  kind: string;
  from_id: NodeId;
  to_id: NodeId;
  /** When the relationship came into being. */
  at: Iso8601;
  /** Optional weight for ranking. */
  weight?: number;
  /** Optional edge-specific metadata. */
  metadata?: Readonly<Record<string, unknown>>;
}

// ─── Provenance ───────────────────────────────────────────────────────────

/**
 * Every stored record carries provenance. Ingested records trace back to an
 * adapter; inferred records trace back to the inferrer that produced them
 * plus the input record ids that were consumed.
 *
 * `inputs_hash` is the idempotency key for inferrers — re-running an inferrer
 * over the same inputs produces the same hash; the Store drops duplicates.
 */
export type Provenance =
  | {
      kind: 'ingested';
      adapter: string;
      adapter_version: string;
      external_id: string;
      source_uri?: string;
    }
  | {
      kind: 'inferred';
      inferrer: string;
      inferrer_version: string;
      inputs: readonly (NodeId | EdgeId)[];
      inputs_hash: string;
      confidence: number; // 0..1
      reason?: string;
    };

// ─── Bitemporal metadata ──────────────────────────────────────────────────

export interface RecordMeta {
  /** System time — when Hypha created this record. */
  tx_created: Iso8601;
  /**
   * System time — when Hypha retracted or superseded it.
   * `null` (absence) = currently believed.
   */
  tx_invalidated?: Iso8601;
  /** Real-world time the fact started being true. Null → inherit `at`. */
  valid_from?: Iso8601;
  /** Real-world time the fact stopped being true. Null → still true. */
  valid_to?: Iso8601;
  /** Governance/UX flag; surfaces in `search({ needs_review: true })`. */
  needs_review?: boolean;
  provenance: Provenance;
  owner_instance_id: string;
}

// ─── Stored shapes ────────────────────────────────────────────────────────

export type StoredNode = Node & RecordMeta;
export type StoredEdge = Edge & RecordMeta;

export type Record_ = StoredNode | StoredEdge;

// ─── Type guards ──────────────────────────────────────────────────────────

export function isNode(r: Record_): r is StoredNode {
  return !('from_id' in r);
}

export function isEdge(r: Record_): r is StoredEdge {
  return 'from_id' in r;
}

export function isIngested(p: Provenance): p is Extract<Provenance, { kind: 'ingested' }> {
  return p.kind === 'ingested';
}

export function isInferred(p: Provenance): p is Extract<Provenance, { kind: 'inferred' }> {
  return p.kind === 'inferred';
}
