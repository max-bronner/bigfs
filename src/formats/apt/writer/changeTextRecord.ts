import type { TextRecordChange } from './aptEdit';
import { AptImage } from './aptImage';

/** Writes the fields of a text record in place, appending a new glyph table */
export const changeTextRecord = (
  image: AptImage,
  at: number,
  change: TextRecordChange,
): void => {
  if (change.font !== undefined) {
    image.setU32(at, change.font);
  }
  if (change.color) {
    // R, G, B, A are stored as the rect's top, left, bottom, right
    const [red, green, blue, alpha] = change.color;

    [green, red, alpha, blue].forEach((value, index) =>
      image.setF32(at + 4 + index * 4, value),
    );
  }
  change.unknown?.forEach((value, index) =>
    image.setF32(at + 20 + index * 4, value),
  );
  if (change.penOffset) {
    image.setF32(at + 36, change.penOffset[0]);
    image.setF32(at + 40, change.penOffset[1]);
  }
  if (change.textHeight !== undefined) {
    image.setF32(at + 44, change.textHeight);
  }
  if (change.glyphs) {
    const glyphs = change.glyphs;

    image.setU32(
      at + 52,
      glyphs.length
        ? image.appendWords(
            glyphs.flatMap((glyph) => [glyph.index, glyph.advance >>> 0]),
          )
        : 0,
    );
    image.setU32(at + 48, glyphs.length);
  }
};
