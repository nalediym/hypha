/**
 * @hypha/governance — policy, audit, capability tokens, biometric unlock.
 *
 * W7-8 ships: audit log writer, allow-all + owner-only policy stubs.
 * Deferred: Cedar crate bindings, OAuth 2.1 + PKCE, Touch ID via Swift helper.
 */

export const GOVERNANCE_VERSION = '0.1.0-dev';
export { AuditLog, hashQuery, type AuditEntry } from './audit.ts';
export {
  AllowAllPolicy,
  OwnerOnlyPolicy,
  type Obligation,
  type PolicyDecision,
  type PolicyEngine,
  type PolicyRequest,
} from './policy.ts';
