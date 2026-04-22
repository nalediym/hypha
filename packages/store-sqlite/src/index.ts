/**
 * @hypha/store-sqlite — SQLite implementation of @hypha/core's Store.
 *
 * Uses `bun:sqlite` (native, 3-6× faster than better-sqlite3) + sqlite-vec
 * (loaded as an extension) + FTS5 (built into SQLite).
 *
 * Current scope (W1-2): schema init + getNode + upsert + close. Remaining
 * Store methods (search, neighborhood, timeline, why, scan, invalidate) land
 * alongside the MCP tools in W7-8 — they share the query shape.
 */

import { Database } from 'bun:sqlite';
import * as sqliteVec from 'sqlite-vec';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import type {
  BitemporalCoord,
  EdgeId,
  InvalidateOp,
  NodeId,
  Store,
  StoredEdge,
  StoredNode,
  UpsertEdge,
  UpsertNode,
  UpsertResult,
  WriteContext,
} from '@hypha/core';
import { now } from '@hypha/core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, 'schema.sql');

export interface SQLiteStoreOptions {
  /** Path to the SQLite file. `:memory:` for ephemeral. */
  path: string;
  /** Embedding dimension. Creates the sqlite-vec virtual table at this size. */
  embeddingDims?: number;
  /** Owner-instance id (stamped onto every written record). */
  ownerInstanceId: string;
  /**
   * Enable sqlite-vec vector support. Requires a system SQLite built with
   * extension loading (`-DSQLITE_ENABLE_LOAD_EXTENSION=1`). Bun's default
   * SQLite does NOT support this — point at a system lib via HYPHA_SQLITE_LIB.
   * Default: false (v1-2 scaffold; identity-resolver in W5-6 will flip this).
   *
   * TODO(W5-6): resolve sqlite-vec loading story — either via
   * setCustomSQLite + HYPHA_SQLITE_LIB, or by swapping to better-sqlite3
   * for the vec path while keeping bun:sqlite for hot reads.
   */
  withVectors?: boolean;
}

/**
 * Bun's default SQLite build disables `SQLITE_ENABLE_LOAD_EXTENSION` for
 * security. To load sqlite-vec we point Bun at a system sqlite that *does*
 * support dynamic extension loading. On macOS, homebrew's sqlite is the
 * canonical choice; on Linux, the distro sqlite usually works.
 *
 * Users can override via HYPHA_SQLITE_LIB env var; otherwise we probe.
 */
const SYSTEM_SQLITE_CANDIDATES = [
  process.env.HYPHA_SQLITE_LIB,
  '/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib', // macOS arm64 homebrew
  '/usr/local/opt/sqlite/lib/libsqlite3.dylib',    // macOS x86_64 homebrew
  '/usr/lib/x86_64-linux-gnu/libsqlite3.so.0',      // Debian/Ubuntu
  '/usr/lib/aarch64-linux-gnu/libsqlite3.so.0',
  '/usr/lib64/libsqlite3.so.0',                     // RHEL-likes
].filter((p): p is string => typeof p === 'string' && p.length > 0);

let customSqliteApplied = false;
function tryApplyCustomSqlite(): boolean {
  if (customSqliteApplied) return true;
  for (const candidate of SYSTEM_SQLITE_CANDIDATES) {
    try {
      Database.setCustomSQLite(candidate);
      customSqliteApplied = true;
      return true;
    } catch {
      // Try next candidate.
    }
  }
  return false;
}

export class SQLiteStore implements Store {
  readonly #db: Database;
  readonly #ownerInstanceId: string;
  readonly #embeddingDims: number | undefined;

  constructor(opts: SQLiteStoreOptions) {
    this.#ownerInstanceId = opts.ownerInstanceId;
    this.#embeddingDims = opts.embeddingDims;

    if (opts.withVectors) {
      if (!tryApplyCustomSqlite()) {
        throw new Error(
          'SQLiteStore: sqlite-vec requires a SQLite build with extension loading. ' +
            'Set HYPHA_SQLITE_LIB to the path of a libsqlite3 built with ' +
            '-DSQLITE_ENABLE_LOAD_EXTENSION=1 (e.g. `brew install sqlite`). ' +
            'Or omit `withVectors: true` to use the store without vector support.',
        );
      }
    }

    this.#db = new Database(opts.path, { create: true });

    this.#db.exec('PRAGMA journal_mode = WAL');
    this.#db.exec('PRAGMA foreign_keys = ON');
    this.#db.exec('PRAGMA busy_timeout = 5000');

    if (opts.withVectors) {
      sqliteVec.load(this.#db);
    }

    this.#applySchema();

    if (this.#embeddingDims && opts.withVectors) {
      this.#db.exec(
        `CREATE VIRTUAL TABLE IF NOT EXISTS records_vec USING vec0(
           id TEXT PRIMARY KEY,
           embedding FLOAT[${this.#embeddingDims}]
         )`,
      );
    }
  }

