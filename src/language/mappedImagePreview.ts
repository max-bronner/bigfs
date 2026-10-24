import * as vscode from 'vscode';
import { decodeWindows1252 } from '../common/windows1252';
import type { EntryLocator } from '../formats/entryLocator';
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

const fieldsOf = (lines: string[]): Map<string, string> =>
  new Map(
    lines.flatMap((line) => {
      const match = /^\s*(\w+)\s*=\s*([^;]*)/.exec(line);

      return match ? [[match[1].toLowerCase(), match[2].trim()] as const] : [];
    }),
  );

const crop = (
  image: RgbaImage,
  left: number,
  top: number,
  width: number,
  height: number,
): RgbaImage => {
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const outWidth = Math.max(1, Math.round(width * scale));
  const outHeight = Math.max(1, Math.round(height * scale));
  const pixels = new Uint8Array(outWidth * outHeight * 4);

  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      const sx = Math.min(
        image.width - 1,
        Math.max(0, Math.floor(left + x / scale)),
      );
      const sy = Math.min(
        image.height - 1,
        Math.max(0, Math.floor(top + y / scale)),
      );

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
    const text = decodeWindows1252(
      await vscode.workspace.fs.readFile(definition.uri),
    ).split(/\r?\n/);
    const fields = fieldsOf(
      text.slice(definition.line + 1, definition.endLine),
    );
    const textureName = fields.get('texture');

    if (!textureName) {
      return undefined;
    }

    let texture: RgbaImage | undefined;

    for (const name of [textureName.replace(/\.[^.]*$/, '.dds'), textureName]) {
      const bytes = await locator.read(name, definition.uri);

      if (bytes) {
        texture = (/\.dds$/i.test(name) ? decodeDds(bytes) : decodeTga(bytes))
          .levels[0];
        break;
      }
    }

    if (!texture) {
      return `*Texture \`${textureName}\` was not found.*`;
    }

    const coords = new Map(
      [...(fields.get('coords') ?? '').matchAll(/(\w+)\s*:\s*(-?\d+)/g)].map(
        (match) => [match[1].toLowerCase(), Number(match[2])],
      ),
    );
    const declaredWidth = Number(fields.get('texturewidth')) || texture.width;
    const declaredHeight =
      Number(fields.get('textureheight')) || texture.height;
    const sx = texture.width / declaredWidth;
    const sy = texture.height / declaredHeight;
    const left = (coords.get('left') ?? 0) * sx;
    const top = (coords.get('top') ?? 0) * sy;
    const right = (coords.get('right') ?? declaredWidth) * sx;
    const bottom = (coords.get('bottom') ?? declaredHeight) * sy;
    const png = encodePng(
      crop(
        texture,
        left,
        top,
        Math.max(1, right - left),
        Math.max(1, bottom - top),
      ),
    );

    return `![${definition.name}](data:image/png;base64,${Buffer.from(png).toString('base64')})\n\n${textureName} · ${Math.round(right - left)}×${Math.round(bottom - top)}`;
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
