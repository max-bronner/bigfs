import type { Character } from '../aptMovie';
import type { CharacterChange } from './aptEdit';
import { AptImage } from './aptImage';

/** Byte offsets of a character's fields, by type and field */
const FIELD_OFFSETS: Record<
  string,
  Record<string, [number, 'u32' | 'f32' | 'string' | 'rect' | 'pair']>
> = {
  shape: { bounds: [8, 'rect'], geometry: [24, 'u32'] },
  editText: {
    bounds: [8, 'rect'],
    font: [24, 'u32'],
    alignment: [28, 'u32'],
    color: [32, 'u32'],
    fontHeight: [36, 'f32'],
    readonly: [40, 'u32'],
    multiline: [44, 'u32'],
    wordwrap: [48, 'u32'],
    text: [52, 'string'],
    variable: [56, 'string'],
  },
  font: { fontName: [8, 'string'], glyphs: [16, 'u32'] },
  button: { bounds: [12, 'rect'] },
  image: { texture: [8, 'u32'] },
  morph: { startShape: [8, 'u32'], endShape: [12, 'u32'] },
  text: { bounds: [8, 'rect'], matrix: [24, 'rect'], translate: [40, 'pair'] },
};

/** Writes a field of a character in place, or repoints a string field */
export const changeCharacter = (
  image: AptImage,
  character: Character,
  change: CharacterChange,
): void => {
  const field = FIELD_OFFSETS[character.type]?.[change.field];

  if (!field) {
    throw new Error(`A ${character.type} has no field ${change.field}`);
  }

  const [delta, type] = field;
  const at = character.offset + delta;

  if (change.field === 'glyphs') {
    if (character.type !== 'font') {
      throw new Error(`A ${character.type} has no field glyphs`);
    }
    image.setU32(character.offset + 16, image.appendWords(change.value));
    image.setU32(character.offset + 12, change.value.length);
    return;
  }

  if (type === 'rect' || type === 'pair') {
    (change.value as number[]).forEach((value, index) =>
      image.setF32(at + index * 4, value),
    );
  } else if (type === 'string') {
    const value = change.value as string | undefined;

    image.setU32(at, value === undefined ? 0 : image.appendString(value));
  } else if (type === 'f32') {
    image.setF32(at, change.value as number);
  } else {
    image.setU32(at, change.value as number);
  }
};
