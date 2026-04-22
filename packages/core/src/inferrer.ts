/**
 * Inferrer contract types. Implementations live in packages/inferrers/*.
 *
 * Inferrers read from a StoreReadOnly and return Facts (nodes + edges) with
 * inferred provenance. The runner topologically sorts by `reads`/`writes`,
 * executes each inferrer, and writes returned facts in a single transaction,
 * stamping `inputs_hash` to drop duplicate writes on re-runs.
 */

import type { Edge, Node, Provenance } from './model.ts';
import type { StoreReadOnly, WriteContext } from './store.ts';

export interface Inferrer<Ctx extends InferrerRunContext = InferrerRunContext> {
  readonly id: string;
  readonly version: string;
  readonly reads: readonly string[]; // node + edge kinds this consumes
  readonly writes: readonly string[]; // node + edge kinds this produces

  run(store: StoreReadOnly, ctx: Ctx): Promise<Facts>;
}

export interface InferrerRunContext {
  readonly tx: WriteContext;
  readonly logger: InferrerLogger;
  /**
   * Reasoning hooks — a `Reasoner` for LLM judge calls, an `Embedder` for ANN
   * blocking. Optional so inferrers that don't need them avoid DI boilerplate.
   */
  reasoner?: Reasoner;
  embedder?: Embedder;
}

export interface InferrerLogger {
  debug(msg: string, ctx?: Readonly<Record<string, unknown>>): void;
  info(msg: string, ctx?: Readonly<Record<string, unknown>>): void;
  warn(msg: string, ctx?: Readonly<Record<string, unknown>>): void;
  error(msg: string, ctx?: Readonly<Record<string, unknown>>): void;
}

export interface Facts {
  nodes?: readonly FactNode[];
  edges?: readonly FactEdge[];
  invalidations?: readonly string[]; // ids of prior inferences being superseded
}

export type FactNode = Node & { provenance: Provenance; needs_review?: boolean };
export type FactEdge = Edge & { provenance: Provenance; needs_review?: boolean };

// ─── Reasoner + Embedder (pluggable LLM interfaces) ───────────────────────

export type Locality = 'local' | 'remote-zdr' | 'remote-standard';

export interface Embedder {
  readonly id: string;
  readonly dims: number;
  readonly maxTokens: number;
  readonly locality: Locality;
  embed(texts: readonly string[]): Promise<Float32Array[]>;
}

export interface Reasoner {
  readonly id: string;
  readonly contextWindow: number;
  readonly locality: Locality;
  complete(req: CompletionRequest): Promise<CompletionResponse>;
}

export interface CompletionRequest {
  system?: string;
  messages: readonly { role: 'user' | 'assistant' | 'system'; content: string }[];
  maxTokens?: number;
  temperature?: number;
  /** Optional JSON schema for structured output. */
  outputSchema?: Readonly<Record<string, unknown>>;
}

export interface CompletionResponse {
  text: string;
  structured?: unknown;
  usage?: { input_tokens: number; output_tokens: number };
}
