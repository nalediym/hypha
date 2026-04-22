import { resolve } from 'node:path';
import { runInferrer, runInferrers, type Inferrer } from '@hypha/inferrer-sdk';
import { SQLiteStore } from '@hypha/store-sqlite';

/**
 * Inferrer registry. Maps inferrer id → dynamic-import path.
 *
 * Future: discover via `hypha.inferrer` field in package.json, same pattern
 * as adapters. For v1 a static map is fine.
 */
const INFERRER_REGISTRY: Readonly<Record<string, () => Promise<{ default: Inferrer }>>> = {
  'identity-resolver': () =>
    import('@hypha/inferrer-identity-resolver') as Promise<{ default: Inferrer }>,
  'dlp-scanner': () => import('@hypha/inferrer-dlp-scanner') as Promise<{ default: Inferrer }>,
};

export interface InferArgs {
  /** Inferrer id, or omitted to run all registered inferrers. */
  inferrer?: string;
  db?: string;
  owner?: string;
}

export async function inferCommand(args: InferArgs): Promise<void> {
  const dbPath = args.db ?? resolve('.hypha/store.sqlite');
  const ownerInstanceId = args.owner ?? 'local-owner';
  const store = new SQLiteStore({ path: dbPath, ownerInstanceId });

  const ids = args.inferrer ? [args.inferrer] : Object.keys(INFERRER_REGISTRY);
  const inferrers: Inferrer[] = [];
  for (const id of ids) {
    const loader = INFERRER_REGISTRY[id];
    if (!loader) {
      console.error(`Unknown inferrer: ${id}`);
      console.error(`Available: ${Object.keys(INFERRER_REGISTRY).join(', ')}`);
      process.exit(2);
    }
    const mod = await loader();
    inferrers.push(mod.default);
  }

  console.log(`[hypha] store: ${dbPath}`);
  console.log(`[hypha] running: ${inferrers.map((i) => i.id).join(', ')}`);
  console.log('');

  const results =
    inferrers.length === 1
      ? [await runInferrer({ inferrer: inferrers[0]!, store, ownerInstanceId })]
      : await runInferrers({ inferrers, store, ownerInstanceId });

  for (const result of results) {
    console.log(`[hypha] ${result.inferrer_id}  (${result.durationMs}ms)`);
    console.log(`[hypha]   nodes written:  ${result.nodes_written}`);
    console.log(`[hypha]   edges written:  ${result.edges_written}`);
    console.log(`[hypha]   skipped (dupe): ${result.skipped_idempotent}`);
    console.log(`[hypha]   invalidated:    ${result.invalidated}`);
  }

  await store.close();
}
