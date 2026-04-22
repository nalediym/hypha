/**
 * Audit log writer. Every MCP tool call, every mutation, every unlock
 * lands in the SQLite `audit` table with a ULID, ISO timestamp, actor kind,
 * and optional pii_kinds_seen roll-up for incident response.
 *
 * We use bun:sqlite directly rather than going through Store so audit
 * writes stay cheap and don't participate in user transactions.
 */

import { Database } from 'bun:sqlite';
import { createHash, randomBytes } from 'node:crypto';

export interface AuditEntry {
  actor_kind: 'owner' | 'agent' | 'system';
  actor_id: string;
  action: string;
  resource_kind?: 'node' | 'edge' | 'query' | 'connector';
  resource_id?: string;
  capability_id?: string;
  pdp_decision?: 'allow' | 'deny' | 'obligation';
  pdp_reason?: string;
  query_hash?: string;
  result_count?: number;
  pii_kinds_seen?: readonly string[];
  duration_ms?: number;
}

export class AuditLog {
  readonly #db: Database;
  readonly #insert: ReturnType<Database['prepare']>;

  constructor(db: Database) {
    this.#db = db;
    this.#insert = db.prepare(`
      INSERT INTO audit (
        audit_id, at, actor_kind, actor_id, action,
        resource_kind, resource_id, capability_id,
        pdp_decision, pdp_reason, query_hash, result_count,
        pii_kinds_seen, duration_ms
      ) VALUES (
        $audit_id, $at, $actor_kind, $actor_id, $action,
        $resource_kind, $resource_id, $capability_id,
        $pdp_decision, $pdp_reason, $query_hash, $result_count,
        $pii_kinds_seen, $duration_ms
      )
    `);
  }

  /** Append a row. Fire-and-forget from hot paths. */
  write(entry: AuditEntry): string {
    const id = ulid();
    (this.#insert.run as (p: Record<string, unknown>) => void)({
      $audit_id: id,
      $at: Date.now(),
      $actor_kind: entry.actor_kind,
      $actor_id: entry.actor_id,
      $action: entry.action,
      $resource_kind: entry.resource_kind ?? null,
      $resource_id: entry.resource_id ?? null,
      $capability_id: entry.capability_id ?? null,
      $pdp_decision: entry.pdp_decision ?? null,
      $pdp_reason: entry.pdp_reason ?? null,
      $query_hash: entry.query_hash ?? null,
      $result_count: entry.result_count ?? null,
      $pii_kinds_seen: entry.pii_kinds_seen ? JSON.stringify(entry.pii_kinds_seen) : null,
      $duration_ms: entry.duration_ms ?? null,
    });
    return id;
  }
}

/** SHA-256 hex of a canonical JSON — handy for correlating query invocations. */
export function hashQuery(q: unknown): string {
  const canonical = JSON.stringify(q, Object.keys(q as object).sort());
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

// ─── Minimal ULID implementation (timestamp + 80 bits of randomness) ────────
// Crockford base32 over 10 time chars + 16 random chars = 26 total.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function ulid(): string {
  const time = Date.now();
  const timeStr = encodeTime(time, 10);
  const randomStr = encodeRandom(16);
  return timeStr + randomStr;
}

function encodeTime(time: number, length: number): string {
  let out = '';
  let t = time;
  for (let i = length - 1; i >= 0; i--) {
    const mod = t % 32;
    out = CROCKFORD[mod] + out;
    t = (t - mod) / 32;
  }
  return out;
}

function encodeRandom(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += CROCKFORD[(bytes[i] ?? 0) % 32];
  }
  return out;
}
