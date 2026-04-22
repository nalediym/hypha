import { describe, expect, test } from 'bun:test';
import {
  edgeId,
  now,
  nodeIdFromContent,
  nodeIdFromExternal,
} from '@hypha/core';
import type { UpsertEdge, UpsertNode } from '@hypha/core';
import { SQLiteStore } from './index.ts';

describe('SQLiteStore W1-2 smoke', () => {
  test('in-memory store initializes, upserts, round-trips', async () => {
    const store = new SQLiteStore({
      path: ':memory:',
      ownerInstanceId: 'test-instance',
    });

    const at = now();
    const externalId = '<abc123@gmail.test>';
    const nodeId = nodeIdFromExternal('gmail-mbox', 'gmail.message', externalId);

    const node: UpsertNode = {
      id: nodeId,
      kind: 'gmail.message',
      at,
      ingested_at: at,
      adapter: 'gmail-mbox',
      external_id: externalId,
      title: 'Re: dinner plans',
      body: 'see you at 7',
      provenance: {
        kind: 'ingested',
        adapter: 'gmail-mbox',
        adapter_version: '0.1.0',
        external_id: externalId,
      },
    };

    const result = await store.upsert(
      { nodes: [node] },
      { owner_instance_id: 'test-instance', tx_at: at },
    );

    expect(result.nodes_written).toBe(1);
    expect(result.skipped_idempotent).toBe(0);

    const fetched = await store.getNode(nodeId);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(nodeId);
    expect(fetched!.kind).toBe('gmail.message');
    expect(fetched!.title).toBe('Re: dinner plans');
    expect(fetched!.body).toBe('see you at 7');
    expect(fetched!.provenance.kind).toBe('ingested');
    expect(fetched!.tx_created).toBeDefined();
    expect(fetched!.tx_invalidated).toBeUndefined();

    await store.close();
  });

  test('re-upsert of same id is idempotent', async () => {
    const store = new SQLiteStore({
      path: ':memory:',
      ownerInstanceId: 'test',
    });
    const at = now();
    const nodeId = nodeIdFromContent('gmail-mbox', 'gmail.message', 'hello world');

    const node: UpsertNode = {
      id: nodeId,
      kind: 'gmail.message',
      at,
      ingested_at: at,
      adapter: 'gmail-mbox',
      external_id: 'x',
      title: 'test',
      provenance: {
        kind: 'ingested',
        adapter: 'gmail-mbox',
        adapter_version: '0.1.0',
        external_id: 'x',
      },
    };

    const first = await store.upsert({ nodes: [node] }, { owner_instance_id: 'test' });
    const second = await store.upsert({ nodes: [node] }, { owner_instance_id: 'test' });

    expect(first.nodes_written).toBe(1);
    expect(second.nodes_written).toBe(0);
    expect(second.skipped_idempotent).toBe(1);

    await store.close();
  });

  test.skip('sqlite-vec extension loads and vec table accepts the configured dimension', async () => {
    // TODO(W5-6): re-enable once sqlite-vec loading is resolved.
    // Bun's default SQLite is built without SQLITE_ENABLE_LOAD_EXTENSION; we
    // need either Database.setCustomSQLite(path) pointing at a system lib that
    // has extension support, or a swap to better-sqlite3 for the vec path.
    const store = new SQLiteStore({
      path: ':memory:',
      ownerInstanceId: 'test',
      embeddingDims: 768, // Nomic-Embed-v2 default
      withVectors: true,
    });
    await store.close();
  });

  test('edge upsert + FK-style source/target populated', async () => {
    const store = new SQLiteStore({
      path: ':memory:',
      ownerInstanceId: 'test',
    });
    const at = now();

    const from = nodeIdFromExternal('gmail-mbox', 'gmail.message', 'm1');
    const to = nodeIdFromExternal('gmail-mbox', 'identity.email', 'a@b.com');

    const baseNodeProv = {
      kind: 'ingested' as const,
      adapter: 'gmail-mbox',
      adapter_version: '0.1.0',
      external_id: 'x',
    };

    const msg: UpsertNode = {
      id: from, kind: 'gmail.message', at, ingested_at: at,
      adapter: 'gmail-mbox', external_id: 'm1', title: 'hi',
      provenance: baseNodeProv,
    };
    const id: UpsertNode = {
      id: to, kind: 'identity.email', at, ingested_at: at,
      adapter: 'gmail-mbox', external_id: 'a@b.com', title: 'a@b.com',
      provenance: baseNodeProv,
    };
    const edge: UpsertEdge = {
      id: edgeId('sent_to', from, to, at),
      kind: 'sent_to', from_id: from, to_id: to, at,
      provenance: baseNodeProv,
    };

    await store.upsert({ nodes: [msg, id], edges: [edge] }, { owner_instance_id: 'test' });

    const fetched = await store.getEdge(edge.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.from_id).toBe(from);
    expect(fetched!.to_id).toBe(to);
    expect(fetched!.kind).toBe('sent_to');

    await store.close();
  });
});
