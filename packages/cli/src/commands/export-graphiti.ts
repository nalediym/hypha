import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { SQLiteStore } from '@hypha/store-sqlite';

export interface ExportGraphitiArgs {
  db?: string;
  out: string;
  kinds?: readonly string[];
}

/**
 * Export the Hypha graph to a Graphiti-compatible JSON bundle.
 *
 * Maps Hypha's four-timestamp provenance (tx_created, tx_invalidated,
 * valid_from, valid_to) to Graphiti's (t_created, t_expired, t_valid,
 * t_invalid). Preserves provenance + inferrer lineage so a Graphiti
 * consumer can respect "why" chains without recomputation.
 */
export async function exportGraphitiCommand(args: ExportGraphitiArgs): Promise<void> {
  const dbPath = args.db ?? resolve('.hypha/store.sqlite');
  const outPath = resolve(args.out);
  const store = new SQLiteStore({ path: dbPath, ownerInstanceId: 'export' });

  const nodes: unknown[] = [];
  const edges: unknown[] = [];

  for await (const record of store.scan(args.kinds ?? ['*'])) {
    if ('title' in record) {
      nodes.push({
        uuid: record.id,
        name: record.title,
        labels: [record.kind],
        summary: record.body ?? '',
        attributes: record.facets ?? {},
        t_created: record.tx_created,
        t_expired: record.tx_invalidated ?? null,
        t_valid: record.valid_from ?? record.at,
        t_invalid: record.valid_to ?? null,
        provenance: record.provenance,
      });
    } else {
      edges.push({
        uuid: record.id,
        relation_type: record.kind,
        source_node_uuid: record.from_id,
        target_node_uuid: record.to_id,
        weight: record.weight ?? null,
        t_created: record.tx_created,
        t_expired: record.tx_invalidated ?? null,
        t_valid: record.valid_from ?? record.at,
        t_invalid: record.valid_to ?? null,
        provenance: record.provenance,
      });
    }
  }

  const bundle = {
    format: 'graphiti-v1',
    hypha_version: '0.1.0-dev',
    exported_at: new Date().toISOString(),
    node_count: nodes.length,
    edge_count: edges.length,
    nodes,
    edges,
  };
  await writeFile(outPath, JSON.stringify(bundle, null, 2));
  await store.close();

  console.log(`[hypha] exported ${nodes.length} nodes + ${edges.length} edges to ${outPath}`);
}
