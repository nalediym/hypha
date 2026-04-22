/**
 * @hypha/inferrer-sdk — author Hypha inferrers.
 *
 * Public surface:
 *   - defineInferrer(opts)   : build an Inferrer
 *   - runInferrer(opts)      : run one inferrer + write facts
 *   - runInferrers(opts)     : topologically sort + run a group
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

export { defineInferrer } from './define.ts';
export type { DefineInferrerOptions } from './define.ts';
export { runInferrer, runInferrers } from './runtime.ts';
export type {
  RunInferrerOptions,
  RunInferrerResult,
  RunInferrersOptions,
} from './runtime.ts';
