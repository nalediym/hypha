import { describe, expect, test } from 'bun:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAdapter } from '@hypha/adapter-sdk';
import gmailMboxAdapter from '@hypha/adapter-gmail-mbox';
import { runInferrer } from '@hypha/inferrer-sdk';
import { SQLiteStore } from '@hypha/store-sqlite';
import identityResolver from './index.ts';
import { jaroWinkler } from './jaro-winkler.ts';
import { parseIdentity, scorePair, MATCH_THRESHOLD } from './score.ts';
import { weaklyConnectedComponents } from './wcc.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, '..', 'fixtures', 'with-duplicates.mbox');

describe('jaro-winkler', () => {
  test('identical strings → 1', () => {
    expect(jaroWinkler('alice kim', 'alice kim')).toBe(1);
  });
  test('shared prefix boosts score', () => {
    // Canonical Jaro-Winkler test pair (Winkler 1990).
    const withPrefix = jaroWinkler('martha', 'marhta');
    const withoutPrefix = jaroWinkler('martha', 'zelmar');
    expect(withPrefix).toBeGreaterThan(withoutPrefix);
  });
  test('empty input → 0', () => {
    expect(jaroWinkler('', 'abc')).toBe(0);
  });
});

describe('scorePair', () => {
  test('identical emails + names → auto-match', () => {
    const a = parseIdentity('a', 'alice@example.com', 'Alice Kim');
    const b = parseIdentity('b', 'alice@work.example.com', 'Alice Kim');
    const s = scorePair(a, b);
    expect(s.confidence).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
  });
  test('completely different → no score', () => {
    const a = parseIdentity('a', 'abc@xyz.com', 'Abc Xyz');
    const b = parseIdentity('b', 'def@uvw.com', 'Def Uvw');
    const s = scorePair(a, b);
    expect(s.confidence).toBeLessThan(0.3);
  });
  test('same domain alone is weak', () => {
    const a = parseIdentity('a', 'alice@gmail.com');
    const b = parseIdentity('b', 'bob@gmail.com');
    const s = scorePair(a, b);
    expect(s.confidence).toBeLessThan(0.3);
  });
});

describe('weaklyConnectedComponents', () => {
  test('isolated nodes + chained edges form expected clusters', () => {
    const clusters = weaklyConnectedComponents(
      ['a', 'b', 'c', 'd', 'e'] as const,
      [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }],
    );
    const sizes = clusters.map((c) => c.length).sort();
    expect(sizes).toEqual([1, 1, 3]);
  });
});

describe('identity-resolver E2E', () => {
  test('clusters alice@example.com and alice@acme-school.example.com into one person', async () => {
    const store = new SQLiteStore({ path: ':memory:', ownerInstanceId: 'test' });
    await runAdapter({
      adapter: gmailMboxAdapter,
      inputs: { mbox_path: FIXTURE },
      store,
      ownerInstanceId: 'test',
    });

    const result = await runInferrer({
      inferrer: identityResolver,
      store,
      ownerInstanceId: 'test',
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    });

    // Should emit at least one person node + one identity.same_as edge.
    expect(result.nodes_written).toBeGreaterThanOrEqual(1);
    expect(result.edges_written).toBeGreaterThanOrEqual(1);

    // Re-run should be idempotent.
    const second = await runInferrer({
      inferrer: identityResolver,
      store,
      ownerInstanceId: 'test',
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    });
    expect(second.nodes_written).toBe(0);
    expect(second.edges_written).toBe(0);

    // Confirm the person node surfaces via search.
    const hits = await store.search({ text: 'Alice Kim', kinds: ['person'] });
    expect(hits.hits.length).toBeGreaterThanOrEqual(1);
    const person = hits.hits[0]!.node;
    expect(person.kind).toBe('person');
    expect(person.provenance.kind).toBe('inferred');
    if (person.provenance.kind === 'inferred') {
      expect(person.provenance.inferrer).toBe('identity-resolver');
      expect(person.provenance.confidence).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
      expect(person.provenance.inputs.length).toBeGreaterThanOrEqual(2);
    }
    const addresses = (person.facets?.addresses as string[] | undefined) ?? [];
    expect(addresses).toContain('alice@example.com');
    expect(addresses).toContain('alice@acme-school.example.com');

    await store.close();
  });
});
