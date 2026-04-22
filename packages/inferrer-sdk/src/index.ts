/**
 * @hypha/inferrer-sdk — author Hypha inferrers.
 *
 * Lands in W5-6 alongside identity-resolver. For now we re-export the core
 * inferrer contract so authors can start sketching.
 */

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
} from '@hypha/core';