  #applySchema(): void {
    const sql = readFileSync(SCHEMA_PATH, 'utf8');
    this.#db.exec(sql);
  }

  // ── Reads ──────────────────────────────────────────────────────────────

  async getNode(id: NodeId, coord?: BitemporalCoord): Promise<StoredNode | null> {
    const row = this.#db
      .query<RecordRow, { $id: string }>(
        `SELECT * FROM records
         WHERE id = $id AND record_type = 'node'
           AND (${coord?.asOf ? 'tx_created <= :txCutoff AND (tx_invalidated IS NULL OR tx_invalidated > :txCutoff)' : 'tx_invalidated IS NULL'})
         LIMIT 1`,
      )
      .get({ $id: id });
    return row ? rowToStoredNode(row) : null;
  }

  async getEdge(id: EdgeId, _coord?: BitemporalCoord): Promise<StoredEdge | null> {
    const row = this.#db
      .query<RecordRow, { $id: string }>(
        `SELECT * FROM records WHERE id = $id AND record_type = 'edge' AND tx_invalidated IS NULL LIMIT 1`,
      )
      .get({ $id: id });
    return row ? rowToStoredEdge(row) : null;
  }

  /**
   * MVP search: FTS5 only. Accepts a text query, optional kind filter, and
   * limit. Returns node hits with FTS5 rank as the score. No vector search
   * yet — that lands in W7-8 alongside hybrid ranking + pagination cursors.
   */
  async search(q: {
    text?: string;
    kinds?: readonly string[];
    limit?: number;
    include_inferred?: boolean;
    needs_review?: boolean;
  }): Promise<{
    hits: Array<{ node: StoredNode; score: number; highlights?: string[] }>;
  }> {
    const limit = q.limit ?? 20;
    const includeInferred = q.include_inferred ?? true;
    const kindFilter = q.kinds && q.kinds.length > 0
      ? ` AND r.kind IN (${q.kinds.map(() => '?').join(',')})`
      : '';
    const provFilter = includeInferred ? '' : ` AND r.provenance_kind = 'ingested'`;
    const reviewFilter = q.needs_review ? ` AND r.needs_review = 1` : '';

    const params: unknown[] = [];
    let sql: string;
    if (q.text && q.text.trim().length > 0) {
      sql = `
        SELECT r.*, bm25(records_fts) AS score
        FROM records_fts
        JOIN records r ON r.id = records_fts.id
        WHERE records_fts MATCH ?
          AND r.record_type = 'node'
          AND r.tx_invalidated IS NULL
          ${kindFilter}
          ${provFilter}
          ${reviewFilter}
        ORDER BY score
        LIMIT ?
      `;
      params.push(fts5Query(q.text));
      if (q.kinds) params.push(...q.kinds);
      params.push(limit);
    } else {
      sql = `
        SELECT r.*, 1.0 AS score
        FROM records r
        WHERE r.record_type = 'node'
          AND r.tx_invalidated IS NULL
          ${kindFilter}
          ${provFilter}
          ${reviewFilter}
        ORDER BY r.tx_created DESC
        LIMIT ?
      `;
      if (q.kinds) params.push(...q.kinds);
      params.push(limit);
    }

    const rows = this.#db.query(sql).all(...(params as [])) as (RecordRow & { score: number })[];
    return {
      hits: rows.map((row) => ({
        node: rowToStoredNode(row),
        score: row.score,
      })),
    };
  }
  async neighborhood(): Promise<never> { throw notImpl('neighborhood'); }
  async timeline(): Promise<never> { throw notImpl('timeline'); }
  async why(): Promise<never> { throw notImpl('why'); }
  async *scan(): AsyncIterable<never> { throw notImpl('scan'); }

  // ── Writes ─────────────────────────────────────────────────────────────

  async upsert(
    records: { nodes?: readonly UpsertNode[]; edges?: readonly UpsertEdge[] },
    ctx: WriteContext,
  ): Promise<UpsertResult> {
    const owner = ctx.owner_instance_id ?? this.#ownerInstanceId;
    const txMs = Date.parse(ctx.tx_at ?? now());

    const insertRecord = this.#db.prepare(
      `INSERT INTO records (
         id, record_type, kind, data, source_id, target_id,
         at, ingested_at, adapter, external_id, owner_instance_id,
         provenance_kind, provenance_inferrer, provenance_inferrer_version,
         provenance_adapter_version, provenance_inputs, provenance_inputs_hash,
         provenance_confidence,
         tx_created, tx_invalidated, valid_from, valid_to, needs_review
       ) VALUES (
         $id, $record_type, $kind, $data, $source_id, $target_id,
         $at, $ingested_at, $adapter, $external_id, $owner_instance_id,
         $provenance_kind, $provenance_inferrer, $provenance_inferrer_version,
         $provenance_adapter_version, $provenance_inputs, $provenance_inputs_hash,
         $provenance_confidence,
         $tx_created, NULL, $valid_from, $valid_to, $needs_review
       )
       ON CONFLICT(id) DO NOTHING`,
    );

    let nodesWritten = 0;
    let edgesWritten = 0;
    let skipped = 0;

    const txn = this.#db.transaction(() => {
      for (const n of records.nodes ?? []) {
        // bun:sqlite accepts a named-params object, but its TS types over-narrow; cast.
        const res = (insertRecord.run as (p: Record<string, unknown>) => { changes: number })(
          nodeToParams(n, owner, txMs),
        );
        if (res.changes > 0) nodesWritten++; else skipped++;
      }
      for (const e of records.edges ?? []) {
        const res = (insertRecord.run as (p: Record<string, unknown>) => { changes: number })(
          edgeToParams(e, owner, txMs),
        );
        if (res.changes > 0) edgesWritten++; else skipped++;
      }
    });
    txn();

    return { nodes_written: nodesWritten, edges_written: edgesWritten, skipped_idempotent: skipped };
  }

  async invalidate(ops: readonly InvalidateOp[], _ctx: WriteContext): Promise<number> {
    const stmt = this.#db.prepare(
      `UPDATE records SET tx_invalidated = $tx WHERE id = $id AND tx_invalidated IS NULL`,
    );
    let n = 0;
    const txn = this.#db.transaction(() => {
      for (const op of ops) {
        const res = (stmt.run as (p: Record<string, unknown>) => { changes: number })({
          $id: op.id,
          $tx: Date.parse(op.at),
        });
        n += res.changes;
      }
    });
    txn();
    return n;
  }

  async close(): Promise<void> {
    this.#db.close();
  }
}

