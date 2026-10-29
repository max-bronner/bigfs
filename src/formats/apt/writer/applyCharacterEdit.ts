import type { AptMovie } from '../aptMovie';
import type { AptEdit, EditResult } from './aptEdit';
import { AptImage } from './aptImage';
import { changeCharacter } from './changeCharacter';

/** An edit to the character table or a character's own fields */
export type CharacterEdit = Extract<
  AptEdit,
  {
    kind:
      | 'character'
      | 'movieUnknown36'
      | 'screen'
      | 'duplicateCharacter'
      | 'addCharacter'
      | 'removeCharacter';
  }
>;

/** Bytes each character type's record takes, for a duplicate */
const RECORD_LENGTHS: Record<string, number> = {
  shape: 28,
  editText: 60,
  font: 20,
  button: 60,
  sprite: 20,
  image: 12,
  morph: 16,
  text: 56,
};

/** Applies an edit that adds, copies, removes or changes a character, or changes the movie character's own fields */
export const applyCharacterEdit = (
  image: AptImage,
  movie: AptMovie,
  edit: CharacterEdit,
): EditResult => {
  const record = movie.record;

  switch (edit.kind) {
    case 'character': {
      const character = movie.characters[edit.id];

      if (!character) {
        throw new Error(`No character #${edit.id}`);
      }

      changeCharacter(image, character, edit.change);
      return {};
    }
    case 'movieUnknown36':
      image.setU32(record.offset + 36, edit.value);
      return {};
    case 'screen':
      image.setU32(record.offset + 28, edit.width);
      image.setU32(record.offset + 32, edit.height);
      return {};
    case 'duplicateCharacter': {
      const source = movie.characters[edit.id];
      const length = source && RECORD_LENGTHS[source.type];

      if (!source || !length) {
        throw new Error(`#${edit.id} cannot be duplicated`);
      }

      const copy = image.appendCopy(source.offset, length);
      const id = record.characterCount;
      const array = image.growArray(record.offset + 24, id, 1);

      image.setU32(array + id * 4, copy);
      image.setU32(record.offset + 20, id + 1);

      // A shape's geometry and an image's texture are named by its id
      if (source.type === 'shape') {
        image.setU32(copy + 24, id);
      }
      if (source.type === 'image') {
        image.setU32(copy + 8, id);
      }

      // A copy gets its own frames and button records, so editing it never
      // edits the original
      if (source.type === 'sprite') {
        image.growArray(copy + 12, source.frameCount * 2, 0);
      }

      if (source.type === 'button') {
        image.growArray(copy + 48, source.records.length * 17, 0);
      }

      return { character: id };
    }
    case 'addCharacter': {
      const id = record.characterCount;
      const f32 = (value: number) =>
        new Uint32Array(new Float32Array([value]).buffer)[0];
      const signature = 0x09876543;
      let words: number[];

      switch (edit.type) {
        case 'editText':
          // Bounds 0,0-200,24, font 0, left aligned, white, 16 px, read-only
          words = [
            2,
            signature,
            f32(0),
            f32(0),
            f32(200),
            f32(24),
            0,
            0,
            0xffffffff,
            f32(16),
            1,
            0,
            0,
            image.appendString('Text'),
            0,
          ];
          break;
        case 'sprite':
          words = [5, signature, 1, image.appendWords([0, 0]), 0];
          break;
        case 'shape':
          // Its geometry is the .ru the editor writes under the new id
          words = [1, signature, f32(0), f32(0), f32(100), f32(100), id];
          break;
        case 'image':
          words = [7, signature, id];
          break;
        case 'button': {
          // Bounds 0,0-100,30 and a hit mesh of the same box, so it can be
          // clicked; no records and no actions yet (layout: mint's research)
          const vertices = image.appendWords(
            [0, 0, 100, 0, 100, 30, 0, 30].map(f32),
          );
          // Two triangles as u16 indices, two to a word
          const triangles = image.appendWords([
            0 | (1 << 16),
            2 | (0 << 16),
            2 | (3 << 16),
          ]);

          words = [
            4,
            signature,
            0,
            f32(0),
            f32(0),
            f32(100),
            f32(30),
            2,
            4,
            vertices,
            triangles,
            0,
            0,
            0,
            0,
          ];
          break;
        }
      }

      const at = image.appendWords(words);
      const array = image.growArray(record.offset + 24, id, 1);

      image.setU32(array + id * 4, at);
      image.setU32(record.offset + 20, id + 1);

      return { character: id };
    }
    case 'removeCharacter': {
      if (
        !Number.isInteger(edit.id) ||
        edit.id < 1 ||
        edit.id >= record.characterCount
      ) {
        throw new Error(`There is no character #${edit.id} to remove`);
      }
      // Copied first: the table may be shared
      image.setU32(
        image.growArray(record.offset + 24, record.characterCount, 0) +
          edit.id * 4,
        0,
      );
      return {};
    }
  }
};
