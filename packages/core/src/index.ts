/**
 * @hypha/core — two-primitive graph model, Store interface, Adapter + Inferrer contracts.
 *
 * Import surface is intentionally small. Deep imports are available via
 * subpath exports (./model, ./store, ./adapter, ./inferrer, ./id, ./time).
 */

export type { BlobRef, EdgeId, NodeId } from './id.ts';
export {
  blobRef,
  edgeId,
  inputsHash,
  nodeIdFromContent,
  nodeIdFromExternal,
} from './id.ts';

export type { BitemporalCoord, Iso8601, TimeRange } from './time.ts';
export { fromEpochMs, iso, now, toEpochMs } from './time.ts';

export type {
  Edge,
  Node,
  Provenance,
  RecordMeta,
  Record_,
  StoredEdge,
  StoredNode,
} from './model.ts';
export { isEdge, isIngested, isInferred, isNode } from './model.ts';

export type {
  DerivationNode,
  GraphSlice,
  InvalidateOp,
  NeighborhoodQuery,
  SearchHit,
  SearchQuery,
  SearchResult,
  Store,
  StoreReadOnly,
  TimelineEvent,
  TimelineQuery,
  TimelineResult,
  UpsertEdge,
  UpsertNode,
  UpsertResult,
  WhyResult,
  WriteContext,
} from './store.ts';

export type {
  AdapterCapabilities,
  AdapterContext,
  AdapterEvent,
  AdapterInput,
  AdapterLogger,
  AdapterManifest,
  CheckResult,
  DiscoveredStreams,
  EmittedKind,
  FacetEvolutionPolicy,
  HttpClient,
  HyphaAdapter,
} from './adapter.ts';

export type {
  CompletionRequest,
  CompletionResponse,
  Embedder,
  FactEdge,
  FactNode,
  Facts,
  Inferrer,
  InferrerLogger,
  InferrerRunContext,
  Locality,
  Reasoner,
} from './inferrer.ts';