// ─── Row mapping ────────────────────────────────────────────────────────────

type RecordRow = {
  id: string;
  record_type: 'node' | 'edge';
  kind: string;
  data: string;
  source_id: string | null;
  target_id: string | null;
  at: string;
  ingested_at: string;
  adapter: string | null;
  external_id: string | null;
  owner_instance_id: string;
  provenance_kind: 'ingested' | 'inferred';
  provenance_inferrer: string | null;
  provenance_inferrer_version: string | null;
  provenance_adapter_version: string | null;
  provenance_inputs: string | null;
  provenance_inputs_hash: string | null;
  provenance_confidence: number | null;
  tx_created: number;
  tx_invalidated: number | null;
  valid_from: number | null;
  valid_to: number | null;
  needs_review: number;
};

function rowToStoredNode(row: RecordRow): StoredNode {
  const data = JSON.parse(row.data) as { title: string; body?: string; facets?: Record<string, unknown>; blob_refs?: string[] };
  const base: Record<string, unknown> = {
    id: row.id as NodeId,
    kind: row.kind,
    at: row.at,
    ingested_at: row.ingested_at,
    adapter: row.adapter ?? '',
    external_id: row.external_id ?? '',
    title: data.title,
    owner_instance_id: row.owner_instance_id,
    provenance: rowToProvenance(row),
    tx_created: epochToIso(row.tx_created),
  };
  if (data.body !== undefined) base.body = data.body;
  if (data.blob_refs) base.blob_refs = data.blob_refs;
  if (data.facets) base.facets = data.facets;
  if (row.tx_invalidated !== null) base.tx_invalidated = epochToIso(row.tx_invalidated);
  if (row.valid_from !== null) base.valid_from = epochToIso(row.valid_from);
  if (row.valid_to !== null) base.valid_to = epochToIso(row.valid_to);
  if (row.needs_review) base.needs_review = true;
  return base as unknown as StoredNode;
}

