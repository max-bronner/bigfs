import type { ArchiveModel } from '../../services/archives/archiveModel';
import { parseMappedImageRegionId } from './mappedImageRegionId';
import { readMappedImageRegion } from './readMappedImageRegion';
import type { RegionKind } from './regionKind';
import { writeMappedImageRegion } from './writeMappedImageRegion';

/** Creates the region kind of `MappedImage` blocks, whose `Coords` are the box */
export const createMappedImageRegionKind = (
  archives: ArchiveModel,
): RegionKind => ({
  owns: (id) => parseMappedImageRegionId(id) !== undefined,
  read: async (id, decoded) => {
    const source = parseMappedImageRegionId(id);

    return source && readMappedImageRegion(archives, source, decoded);
  },
  write: async (id, decoded, rect) => {
    const source = parseMappedImageRegionId(id);

    return source ? writeMappedImageRegion(archives, source, decoded, rect) : false;
  },
  documentOf: (id) => parseMappedImageRegionId(id)?.uri,
});
