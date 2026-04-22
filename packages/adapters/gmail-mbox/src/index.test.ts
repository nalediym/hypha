import { describe, expect, test } from 'bun:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAdapter } from '@hypha/adapter-sdk';
import { assertAdapterContract } from '@hypha/adapter-sdk/testing';
import { SQLiteStore } from '@hypha/store-sqlite';
import gmailMboxAdapter from './index.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, '..', 'fixtures', 'small.mbox');

describe('gmail-mbox adapter', () => {
  test('manifest shape', () => {
    expect(gmailMboxAdapter.manifest.id).toBe('gmail-mbox');
    expect(gmailMboxAdapter.manifest.version).toBe('0.1.0');
    const kinds = gmailMboxAdapter.manifest.emits.kinds.map((k) => k.kind);
    expect(kinds).toContain('gmail.message');
    expect(kinds).toContain('gmail.thread');
    expect(kinds).toContain('identity.email');
  });

  test('small fixture round-trips through runAdapter', async () => {
    const store = new SQLiteStore({ path: ':memory:', ownerInstanceId: 'test' });
    const result = await runAdapter({
      adapter: gmailMboxAdapter,
      inputs: { mbox_path: FIXTURE },
      store,
      ownerInstanceId: 'test',
    });

    // 3 messages, 2 threads (dinner + ci), ≥4 identities (naledi, mom, sister, github noreply)
    expect(result.nodes_written).toBeGreaterThanOrEqual(9);
    // sent_to + cc + part_of_thread + replied_to edges
    expect(result.edges_written).toBeGreaterThanOrEqual(7);
    expect(result.warnings).toEqual([]);

    await store.close();
  });

  test('passes adapter contract', async () => {
    const report = await assertAdapterContract({
      adapter: gmailMboxAdapter,
      inputs: { mbox_path: FIXTURE },
      fixtureLabel: 'small.mbox',
    });
    expect(report.passed).toBe(true);
  });
});
