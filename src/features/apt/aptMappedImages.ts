import type { Uri } from 'vscode';
import type { EntryLocator } from '../../services/entryLocator';
import { isTextureFile } from '../../formats/apt/aptEngineImages';
import { imageExtent, isRotated, mappedUv } from '../../formats/mappedImage/mappedImage';
import type { MappedImage } from '../../formats/mappedImage/mappedImage';
import { readJpegSize } from '../../formats/texture/jpegSize';
import type { SageIniIndex } from '../../services/ini/sageIniIndex';
import { loadMappedTexture, readMappedImage } from '../../services/mappedImagePreview';
import type { PageMappedImage, TexturePixels } from '../../webview/apt/protocol';

/** Most names answered per request, so a page cannot ask for the whole INI */
export const MAX_NAMES = 64;

/** Reply to a page's `MappedImage` request: each name's image and the textures not yet sent */
export interface MappedAnswer {
  images: Record<string, PageMappedImage | null>;
  textures: Record<string, TexturePixels>;
  /** Textures the game ships as JPEG, which the page decodes */
  jpegs: Record<string, Uint8Array>;
}

/** A surface's picture before it is cut from its texture */
interface FoundImage {
  texture: string;
  mapped?: MappedImage;
}

/** What a name means: a `MappedImage`, else a texture named as a file */
const findImage = async (
  name: string,
  index: SageIniIndex,
): Promise<{ found?: FoundImage; near?: Uri }> => {
  const definition = index.findDefinitions('MappedImage', name)[0];

  if (definition) {
    const mapped = await readMappedImage(definition);

    return {
      found: mapped.texture ? { texture: mapped.texture, mapped } : undefined,
      near: definition.uri,
    };
  }
  return isTextureFile(name) ? { found: { texture: name.trim() } } : {};
};

/**
 * Looks image surfaces' names up in the INI index and loads their textures
 * like the WND preview does; a name no definition holds may be a texture file,
 * which the Engine panel accepts. A name that resolves to nothing, or whose
 * texture does not read, answers null and never throws.
 */
export const resolveMappedImages = async (
  names: readonly string[],
  index: SageIniIndex,
  locator: EntryLocator,
  sent: Set<string>,
  near: Uri,
): Promise<MappedAnswer> => {
  const answer: MappedAnswer = { images: {}, textures: {}, jpegs: {} };

  for (const name of names.slice(0, MAX_NAMES)) {
    answer.images[name] = null;
    try {
      const { found, near: beside = near } = await findImage(name, index);

      if (!found) {
        continue;
      }

      const path = `mapped:${found.texture.toLowerCase()}`;
      const texture = await loadMappedTexture(locator, found.texture, beside);
      const size = texture
        ? ([texture.width, texture.height] as [number, number])
        : await loadJpeg(locator, found.texture, beside, path, sent, answer);

      if (!size) {
        continue;
      }
      if (texture && !sent.has(path)) {
        sent.add(path);
        answer.textures[path] = texture;
      }
      answer.images[name] = {
        texture: path,
        uv: found.mapped ? mappedUv(found.mapped, size) : [0, 0, 1, 1],
        rotated: !!found.mapped && isRotated(found.mapped),
        extent: (found.mapped && imageExtent(found.mapped)) ?? size,
      };
    } catch {
      // The surface keeps its placeholder
    }
  }
  return answer;
};

/**
 * Finds a texture the game ships as JPEG, as `InstallLoad.tga` is, and adds
 * it to the answer unsent; gets its size.
 */
const loadJpeg = async (
  locator: EntryLocator,
  textureName: string,
  near: Uri,
  path: string,
  sent: Set<string>,
  answer: MappedAnswer,
): Promise<[number, number] | undefined> => {
  const bytes = await locator.read(
    textureName.replace(/\.[^.]*$/, '.jpg'),
    near,
  );
  const size = bytes && readJpegSize(bytes);

  if (bytes && size && !sent.has(path)) {
    sent.add(path);
    answer.jpegs[path] = bytes;
  }
  return size;
};
