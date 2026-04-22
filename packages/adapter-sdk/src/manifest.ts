import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { AdapterManifest } from '@hypha/core';

const EmittedKindSchema = z.object({
  kind: z.string().min(1),
  facet_schema_version: z.number().int().positive(),
  id_strategy: z.enum(['content_addressed', 'derived', 'natural']),
});

const CapabilitiesSchema = z.object({
  ingest_modes: z.array(z.enum(['full', 'incremental', 'cdc'])).nonempty(),
  bounded: z.boolean(),
  emits_content_addressed_ids: z.boolean(),
  supports_corrections: z.boolean(),
  supports_dry_run: z.boolean(),
  idempotent: z.boolean(),
});

const InputSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['path', 'url', 'token', 'string', 'number', 'boolean']),
  required: z.boolean(),
  description: z.string().optional(),
});

export const ManifestSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  name: z.string().optional(),
  description: z.string().optional(),
  emits: z.object({
    kinds: z.array(EmittedKindSchema).nonempty(),
    edges: z.array(z.string()).default([]),
  }),
  capabilities: CapabilitiesSchema,
  inputs: z.array(InputSchema).default([]),
  schema_evolution: z
    .record(
      z.string(),
      z.object({
        on_new_field: z.enum(['evolve', 'freeze', 'discard_columns']).optional(),
        on_type_change: z.enum(['evolve', 'freeze', 'discard_rows']).optional(),
      }),
    )
    .optional(),
});

export function loadManifest(path: string): AdapterManifest {
  const raw = readFileSync(path, 'utf8');
  return parseManifest(raw);
}

export function parseManifest(yaml: string): AdapterManifest {
  const parsed: unknown = parseYaml(yaml);
  const result = ManifestSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid adapter manifest: ${result.error.message}`);
  }
  return result.data as AdapterManifest;
}
