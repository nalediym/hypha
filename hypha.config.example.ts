/**
 * Example Hypha instance configuration.
 *
 * Copy to `hypha.config.ts` and edit.
 *
 * v1-B profiles are scaffolded here; actual policy enforcement happens in
 * @hypha/governance. Cedar integration lands in a future milestone; until
 * then, the policy field accepts the current JS-based stubs.
 */

export default {
  /** One owner per Hypha instance. Identity-resolver anchors the owner node. */
  owner: {
    handle: 'your-handle',
    emails: ['you@example.com', 'you@work.example.com'],
    names: ['Your Name'],
    org: undefined,
  },

  /** Storage mode. `trust-os` is the honest default on a FileVault-encrypted Mac. */
  storage: {
    mode: 'trust-os' as 'trust-os' | 'portable' | 'envelope',
    db_path: '.hypha/store.sqlite',
  },

  /** Governance policy profile. */
  governance: {
    policy: 'owner-only' as 'allow-all' | 'owner-only',
    audit_to_sqlite: true,
  },

  /**
   * LLM / embedder profile.
   *   `default`       : local Nomic embeddings + Claude Sonnet with ZDR.
   *   `strict-local`  : local Nomic + local Phi-4 Mini via Ollama.
   *   `cloud-zdr`     : remote embeddings + remote LLM, both under ZDR.
   */
  llm: {
    profile: 'default' as 'default' | 'strict-local' | 'cloud-zdr',
    anthropic_model: 'claude-sonnet-4-6', // or 'claude-haiku-4-5-20251001'
    embedder: 'nomic-embed-v2',
  },

  /** MCP server configuration. */
  mcp: {
    instance_id: 'personal',
    instance_label: 'Personal',
    transports: ['stdio'] as ('stdio' | 'streamable-http')[],
  },
};
