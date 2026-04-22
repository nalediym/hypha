import { resolve } from 'node:path';
import { SQLiteStore } from '@hypha/store-sqlite';

export interface SearchArgs {
  text: string;
  kinds?: readonly string[];
  limit?: number;
  db?: string;
  owner?: string;
  needsReview?: boolean;
  includeInferred?: boolean;
}

export async function searchCommand(args: SearchArgs): Promise<void> {
  const dbPath = args.db ?? resolve('.hypha/store.sqlite');
  const ownerInstanceId = args.owner ?? 'local-owner';
  const store = new SQLiteStore({ path: dbPath, ownerInstanceId });

  const result = await store.search({
    text: args.text,
    ...(args.kinds ? { kinds: args.kinds } : {}),
    ...(args.limit ? { limit: args.limit } : {}),
    ...(args.needsReview !== undefined ? { needs_review: args.needsReview } : {}),
    ...(args.includeInferred !== undefined ? { include_inferred: args.includeInferred } : {}),
  });

  if (result.hits.length === 0) {
    console.log('(no matches)');
    await store.close();
    return;
  }

  console.log(`${result.hits.length} hits for "${args.text}":\n`);
  for (const hit of result.hits) {
    const n = hit.node;
    console.log(`  ${n.kind}  ${n.id}`);
    console.log(`    ${n.title}`);
    console.log(`    at ${n.at}  via ${n.adapter}  score ${hit.score.toFixed(3)}`);
    console.log(`    provenance: ${n.provenance.kind}${
      n.provenance.kind === 'inferred' ? ` (${n.provenance.inferrer}, confidence=${n.provenance.confidence.toFixed(2)})` : ''
    }`);
    console.log('');
  }

  await store.close();
}
