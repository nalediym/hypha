import type { z } from 'zod';
import type {
  AdapterContext,
  AdapterEvent,
  AdapterManifest,
  CheckResult,
  DiscoveredStreams,
  HyphaAdapter,
} from '@hypha/core';
import { loadManifest } from './manifest.ts';

export interface DefineAdapterOptions<Inputs> {
  /** Absolute or module-relative path to `adapter.yaml`. */
  manifestPath?: string;
  /** Inline manifest — use in tests, or when YAML is inconvenient. */
  manifest?: AdapterManifest;
  /** Zod schema per emitted `kind`. Validated when the runtime writes. */
  facetSchemas: Readonly<Record<string, z.ZodTypeAny>>;
  /** Optional Zod schema per emitted edge kind. */
  edgeSchemas?: Readonly<Record<string, z.ZodTypeAny>>;
  /** The ingest routine — an async generator of AdapterEvents. */
  ingest: (inputs: Inputs, ctx: AdapterContext) => AsyncIterable<AdapterEvent>;
  check?: (inputs: Inputs) => Promise<CheckResult>;
  discover?: (inputs: Inputs) => Promise<DiscoveredStreams>;
}

export function defineAdapter<Inputs = Readonly<Record<string, unknown>>>(
  opts: DefineAdapterOptions<Inputs>,
): HyphaAdapter<Inputs> {
  const manifest = opts.manifest ?? (opts.manifestPath ? loadManifest(opts.manifestPath) : null);
  if (!manifest) {
    throw new Error('defineAdapter: either `manifest` or `manifestPath` is required');
  }

  const adapter: HyphaAdapter<Inputs> = {
    manifest,
    facetSchemas: opts.facetSchemas,
    ingest: opts.ingest,
    ...(opts.edgeSchemas ? { edgeSchemas: opts.edgeSchemas } : {}),
    ...(opts.check ? { check: opts.check } : {}),
    ...(opts.discover ? { discover: opts.discover } : {}),
  };

  return adapter;
}
