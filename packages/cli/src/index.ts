/**
 * @hypha/cli — `hypha ingest`, `hypha infer`, `hypha serve`, `hypha publish`, etc.
 *
 * Commands shipped in W3-4: ingest, search, build-adapter.
 * Later weeks: infer (W5-6), serve (W7-8), publish + export-graphiti (W11-12).
 */

export const CLI_VERSION = '0.1.0-dev';
export { ingestCommand } from './commands/ingest.ts';
export { searchCommand } from './commands/search.ts';
export { buildAdapterCommand } from './commands/build-adapter.ts';
