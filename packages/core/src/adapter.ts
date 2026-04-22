/**
 * Adapter contract types. Implementations live in packages/adapters/*.
 *
 * An adapter produces a stream of `AdapterEvent`s describing the nodes, edges,
 * blobs, progress, state, and log messages it observes while parsing a source.
 * The runtime batches, deduplicates, persists blobs to content-addressed
 * storage, and writes records transactionally.
 */

import type { z } from 'zod';
import type { Edge, Node, Provenance } from './model.ts';

// ─── Manifest ─────────────────────────────────────────────────────────────

export interface AdapterManifest {
  id: string;
  version: string;
  name?: string;
  description?: string;
  emits: {
    kinds: readonly EmittedKind[];
    edges: readonly string[];
  };
  capabilities: AdapterCapabilities;
  inputs: readonly AdapterInput[];
  schema_evolution?: Readonly<Record<string, FacetEvolutionPolicy>>;
}

export interface EmittedKind {
  kind: string;
  facet_schema_version: number;
  id_strategy: 'content_addressed' | 'derived' | 'natural';
}

export interface AdapterCapabilities {
  /** Which ingest modes the adapter supports. */
  ingest_modes: readonly ('full' | 'incremental' | 'cdc')[];
  /** Does this source naturally terminate (Takeout ZIP)? */
  bounded: boolean;
  /** Does it emit stable content-addressed ids? */
  emits_content_addressed_ids: boolean;
  /** Can re-ingest update facets on existing nodes? */
  supports_corrections: boolean;
  /** Can it run without side-effects (enumerate only)? */
  supports_dry_run: boolean;
  /** Is `ingest()` pure under a fixed input + state? */
  idempotent: boolean;
}

export interface AdapterInput {
  name: string;
  type: 'path' | 'url' | 'token' | 'string' | 'number' | 'boolean';
  required: boolean;
  description?: string;
}

export type FacetEvolutionPolicy =
  | { on_new_field?: 'evolve' | 'freeze' | 'discard_columns'; on_type_change?: 'evolve' | 'freeze' | 'discard_rows' };

// ─── Events ───────────────────────────────────────────────────────────────

export type AdapterEvent =
  | { type: 'node'; node: Omit<Node, 'ingested_at'>; provenance?: Provenance }
  | { type: 'edge'; edge: Omit<Edge, 'ingested_at'>; provenance?: Provenance }
  | { type: 'blob'; bytes: Uint8Array; mime?: string }
  | { type: 'progress'; stream: string; scanned: number; emitted: number }
  | { type: 'state'; state: Readonly<Record<string, unknown>> }
  | { type: 'log'; level: 'debug' | 'info' | 'warn' | 'error'; message: string; ctx?: Readonly<Record<string, unknown>> };

// ─── Runtime context ──────────────────────────────────────────────────────

export interface AdapterContext {
  logger: AdapterLogger;
  state: Readonly<Record<string, unknown>> | undefined;
  dryRun: boolean;
  httpClient?: HttpClient;
}

export interface AdapterLogger {
  debug(msg: string, ctx?: Readonly<Record<string, unknown>>): void;
  info(msg: string, ctx?: Readonly<Record<string, unknown>>): void;
  warn(msg: string, ctx?: Readonly<Record<string, unknown>>): void;
  error(msg: string, ctx?: Readonly<Record<string, unknown>>): void;
}

export interface HttpClient {
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
}

// ─── The adapter itself ───────────────────────────────────────────────────

export interface HyphaAdapter<Inputs = Readonly<Record<string, unknown>>> {
  readonly manifest: AdapterManifest;
  readonly facetSchemas: Readonly<Record<string, z.ZodTypeAny>>;
  readonly edgeSchemas?: Readonly<Record<string, z.ZodTypeAny>>;

  ingest(inputs: Inputs, ctx: AdapterContext): AsyncIterable<AdapterEvent>;

  /** Optional: cheap pre-flight validating that the input is consumable. */
  check?(inputs: Inputs): Promise<CheckResult>;
  /** Optional: enumerate streams/partitions without reading data. */
  discover?(inputs: Inputs): Promise<DiscoveredStreams>;
}

export interface CheckResult {
  ok: boolean;
  reason?: string;
}

export interface DiscoveredStreams {
  streams: readonly { name: string; kinds: readonly string[]; estimated_size?: number }[];
}
