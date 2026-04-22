/**
 * @hypha/adapter-sdk — author Hypha adapters.
 *
 * Public surface:
 *   - defineAdapter(opts)   : build a HyphaAdapter with YAML-manifest + Zod facets
 *   - runAdapter(opts)      : consume an adapter's event stream and write to a Store
 *   - assertAdapterContract : six-assertion contract test every adapter must pass
 *   - loadManifest / parseManifest : YAML loader + validator
 */

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
} from '@hypha/core';

export { defineAdapter } from './define.ts';
export type { DefineAdapterOptions } from './define.ts';

export { runAdapter } from './runtime.ts';
export type { RunAdapterOptions, RunAdapterResult } from './runtime.ts';

export { loadManifest, parseManifest, ManifestSchema } from './manifest.ts';
