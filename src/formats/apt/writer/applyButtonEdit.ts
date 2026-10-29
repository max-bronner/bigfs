import type { AptMovie } from '../aptMovie';
import type { AptEdit, EditResult } from './aptEdit';
import { AptImage } from './aptImage';
import { editRecords } from './editRecords';

/** An edit to a button's records or actions */
export type ButtonEdit = Extract<
  AptEdit,
  {
    kind:
      | 'buttonRecord'
      | 'addButtonRecord'
      | 'moveButtonRecord'
      | 'removeButtonRecord'
      | 'addButtonAction'
      | 'buttonAction'
      | 'removeButtonAction';
  }
>;

/** Applies an edit to a button's records or actions */
export const applyButtonEdit = (
  image: AptImage,
  movie: AptMovie,
  edit: ButtonEdit,
): EditResult => {
  switch (edit.kind) {
    case 'buttonRecord': {
      if (edit.flags !== undefined) {
        image.setU32(edit.offset, edit.flags);
      }
      if (edit.character !== undefined) {
        image.setU32(edit.offset + 4, edit.character);
      }
      if (edit.depth !== undefined) {
        image.setI32(edit.offset + 8, edit.depth);
      }
      edit.matrix?.forEach((value, index) =>
        image.setF32(edit.offset + 12 + index * 4, value),
      );

      if (edit.translate) {
        image.setF32(edit.offset + 28, edit.translate[0]);
        image.setF32(edit.offset + 32, edit.translate[1]);
      }
      edit.color?.forEach((value, index) =>
        image.setF32(edit.offset + 36 + index * 4, value),
      );
      edit.unknown?.forEach((value, index) =>
        image.setF32(edit.offset + 52 + index * 4, value),
      );

      return {};
    }
    case 'addButtonRecord':
    case 'moveButtonRecord':
    case 'removeButtonRecord': {
      const button = movie.characters[edit.id];

      if (button?.type !== 'button') {
        throw new Error(`#${edit.id} is not a button`);
      }

      const f = (value: number) =>
        new Uint32Array(new Float32Array([value]).buffer)[0];

      // 68 bytes: flags, character, depth, matrix, translate, then a colour
      // (multiplied, so white) and a vector OpenSAGE reads as unknown
      editRecords(
        image,
        button.offset + 44,
        button.offset + 48,
        17,
        edit.kind === 'addButtonRecord'
          ? {
              add: [
                edit.flags,
                edit.character,
                edit.depth,
                ...(edit.matrix ?? [1, 0, 0, 1]).map(f),
                ...(edit.translate ?? [0, 0]).map(f),
                ...(edit.color ?? [1, 1, 1, 1]).map(f),
                ...(edit.unknown ?? [0, 0, 0, 0]).map(f),
              ],
            }
          : edit.kind === 'moveButtonRecord'
            ? { index: edit.from, moveTo: edit.to }
            : { index: edit.index, remove: true },
      );
      return {};
    }
    case 'addButtonAction':
    case 'buttonAction':
    case 'removeButtonAction': {
      const button = movie.characters[edit.id];

      if (button?.type !== 'button') {
        throw new Error(`#${edit.id} is not a button`);
      }
      editRecords(
        image,
        button.offset + 52,
        button.offset + 56,
        2,
        edit.kind === 'addButtonAction'
          ? { add: [edit.condition, edit.block] }
          : edit.kind === 'buttonAction'
            ? { index: edit.index, set: [edit.condition] }
            : { index: edit.index, remove: true },
      );
      return {};
    }
  }
};
