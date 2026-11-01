import type { ArchiveModel } from '../../services/archives/archiveModel';
import { isEditable } from '../../services/ini/archiveText';
import { readMappedImageBlock } from '../../formats/mappedImage/mappedImageEdit';
import { getMappedPixelRect } from '../../formats/mappedImage/mappedRegion';
import { isRotated } from '../../formats/mappedImage/mappedImage';
import type { TextureRegion } from '../../webview/preview/protocol';
import { getMappedImageRegionId } from './mappedImageRegionId';
import type { MappedImageSource } from './mappedImageRegionId';

/**
 * Reads a `MappedImage` block as a region of the texture it names, from the
 * lines of its document as they are now so an edit not yet saved shows. A
 * block without `Coords` covers the whole texture. A block in a read-only
 * archive entry is shown but cannot be edited.
 */
export const readMappedImageRegion = (
  archives: ArchiveModel,
  source: MappedImageSource,
  lines: readonly string[],
  decoded: readonly [number, number],
): TextureRegion | undefined => {
  const block = readMappedImageBlock(lines, source.line);

  if (!block) {
    return undefined;
  }

  const { image } = block;
  const pixels = getMappedPixelRect(image, decoded);
  const editable = isEditable(archives, source.uri);

  return {
    id: getMappedImageRegionId(source),
    label: image.name,
    group: 'MappedImage',
    rect: pixels
      ? [pixels.left, pixels.top, pixels.right, pixels.bottom]
      : [0, 0, decoded[0], decoded[1]],
    rotated: isRotated(image),
    editable,
    note:
      [
        pixels
          ? ''
          : 'No Coords: this covers the whole texture. Drag to give it some.',
        editable
          ? ''
          : 'In a read-only archive: override the INI file in a folder to edit it.',
      ]
        .filter((each) => each)
        .join(' ') || undefined,
    source: { uri: source.uri.toString(), line: source.line },
  };
};
