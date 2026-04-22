import type {
  Facts,
  Inferrer,
  InferrerRunContext,
  StoreReadOnly,
} from '@hypha/core';

export interface DefineInferrerOptions {
  id: string;
  version: string;
  /** Node + edge kinds this inferrer consumes. Used by the runner's topological sort. */
  reads: readonly string[];
  /** Node + edge kinds this inferrer produces. */
  writes: readonly string[];
  /** The inference pass. Reads from Store, returns Facts; runner writes. */
  run(store: StoreReadOnly, ctx: InferrerRunContext): Promise<Facts>;
}

export function defineInferrer(opts: DefineInferrerOptions): Inferrer {
  return {
    id: opts.id,
    version: opts.version,
    reads: opts.reads,
    writes: opts.writes,
    run: opts.run,
  };
}
