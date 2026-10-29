import type { AptMovie } from '../aptMovie';
import type { AptEdit, EditResult } from './aptEdit';
import { AptImage } from './aptImage';
import { changeTextRecord } from './changeTextRecord';
import { editRecords } from './editRecords';

/** An edit to the runs of a Text character */
export type TextRecordEdit = Extract<
  AptEdit,
  { kind: 'textRecord' | 'addTextRecord' | 'removeTextRecord' }
>;

/** The bits of a float, as a word */
const f32Bits = (value: number): number =>
  new Uint32Array(new Float32Array([value]).buffer)[0];

/** Applies an edit to the runs of a Text character */
export const applyTextRecordEdit = (
  image: AptImage,
  movie: AptMovie,
  edit: TextRecordEdit,
): EditResult => {
  switch (edit.kind) {
    case 'textRecord':
    case 'addTextRecord':
    case 'removeTextRecord': {
      const text = movie.characters[edit.id];

      if (text?.type !== 'text') {
        throw new Error(`#${edit.id} is not a Text character`);
      }
      if (edit.kind === 'textRecord') {
        const record = text.records[edit.index];

        if (!record) {
          throw new Error(`#${edit.id} has no text record ${edit.index}`);
        }
        changeTextRecord(image, record.offset, edit.change);
        return {};
      }

      // 56 bytes: font, colour rect (white), unknown rect, pen offset,
      // height 16, no glyphs; the layout is mint's TextRecord
      editRecords(
        image,
        text.offset + 48,
        text.offset + 52,
        14,
        edit.kind === 'addTextRecord'
          ? {
              add: [
                edit.font,
                ...[1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 16].map(f32Bits),
                0,
                0,
              ],
            }
          : { index: edit.index, remove: true },
      );
      return {};
    }
  }
};
