# Hypha

**Reverse hyperbrowser — Person OS for your static exports.**

A local-first personal/org knowledge graph library. Ingests your static data exports (Google Takeout, Microsoft 365 exports, Slack/Notion exports, mbox archives, and more) into a typed, temporal, browsable graph that AI agents navigate over MCP like a private website.

> _Dogsheep for AI agents._

---

## Status

🚧 **Pre-alpha.** Under active development toward `v0.1.0`. Not yet installable.

See [the plan](https://github.com/naledi/hypha/blob/main/SPEC.md) for architecture, and [CHANGELOG](./CHANGELOG.md) for progress.

## Thesis

A **hyperbrowser** gives an AI agent a headless browser on the outward web.
A **reverse hyperbrowser** does the inverse — it takes *your own* data, normalizes it into a typed temporal graph, and lets agents navigate *inside* it.

The bet: **the archive is the source of truth**. Logins rot. Accounts get deleted. Companies get acquired. Kids leave school districts. But the PowerSchool CSV never does. The Gmail mbox never does. Hypha makes those archives *useful after* the login expires.

## Who it's for

- **Prosumer:** 20 years of Gmail, a Takeout ZIP, a Notion export. Ask your own data things; let an agent navigate the graph.
- **Mission-driven orgs:** schools, nonprofits, small firms — tiers that Glean and Copilot are priced out of. Hypha gives them a local, agent-queryable, policy-governed substrate.

## What makes it different

- **Static-exports-first.** Not live APIs. The archive is the data layer.
- **Typed temporal graph.** Two primitives (Node + Edge with open `kind`), bitemporal from day one, provenance on every record.
- **Inference layer is peer to ingestion.** Identity resolution, community summaries, salience — all inferrers with cited provenance, revisable as new data arrives.
- **Local-first with governance built in.** SQLite + sqlite-vec + FTS5. Cedar policy embedded, biometric unlock, audit log.
- **MCP-native.** Agents see six intent-shaped tools plus resource-template URLs. Works with Claude Desktop, Claude Code, anything that speaks MCP.

## Credits

Built on the shoulders of:
- **[Dogsheep](https://github.com/dogsheep)** (Simon Willison) — the philosophical north star.
- **[Graphiti / Zep](https://github.com/getzep/graphiti)** — bitemporal KG architecture.
- **[Splink](https://moj-analytical-services.github.io/splink/)** — Fellegi-Sunter entity resolution.
- **[Microsoft Presidio](https://github.com/microsoft/presidio)** — DLP / PII detection.
- **[sqlite-vec](https://github.com/asg017/sqlite-vec)** — vectors in SQLite.
- **[Anthropic MCP](https://modelcontextprotocol.io)** — the protocol.

## License

Apache-2.0.
