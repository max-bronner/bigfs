import type { ArchiveModel } from '../../services/archives/archiveModel';
import { readWorkspaceText } from '../../services/ini/workspaceText';
import { parseMappedImageRegionId } from './mappedImageRegionId';
import type { MappedImageSource } from './mappedImageRegionId';
import { readMappedImageRegion } from './readMappedImageRegion';
import type { RegionKind } from './regionKind';
import { writeMappedImageRegion } from './writeMappedImageRegion';

/** Creates the region kind of `MappedImage` blocks, whose `Coords` are the box */
export const createMappedImageRegionKind = (
  archives: ArchiveModel,
): RegionKind => ({
  owns: (id) => parseMappedImageRegionId(id) !== undefined,
  read: async (ids, decoded) => {
    const byDocument = new Map<string, MappedImageSource[]>();

    for (const source of ids.flatMap(
      (id) => parseMappedImageRegionId(id) ?? [],
    )) {
      const key = source.uri.toString();

      byDocument.set(key, [...(byDocument.get(key) ?? []), source]);
    }

    const regions = await Promise.all(
      [...byDocument.values()].map(async (sources) => {
        try {
          const lines = (await readWorkspaceText(sources[0].uri)).split(
            /\r?\n/,
          );

          return sources.flatMap(
            (source) =>
              readMappedImageRegion(archives, source, lines, decoded) ?? [],
          );
        } catch {
          return [];
        }
      }),
    );

    return regions.flat();
  },
  write: async (id, decoded, rect) => {
    const source = parseMappedImageRegionId(id);

    return source
      ? writeMappedImageRegion(archives, source, decoded, rect)
      : false;
  },
  documentOf: (id) => parseMappedImageRegionId(id)?.uri,
});
