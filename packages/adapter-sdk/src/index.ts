/**
 * @hypha/adapter-sdk — author Hypha adapters.
 *
 * Lands in W3-4 alongside the gmail-mbox adapter. For now we re-export the
 * core adapter contract so authors can start sketching.
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
