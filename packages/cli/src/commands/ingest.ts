import { resolve } from 'node:path';
import { runAdapter, type HyphaAdapter } from '@hypha/adapter-sdk';
import { SQLiteStore } from '@hypha/store-sqlite';

/**
 * Adapter registry. Maps adapter id → dynamic-import path.
 *
 * Future: discover adapters by scanning `node_modules` for packages with a
 * `hypha.adapter` field in their package.json (LlamaHub pattern). For v1 a
 * static map is fine.
 */
const ADAPTER_REGISTRY: Readonly<Record<string, () => Promise<{ default: HyphaAdapter<unknown> }>>> = {
  'gmail-mbox': () => import('@hypha/adapter-gmail-mbox') as Promise<{ default: HyphaAdapter<unknown> }>,
  'google-drive-folder': () =>
    import('@hypha/adapter-google-drive-folder') as Promise<{ default: HyphaAdapter<unknown> }>,
};

export interface IngestArgs {
  adapter: string;
  /** The first positional argument after the adapter — typically a file path. */
  input: string;
  /** Optional: override the default .hypha/store.sqlite path. */
  db?: string;
  /** Optional: owner instance id. */
  owner?: string;
  /** Dry run — parse and validate but don't write. */
  dryRun?: boolean;
}

export async function ingestCommand(args: IngestArgs): Promise<void> {
  const loader = ADAPTER_REGISTRY[args.adapter];
  if (!loader) {
    console.error(`Unknown adapter: ${args.adapter}`);
    console.error(`Available: ${Object.keys(ADAPTER_REGISTRY).join(', ')}`);
    process.exit(2);
  }

  const mod = await loader();
  const adapter = mod.default;

  const dbPath = args.db ?? resolve('.hypha/store.sqlite');
  const ownerInstanceId = args.owner ?? 'local-owner';

  await ensureDbDir(dbPath);

  const store = new SQLiteStore({ path: dbPath, ownerInstanceId });

  console.log(`[hypha] adapter: ${adapter.manifest.id}@${adapter.manifest.version}`);
  console.log(`[hypha] input: ${args.input}`);
  console.log(`[hypha] store: ${dbPath}`);

  const inputs = inputsForAdapter(adapter.manifest.id, args.input);
  const result = await runAdapter({
    adapter,
    inputs,
    store,
    ownerInstanceId,
    context: { dryRun: args.dryRun ?? false },
  });

  console.log('');
  console.log(`[hypha] ingest complete in ${result.durationMs}ms`);
  console.log(`[hypha]   nodes written:   ${result.nodes_written}`);
  console.log(`[hypha]   edges written:   ${result.edges_written}`);
  console.log(`[hypha]   skipped (dupe):  ${result.skipped_idempotent}`);
  console.log(`[hypha]   blobs seen:      ${result.blobs_seen}`);
  if (result.warnings.length > 0) {
    console.log(`[hypha]   warnings:        ${result.warnings.length}`);
    for (const w of result.warnings.slice(0, 5)) console.log(`[hypha]     · ${w}`);
  }

  await store.close();
}

async function ensureDbDir(dbPath: string): Promise<void> {
  if (dbPath === ':memory:') return;
  const { mkdir } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  await mkdir(dirname(dbPath), { recursive: true });
}

/** Translate a single positional path into the adapter's declared inputs shape. */
function inputsForAdapter(adapterId: string, input: string): Record<string, unknown> {
  switch (adapterId) {
    case 'gmail-mbox':
      return { mbox_path: input };
    case 'google-drive-folder':
      return { folder_path: input };
    default:
      return { path: input };
  }
}
