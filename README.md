# Hypha

**Person OS for your static exports.**

A local-first personal/org knowledge graph library. Ingests static data exports (Gmail mbox, Google Drive folders, and more) into a typed, temporal, browsable graph that AI agents navigate over MCP like a private website.

> _Dogsheep for AI agents._

[![License: Apache 2.0](https://img.shields.io/badge/license-Apache_2.0-blue.svg)](LICENSE)
![Status: Alpha](https://img.shields.io/badge/status-alpha-yellow)

---

## Status

`v0.1.0-alpha` — the core is end-to-end wired; some adapters and the web UI are deferred. See [CHANGELOG](./CHANGELOG.md).

![Tests: 27 passing](https://img.shields.io/badge/tests-27%20passing-brightgreen)

<!-- TODO: GIF of Claude Desktop calling search() → neighborhood() → why() on a real mbox, showing inline provenance -->

## Who is this for?

- **People with a decade of Gmail and Drive** who want an AI agent that can actually reason across it — without uploading it to anyone.
- **Privacy-minded power users** who already run Claude Desktop or Cursor locally and want their own data as a first-class tool surface.
- **Builders of personal agents** who need a typed, temporal substrate instead of re-inventing embeddings-over-PDFs every project.

If you've ever thought *"my inbox knows the answer, but I can't ask it"* — Hypha is for you.

## Quick start

```bash
git clone https://github.com/nalediym/hypha && cd hypha
bun install

# Ingest a mbox archive
bun run hypha ingest gmail-mbox path/to/archive.mbox --db .hypha/store.sqlite

# Resolve identities across addresses
bun run hypha infer identity-resolver

# Scan for PII
bun run hypha infer dlp-scanner

# Query
bun run hypha search "Dinner plans"
bun run hypha search "Naledi Kekana" --kinds person

# Serve over MCP for Claude Desktop / Cursor
bun run hypha serve

# Or serve read-only JSON over HTTP
bun run hypha publish --port 3456

# Round-trip with Graphiti
bun run hypha export --format graphiti --out export.json
bun run hypha import --format graphiti --in export.json
```

### Claude Desktop integration

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "hypha": {
      "command": "bun",
      "args": ["/absolute/path/to/hypha/packages/mcp/src/bin.ts"],
      "env": { "HYPHA_DB": "/absolute/path/to/.hypha/store.sqlite" }
    }
  }
}
```

Claude sees seven tools: `search`, `neighborhood`, `timeline`, `why`, `fetch`, `record`, `ask`. Each returns structured content with inline provenance.

## Thesis

Hypha takes *your own* data — Gmail mboxes, Google Drive folders, takeout exports — normalizes it into a typed temporal graph, and lets AI agents navigate *inside* it over MCP.

The bet: **the archive is the source of truth**. Logins rot. Accounts get deleted. Companies get acquired. Kids leave school districts. But the PowerSchool CSV never does. The Gmail mbox never does. Hypha makes those archives *useful after* the login expires.

## What makes Hypha different

- **Static-exports-first.** Not live APIs. The archive is the data layer.
- **Typed temporal graph.** Two primitives (Node + Edge with open `kind`), **bitemporal from day one** (`tx_created`, `tx_invalidated`, `valid_from`, `valid_to`), provenance on every record.
- **Inference layer is peer to ingestion.** Identity resolution, DLP scanning — all inferrers writing into the same tables with cited provenance and stable idempotency hashes.
- **Local-first with governance built in.** SQLite + FTS5 + sqlite-vec. Cedar policy interface, audit log with `pii_kinds_seen`.
- **MCP-native.** Six intent-shaped tools + `hypha://node/{id}` resource templates. Works with Claude Desktop, Cursor, anything that speaks MCP.

## What's shipped in `v0.1.0-alpha`

**Adapters:** `gmail-mbox`, `google-drive-folder`.

**Inferrers:** `identity-resolver` (three-stage cascade: multi-key block → Fellegi-Sunter-inspired score → WCC clustering), `dlp-scanner` (regex patterns for SSN, email, phone, Luhn-validated credit card, IBAN).

**MCP tools:** `search`, `neighborhood`, `timeline`, `why`, `fetch`, `record`, `ask` (Claude Haiku compiles NL queries when `ANTHROPIC_API_KEY` is set; falls back to FTS).

**CLI:** `hypha ingest | infer | search | serve | publish | export | import | build-adapter`.

**Surfaces:** stdio MCP server (`hypha serve`), read-only HTTP server (`hypha publish`), Graphiti-compatible export/import.

**Tests:** 27 pass, 1 skip (sqlite-vec pending), 0 fail.

## What's explicitly deferred (honest scope)

- `google-takeout`, `slack-export`, `microsoft-365-export`, `notion-export` adapters.
- `community-summarizer` (GraphRAG-style Leiden + LLM summaries) and `memify` (usage-based salience) inferrers.
- Constellation UI (Next.js 16 port of [my-ai-browser](https://github.com/naledi/my-ai-browser)).
- Streamable HTTP transport + OAuth 2.1 + PKCE, biometric DEK unlock (Swift helper), SQLCipher `envelope` mode.
- `@hypha/store-postgres` (interface stubbed; implementation in v1.2).

## FAQ

**Does anything leave my machine?** No. Ingestion, inference, search, and MCP serving are all local. The only optional network call is Claude Haiku for `ask()` NL compilation, gated on `ANTHROPIC_API_KEY`; omit the key and it falls back to FTS.

**Why bitemporal from v0.1?** Because retroactive corrections to a personal archive are the common case, not the edge case. Migrating to bitemporal later is a rewrite; starting bitemporal is free.

**Can I use it without Claude?** Yes — any MCP client works, and `hypha publish` exposes a read-only HTTP API with zero MCP dependency.

## Architecture at a glance

```
  your archives  →  ADAPTERS  →  [Node + Edge graph]  →  INFERRERS  →  same graph (tagged inferred)
                                        ↓
                              SQLite + FTS5 + sqlite-vec
                                        ↓
                     MCP tools     REST API     (future: constellation UI)
                         ↓
                  Claude Desktop / Claude Code / Cursor
```

- **Two primitives.** `Node { id, kind, at, ingested_at, adapter, external_id, title, body?, facets? }` + `Edge { id, kind, from_id, to_id, at, weight? }`. Open `kind` vocabulary; no fixed union.
- **Bitemporal, always.** Every stored record carries four timestamps. `tx_invalidated IS NULL` = currently believed.
- **Provenance = indexed column.** `{ kind: "ingested" | "inferred", ... }` on the same record table. Queries take `include_inferred` + `min_confidence`.
- **Adapters + Inferrers are symmetric plugins.** Both register a YAML manifest, emit an `AsyncIterable<AdapterEvent>` (or return `Facts`), validate facets against Zod.

## Credits

Built on the shoulders of:
- **[Dogsheep](https://github.com/dogsheep)** (Simon Willison) — the philosophical north star.
- **[Graphiti / Zep](https://github.com/getzep/graphiti)** — bitemporal KG architecture.
- **[Splink](https://moj-analytical-services.github.io/splink/)** — Fellegi-Sunter entity resolution formulas.
- **[Microsoft Presidio](https://github.com/microsoft/presidio)** — DLP / PII detection patterns.
- **[sqlite-vec](https://github.com/asg017/sqlite-vec)** — vectors in SQLite.
- **[Anthropic MCP](https://modelcontextprotocol.io)** — the protocol.

## License

Apache-2.0. Hypha code is yours to use, fork, extend, and ship commercially. See [LICENSE](./LICENSE).

---

_Hypha, n. — the fungal threads that connect plants in a forest and shuttle nutrients between them. Biologically, hypha underlies a trellis._
