import * as vscode from 'vscode';
import { decodeWindows1252 } from '../common/windows1252';
import type { EntryLocator } from '../formats/entryLocator';
import { isRotated, parseMappedImage } from '../formats/mappedImage';
import type { MappedImage } from '../formats/mappedImage';
import { encodePng } from '../formats/textureEncode';
import { decodeDds, decodeTga } from '../tools/textureTools';
import type { RgbaImage } from '../tools/textureTools';
import type { SageDefinition } from './sageIniIndex';

/**
 * The picture a `MappedImage` names: its texture, cropped to `Coords`, as a
 * PNG data URI a hover can show. Coordinates are in the `TextureWidth` ×
 * `TextureHeight` space the definition declares and are scaled to the real
 * texture, so a texture shipped at another size still crops right. The game
 * looks for a DDS beside a TGA name, so that is tried first.
 */

const MAX_SIDE = 256;

/** A definition's fields, read from the lines between its header and `End` */
export const readMappedImage = async (
  definition: SageDefinition,
): Promise<MappedImage> => {
  const text = decodeWindows1252(
    await vscode.workspace.fs.readFile(definition.uri),
  ).split(/\r?\n/);

  return parseMappedImage(
    definition.name,
    text.slice(definition.line + 1, definition.endLine),
  );
};

/** The texture a definition names, DDS before TGA, as the game looks */
export const loadMappedTexture = async (
  locator: EntryLocator,
  textureName: string,
  near: vscode.Uri,
): Promise<RgbaImage | undefined> => {
  for (const name of [textureName.replace(/\.[^.]*$/, '.dds'), textureName]) {
    const bytes = await locator.read(name, near);

    if (bytes) {
      return (/\.dds$/i.test(name) ? decodeDds(bytes) : decodeTga(bytes))
        .levels[0];
    }
  }

  return undefined;
};

/**
 * The rect `width` by `height` at `left`, `top` of `image`, scaled down to
 * fit. A `rotated` image is packed turned a quarter turn clockwise, so it
 * comes out turned back: width and height swap, its left edge reading the
 * rect's top and its top edge the rect's right (`UiQuad::uv_rotated_cw`).
 */
export const crop = (
  image: RgbaImage,
  left: number,
  top: number,
  width: number,
  height: number,
  rotated = false,
): RgbaImage => {
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const outWidth = Math.max(1, Math.round((rotated ? height : width) * scale));
  const outHeight = Math.max(1, Math.round((rotated ? width : height) * scale));
  const pixels = new Uint8Array(outWidth * outHeight * 4);

  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      const px = rotated ? width - (y + 0.5) / scale : x / scale;
      const py = rotated ? (x + 0.5) / scale : y / scale;
      const sx = Math.min(image.width - 1, Math.max(0, Math.floor(left + px)));
      const sy = Math.min(image.height - 1, Math.max(0, Math.floor(top + py)));

      pixels.set(
        image.pixels.subarray(
          (sy * image.width + sx) * 4,
          (sy * image.width + sx) * 4 + 4,
        ),
        (y * outWidth + x) * 4,
      );
    }
  }

  return { width: outWidth, height: outHeight, pixels };
};

export const createMappedImagePreview = (locator: EntryLocator) => {
  const cache = new Map<string, Promise<string | undefined>>();

  const build = async (
    definition: SageDefinition,
  ): Promise<string | undefined> => {
    const image = await readMappedImage(definition);

    if (!image.texture) {
      return undefined;
    }

    const texture = await loadMappedTexture(
      locator,
      image.texture,
      definition.uri,
    );

    if (!texture) {
      return `*Texture \`${image.texture}\` was not found.*`;
    }

    const sx = texture.width / (image.textureWidth ?? texture.width);
    const sy = texture.height / (image.textureHeight ?? texture.height);
    const { left, top, right, bottom } = image.coords ?? {
      left: 0,
      top: 0,
      right: image.textureWidth ?? texture.width,
      bottom: image.textureHeight ?? texture.height,
    };
    const packedWidth = Math.max(1, (right - left) * sx);
    const packedHeight = Math.max(1, (bottom - top) * sy);
    const png = encodePng(
      crop(
        texture,
        left * sx,
        top * sy,
        packedWidth,
        packedHeight,
        isRotated(image),
      ),
    );
    const [width, height] = isRotated(image)
      ? [packedHeight, packedWidth]
      : [packedWidth, packedHeight];

    return `![${definition.name}](data:image/png;base64,${Buffer.from(png).toString('base64')})\n\n${image.texture} · ${Math.round(width)}×${Math.round(height)}`;
  };

  return (definition: SageDefinition): Promise<string | undefined> => {
    const key = `${definition.uri.toString()}#${definition.line}`;
    let entry = cache.get(key);

    if (!entry) {
      entry = build(definition).catch(() => undefined);
      cache.set(key, entry);
    }

    return entry;
  };
};
