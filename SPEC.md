# Hypha — Specification

Pre-alpha. Canonical decisions live in [`~/.deep-research/sessions/hypha-2026-sota/report.md`](../.deep-research/sessions/hypha-2026-sota/report.md); this spec is the user-facing reference.

## 1. Data model — two primitives, open kinds

Hypha's entire graph is two record types:

```ts
interface Node {
  id: string;                   // `${adapter}:${kind}:${blake3(externalId)}` or content-addressed
  kind: string;                 // open; namespaced. e.g. "gmail.message", "identity.email"
  at: string;                   // ISO 8601 — primary event (valid) time
  ingested_at: string;          // ISO 8601 — when Hypha learned it (transaction time)
  adapter: string;              // "gmail-mbox"
  external_id: string;          // source-native id
  title: string;
  body?: string;
  blob_refs?: string[];         // sha256 content hashes
  facets?: Record<string, unknown>;  // adapter-defined structured payload (Zod-validated)
}

interface Edge {
  id: string;
  kind: string;                 // "sent_to", "authored", "part_of_thread", ...
  from_id: string;
  to_id: string;
  at: string;
  weight?: number;
}
```

Kinds are strings, not a discriminated union. Adapters declare their kinds in a YAML manifest. Core doesn't know what a "message" is.

## 2. Temporal — bitemporal from day one

Every record carries four timestamps:

- `tx_created` — system time, when Hypha first recorded the fact.
- `tx_invalidated` — system time, when Hypha retracted or superseded the fact. `NULL` = currently believed.
- `valid_from` — real-world time the fact started being true (nullable; falls back to `at`).
- `valid_to` — real-world time the fact stopped being true (nullable).

Queries take `{ asOf?, validAt?, include_inferred?, min_confidence? }`. Default is "currently believed, include inferred facts above 0.6 confidence."

## 3. Provenance — same tables, one indexed column

Every record has:

```ts
type Provenance =
  | { kind: "ingested"; adapter: string; adapter_version: string; external_id: string }
  | { kind: "inferred"; inferrer: string; inferrer_version: string;
      inputs: string[]; inputs_hash: string; confidence: number };
```

Stored on the same table as the data. Indexed on `provenance_kind` so `include_inferred=false` is a fast filter. `inputs_hash` is used for inferrer idempotency: re-running an inferrer over the same inputs produces the same hash → no duplicate writes.

## 4. Adapters — plugin contract

Each adapter is a package under `packages/adapters/*`, exporting:

```ts
interface HyphaAdapter {
  manifest: AdapterManifest;              // YAML contents
  facetSchemas: Record<string, ZodSchema>;
  ingest(inputs, ctx): AsyncIterable<AdapterEvent>;
  check?(inputs): Promise<CheckResult>;
  discover?(inputs): Promise<DiscoveredStreams>;
}
```

`AdapterEvent` union: `node | edge | progress | state | log`.

Adapter manifest (`adapter.yaml`):

```yaml
id: gmail-mbox
version: 0.1.0
emits:
  kinds:    [gmail.message, gmail.thread, identity.email]
  edges:    [sent_to, cc, part_of_thread, replied_to]
capabilities:
  ingest_modes: [full]
  bounded: true
  emits_content_addressed_ids: true
  supports_corrections: true
```

Contract test (`assertAdapterContract`) enforces: id stability, idempotent re-ingest, capabilities-match-behavior, edge kinds declared, facets validate against Zod, emits match manifest.

## 5. Inferrers — symmetric to adapters

Inferrers live in `packages/inferrers/*`. Same lifecycle, same provenance machinery, different output-origin:

```ts
interface Inferrer<Reads, Writes> {
  id: string;
  version: string;
  reads: string[];      // kinds it consumes
  writes: string[];     // kinds it produces
  run(store: StoreReadOnly, tx: TxContext): Promise<Facts>;
}
```

Runner topologically sorts by `reads`/`writes`. Inferrers return facts; runner writes. Idempotency by `inputs_hash`.

v1 inferrers: `identity-resolver`, `community-summarizer`, `memify`, `dlp-scanner`.

## 6. MCP surface — six tools + resource templates

Tools (small, intent-shaped, model-controlled):

- `search(q, kinds?, edge_kinds?, limit?, min_confidence?, cursor?)`
- `neighborhood(id, depth?, edge_kinds?, direction?, limit?)`
- `timeline(subject?, kinds?, since?, until?, cursor?)`
- `why(id, depth?)` — walks provenance tree
- `fetch(uri)` — resolves `hypha://node/{id}` or `hypha://edge/{id}`
- `record(kind, fields, edges?, provenance)` — mutating; requires idempotency key

Resource templates (app/user-controlled):
- `hypha://node/{id}` · `hypha://edge/{id}` · `hypha://timeline/{subject_id}` · `hypha://why/{id}`

Prompts: `/hypha:weekly-digest`.

Transports: stdio + Streamable HTTP. No SSE.

Every tool response includes `instance_id`, `instance_label`, inline provenance, cursor-based pagination.

## 7. Governance — Cedar embedded, biometric unlock

- **Cedar policies** in `hypha.config.ts`. `authorize(subject, action, resource, context) → allow | deny | obligation[]`.
- **MCP auth**: OAuth 2.1 + PKCE for non-stdio clients.
- **Storage modes**: `trust-os` (plaintext, rely on FileVault; default) · `portable` (SQLCipher + Keychain DEK + biometric unlock) · `envelope` (per-row AES-GCM on sensitive columns; v1.1+).
- **Audit log** in SQLite with `pii_kinds_seen` column.

## 8. LLM / embedder profiles

- `default`: Nomic Embed v2 local + Claude Sonnet under ZDR.
- `strict-local`: Nomic + Phi-4 Mini / Llama 3.3 70B via Ollama.
- `cloud-zdr`: both remote, both under ZDR.

Pluggable `Embedder` and `Reasoner` interfaces with `locality: 'local' | 'remote-zdr' | 'remote-standard'` so Cedar policy can route per-node-kind.

## 9. Owner model

Exactly one owner per Hypha instance, declared in `hypha.config.ts`. Owner is instance-level state, not a node kind. Identity resolution clusters `identity.*` nodes into `person.*` inferred nodes — the owner is one of those persons, anchored by explicit config.

## 10. Non-goals

- Live API connectors (someone else's product).
- Chat UI (agents bring their own).
- Enterprise search replacement (Glean's game).
- Agent-memory infra (Mem0/Zep/Letta own that).
- A notes app or screen recorder.
