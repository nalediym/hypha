import { describe, expect, test } from 'bun:test';
import { now } from '@hypha/core';
import { SQLiteStore } from '@hypha/store-sqlite';
import { runInferrer } from '@hypha/inferrer-sdk';
import dlpScanner, { scanString } from './index.ts';

describe('scanString', () => {
  test('finds SSN', () => {
    const f = scanString('My SSN is 123-45-6789.');
    expect(f.some((x) => x.kind === 'ssn')).toBe(true);
  });
  test('finds email', () => {
    const f = scanString('Contact alice@example.com for details');
    expect(f.some((x) => x.kind === 'email')).toBe(true);
  });
  test('finds Luhn-valid credit card', () => {
    // Valid test card: 4111 1111 1111 1111 (Luhn-valid Visa test).
    const f = scanString('card: 4111 1111 1111 1111 expires 05/26');
    expect(f.some((x) => x.kind === 'credit_card')).toBe(true);
  });
  test('rejects Luhn-invalid credit card', () => {
    const f = scanString('not a card: 4111 1111 1111 1112');
    expect(f.some((x) => x.kind === 'credit_card')).toBe(false);
  });
  test('finds IBAN', () => {
    const f = scanString('IBAN DE89370400440532013000');
    expect(f.some((x) => x.kind === 'iban')).toBe(true);
  });
  test('empty text → no findings', () => {
    expect(scanString('')).toEqual([]);
  });
});

describe('dlp-scanner inferrer', () => {
  test('scans node bodies and emits dlp.finding nodes', async () => {
    const store = new SQLiteStore({ path: ':memory:', ownerInstanceId: 'test' });

    // Seed a node with PII in the body.
    const at = now();
    await store.upsert(
      {
        nodes: [
          {
            id: 'gmail:gmail.message:testpii' as never,
            kind: 'gmail.message',
            at,
            ingested_at: at,
            adapter: 'gmail-mbox',
            external_id: 'testpii',
            title: 'SSN confirmation',
            body: 'Your SSN is 123-45-6789 and your phone is (555) 867-5309.',
            provenance: {
              kind: 'ingested',
              adapter: 'gmail-mbox',
              adapter_version: '0.1.0',
              external_id: 'testpii',
            },
          },
        ],
      },
      { owner_instance_id: 'test' },
    );

    const result = await runInferrer({
      inferrer: dlpScanner,
      store,
      ownerInstanceId: 'test',
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    });

    expect(result.nodes_written).toBeGreaterThanOrEqual(2); // SSN + phone
    expect(result.edges_written).toBeGreaterThanOrEqual(2);

    // Second run is idempotent.
    const second = await runInferrer({
      inferrer: dlpScanner,
      store,
      ownerInstanceId: 'test',
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    });
    expect(second.nodes_written).toBe(0);
    expect(second.edges_written).toBe(0);

    // Findings are searchable.
    const hits = await store.search({ text: '', kinds: ['dlp.finding'], limit: 10 });
    expect(hits.hits.length).toBeGreaterThanOrEqual(2);

    await store.close();
  });
});