function rowToStoredEdge(row: RecordRow): StoredEdge {
  const data = JSON.parse(row.data) as { weight?: number; metadata?: Record<string, unknown> };
  const base: Record<string, unknown> = {
    id: row.id as EdgeId,
    kind: row.kind,
    from_id: row.source_id as NodeId,
    to_id: row.target_id as NodeId,
    at: row.at,
    owner_instance_id: row.owner_instance_id,
    provenance: rowToProvenance(row),
    tx_created: epochToIso(row.tx_created),
  };
  if (data.weight !== undefined) base.weight = data.weight;
  if (data.metadata) base.metadata = data.metadata;
  if (row.tx_invalidated !== null) base.tx_invalidated = epochToIso(row.tx_invalidated);
  if (row.valid_from !== null) base.valid_from = epochToIso(row.valid_from);
  if (row.valid_to !== null) base.valid_to = epochToIso(row.valid_to);
  if (row.needs_review) base.needs_review = true;
  return base as unknown as StoredEdge;
}

function rowToProvenance(row: RecordRow): StoredNode['provenance'] {
  if (row.provenance_kind === 'ingested') {
    return {
      kind: 'ingested',
      adapter: row.adapter ?? '',
      adapter_version: row.provenance_adapter_version ?? '',
      external_id: row.external_id ?? '',
    };
  }
  return {
    kind: 'inferred',
    inferrer: row.provenance_inferrer ?? '',
    inferrer_version: row.provenance_inferrer_version ?? '',
    inputs: JSON.parse(row.provenance_inputs ?? '[]') as (NodeId | EdgeId)[],
    inputs_hash: row.provenance_inputs_hash ?? '',
    confidence: row.provenance_confidence ?? 0,
  };
}

function epochToIso(ms: number): StoredNode['tx_created'] {
  return new Date(ms).toISOString() as StoredNode['tx_created'];
}

function nodeToParams(n: UpsertNode, owner: string, tx: number): Record<string, unknown> {
  const data = {
    title: n.title,
    ...(n.body !== undefined ? { body: n.body } : {}),
    ...(n.blob_refs ? { blob_refs: n.blob_refs } : {}),
    ...(n.facets ? { facets: n.facets } : {}),
  };
  return {
    $id: n.id,
    $record_type: 'node',
    $kind: n.kind,
    $data: JSON.stringify(data),
    $source_id: null,
    $target_id: null,
    $at: n.at,
    $ingested_at: n.ingested_at,
    $adapter: n.adapter,
    $external_id: n.external_id,
    $owner_instance_id: owner,
    ...provenanceToParams(n.provenance),
    $tx_created: tx,
    $valid_from: n.valid_from ? Date.parse(n.valid_from) : null,
    $valid_to: n.valid_to ? Date.parse(n.valid_to) : null,
    $needs_review: 0,
  };
}

function edgeToParams(e: UpsertEdge, owner: string, tx: number): Record<string, unknown> {
  const data = {
    ...(e.weight !== undefined ? { weight: e.weight } : {}),
    ...(e.metadata ? { metadata: e.metadata } : {}),
  };
  return {
    $id: e.id,
    $record_type: 'edge',
    $kind: e.kind,
    $data: JSON.stringify(data),
    $source_id: e.from_id,
    $target_id: e.to_id,
    $at: e.at,
    $ingested_at: (e as unknown as { ingested_at: string }).ingested_at ?? e.at,
    $adapter: null,
    $external_id: null,
    $owner_instance_id: owner,
    ...provenanceToParams(e.provenance),
    $tx_created: tx,
    $valid_from: e.valid_from ? Date.parse(e.valid_from) : null,
    $valid_to: e.valid_to ? Date.parse(e.valid_to) : null,
    $needs_review: 0,
  };
}

function provenanceToParams(p: UpsertNode['provenance']): Record<string, unknown> {
  if (p.kind === 'ingested') {
    return {
      $provenance_kind: 'ingested',
      $provenance_inferrer: null,
      $provenance_inferrer_version: null,
      $provenance_adapter_version: p.adapter_version,
      $provenance_inputs: null,
      $provenance_inputs_hash: null,
      $provenance_confidence: null,
    };
  }
  return {
    $provenance_kind: 'inferred',
    $provenance_inferrer: p.inferrer,
    $provenance_inferrer_version: p.inferrer_version,
    $provenance_adapter_version: null,
    $provenance_inputs: JSON.stringify(p.inputs),
    $provenance_inputs_hash: p.inputs_hash,
    $provenance_confidence: p.confidence,
  };
}

function notImpl(method: string): Error {
  return new Error(`SQLiteStore.${method} not implemented — lands in W7-8 alongside MCP tools`);
}

/**
 * Sanitize a user query for FTS5 MATCH. FTS5 treats certain tokens as
 * operators — leaving them raw gives users terrible UX on queries with
 * apostrophes, hyphens, or common ops words. We quote each term and join
 * with AND to give OR-default-AND semantics without surprises.
 */
function fts5Query(raw: string): string {
  const terms = raw
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"`);
  return terms.length > 0 ? terms.join(' ') : '""';
}
