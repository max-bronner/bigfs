import type { EntryLocator } from '../services/entryLocator';
import { imageExtent, isRotated, mappedUv } from '../formats/mappedImage/mappedImage';
import type { SageIniIndex } from '../services/ini/sageIniIndex';
import { loadMappedTexture, readMappedImage } from '../features/preview/mappedImagePreview';
import type { PageMappedImage, TexturePixels } from '../webview/apt/protocol';

/** Most names answered per request, so a page cannot ask for the whole INI */
export const MAX_NAMES = 64;

export interface MappedAnswer {
  images: Record<string, PageMappedImage | null>;
  textures: Record<string, TexturePixels>;
}

/**
 * Looks image surfaces' `MappedImage` names up in the INI index and loads
 * their textures like the WND preview does; a name no definition holds, or
 * whose texture does not read, answers null and never throws.
 */
export const resolveMappedImages = async (
  names: readonly string[],
  index: SageIniIndex,
  locator: EntryLocator,
  sent: Set<string>,
): Promise<MappedAnswer> => {
  const answer: MappedAnswer = { images: {}, textures: {} };

  for (const name of names.slice(0, MAX_NAMES)) {
    answer.images[name] = null;
    try {
      const definition = index.findDefinitions('MappedImage', name)[0];

      if (!definition) {
        continue;
      }

      const mapped = await readMappedImage(definition);
      const texture =
        mapped.texture &&
        (await loadMappedTexture(locator, mapped.texture, definition.uri));

      if (!mapped.texture || !texture) {
        continue;
      }

      const path = `mapped:${mapped.texture.toLowerCase()}`;

      if (!sent.has(path)) {
        sent.add(path);
        answer.textures[path] = texture;
      }
      answer.images[name] = {
        texture: path,
        uv: mappedUv(mapped, [texture.width, texture.height]),
        rotated: isRotated(mapped),
        extent: imageExtent(mapped) ?? [texture.width, texture.height],
      };
    } catch {
      // The surface keeps its placeholder
    }
  }
  return answer;
};
