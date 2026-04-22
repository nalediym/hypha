import { describe, expect, test } from 'bun:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAdapter } from '@hypha/adapter-sdk';
import { assertAdapterContract } from '@hypha/adapter-sdk/testing';
import { SQLiteStore } from '@hypha/store-sqlite';
import driveFolderAdapter from './index.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, '..', 'fixtures', 'sample');

describe('google-drive-folder adapter', () => {
  test('walks a fixture folder and emits nodes + edges', async () => {
    const store = new SQLiteStore({ path: ':memory:', ownerInstanceId: 'test' });
    const result = await runAdapter({
      adapter: driveFolderAdapter,
      inputs: { folder_path: FIXTURE },
      store,
      ownerInstanceId: 'test',
    });
    // 1 root + 3 subfolders + 4 files = 8 nodes min
    expect(result.nodes_written).toBeGreaterThanOrEqual(7);
    expect(result.edges_written).toBeGreaterThanOrEqual(5);
    await store.close();
  });

  test('passes adapter contract', async () => {
    const report = await assertAdapterContract({
      adapter: driveFolderAdapter,
      inputs: { folder_path: FIXTURE },
      fixtureLabel: 'sample',
    });
    expect(report.passed).toBe(true);
  });
});
