# Security Policy

## Threat model

Hypha is a local-first library that ingests personal data exports (email, Drive, etc.) into a SQLite graph on the user's own machine. The primary security concerns are:

1. **Data exfiltration via MCP clients.** Any MCP client Hypha is exposed to (Claude Desktop, Cursor, a custom agent) has full read access to the ingested graph unless policy constraints are applied. Treat the MCP surface as a trust boundary.
2. **PII leakage via inferrers.** The `dlp-scanner` inferrer detects sensitive patterns (SSN, credit card, etc.) but does not redact source records. Anything the scanner flags still lives in `node.body`.
3. **Secrets in archives.** Gmail and Drive exports often contain API keys, passwords, and other secrets in message bodies. Hypha stores these as-is.

## Supported versions

| Version | Supported |
|---|---|
| `v0.1.0-alpha` | Yes (security fixes applied to main) |
| older | No |

## Reporting a vulnerability

If you discover a vulnerability, please **do not open a public issue**. Instead:

- Email: **nalediymkekana+security@gmail.com**
- Include: reproduction steps, affected commit SHA, and impact assessment.

Expect an acknowledgement within 72 hours.

Security issues are triaged at higher priority than feature work. A fix + advisory will typically land within 7 days of triage for confirmed issues.

## Known gaps (tracked)

These are documented as deferred in the README but worth flagging for security-conscious evaluators:

- **No encryption at rest.** The SQLite store is plaintext. SQLCipher envelope mode is scoped but not shipped.
- **No OAuth on the MCP surface.** `hypha serve` runs stdio; `hypha publish` is read-only HTTP on a loopback port. Streamable HTTP + OAuth 2.1 + PKCE are scoped for v1.1.
- **No biometric unlock on the DEK.** Swift helper scoped, not shipped.
- **Cedar policy engine is scaffolded.** Policies are accepted at config load but enforcement is pass-through in this alpha.

If you are evaluating Hypha for a security-sensitive deployment, wait for v1.1 or contact the maintainer.
