# Changelog

All notable changes to Hypha are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Hypha adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0-alpha] — 2026-04-22

First tagged release. The core is end-to-end wired; several adapters and the web UI are deferred (see below). Production-ready as a library; developers welcome.

### Added — W13-14 polish + launch
- Polished `README.md` with quick-start, Claude Desktop integration config, explicit deferred scope, architecture ASCII.
- `hypha.config.example.ts` — instance-level configuration shape (owner, storage mode, governance profile, LLM/embedder profile, MCP transports).
- `evals/` scaffold with a README pointing at LongMemEval subset + synthetic Takeout benchmark (implementation in v1.x).
- Blog post draft `docs/blog-dogsheep-for-ai-agents.md` — ready to publish.

### Added — W11-12 ask(NL) + publish + Graphiti interchange
- `ask` MCP tool (7th tool, under the ≤7 cap): compiles natural-language questions via Claude Haiku when `ANTHROPIC_API_KEY` is set; falls back to plain FTS text search otherwise. Compiled query always surfaces in `structuredContent` so agents and humans see what Hypha actually asked — never "the LLM made it up."
- `hypha publish [--port]` — read-only HTTP server (Elysia) mirroring the MCP surface as JSON: `/search`, `/node/:id` (with 1-hop neighborhood), `/node/:id/why`, `/timeline`. Stable permalinks.
- `hypha export --format graphiti --out FILE` and `hypha import --format graphiti --in FILE` — round-trips between Hypha and Graphiti's node/edge JSON schema, mapping four-timestamp provenance to `t_valid`/`t_invalid`/`t_created`/`t_expired`. End-to-end verified: 12 nodes + 12 edges export ↔ re-import with zero data loss.

### Added — W9-10 adapters + inferrers (partial)
- `@hypha/adapter-google-drive-folder`: recursive directory walk with MIME-typed file kinds (file.document / file.image / file.other), emits folder tree + `contained_in` edges. Works for any local folder — a generalization of Drive export unpack.
- `@hypha/inferrer-dlp-scanner`: regex-based DLP/PII pre-pass. Validated patterns for SSN, email, US phone, Luhn-checked credit cards, ABA-validated US bank routing, IBAN, labeled DOB. Emits `dlp.finding` nodes linked to their source via `dlp_finding_for` edges. No matched substring stored — offsets + kind only, to avoid making findings their own PII vector.
- Registered both in the CLI: `hypha ingest google-drive-folder <path>` + `hypha infer dlp-scanner`.
- 9 new tests pass (adapter contract + regex patterns + E2E inferrer idempotency).

### Explicitly deferred (not in v1-B)
- `google-takeout` meta-adapter (multi-format routing: mbox, iCal, vCard, JSON).
- `slack-export` adapter (ZIP walk + JSON-per-channel-per-day).
- `microsoft-365-export` adapter (PST/OST via libpff FFI).
- `notion-export` adapter (markdown + CSV walk).
- `community-summarizer` inferrer (Leiden clustering + LLM summaries — needs Reasoner plumbing).
- `memify` inferrer (usage-based salience — needs audit-log reader extension on the Store interface).

### Added — W7-8 MCP surface + governance
- `@hypha/mcp`: full MCP server with six intent-shaped tools (`search`, `neighborhood`, `timeline`, `why`, `fetch`, `record`), two resource templates (`hypha://node/{id}`, `hypha://edge/{id}`), and one prompt (`/hypha:weekly-digest`). Tool annotations (`readOnlyHint`, `idempotentHint`, `openWorldHint`) set correctly. All tools return `structuredContent` with `instance_id` + inline provenance.
- `@hypha/governance`: `AuditLog` (SQLite `audit` table writer with `pii_kinds_seen`), `AllowAllPolicy` + `OwnerOnlyPolicy` stubs behind a `PolicyEngine` interface. Cedar binding deferred until the Rust crate has stable Bun bindings.
- `SQLiteStore`: implemented `neighborhood` (1-3 hop traversal with direction + edge-kind filters + truncation flag), `timeline` (time-ordered events, optionally subject-scoped, cursor-paginated), `why` (walks provenance tree to ingested leaves + returns citations).
- `hypha serve` CLI command (stdio transport for Claude Desktop).
- Identity-resolver edge ids are now content-addressed from the pair hash, making re-runs genuinely idempotent.
- 4 new MCP server tests via InMemoryTransport: list tools/resources, search through MCP, fetch resolves URIs, why walks inferred derivations.

