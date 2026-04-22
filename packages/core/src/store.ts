/**
 * Store — the single abstraction over Hypha's persistent graph.
 *
 * Implementations: @hypha/store-sqlite (default, local-first),
 * @hypha/store-postgres (v1.2 target, stubbed for now).
 *
 * Every query accepts a BitemporalCoord (`asOf`, `validAt`) so time-travel
 * is first-class. Default is "currently believed, right now."
 *
 * Every mutation accepts a `WriteContext` so inferrer runs and adapter
 * ingests share a single transaction boundary + stable `tx_created`.
 */

import type { Edge, Node, Provenance, StoredEdge, StoredNode } from './model.ts';
import type { EdgeId, NodeId } from './id.ts';
import type { BitemporalCoord, Iso8601, TimeRange } from './time.ts';

// ─── Queries ──────────────────────────────────────────────────────────────

export interface SearchQuery extends BitemporalCoord {
  /** Free text — runs through FTS5 and (if `embedding` absent) a hybrid score. */
  text?: string;
  /** Dense vector for semantic search. Merged with `text` in hybrid ranking. */
  embedding?: Float32Array;
  /** Filter by node kind. Supports glob-style suffix wildcards: `gmail.*`. */
  kinds?: readonly string[];
  /** Restrict to nodes connected via these edge kinds. */
  edge_kinds?: readonly string[];
  /** Time-range filter on primary event time. */
  range?: TimeRange;
  /** Adapter-source filter. */
  adapters?: readonly string[];
  /** Include inferred records. Default true. */
  include_inferred?: boolean;
  /** Minimum provenance confidence for inferred records. Default 0.6. */
  min_confidence?: number;
  /** Only return records flagged `needs_review: true`. */
  needs_review?: boolean;
  /** Page size. Server-chosen if omitted. */
  limit?: number;
  /** Opaque cursor from a previous page. */
  cursor?: string;
}

export interface SearchHit {
  node: StoredNode;
  score: number;
  highlights?: readonly string[];
}

export interface SearchResult {
  hits: readonly SearchHit[];
  nextCursor?: string;
  total?: number;
}

export interface NeighborhoodQuery extends BitemporalCoord {
  id: NodeId;
  /** Hop count. Default 1. Hard-cap 3 at the Store level. */
  depth?: 1 | 2 | 3;
  edge_kinds?: readonly string[];
  direction?: 'in' | 'out' | 'both';
  limit?: number;
}

export interface GraphSlice {
  center: StoredNode;
  nodes: readonly StoredNode[];
  edges: readonly StoredEdge[];
  truncated: boolean;
}

export interface TimelineQuery extends BitemporalCoord {
  /** Optional subject — events _about_ this node (via any edge). */
  subject?: NodeId;
  kinds?: readonly string[];
  range?: TimeRange;
  limit?: number;
  cursor?: string;
}

export interface TimelineEvent {
  record: StoredNode | StoredEdge;
  anchor: Iso8601; // primary sort key — normalized event time
}

export interface TimelineResult {
  events: readonly TimelineEvent[];
  nextCursor?: string;
}

export interface WhyResult {
  subject: StoredNode | StoredEdge;
  inferred: boolean;
  derivation: DerivationNode;
  citations: readonly (StoredNode | StoredEdge)[];
}

export interface DerivationNode {
  subject_id: string;
  provenance: Provenance;
  inputs: readonly DerivationNode[];
}

// ─── Writes ───────────────────────────────────────────────────────────────

export interface WriteContext {
  /** The owner instance id. Stamped onto every written record. */
  owner_instance_id: string;
  /** Stable tx_created for all records in this batch. */
  tx_at?: Iso8601;
  /** If provided, enables per-call idempotency for `record()` mutations. */
  idempotency_key?: string;
}

export type UpsertNode = Node & { provenance: Provenance; valid_from?: Iso8601; valid_to?: Iso8601 };
export type UpsertEdge = Edge & { provenance: Provenance; valid_from?: Iso8601; valid_to?: Iso8601 };

export interface UpsertResult {
  nodes_written: number;
  edges_written: number;
  skipped_idempotent: number;
}

export interface InvalidateOp {
  id: NodeId | EdgeId;
  at: Iso8601; // tx_invalidated timestamp
}

// ─── Store interface ──────────────────────────────────────────────────────

/**
 * Read-only view of the store. Inferrers get this — they can query but not write.
 * The runner writes returned Facts atomically after the run completes.
 */
export interface StoreReadOnly {
  getNode(id: NodeId, coord?: BitemporalCoord): Promise<StoredNode | null>;
  getEdge(id: EdgeId, coord?: BitemporalCoord): Promise<StoredEdge | null>;
  search(q: SearchQuery): Promise<SearchResult>;
  neighborhood(q: NeighborhoodQuery): Promise<GraphSlice>;
  timeline(q: TimelineQuery): Promise<TimelineResult>;
  why(id: NodeId | EdgeId, depth?: number): Promise<WhyResult>;

  /**
   * Scan a stream of records by kind — used by inferrers that consume large
   * slices (e.g. community-summarizer). Generator is bitemporally consistent
   * with the coord at open time.
   */
  scan(
    kinds: readonly string[],
    coord?: BitemporalCoord,
  ): AsyncIterable<StoredNode | StoredEdge>;
}

export interface Store extends StoreReadOnly {
  /**
   * Upsert nodes and edges in a single transaction. Re-upserts of the same id
   * with identical content are no-ops; with changed content, prior record is
   * tx_invalidated and a new row is inserted. Idempotent when provenance
   * carries a stable inputs_hash (inferrer case) or external_id (adapter case).
   */
  upsert(
    records: { nodes?: readonly UpsertNode[]; edges?: readonly UpsertEdge[] },
    ctx: WriteContext,
  ): Promise<UpsertResult>;

  /** Mark records as retracted. Does not delete; sets tx_invalidated. */
  invalidate(ops: readonly InvalidateOp[], ctx: WriteContext): Promise<number>;

  /** Close underlying handles. Idempotent. */
  close(): Promise<void>;
}
