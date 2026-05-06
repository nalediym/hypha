#!/usr/bin/env bun
/**
 * `hypha` CLI entry point.
 *
 * Usage:
 *   hypha ingest <adapter> <path> [--db <path>] [--dry-run]
 *   hypha search <query> [--kinds <k1,k2>] [--limit N] [--needs-review]
 *   hypha build-adapter <package-dir>
 *
 * More commands (infer, serve, publish, export-graphiti) land in later weeks.
 */

import { parseArgs } from 'node:util';
import { ingestCommand } from './commands/ingest.ts';
import { inferCommand } from './commands/infer.ts';
import { searchCommand } from './commands/search.ts';
import { serveCommand } from './commands/serve.ts';
import { publishCommand } from './commands/publish.ts';
import { exportGraphitiCommand } from './commands/export-graphiti.ts';
import { importGraphitiCommand } from './commands/import-graphiti.ts';
import { buildAdapterCommand } from './commands/build-adapter.ts';

const HELP = `hypha — local-first knowledge graph CLI (v0.1.0-dev)

Usage:
  hypha ingest <adapter> <path>              Ingest a source archive.
      --db <path>                            Custom SQLite path (default: .hypha/store.sqlite)
      --owner <id>                           Owner instance id (default: local-owner)
      --dry-run                              Parse + validate but don't write.

  hypha infer [inferrer]                     Run an inferrer (or all).
      --db <path>                            Custom SQLite path.

  hypha serve [--db <path>]                  Run the MCP stdio server (for Claude Desktop).

  hypha publish [--port 3456]                Run a read-only HTTP view.
  hypha export --format graphiti --out FILE  Export graph as Graphiti-compatible JSON.
  hypha import --format graphiti --in FILE   Import a Graphiti JSON bundle.

  hypha search <query>                       FTS5 full-text search.
      --kinds <k1,k2,…>                      Filter by node kinds.
      --limit N                              Max hits (default: 20).
      --needs-review                         Only records flagged for human review.
      --no-inferred                          Exclude inferred records.

  hypha build-adapter <package-dir>          Validate an adapter package.

  hypha help                                 Show this message.
`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(HELP);
    return;
  }

  switch (cmd) {
    case 'ingest':
      return runIngest(argv.slice(1));
    case 'infer':
      return runInfer(argv.slice(1));
    case 'serve':
      return runServe(argv.slice(1));
    case 'publish':
      return runPublish(argv.slice(1));
    case 'export':
      return runExport(argv.slice(1));
    case 'import':
      return runImport(argv.slice(1));
    case 'search':
      return runSearch(argv.slice(1));
    case 'build-adapter':
      return runBuildAdapter(argv.slice(1));
    default:
      console.error(`Unknown command: ${cmd}`);
      console.error(HELP);
      process.exit(2);
  }
}

async function runIngest(argv: string[]): Promise<void> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      db: { type: 'string' },
      owner: { type: 'string' },
      'dry-run': { type: 'boolean' },
    },
  });
  const [adapter, input] = positionals;
  if (!adapter || !input) {
    console.error('Usage: hypha ingest <adapter> <path>');
    process.exit(2);
  }
  await ingestCommand({
    adapter,
    input,
    ...(values.db ? { db: values.db } : {}),
    ...(values.owner ? { owner: values.owner } : {}),
    ...(values['dry-run'] ? { dryRun: true } : {}),
  });
}

async function runInfer(argv: string[]): Promise<void> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      db: { type: 'string' },
      owner: { type: 'string' },
    },
  });
  await inferCommand({
    ...(positionals[0] ? { inferrer: positionals[0] } : {}),
    ...(values.db ? { db: values.db } : {}),
    ...(values.owner ? { owner: values.owner } : {}),
  });
}

async function runServe(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      db: { type: 'string' },
      'instance-id': { type: 'string' },
      'instance-label': { type: 'string' },
    },
  });
  await serveCommand({
    ...(values.db ? { db: values.db } : {}),
    ...(values['instance-id'] ? { instanceId: values['instance-id'] } : {}),
    ...(values['instance-label'] ? { instanceLabel: values['instance-label'] } : {}),
  });
}

async function runPublish(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      db: { type: 'string' },
      port: { type: 'string' },
      host: { type: 'string' },
      filter: { type: 'string' },
    },
  });
  await publishCommand({
    ...(values.db ? { db: values.db } : {}),
    ...(values.port ? { port: parseInt(values.port, 10) } : {}),
    ...(values.host ? { host: values.host } : {}),
    ...(values.filter ? { filter: values.filter } : {}),
  });
}

async function runExport(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      format: { type: 'string' },
      out: { type: 'string' },
      db: { type: 'string' },
    },
  });
  if (values.format !== 'graphiti') {
    console.error('Only --format graphiti is supported (v1).');
    process.exit(2);
  }
  if (!values.out) {
    console.error('--out <file> is required');
    process.exit(2);
  }
  await exportGraphitiCommand({
    out: values.out,
    ...(values.db ? { db: values.db } : {}),
  });
}

async function runImport(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      format: { type: 'string' },
      in: { type: 'string' },
      db: { type: 'string' },
      owner: { type: 'string' },
    },
  });
  if (values.format !== 'graphiti') {
    console.error('Only --format graphiti is supported (v1).');
    process.exit(2);
  }
  if (!values.in) {
    console.error('--in <file> is required');
    process.exit(2);
  }
  await importGraphitiCommand({
    in: values.in,
    ...(values.db ? { db: values.db } : {}),
    ...(values.owner ? { owner: values.owner } : {}),
  });
}

async function runSearch(argv: string[]): Promise<void> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      kinds: { type: 'string' },
      limit: { type: 'string' },
      db: { type: 'string' },
      owner: { type: 'string' },
      'needs-review': { type: 'boolean' },
      'no-inferred': { type: 'boolean' },
    },
  });
  const text = positionals.join(' ');
  if (!text) {
    console.error('Usage: hypha search <query>');
    process.exit(2);
  }
  await searchCommand({
    text,
    ...(values.kinds ? { kinds: values.kinds.split(',').map((s) => s.trim()).filter(Boolean) } : {}),
    ...(values.limit ? { limit: parseInt(values.limit, 10) } : {}),
    ...(values.db ? { db: values.db } : {}),
    ...(values.owner ? { owner: values.owner } : {}),
    ...(values['needs-review'] ? { needsReview: true } : {}),
    ...(values['no-inferred'] ? { includeInferred: false } : {}),
  });
}

async function runBuildAdapter(argv: string[]): Promise<void> {
  const [path] = argv;
  if (!path) {
    console.error('Usage: hypha build-adapter <package-dir>');
    process.exit(2);
  }
  await buildAdapterCommand({ path });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
