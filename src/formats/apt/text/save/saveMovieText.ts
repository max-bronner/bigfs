import type { ConstItem } from '../../aptMovie';
import type { AptEdit, ConstItemChange } from '../../writer/aptEdit';
import type { MovieText } from '../textModel';
import { saveCharacters } from './characters';
import { saveConstants } from './constants';
import { saveExports, saveImports } from './importsAndExports';
import { createSaveSession } from './saveSession';
import { saveScripts } from './scripts';
import { saveTimelines, writeOrders } from './timelines';
import { checkSavedText } from './verification';

/**
 * Saves a movie's text: the differences between the movie as it stands and
 * the text as edited become the editor's own edits, `AptEdit`s through
 * `applyAptEdit` and scripts through the compiler, so a field that was not
 * edited is not written and a movie whose text did not change is not touched
 * at all.
 *
 * Lists are matched before they are compared. Entries that print alike are
 * the same entry; between them, entries of the same kind pair in order and
 * are edited field by field; what is left over is removed or added. Frame
 * items are written back in the order the text gives them, so moving a
 * line moves the record; other lists take additions at their end.
 *
 * Everything is applied to a copy, and the result is read back and printed:
 * a save is accepted only when that print equals the text, so the text
 * either becomes the movie exactly or the movie stays as it was.
 */

/** Result of `saveMovieText`: the new files and the edits that made them */
export interface TextSave {
  apt: Uint8Array;
  constBytes: Uint8Array;
  /** The movie edits applied, in order, with the blocks scripts were compiled to */
  edits: AptEdit[];
  constChanges: ConstItemChange[];
  /** `.const` items appended, by a new item in the text or a compiled script */
  constAdded: ConstItem[];
  /** Blocks whose script changed, and where the compiled script went */
  scripts: { block: number; start: number }[];
}

/**
 * Turns the text of a movie as edited into edits of the movie as it stands.
 * `before` is the model the text was made from.
 * @throws TextSaveError for a text that cannot be saved; nothing is changed then
 */
export const saveMovieText = (
  apt: Uint8Array,
  constBytes: Uint8Array,
  before: MovieText,
  after: MovieText,
): TextSave => {
  const session = createSaveSession(apt, constBytes, before);

  saveConstants(session, before, after);
  saveImports(session, before, after);
  saveCharacters(session, after);
  saveExports(session, session.current(), after);
  saveTimelines(session, after);
  saveScripts(session);
  writeOrders(session);
  checkSavedText(after, session.current());

  return {
    apt:
      session.edits.length || session.scripts.length
        ? session.image.bytes
        : apt,
    constBytes: session.constBytes,
    edits: session.edits,
    constChanges: session.constChanges,
    constAdded: session.constAdded,
    scripts: session.scripts,
  };
};
