/**
 * Policy engine (Cedar stub).
 *
 * v1-B ships a trivial allow-all-to-owner / default-deny-to-agents policy.
 * Full Cedar integration lands once the Rust Cedar crate has stable
 * Bun/N-API bindings; meanwhile this interface is the contract Trellis (or
 * any future PDP consumer) will conform to.
 */

export interface PolicyRequest {
  subject_kind: 'owner' | 'agent' | 'system';
  subject_id: string;
  action: string; // 'search' | 'neighborhood' | 'timeline' | 'why' | 'fetch' | 'record' | ...
  resource_kind?: 'node' | 'edge' | 'query' | 'connector';
  resource_id?: string;
  context?: Readonly<Record<string, unknown>>;
}

export type PolicyDecision =
  | { effect: 'allow'; obligations?: readonly Obligation[]; ttl_ms?: number }
  | { effect: 'deny'; reason: string };

export interface Obligation {
  kind: 'redact' | 'rate_limit' | 'require_confirmation';
  params?: Readonly<Record<string, unknown>>;
}

export interface PolicyEngine {
  authorize(req: PolicyRequest): Promise<PolicyDecision>;
}

/**
 * Allow-all policy. Use for local-only single-owner deployments. The real
 * Cedar engine replaces this when a hypha.config.ts declares rules.
 */
export class AllowAllPolicy implements PolicyEngine {
  async authorize(_req: PolicyRequest): Promise<PolicyDecision> {
    return { effect: 'allow' };
  }
}

/**
 * Owner-only policy. Agents are denied unless explicitly granted a
 * capability. Used as the safe-by-default before Trellis configures.
 */
export class OwnerOnlyPolicy implements PolicyEngine {
  async authorize(req: PolicyRequest): Promise<PolicyDecision> {
    if (req.subject_kind === 'owner' || req.subject_kind === 'system') {
      return { effect: 'allow' };
    }
    return { effect: 'deny', reason: 'owner-only policy; agent access requires capability grant' };
  }
}
