/**
 * Content-addressed and deterministic ID helpers.
 *
 * Every Hypha node has a deterministic ID so re-ingesting the same source
 * archive is idempotent. Two strategies:
 *
 *   1. Content-addressed: sha256 of a canonical payload. Use when the source
 *      content itself is the natural identity (e.g. an mbox message).
 *
 *   2. Derived: hash of (adapter, kind, external_id). Use when the source has
 *      a stable vendor-native identifier (e.g. a Gmail thread id, a Slack ts).
 *
 * IDs are lowercase hex, prefixed with the adapter + kind for readability in
 * logs and URLs: `{adapter}:{kind}:{hash16}`. Truncated to 16 hex chars
 * (64 bits of entropy) — plenty for personal graphs, queryable as a string.
 */

import { createHash } from 'node:crypto';

export type NodeId = string & { readonly __brand: 'NodeId' };
export type EdgeId = string & { readonly __brand: 'EdgeId' };
export type BlobRef = string & { readonly __brand: 'BlobRef' };

const HASH_CHARS = 16;

function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Deterministic NodeId from (adapter, kind, external_id).
 * Use when the source provides a stable native identifier.
 */
export function nodeIdFromExternal(
  adapter: string,
  kind: string,
  externalId: string,
): NodeId {
  const hash = sha256Hex(`${adapter}|${kind}|${externalId}`).slice(0, HASH_CHARS);
  return `${adapter}:${kind}:${hash}` as NodeId;
}

/**
 * Content-addressed NodeId from the canonical bytes of the source.
 * Use when the source content itself defines identity (mbox messages, attachments).
 */
export function nodeIdFromContent(
  adapter: string,
  kind: string,
  content: string | Uint8Array,
): NodeId {
  const hash = sha256Hex(content).slice(0, HASH_CHARS);
  return `${adapter}:${kind}:${hash}` as NodeId;
}

/**
 * Deterministic EdgeId from (kind, from, to, at). Ensures re-ingest
 * produces the same edge id; no duplicates.
 */
export function edgeId(kind: string, fromId: NodeId, toId: NodeId, at: string): EdgeId {
  const hash = sha256Hex(`${kind}|${fromId}|${toId}|${at}`).slice(0, HASH_CHARS);
  return `e:${kind}:${hash}` as EdgeId;
}

/**
 * Content hash for a blob. sha256 hex (full 64 chars) so filesystem layout
 * at `.hypha/blobs/<first2>/<next2>/<sha256>` is natively addressable.
 */
export function blobRef(content: string | Uint8Array): BlobRef {
  return sha256Hex(content) as BlobRef;
}

/**
 * Stable hash of an inferrer's inputs used for idempotency.
 * Re-running the same inferrer over the same input set produces the same
 * hash; the runner skips writes whose inputs_hash already exists.
 */
export function inputsHash(inferrerId: string, inputs: readonly string[]): string {
  const sorted = [...inputs].sort();
  return sha256Hex(`${inferrerId}|${sorted.join(',')}`).slice(0, 32);
}
