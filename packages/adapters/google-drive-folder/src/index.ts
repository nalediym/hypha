import { readdir, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve as resolvePath } from 'node:path';
import { dirname as fileDirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineAdapter, type AdapterEvent } from '@hypha/adapter-sdk';
import {
  edgeId,
  nodeIdFromContent,
  now,
  type Edge,
  type Node,
  type NodeId,
} from '@hypha/core';
import { FileDocumentFacets, FileImageFacets, FileOtherFacets, FolderFacets } from './schemas.ts';

const __dirname = fileDirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = resolvePath(join(__dirname, '..', 'adapter.yaml'));

const ADAPTER_ID = 'google-drive-folder';

export interface FolderInputs {
  folder_path: string;
}

const DOC_EXTENSIONS = new Set([
  '.md', '.txt', '.pdf', '.docx', '.doc', '.odt', '.rtf', '.pages',
  '.html', '.htm', '.xml', '.json', '.yaml', '.yml', '.csv', '.tsv',
  '.xlsx', '.xls', '.pptx', '.ppt',
]);

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.heic']);

function kindForFile(ext: string): 'file.document' | 'file.image' | 'file.other' {
  if (DOC_EXTENSIONS.has(ext)) return 'file.document';
  if (IMAGE_EXTENSIONS.has(ext)) return 'file.image';
  return 'file.other';
}

export const driveFolderAdapter = defineAdapter<FolderInputs>({
  manifestPath: MANIFEST_PATH,
  facetSchemas: {
    folder: FolderFacets,
    'file.document': FileDocumentFacets,
    'file.image': FileImageFacets,
    'file.other': FileOtherFacets,
  },
  async *ingest({ folder_path }, ctx) {
    const root = resolvePath(folder_path);
    let walked = 0;
    let emitted = 0;

    const folderIds = new Map<string, NodeId>();

    async function* walk(
      current: string,
      parentId: NodeId | null,
      rootName: string,
    ): AsyncGenerator<AdapterEvent> {
      walked++;
      const stats = await stat(current);
      const relativePath = relative(root, current) || rootName;
      const name = basename(current);
      const at = new Date(stats.mtimeMs).toISOString();
      const id = nodeIdFromContent(ADAPTER_ID, 'folder', relativePath || rootName);
      folderIds.set(current, id);

      let entries: string[] = [];
      try {
        entries = await readdir(current);
      } catch (err) {
        ctx.logger.warn(`unreadable folder: ${current}`, { err: String(err) });
        return;
      }

      const folderNode: Omit<Node, 'ingested_at'> = {
        id,
        kind: 'folder',
        at: at as Node['at'],
        adapter: ADAPTER_ID,
        external_id: relativePath || rootName,
        title: name,
        facets: { path: relativePath || rootName, name, child_count: entries.length },
      };
      yield { type: 'node', node: folderNode };
      emitted++;

      if (parentId) {
        yield {
          type: 'edge',
          edge: {
            id: edgeId('contained_in', id, parentId, at) as Edge['id'],
            kind: 'contained_in',
            from_id: id,
            to_id: parentId,
            at: at as Node['at'],
          },
        };
      }

      for (const entry of entries) {
        if (entry.startsWith('.')) continue;
        const childPath = join(current, entry);
        let childStats;
        try {
          childStats = await stat(childPath);
        } catch {
          continue;
        }
        if (childStats.isDirectory()) {
          yield* walk(childPath, id, rootName);
        } else if (childStats.isFile()) {
          const ext = extname(entry).toLowerCase();
          const kind = kindForFile(ext);
          const childAt = new Date(childStats.mtimeMs).toISOString();
          const childRel = relative(root, childPath);
          const childId = nodeIdFromContent(
            ADAPTER_ID,
            kind,
            `${childRel}|${childStats.size}|${childStats.mtimeMs}`,
          );
          const fileNode: Omit<Node, 'ingested_at'> = {
            id: childId,
            kind,
            at: childAt as Node['at'],
            adapter: ADAPTER_ID,
            external_id: childRel,
            title: entry,
            facets: {
              path: childRel,
              name: entry,
              extension: ext,
              size_bytes: childStats.size,
              modified_at: childAt,
            },
          };
          yield { type: 'node', node: fileNode };
          yield {
            type: 'edge',
            edge: {
              id: edgeId('contained_in', childId, id, childAt) as Edge['id'],
              kind: 'contained_in',
              from_id: childId,
              to_id: id,
              at: childAt as Node['at'],
            },
          };
          emitted += 1;
          walked += 1;
          if (walked % 500 === 0) {
            yield { type: 'progress', stream: 'files', scanned: walked, emitted };
          }
        }
      }
    }

    yield* walk(root, null, basename(root));
    ctx.logger.info(`google-drive-folder: walked ${walked} entries, emitted ${emitted} nodes`);
    void dirname;
    void folderIds;
  },
});

export default driveFolderAdapter;
