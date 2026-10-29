import type { AptMovie } from '../aptMovie';
import type { AptEdit, EditResult } from './aptEdit';
import { AptImage } from './aptImage';

/** An edit to the movie's import or export table */
export type ImportExportEdit = Extract<
  AptEdit,
  {
    kind:
      | 'export'
      | 'addExport'
      | 'removeExport'
      | 'import'
      | 'addImport'
      | 'removeImport';
  }
>;

/** Applies an edit to the movie's import or export table */
export const applyImportExportEdit = (
  image: AptImage,
  movie: AptMovie,
  edit: ImportExportEdit,
): EditResult => {
  const record = movie.record;

  switch (edit.kind) {
    case 'export': {
      const at = record.exportsOffset + edit.index * 8;

      if (edit.index < 0 || edit.index >= record.exportCount) {
        throw new Error(`No export ${edit.index}`);
      }

      if (edit.name !== undefined) {
        image.setU32(at, image.appendString(edit.name));
      }
      if (edit.character !== undefined) {
        image.setU32(at + 4, edit.character);
      }
      return {};
    }
    case 'addExport': {
      const array = image.appendWords(
        Array.from({ length: record.exportCount * 2 }, (_, index) =>
          image.u32(record.exportsOffset + index * 4),
        ).concat([image.appendString(edit.name), edit.character]),
      );

      image.setU32(record.offset + 52, array);
      image.setU32(record.offset + 48, record.exportCount + 1);
      return {};
    }
    case 'removeExport': {
      if (edit.index < 0 || edit.index >= record.exportCount) {
        throw new Error(`No export ${edit.index}`);
      }

      // Shifted down in place; the array only shrinks
      for (let index = edit.index; index < record.exportCount - 1; index++) {
        const at = record.exportsOffset + index * 8;

        image.setU32(at, image.u32(at + 8));
        image.setU32(at + 4, image.u32(at + 12));
      }

      image.setU32(record.offset + 48, record.exportCount - 1);
      return {};
    }
    case 'import': {
      const at = record.importsOffset + edit.index * 16;

      if (edit.index < 0 || edit.index >= record.importCount) {
        throw new Error(`No import ${edit.index}`);
      }

      if (edit.movie !== undefined) {
        image.setU32(at, image.appendString(edit.movie));
      }
      if (edit.name !== undefined) {
        image.setU32(at + 4, image.appendString(edit.name));
      }
      if (edit.character !== undefined) {
        image.setU32(at + 8, edit.character);
      }
      return {};
    }
    case 'addImport': {
      // The import takes a new character id, whose slot names no record
      const id = record.characterCount;
      const characters = image.growArray(record.offset + 24, id, 1);
      const imports = image.growArray(
        record.offset + 44,
        record.importCount * 4,
        4,
      );
      const at = imports + record.importCount * 16;

      image.setU32(characters + id * 4, 0);
      image.setU32(record.offset + 20, id + 1);
      image.setU32(at, image.appendString(edit.movie));
      image.setU32(at + 4, image.appendString(edit.name));
      image.setU32(at + 8, id);
      image.setU32(record.offset + 40, record.importCount + 1);
      return { character: id };
    }
    case 'removeImport': {
      if (edit.index < 0 || edit.index >= record.importCount) {
        throw new Error(`No import ${edit.index}`);
      }

      // Shifted down in place; the character slot stays, naming nothing
      for (let index = edit.index; index < record.importCount - 1; index++) {
        const at = record.importsOffset + index * 16;

        for (let word = 0; word < 16; word += 4) {
          image.setU32(at + word, image.u32(at + 16 + word));
        }
      }

      image.setU32(record.offset + 40, record.importCount - 1);
      return {};
    }
  }
};
