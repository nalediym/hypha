import { resolve } from 'node:path';
import { Elysia } from 'elysia';
import type { Store } from '@hypha/core';
import { SQLiteStore } from '@hypha/store-sqlite';

export interface PublishArgs {
  db?: string;
  port?: number;
  host?: string;
  filter?: string; // optional kind prefix filter
}

/**
 * `hypha publish` — serve a read-only HTTP view of the graph.
 *
 * Endpoints:
 *   GET /                         overview + counts
 *   GET /search?q=…&kinds=…       hits list
 *   GET /node/:id                 node detail + neighborhood
 *   GET /node/:id/why             provenance walk
 *   GET /timeline?since=…&until=… events
 *   GET /export/graphiti          static JSON bundle (if --export is opted in)
 *
 * Each response has stable permalinks so agents and humans see the same
 * URL. This is NOT a Datasette clone — no authored SQL surface, no
 * mutation, no user accounts. Lightweight share-view for curated graphs.
 */
export async function publishCommand(args: PublishArgs): Promise<void> {
  const dbPath = args.db ?? resolve('.hypha/store.sqlite');
  const port = args.port ?? 3456;
  const host = args.host ?? '127.0.0.1';
  const store = new SQLiteStore({ path: dbPath, ownerInstanceId: 'public' });

  const app = new Elysia()
    .get('/', async () => ({
      message: 'Hypha — read-only graph view',
      endpoints: ['/search?q=…', '/node/:id', '/node/:id/why', '/timeline'],
    }))
    .get('/search', async ({ query }) => {
      const q = (query.q as string | undefined) ?? '';
      const kinds = (query.kinds as string | undefined)?.split(',').filter(Boolean);
      const result = await store.search({
        text: q,
        ...(kinds ? { kinds } : {}),
        limit: Math.min(parseInt((query.limit as string) ?? '20', 10) || 20, 100),
      });
      return {
        q,
        hits: result.hits.map((h) => ({
          id: h.node.id,
          kind: h.node.kind,
          title: h.node.title,
          at: h.node.at,
          score: h.score,
          url: `/node/${h.node.id}`,
        })),
      };
    })
    .get('/node/:id', async ({ params }) => {
      const node = await store.getNode(params.id as Parameters<Store['getNode']>[0]);
      if (!node) throw new Error(`Not found: ${params.id}`);
      const nb = await store.neighborhood({
        id: params.id as Parameters<Store['neighborhood']>[0]['id'],
        depth: 1,
      });
      return {
        node: {
          id: node.id,
          kind: node.kind,
          title: node.title,
          body: node.body,
          at: node.at,
          facets: node.facets,
          provenance: node.provenance,
        },
        neighborhood: {
          edges: nb.edges.map((e) => ({
            id: e.id,
            kind: e.kind,
            from: e.from_id,
            to: e.to_id,
            ...(e.provenance.kind === 'inferred' ? { confidence: e.provenance.confidence } : {}),
          })),
          nodes: nb.nodes.map((n) => ({
            id: n.id,
            kind: n.kind,
            title: n.title,
            url: `/node/${n.id}`,
          })),
        },
      };
    })
    .get('/node/:id/why', async ({ params }) => {
      const result = await store.why(params.id as Parameters<Store['why']>[0], 3);
      return result;
    })
    .get('/timeline', async ({ query }) => {
      const since = query.since as string | undefined;
      const until = query.until as string | undefined;
      const limit = Math.min(parseInt((query.limit as string) ?? '50', 10) || 50, 200);
      const tq: Record<string, unknown> = { limit };
      if (since || until) {
        tq.range = { from: since ?? '1970-01-01T00:00:00Z', to: until ?? '2999-12-31T23:59:59Z' };
      }
      const result = await store.timeline(tq as Parameters<Store['timeline']>[0]);
      return {
        events: result.events.map((e) => ({
          id: e.record.id,
          kind: e.record.kind,
          title: 'title' in e.record ? e.record.title : `${e.record.kind} edge`,
          anchor: e.anchor,
          url: `/node/${e.record.id}`,
        })),
        ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
      };
    });

  const listening = app.listen({ hostname: host, port });
  console.log(`[hypha] publish server listening at http://${host}:${port}`);
  console.log(`[hypha] db: ${dbPath}`);

  void listening;
  // Keep the process alive.
  await new Promise(() => {});
  void args.filter;
}
