# Contributing to Hypha

Hypha is `v0.1.0-alpha`. The surface is small, deliberate, and still moving. External contribution is welcome but scoped — please open an issue first so we can agree on shape before you write code.

## Ground rules

- **Issues before PRs.** A PR without a linked issue that's been discussed is likely to be closed with a request to open one first.
- **One adapter or inferrer per PR.** Don't bundle.
- **Tests required.** New adapters need a fixture in `tests/fixtures/` and a smoke test that ingests → queries → asserts shape. New inferrers need at least one deterministic test case.
- **Zod schemas live with the code.** If you add a `Node.kind` or `Edge.kind`, define the facets schema in the adapter/inferrer that emits it.
- **Bitemporal invariants.** Never mutate a row. Invalidate with `tx_invalidated` and insert a new one. The store enforces this in tests.

## Development

```bash
git clone https://github.com/nalediym/hypha
cd hypha
bun install
bun test
```

Everything runs against in-memory SQLite in tests. For local ingest of real data, use `bun run hypha ingest ...` with the `--db .hypha/store.sqlite` flag.

## Areas that want help

- **Adapters:** `google-takeout`, `slack-export`, `microsoft-365-export`, `notion-export`. Each is a weekend of work against an existing, stable export format.
- **Inferrers:** `community-summarizer` (GraphRAG-style Leiden + LLM summaries), `memify` (usage-based salience).
- **Store backends:** `@hypha/store-postgres` (interface exists; implementation is a port of the SQLite store).

## Out of scope

- Live API integrations. Hypha is static-exports-first on purpose. If you want live Gmail, that's a different project.
- Cloud-hosted variants in the core repo. Hypha is local-first.
- Anything that breaks the two-primitive (Node + Edge, open `kind`) data model.

## Code of Conduct

By participating, you agree to abide by the [Code of Conduct](./CODE_OF_CONDUCT.md).

## License

Contributions are licensed under Apache-2.0, matching the project license.
