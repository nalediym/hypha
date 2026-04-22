# Changelog

All notable changes to Hypha are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Hypha adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
