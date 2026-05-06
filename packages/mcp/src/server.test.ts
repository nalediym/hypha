import { describe, expect, test } from 'bun:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { runAdapter } from '@hypha/adapter-sdk';
import gmailMboxAdapter from '@hypha/adapter-gmail-mbox';
import { SQLiteStore } from '@hypha/store-sqlite';
import { runInferrer } from '@hypha/inferrer-sdk';
import identityResolver from '@hypha/inferrer-identity-resolver';
import { createHyphaMcpServer } from './server.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(
  __dirname,
  '..',
  '..',
  'inferrers',
  'identity-resolver',
  'fixtures',
  'with-duplicates.mbox',
);

async function prepareDb(dbPath: string): Promise<void> {
  const store = new SQLiteStore({ path: dbPath, ownerInstanceId: 'test' });
  await runAdapter({
    adapter: gmailMboxAdapter,
    inputs: { mbox_path: FIXTURE },
    store,
    ownerInstanceId: 'test',
  });
  await runInferrer({
    inferrer: identityResolver,
    store,
    ownerInstanceId: 'test',
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  });
  await store.close();
}

describe('Hypha MCP server', () => {
  test('lists expected tools + resource templates', async () => {
    const dbPath = `/tmp/hypha-mcp-test-${Date.now()}.sqlite`;
    await prepareDb(dbPath);

    const { server, close } = createHyphaMcpServer({
      dbPath,
      instance_id: 'test',
      instance_label: 'Test',
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.1' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name).sort();
    expect(names).toEqual(['ask', 'fetch', 'neighborhood', 'record', 'search', 'timeline', 'why'].sort());

    const templates = await client.listResourceTemplates();
    const templateUris = templates.resourceTemplates.map((t) => t.uriTemplate).sort();
    expect(templateUris).toContain('hypha://node/{id}');
    expect(templateUris).toContain('hypha://edge/{id}');

    await client.close();
    await close();
  });

  test('search tool returns cited hits', async () => {
    const dbPath = `/tmp/hypha-mcp-test-${Date.now()}-search.sqlite`;
    await prepareDb(dbPath);

    const { server, close } = createHyphaMcpServer({
      dbPath,
      instance_id: 'test',
      instance_label: 'Test',
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.1' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({
      name: 'search',
      arguments: { q: 'Alice Kim', kinds: ['person'] },
    });
    const sc = result.structuredContent as { hits: { id: string; provenance: { kind: string } }[] };
    expect(sc.hits.length).toBeGreaterThanOrEqual(1);
    expect(sc.hits[0]!.provenance.kind).toBe('inferred');
    expect(sc.hits[0]!.id).toMatch(/^identity-resolver:person:/);

    await client.close();
    await close();
  });

  test('fetch resolves hypha://node/{id} via the fetch tool', async () => {
    const dbPath = `/tmp/hypha-mcp-test-${Date.now()}-fetch.sqlite`;
    await prepareDb(dbPath);

    const { server, close } = createHyphaMcpServer({
      dbPath,
      instance_id: 'test',
      instance_label: 'Test',
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.1' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const search = await client.callTool({ name: 'search', arguments: { q: 'Alice Kim', kinds: ['person'] } });
    const firstId = (search.structuredContent as { hits: { id: string }[] }).hits[0]!.id;

    const fetched = await client.callTool({
      name: 'fetch',
      arguments: { uri: `hypha://node/${firstId}` },
    });
    const fc = fetched.structuredContent as { kind: string; record: { kind: string } };
    expect(fc.kind).toBe('node');
    expect(fc.record.kind).toBe('person');

    await client.close();
    await close();
  });

  test('why walks the provenance tree of an inferred person', async () => {
    const dbPath = `/tmp/hypha-mcp-test-${Date.now()}-why.sqlite`;
    await prepareDb(dbPath);

    const { server, close } = createHyphaMcpServer({
      dbPath,
      instance_id: 'test',
      instance_label: 'Test',
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.1' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const search = await client.callTool({ name: 'search', arguments: { q: 'Alice Kim', kinds: ['person'] } });
    const id = (search.structuredContent as { hits: { id: string }[] }).hits[0]!.id;
    const why = await client.callTool({ name: 'why', arguments: { id } });
    const wc = why.structuredContent as { inferred: boolean; citations: { kind: string }[] };
    expect(wc.inferred).toBe(true);
    // Person node cites identity.email nodes.
    expect(wc.citations.some((c) => c.kind === 'identity.email')).toBe(true);

    await client.close();
    await close();
  });
});
