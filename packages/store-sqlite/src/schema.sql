-- Hypha SQLite schema. Single-file store. Run migrations top-to-bottom.
-- Implements the two-primitive graph + bitemporal + provenance model from SPEC.md.

-- ─── Core record table ────────────────────────────────────────────────────
-- Nodes and edges share a single table, discriminated by `record_type`.
-- All bitemporal + provenance metadata lives here.
CREATE TABLE IF NOT EXISTS records (
  id                    TEXT    PRIMARY KEY,
  record_type           TEXT    NOT NULL CHECK (record_type IN ('node','edge')),
  kind                  TEXT    NOT NULL,
  data                  TEXT    NOT NULL,       -- JSON payload (title, body, facets, ...)
  source_id             TEXT,                   -- edges only (from_id)
  target_id             TEXT,                   -- edges only (to_id)
  at                    TEXT    NOT NULL,       -- ISO 8601 — primary event time
  ingested_at           TEXT    NOT NULL,       -- ISO 8601 — when Hypha saw it
  adapter               TEXT,                   -- nullable for inferred records
  external_id           TEXT,
  owner_instance_id     TEXT    NOT NULL,
  -- Provenance (see core/model.ts Provenance union)
  provenance_kind       TEXT    NOT NULL CHECK (provenance_kind IN ('ingested','inferred')),
  provenance_inferrer   TEXT,
  provenance_inferrer_version TEXT,
  provenance_adapter_version TEXT,
  provenance_inputs     TEXT,                   -- JSON array of NodeId|EdgeId
  provenance_inputs_hash TEXT,                  -- idempotency key for inferrers
  provenance_confidence REAL,
  -- Bitemporal quartet
  tx_created            INTEGER NOT NULL,       -- unix ms
  tx_invalidated        INTEGER,                -- NULL = currently believed
  valid_from            INTEGER,
  valid_to              INTEGER,
  -- Review flag surfaces via search({ needs_review: true })
  needs_review          INTEGER NOT NULL DEFAULT 0
) STRICT;

-- Hot index: "give me every currently-believed record of kind X."
CREATE INDEX IF NOT EXISTS idx_kind_live
  ON records(kind) WHERE tx_invalidated IS NULL;

-- Fast `include_inferred=false` filter.
CREATE INDEX IF NOT EXISTS idx_provenance_live
  ON records(provenance_kind, kind) WHERE tx_invalidated IS NULL;

-- Inferrer idempotency lookup.
CREATE INDEX IF NOT EXISTS idx_inferrer_idem
  ON records(provenance_inferrer, provenance_inputs_hash)
  WHERE provenance_inferrer IS NOT NULL;

-- Review queue.
CREATE INDEX IF NOT EXISTS idx_review
  ON records(kind, tx_created) WHERE needs_review = 1 AND tx_invalidated IS NULL;

-- Edge traversal: outbound.
CREATE INDEX IF NOT EXISTS idx_edges_out
  ON records(source_id, kind) WHERE record_type = 'edge' AND tx_invalidated IS NULL;

-- Edge traversal: inbound.
CREATE INDEX IF NOT EXISTS idx_edges_in
  ON records(target_id, kind) WHERE record_type = 'edge' AND tx_invalidated IS NULL;

-- Bitemporal range queries.
CREATE INDEX IF NOT EXISTS idx_tx_created
  ON records(tx_created);
CREATE INDEX IF NOT EXISTS idx_valid_from
  ON records(valid_from) WHERE valid_from IS NOT NULL;

-- ─── Full-text search (FTS5) ──────────────────────────────────────────────
-- Virtual table mirrors (id, title, body) of nodes. Maintained by triggers.
-- Unicode61 + trigram tokenizer covers >99% of personal-data ingestion.
CREATE VIRTUAL TABLE IF NOT EXISTS records_fts USING fts5(
  id UNINDEXED,
  title,
  body,
  tokenize = "unicode61 remove_diacritics 2"
);