### Known gaps
- Streamable HTTP transport, OAuth 2.1 + PKCE, biometric DEK unlock (Swift helper) scaffolded but not wired — land in a future milestone.

### Added — W5-6 inferrer SDK + identity-resolver
- `@hypha/inferrer-sdk`: `defineInferrer()`, `runInferrer()`, `runInferrers()` with topological ordering (reads ↔ writes DAG, cycle detection, `.*` kind patterns), `inputs_hash` idempotency.
- `@hypha/inferrer-identity-resolver`: three-stage cascade.
  - **Block**: multi-key union blocking (by domain, by local-part, by name-tokens) so cross-domain matches are caught.
  - **Score**: pragmatic Fellegi-Sunter-inspired additive weighting (same_local_part +0.75, display_name_jw_high +0.35, etc.) capped at 1.0.
  - **Cluster**: WCC via union-find over match edges at confidence ≥ 0.80. Persons are emitted only for clusters of size ≥ 2; singletons omitted.
- Jaro-Winkler distance + weakly-connected-components helpers (reusable).
- `Store.scan(kinds[])` — streams currently-believed records by kind (supports `kind.*` prefix patterns).
- `hypha infer [inferrer]` CLI command.
- LLM-judge cascade tail is scaffolded via `ctx.reasoner` but disabled until W7-8 plumbs the Reasoner interface.
- E2E: a fixture with `naledi@gmail.com` + `naledi@uncommonschools.org` (same display name) clusters into one `person` node; re-runs are idempotent.

### Added — W3-4 adapter SDK + gmail-mbox
- `@hypha/adapter-sdk`: `defineAdapter()`, `runAdapter()`, `loadManifest`/`parseManifest` (Zod-validated YAML), `assertAdapterContract()` with six assertions (id-stability, idempotent-ingest, capabilities-match-behavior, edge-kinds-declared, facets-validate, emits-match-manifest).
- `@hypha/adapter-gmail-mbox`: streaming mbox parser, Zod facet schemas for `gmail.message`/`gmail.thread`/`identity.email`, emits `sent_to`/`cc`/`bcc`/`part_of_thread`/`replied_to` edges. Content-addressed message ids make re-ingest idempotent.
- `@hypha/cli`: `hypha ingest <adapter> <path>`, `hypha search <query>` (FTS5-only MVP), `hypha build-adapter <pkg-dir>`. `parseArgs`-based; no dep on commander/yargs.
- `@hypha/store-sqlite`: basic FTS5-backed `search()` with kind + provenance + review filters (vector search lands in W7-8).
- gmail-mbox contract test passes all 6 assertions over `fixtures/small.mbox`.
- E2E verified: `bun run hypha ingest gmail-mbox fixtures/small.mbox` → 11 nodes + 9 edges; `bun run hypha search dinner` → 3 cited hits; re-ingest skips all 20 records.

### Added — W1-2 scaffold
- Bun workspace monorepo (Apache-2.0, TS strict + ESM).
- `@hypha/core`: Node + Edge + Provenance types, bitemporal quartet, Store interface, Adapter + Inferrer contracts, id + time helpers.
- `@hypha/store-sqlite`: SQLite + FTS5 + sqlite-vec implementation of Store, with upsert, getNode, getEdge, invalidate, and the full schema.sql (records, ingest_cursor, audit, pii_findings, pii_tags, instance, migrations).
- Package stubs for `@hypha/adapter-sdk`, `@hypha/inferrer-sdk`, `@hypha/mcp`, `@hypha/server`, `@hypha/cli`, `@hypha/governance`.
- README.md, SPEC.md, LICENSE (Apache-2.0), .gitignore.
- 3 passing smoke tests (upsert, idempotent re-upsert, edge + FK).

### Known limitations
- `sqlite-vec` loading currently requires a system SQLite with extension support — Bun's default SQLite is built without `SQLITE_ENABLE_LOAD_EXTENSION`. Resolution scheduled for W5-6 alongside identity-resolver's ANN blocking.
- `search`, `neighborhood`, `timeline`, `why`, `scan` on `SQLiteStore` are stubbed — land in W7-8 alongside MCP tools.
