import { z } from 'zod';

/** Folder and file facet schemas. Kept intentionally loose — arbitrary local dirs. */

export const FolderFacets = z
  .object({
    path: z.string(),
    name: z.string(),
    child_count: z.number().int().nonnegative().optional(),
  })
  .passthrough();

const FileFacetsBase = {
  path: z.string(),
  name: z.string(),
  extension: z.string().optional(),
  mime: z.string().optional(),
  size_bytes: z.number().int().nonnegative(),
  modified_at: z.string(),
};

export const FileDocumentFacets = z.object(FileFacetsBase).passthrough();
export const FileImageFacets = z
  .object({ ...FileFacetsBase, dimensions: z.string().optional() })
  .passthrough();
export const FileOtherFacets = z.object(FileFacetsBase).passthrough();
