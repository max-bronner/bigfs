import { parseAptMovie } from '../../formats/apt/aptMovie';
import { applyAptEdit } from '../../formats/apt/writer/applyAptEdit';
import type { AptEdit, EditResult } from '../../formats/apt/writer/aptEdit';
import { addBlock, replaceBlock } from '../../formats/apt/aptScript';
import { findReferencesTo } from '../../formats/apt/aptManage';
import {
  getTexturePath,
  parseDat,
  writeDat,
} from '../../formats/apt/aptGeometry';
import type { DatLocation } from '../../formats/apt/aptGeometry';
import type { FromPage } from '../../webview/apt/protocol';
import { decodeWindows1252 } from '../../core/windows1252';
import type { AptDocument } from './aptDocument';

/** Where the page asks a new script to be attached */
export type ScriptSite = Extract<FromPage, { kind: 'addScript' }>['to'];

/**
 * Runs a change to a document as one undoable step, and redraws. A change
 * that throws leaves the document as it was.
 */
export type RecordChange = <T>(
  document: AptDocument,
  label: string,
  change: () => Promise<T>,
) => Promise<T>;

/** Applies an edit; duplicating a shape also copies its geometry file */
const applyEdit = async (
  document: AptDocument,
  edit: AptEdit,
): Promise<EditResult> => {
  const before = document.snapshot();
  const source =
    edit.kind === 'duplicateCharacter'
      ? parseAptMovie(before.apt, document.constFile.movieOffset).characters[
          edit.id
        ]
      : undefined;
  const result = applyAptEdit(
    document.image,
    document.constFile.movieOffset,
    edit,
  );

  if (
    edit.kind === 'addCharacter' &&
    edit.type === 'shape' &&
    result.character !== undefined
  ) {
    document.files.set(
      `${document.name}_geometry/${result.character}.ru`,
      new TextEncoder().encode(
        'c\ns s:255:255:255:255\nt 0:0:100:0:0:100\nt 100:0:100:100:0:100\n',
      ),
    );
  }

  if (source?.type === 'shape' && result.character !== undefined) {
    const geometry = await document.readBeside(
      `${document.name}_geometry/${source.geometry}.ru`,
    );

    if (geometry) {
      document.files.set(
        `${document.name}_geometry/${result.character}.ru`,
        geometry,
      );
    }
  }

  return result;
};

/**
 * Applies an edit the page sent as one undoable step. Duplicating a shape
 * also copies its geometry file under the new id.
 */
export const editDocument = (
  record: RecordChange,
  document: AptDocument,
  edit: AptEdit,
): Promise<EditResult> =>
  record(document, edit.kind, () => applyEdit(document, edit));

/**
 * Compiles a script over the block at `block`. The old code stays where it
 * is, unreferenced; an undo points back at it.
 */
export const editScript = (
  record: RecordChange,
  document: AptDocument,
  block: number,
  text: string,
): Promise<number> =>
  record(document, 'script', async () => {
    const { start, added } = replaceBlock(
      document.image,
      document.constFile.movieOffset,
      block,
      text,
      document.constFile.items,
    );

    document.addConstItems(added);

    return start;
  });

/**
 * Compiles an empty script and attaches it where the page asked: a frame
 * of a timeline, a button condition or clip events of a placement
 */
export const addScript = (
  record: RecordChange,
  document: AptDocument,
  site: ScriptSite,
): Promise<number> =>
  record(document, 'add script', async () => {
    const { start, added } = addBlock(
      document.image,
      '',
      document.constFile.items,
    );
    const edit: AptEdit =
      site.kind === 'frame'
        ? {
            kind: 'addFrameScript',
            timeline: site.timeline,
            frame: site.frame,
            block: start,
          }
        : site.kind === 'button'
          ? {
              kind: 'addButtonAction',
              id: site.id,
              condition: site.condition,
              block: start,
            }
          : {
              kind: 'addClipAction',
              offset: site.offset,
              events: site.events,
              block: start,
            };

    applyAptEdit(document.image, document.constFile.movieOffset, edit);
    document.addConstItems(added);
    return start;
  });

/**
 * Removes a character nothing refers to, with the files that are only
 * its own: a shape's geometry, an image's `.dat` line and its texture
 * when no other image uses that file.
 * @throws when something still refers to the character
 */
export const removeCharacter = async (
  record: RecordChange,
  document: AptDocument,
  id: number,
): Promise<void> => {
  const { movie } = await document.build();
  const references = findReferencesTo(
    movie,
    movie.spriteFrames,
    movie.shapes,
    id,
  );
  const character = movie.characters[id];

  if (references.length) {
    throw new Error(
      `#${id} is still used: ${references.slice(0, 5).join('; ')}${references.length > 5 ? '…' : ''}`,
    );
  }

  await record(document, 'remove character', async () => {
    applyAptEdit(document.image, document.constFile.movieOffset, {
      kind: 'removeCharacter',
      id,
    });

    if (character?.type === 'shape') {
      document.files.set(
        `${document.name}_geometry/${character.geometry}.ru`,
        new Uint8Array(),
      );
    } else if (character?.type === 'image') {
      const datName = `${document.name}.dat`;
      const datBytes = await document.readBeside(datName);
      const dat = datBytes
        ? parseDat(decodeWindows1252(datBytes))
        : new Map<number, DatLocation>();
      const location = dat.get(character.texture);
      const stillUsed = movie.characters.some(
        (other) =>
          other.type === 'image' &&
          other.id !== id &&
          other.texture === character.texture,
      );

      if (location && !stillUsed) {
        const path = getTexturePath(
          document.name,
          character.texture,
          location,
        );
        const shared = [...dat].some(
          ([other, place]) =>
            other !== character.texture &&
            getTexturePath(document.name, other, place) === path,
        );

        dat.delete(character.texture);
        document.files.set(
          datName,
          Uint8Array.from(writeDat(dat), (c) => c.charCodeAt(0)),
        );
        // An atlas page other images share stays
        if (!shared) {
          document.files.set(path, new Uint8Array());
        }
      }
    }
  });
};
