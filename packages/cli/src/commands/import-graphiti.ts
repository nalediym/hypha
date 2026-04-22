import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { now } from '@hypha/core';
import type { UpsertEdge, UpsertNode } from '@hypha/core';
import { SQLiteStore } from '@hypha/store-sqlite';

export interface ImportGraphitiArgs {
  db?: string;
  in: string;
  owner?: string;
}

interface GraphitiNode {
  uuid: string;
  name: string;
  labels?: string[];
  summary?: string;
  attributes?: Record<string, unknown>;
  t_created?: string;
  t_expired?: string | null;
  t_valid?: string;
  t_invalid?: string | null;
  provenance?: { kind?: string; adapter?: string; inferrer?: string };
}

interface GraphitiEdge {
  uuid: string;
  relation_type: string;
  source_node_uuid: string;
  target_node_uuid: string;
  weight?: number | null;
  t_valid?: string;
  provenance?: { kind?: string; adapter?: string; inferrer?: string };
}

/**
 * Import a Graphiti-compatible JSON bundle into Hypha.
 *
 * Runs through the standard upsert path so provenance is properly stamped
 * and content-addressed ids dedupe across imports. Nodes + edges that
 * already exist (by uuid) are skipped.
 */
export async function importGraphitiCommand(args: ImportGraphitiArgs): Promise<void> {
  const dbPath = args.db ?? resolve('.hypha/store.sqlite');
  const inPath = resolve(args.in);
  const owner = args.owner ?? 'imported-graphiti';
  const store = new SQLiteStore({ path: dbPath, ownerInstanceId: owner });

  const raw = await readFile(inPath, 'utf8');
  const bundle = JSON.parse(raw) as { nodes?: GraphitiNode[]; edges?: GraphitiEdge[] };

  const tx = now();
  const nodes: UpsertNode[] = (bundle.nodes ?? []).map((n) => ({
    id: n.uuid as never,
    kind: n.labels?.[0] ?? 'graphiti.node',
    at: (n.t_valid ?? n.t_created ?? tx) as never,
    ingested_at: tx,
    adapter: 'graphiti-import',
    external_id: n.uuid,
    title: n.name,
    ...(n.summary ? { body: n.summary } : {}),
    ...(n.attributes ? { facets: n.attributes } : {}),
    provenance: {
      kind: 'ingested',
      adapter: 'graphiti-import',
      adapter_version: '0.1.0',
      external_id: n.uuid,
    },
    ...(n.t_valid ? { valid_from: n.t_valid as never } : {}),
    ...(n.t_invalid ? { valid_to: n.t_invalid as never } : {}),
  }));

  const edges: UpsertEdge[] = (bundle.edges ?? []).map((e) => ({
    id: e.uuid as never,
    kind: e.relation_type,
    from_id: e.source_node_uuid as never,
    to_id: e.target_node_uuid as never,
    at: (e.t_valid ?? tx) as never,
    ...(e.weight !== null && e.weight !== undefined ? { weight: e.weight } : {}),
    provenance: {
      kind: 'ingested',
      adapter: 'graphiti-import',
      adapter_version: '0.1.0',
      external_id: e.uuid,
    },
  }));

  const result = await store.upsert({ nodes, edges }, { owner_instance_id: owner });
  await store.close();

  console.log(
    `[hypha] imported ${result.nodes_written} nodes + ${result.edges_written} edges (skipped ${result.skipped_idempotent})`,
  );
}
