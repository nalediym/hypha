import { resolve } from 'node:path';
import { loadManifest } from '@hypha/adapter-sdk';

export interface BuildAdapterArgs {
  /** Path to the adapter package directory containing adapter.yaml + src/index.ts. */
  path: string;
}

/**
 * `hypha build-adapter <path>` — validate an adapter package.
 *
 * v1 scope: checks that adapter.yaml parses + conforms to the manifest schema,
 * and that src/index.ts can be imported and exports a HyphaAdapter whose
 * manifest matches the YAML. Contract tests (six assertions) still live in
 * the adapter's own test file; this is a structural pre-flight.
 */
export async function buildAdapterCommand(args: BuildAdapterArgs): Promise<void> {
  const pkgDir = resolve(args.path);
  const manifestPath = resolve(pkgDir, 'adapter.yaml');
  const entryPath = resolve(pkgDir, 'src/index.ts');

  console.log(`[hypha] validating adapter at ${pkgDir}`);

  const manifest = loadManifest(manifestPath);
  console.log(`[hypha]   manifest ok: ${manifest.id}@${manifest.version}`);

  const mod = (await import(entryPath)) as { default?: unknown };
  const exported = mod.default as { manifest?: { id: string; version: string } } | undefined;
  if (!exported?.manifest) {
    throw new Error(`Adapter at ${entryPath} does not default-export a HyphaAdapter`);
  }
  if (exported.manifest.id !== manifest.id) {
    throw new Error(
      `Manifest mismatch: adapter.yaml declares id=${manifest.id} but code declares id=${exported.manifest.id}`,
    );
  }
  if (exported.manifest.version !== manifest.version) {
    throw new Error(
      `Manifest version mismatch: adapter.yaml=${manifest.version} code=${exported.manifest.version}`,
    );
  }

  console.log(`[hypha]   code ok: exports HyphaAdapter matching manifest`);
  console.log(`[hypha] ✓ ${manifest.id}@${manifest.version} is shippable`);
}
