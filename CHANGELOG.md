# Changelog

All notable changes to Hypha are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Hypha adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
