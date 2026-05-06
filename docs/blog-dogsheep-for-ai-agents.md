# Dogsheep for AI agents

_A local-first knowledge graph for your static exports._

---

In 2019, Simon Willison started shipping a family of importers called [Dogsheep](https://dogsheep.github.io). Each tool pulled a stream of your data — tweets, GitHub stars, HealthKit, Foursquare check-ins, Swarm, Pocket — into local SQLite. You then ran [Datasette](https://datasette.io) over the resulting file and got a browseable, queryable, shareable view of your own digital life.

It was one of those ideas that feels obvious in retrospect. *Of course* your archives should be local. *Of course* they should be queryable. *Of course* the exported data should outlive the login that produced it.

Seven years later, AI agents exist. They have MCP. They can walk graphs. They can cite sources. They can run small scripts. They can do everything Datasette's UI did for humans — except for AI.

So I built **Hypha**: _Dogsheep for AI agents._

## What Hypha is

A local-first library that takes *your own* data, normalizes it into a typed temporal graph, and lets an agent navigate *inside* it over MCP. The agent sees your archive the way Datasette let humans see it — except now an agent can walk the graph, cite sources, and do everything Datasette's UI did, but for AI.

## Why the archive, not the API?

Every "memory for agents" infra product I respect — Mem0, Zep/Graphiti, Supermemory, Cognee, Letta — has bet on **live API connectors**. OAuth into Gmail, OAuth into Slack, OAuth into GitHub.

That's reasonable. It's also wrong for the hardest cases.

- Kids leave school districts — but the PowerSchool export never does.
- Employees leave a company — but the M365 ZIP sits in the ex-employee's Downloads folder forever.
- Founders wind down a SaaS — but the Slack export survives.
- Journalists are handed a leaker's Takeout — and that Takeout is *all they'll ever have.*

**The archive is the source of truth because logins rot.** Hypha ingests Gmail mbox, Google Drive folders, and (soon) Slack exports, Microsoft 365 exports, Takeout meta-archives, Notion exports. Once a fact is in the graph, it doesn't care whether you still have access to the original platform.

## The model

Hypha's entire data model is two types:

```ts
Node { id, kind, at, ingested_at, adapter, external_id, title, body?, facets? }
Edge { id, kind, from_id, to_id, at, weight? }
```

`kind` is an open string: `"gmail.message"`, `"identity.email"`, `"file.document"`. Adapters declare their kinds in a YAML manifest; the core doesn't know what a "message" is.

Every record is **bitemporal from day one**. Four timestamps: `tx_created` (when Hypha learned it), `tx_invalidated` (NULL = currently believed), `valid_from`, `valid_to`. You can ask "what did I know on date X, about facts that were true on date Y." For personal data ingesting 2019 exports in 2026, that's not academic — it's required.

Every record also carries **provenance** on the same table: `{ kind: "ingested" | "inferred", adapter | inferrer, confidence, inputs }`. `include_inferred` + `min_confidence` are on every query. The `why` tool walks the derivation tree back to the ingested leaves.

## Inferrers are peer to ingestion

The clever bit: **Hypha's inference layer uses the same tables as its raw data.** An inferrer reads from a StoreReadOnly, returns Facts, and the runner writes them with `provenance: { kind: "inferred" }`. Queries default to returning both; agents can filter with one field.

The first inferrer — `identity-resolver` — runs a three-stage cascade:
1. **Block.** Multi-key union blocking (domain, local-part, name-tokens) so cross-domain matches aren't missed. (Splink-style blocking misses them. ER fails closed.)
2. **Score.** Pragmatic Fellegi-Sunter-inspired additive weighting with Jaro-Winkler on display names. LLM judge on the ambiguous 0.3–0.75 band, when Claude is wired in.
3. **Cluster.** Weakly-connected-components over match edges. `person.*` nodes emerge.

Feed it `alice@example.com` and `alice@acme-school.example.com` — same display name, different domains — and Hypha emits a single `person` node whose `facets.addresses` contains both, with provenance pointing to the two `identity.email` source nodes. When a human confirms a merge, they write an `identity.label` *ingested* fact with confidence=1.0, which dominates automatically on next re-run. No special case.

## Six (seven) tools

Hypha exposes a small, intent-shaped MCP surface:

- `search(q, kinds?, min_confidence?)` — FTS5 + filter.
- `neighborhood(id, depth?, direction?)` — 1-3 hop subgraph.
- `timeline(subject?, since?, until?)` — time-ordered events.
- `why(id, depth?)` — walk the provenance tree.
- `fetch(uri)` — resolve `hypha://node/{id}` or `hypha://edge/{id}`.
- `record(kind, fields, idempotency_key)` — agents write, subject to policy.
- `ask(question)` — Claude Haiku compiles NL → structured StoreQuery. Compiled query is always returned; never "the LLM made it up."

Plus `hypha://node/{id}` and `hypha://edge/{id}` resource templates returning markdown with YAML frontmatter, so hosts like Claude Desktop can let users pin a specific node by URI.

## Why this is the right shape now

Three things converged:

1. **MCP is here, and the 2026 spec is stable enough to design against.** `structuredContent` + tool annotations + resource templates + Streamable HTTP. Six intent-shaped tools + resource URIs is the shape agents actually use.

2. **Graphiti proved bitemporal-KG-for-agents works.** Four timestamps on every record, LLM-friendly traversal, 18% accuracy lift on LongMemEval. Hypha lifts their data model and flips the input from live conversation traces to static archives.

3. **Anthropic's "code execution with MCP" pattern is landing.** Tool outputs must be scriptable: stable IDs, serializable returns, deterministic ordering. Hypha's content-addressed IDs and `structuredContent`-first responses are built for that.

## What Hypha isn't

Explicit non-goals, so you know what not to expect:

- **Not a notes app.** (Mem, Reflect, Saga, Cosmos all tried. It's the wrong category.)
- **Not a screen recorder.** (Rewind / Limitless.)
- **Not an enterprise-search replacement.** (Glean's game; we can't compete on live-API breadth.)
- **Not agent-memory infra for conversation traces.** (Mem0 / Zep / Letta own that.)
- **Not a chat UI.** (Agents bring their own.)
- **Not a live-API connector hub.** (Danswer / Onyx / ChatGPT Connectors.)

Hypha does one thing: *turns your archives into an agent-navigable typed temporal graph, locally.*

## Credits where due

This project stands on the shoulders of others. [Dogsheep](https://dogsheep.github.io) set the philosophical bar and named the aesthetic. [Graphiti / Zep](https://github.com/getzep/graphiti) proved the bitemporal-provenance architecture. [Splink](https://moj-analytical-services.github.io/splink/) is the Fellegi-Sunter reference. [Presidio](https://github.com/microsoft/presidio) taught me what the DLP regex bank looks like. [sqlite-vec](https://github.com/asg017/sqlite-vec) made the vector story tenable. The [MCP spec](https://modelcontextprotocol.io) made this an agent-queryable thing instead of a 2019 local Datasette.

## Try it

```bash
git clone https://github.com/nalediym/hypha && cd hypha
bun install
bun run hypha ingest gmail-mbox your-archive.mbox
bun run hypha infer identity-resolver
bun run hypha infer dlp-scanner
bun run hypha search "Dinner plans"
bun run hypha serve  # for Claude Desktop
```

Apache-2.0. PRs welcome. The five deferred adapters are all tractable — open an issue if you want to pair on one.