CREATE TRIGGER IF NOT EXISTS trg_records_fts_ai
AFTER INSERT ON records WHEN NEW.record_type = 'node' BEGIN
  INSERT INTO records_fts(id, title, body) VALUES (
    NEW.id,
    json_extract(NEW.data, '$.title'),
    json_extract(NEW.data, '$.body')
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_records_fts_au
AFTER UPDATE ON records WHEN NEW.record_type = 'node' BEGIN
  DELETE FROM records_fts WHERE id = OLD.id;
  INSERT INTO records_fts(id, title, body) VALUES (
    NEW.id,
    json_extract(NEW.data, '$.title'),
    json_extract(NEW.data, '$.body')
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_records_fts_ad
AFTER DELETE ON records WHEN OLD.record_type = 'node' BEGIN
  DELETE FROM records_fts WHERE id = OLD.id;
END;

-- ─── Vector index (sqlite-vec) ────────────────────────────────────────────
-- Populated via embedder on ingest/inference. Dimension set at init time.
-- Requires `SELECT vec_version()` to succeed (sqlite-vec extension loaded).
-- CREATE VIRTUAL TABLE records_vec USING vec0( … )  is issued at runtime
-- because dimension is configurable; see SQLiteStore.init().

-- ─── Ingest cursor (Singer-style bookmarks, per-adapter) ──────────────────
CREATE TABLE IF NOT EXISTS ingest_cursor (
  adapter        TEXT NOT NULL,
  source_id      TEXT NOT NULL,                   -- sha256(archive_root) + rel path
  external_id    TEXT NOT NULL,                   -- vendor-native id
  content_hash   TEXT NOT NULL,                   -- sha256 of normalized payload
  last_seen_at   INTEGER NOT NULL,                -- unix ms
  PRIMARY KEY (adapter, source_id, external_id)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_cursor_last_seen
  ON ingest_cursor(adapter, last_seen_at);

-- ─── Audit log (single source of truth for who touched what) ──────────────
CREATE TABLE IF NOT EXISTS audit (
  audit_id         TEXT    PRIMARY KEY,           -- ULID
  at               INTEGER NOT NULL,              -- unix ms
  actor_kind       TEXT    NOT NULL,              -- 'owner' | 'agent' | 'system'
  actor_id         TEXT    NOT NULL,
  action           TEXT    NOT NULL,              -- 'query' | 'ingest' | 'export' | 'unlock' | 'mcp.tool_call' | …
  resource_kind    TEXT,                          -- 'node' | 'edge' | 'query' | 'connector'
  resource_id      TEXT,
  capability_id    TEXT,
  pdp_decision     TEXT,                          -- 'allow' | 'deny' | 'obligation'
  pdp_reason       TEXT,
  query_hash       TEXT,                          -- sha256 of canonical query
  result_count     INTEGER,
  pii_kinds_seen   TEXT,                          -- JSON array of PII kinds in results
  duration_ms      INTEGER
) STRICT;

CREATE INDEX IF NOT EXISTS idx_audit_at ON audit(at);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit(actor_kind, actor_id, at);

-- ─── PII findings (per-span) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pii_findings (
  node_id      TEXT    NOT NULL,
  span_start   INTEGER NOT NULL,
  span_end     INTEGER NOT NULL,
  kind         TEXT    NOT NULL,                  -- 'ssn' | 'email' | 'person' | 'ferpa.student_id' | …
  confidence   REAL    NOT NULL,
  detector     TEXT    NOT NULL,                  -- 'regex.ssn' | 'presidio.PERSON' | 'llm.phi4'
  detected_at  INTEGER NOT NULL,
  PRIMARY KEY (node_id, span_start, span_end, kind)
) STRICT;

-- ─── PII tags (denormalized roll-up for fast filtering) ───────────────────
CREATE TABLE IF NOT EXISTS pii_tags (
  node_id   TEXT    PRIMARY KEY,
  kinds     TEXT    NOT NULL,                     -- JSON array of unique kinds
  max_conf  REAL    NOT NULL
) STRICT;

-- ─── Owner instance config (one row) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS instance (
  instance_id   TEXT    PRIMARY KEY,
  owner_json    TEXT    NOT NULL,                 -- { handle, emails[], names[], org? }
  created_at    INTEGER NOT NULL,
  storage_mode  TEXT    NOT NULL CHECK (storage_mode IN ('trust-os','portable','envelope')),
  embedding_dims INTEGER
) STRICT;

-- ─── Schema migration tracking ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS migrations (
  version     INTEGER PRIMARY KEY,
  applied_at  INTEGER NOT NULL,
  description TEXT
) STRICT;

INSERT OR IGNORE INTO migrations(version, applied_at, description)
VALUES (1, strftime('%s', 'now') * 1000, 'initial schema');
