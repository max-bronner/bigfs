import type { CharacterChange } from '../../writer/aptEdit';
import type {
  ButtonActionText,
  ButtonRecordText,
  CharacterText,
  MovieText,
  TextRunText,
} from '../textModel';
import { alignLists, checkAppended, printItem } from './alignLists';
import { sameFloat, sameFloats } from './sameFloats';
import type { SaveSession } from './saveSession';
import { TextSaveError } from './textSaveError';

/** Writes the characters the text changed or added, field by field, with the records they hold */
export const saveCharacters = (
  session: SaveSession,
  after: MovieText,
): void => {
  const current = session.current();

  if (after.characters.length < current.characters.length) {
    throw new TextSaveError(
      `Characters cannot be taken out of the list, ids would change; write character ${after.characters.length} placeholder to empty a slot`,
      after.characters.at(-1)?.endLine ?? 0,
    );
  }

  for (const next of after.characters) {
    let was: CharacterText | undefined = current.characters[next.id];

    if (!was) {
      if (
        next.type !== 'editText' &&
        next.type !== 'sprite' &&
        next.type !== 'shape' &&
        next.type !== 'image' &&
        next.type !== 'button'
      ) {
        throw new TextSaveError(
          `A new character is an edittext, sprite, shape, image or button; a ${next.type} cannot be added`,
          next.line,
        );
      }

      const { character } = session.apply({
        kind: 'addCharacter',
        type: next.type,
      });

      if (character !== next.id) {
        throw new TextSaveError(
          `The new character took id ${character}, not ${next.id}`,
          next.line,
        );
      }
      was = session.current().characters[next.id];
    }

    if (next.type === 'placeholder' && was.type !== 'placeholder') {
      session.apply({ kind: 'removeCharacter', id: next.id });
      continue;
    }
    if (was.type !== next.type) {
      throw new TextSaveError(
        `Character ${next.id} is a ${was.type}; a character's type cannot change`,
        next.line,
      );
    }
    saveCharacter(session, was, next);
  }
};

const changeCharacter = (
  session: SaveSession,
  id: number,
  change: CharacterChange,
): void => {
  session.apply({ kind: 'character', id, change });
};

const saveCharacter = (
  session: SaveSession,
  was: CharacterText,
  next: CharacterText,
): void => {
  const line = next.line ?? 0;
  const id = next.id;
  const field = (
    before: unknown,
    after: unknown,
    change: () => CharacterChange,
  ) => {
    const differs =
      typeof before === 'number' && typeof after === 'number'
        ? !sameFloat(before, after)
        : Array.isArray(before) && Array.isArray(after)
          ? !sameFloats(before as number[], after as number[])
          : before !== after;

    if (differs) {
      changeCharacter(session, id, change());
    }
  };

  switch (next.type) {
    case 'movie': {
      if (was.type !== 'movie') {
        return;
      }
      if (next.screen && was.screen) {
        if (
          next.screen.width !== was.screen.width ||
          next.screen.height !== was.screen.height
        ) {
          session.apply({
            kind: 'screen',
            width: next.screen.width,
            height: next.screen.height,
          });
        }
        if (next.screen.unknown36 !== was.screen.unknown36) {
          session.apply({
            kind: 'movieUnknown36',
            value: next.screen.unknown36,
          });
        }
      } else if (Boolean(next.screen) !== Boolean(was.screen)) {
        throw new TextSaveError(
          'Only character 0 carries screen= and unknown36=',
          line,
        );
      }
      return;
    }
    case 'shape':
      if (was.type === 'shape') {
        field(was.bounds, next.bounds, () => ({
          field: 'bounds',
          value: next.bounds,
        }));
        field(was.geometry, next.geometry, () => ({
          field: 'geometry',
          value: next.geometry,
        }));
      }
      return;
    case 'editText':
      if (was.type === 'editText') {
        field(was.bounds, next.bounds, () => ({
          field: 'bounds',
          value: next.bounds,
        }));
        for (const key of [
          'font',
          'alignment',
          'color',
          'fontHeight',
          'readonly',
          'multiline',
          'wordwrap',
        ] as const) {
          field(was[key], next[key], () => ({
            field: key,
            value: next[key],
          }));
        }
        for (const key of ['text', 'variable'] as const) {
          field(was[key], next[key], () => ({
            field: key,
            value: next[key],
          }));
        }
      }
      return;
    case 'font':
      if (was.type === 'font') {
        field(was.name, next.name, () => ({
          field: 'fontName',
          value: next.name,
        }));
        if (was.glyphs.join() !== next.glyphs.join()) {
          changeCharacter(session, id, { field: 'glyphs', value: next.glyphs });
        }
      }
      return;
    case 'image':
      if (was.type === 'image') {
        field(was.texture, next.texture, () => ({
          field: 'texture',
          value: next.texture,
        }));
      }
      return;
    case 'morph':
      if (was.type === 'morph') {
        field(was.startShape, next.startShape, () => ({
          field: 'startShape',
          value: next.startShape,
        }));
        field(was.endShape, next.endShape, () => ({
          field: 'endShape',
          value: next.endShape,
        }));
      }
      return;
    case 'text':
      if (was.type === 'text') {
        field(was.bounds, next.bounds, () => ({
          field: 'bounds',
          value: next.bounds,
        }));
        field(was.placement.matrix, next.placement.matrix, () => ({
          field: 'matrix',
          value: next.placement.matrix,
        }));
        field(was.placement.translate, next.placement.translate, () => ({
          field: 'translate',
          value: next.placement.translate,
        }));
        saveRuns(session, id, was.runs, next.runs);
      }
      return;
    case 'button':
      if (was.type === 'button') {
        field(was.bounds, next.bounds, () => ({
          field: 'bounds',
          value: next.bounds,
        }));
        if (was.hitTriangles !== next.hitTriangles) {
          throw new TextSaveError(
            'hit-triangles counts the hit mesh, which the text does not hold; it cannot change',
            line,
          );
        }
        saveButtonRecords(session, id, was.records, next.records);
        saveButtonActions(session, id, was.actions, next.actions);
      }
      return;
    case 'unknown':
      if (was.type === 'unknown' && was.characterType !== next.characterType) {
        throw new TextSaveError('An unknown character keeps its type', line);
      }
      return;
    default:
      return;
  }
};

const saveRuns = (
  session: SaveSession,
  id: number,
  before: TextRunText[],
  after: TextRunText[],
): void => {
  const pairs = alignLists(before, after, (run) => printItem(run as never));

  checkAppended(pairs, after, 'run');
  pairs
    .filter(([, j]) => j === undefined)
    .map(([i]) => i!)
    .sort((a, b) => b - a)
    .forEach((index) => session.apply({ kind: 'removeTextRecord', id, index }));

  let index = 0;

  for (const [i, j] of pairs) {
    if (j === undefined) {
      continue;
    }

    const next = after[j];
    const was =
      i === undefined
        ? (session.apply({ kind: 'addTextRecord', id, font: next.font }),
          session.current().characters[id] as Extract<
            CharacterText,
            { type: 'text' }
          >).runs[index]
        : before[i];
    const change = {
      ...(was.font !== next.font ? { font: next.font } : {}),
      ...(!sameFloats(was.color, next.color) ? { color: next.color } : {}),
      ...(!sameFloats(was.unknown, next.unknown)
        ? { unknown: next.unknown }
        : {}),
      ...(!sameFloats(was.penOffset, next.penOffset)
        ? { penOffset: next.penOffset }
        : {}),
      ...(!sameFloat(was.textHeight, next.textHeight)
        ? { textHeight: next.textHeight }
        : {}),
      ...(JSON.stringify(was.glyphs) !== JSON.stringify(next.glyphs)
        ? { glyphs: next.glyphs }
        : {}),
    };

    if (Object.keys(change).length) {
      session.apply({ kind: 'textRecord', id, index, change });
    }
    index++;
  }
};

const saveButtonRecords = (
  session: SaveSession,
  id: number,
  before: ButtonRecordText[],
  after: ButtonRecordText[],
): void => {
  const pairs = alignLists(before, after, (record) =>
    printItem(record as never),
  );

  checkAppended(pairs, after, 'button record');
  pairs
    .filter(([, j]) => j === undefined)
    .map(([i]) => i!)
    .sort((a, b) => b - a)
    .forEach((index) =>
      session.apply({ kind: 'removeButtonRecord', id, index }),
    );

  let index = 0;

  for (const [i, j] of pairs) {
    if (j === undefined) {
      continue;
    }

    const next = after[j];
    let was: ButtonRecordText;

    if (i === undefined) {
      session.apply({
        kind: 'addButtonRecord',
        id,
        flags: next.flags,
        character: next.character,
        depth: next.depth,
        matrix: next.placement.matrix,
        translate: next.placement.translate,
      });
      was = (
        session.current().characters[id] as Extract<
          CharacterText,
          { type: 'button' }
        >
      ).records[index];
    } else {
      was = before[i];
    }

    const change = {
      ...(was.flags !== next.flags ? { flags: next.flags } : {}),
      ...(was.character !== next.character
        ? { character: next.character }
        : {}),
      ...(was.depth !== next.depth ? { depth: next.depth } : {}),
      ...(!sameFloats(was.placement.matrix, next.placement.matrix)
        ? { matrix: next.placement.matrix }
        : {}),
      ...(!sameFloats(was.placement.translate, next.placement.translate)
        ? { translate: next.placement.translate }
        : {}),
      ...(!sameFloats(was.color, next.color) ? { color: next.color } : {}),
      ...(!sameFloats(was.unknown, next.unknown)
        ? { unknown: next.unknown }
        : {}),
    };

    if (Object.keys(change).length) {
      session.apply({ kind: 'buttonRecord', offset: was.offset!, ...change });
    }
    index++;
  }
};

const saveButtonActions = (
  session: SaveSession,
  id: number,
  before: ButtonActionText[],
  after: ButtonActionText[],
): void => {
  const pairs = alignLists(before, after, (action) =>
    JSON.stringify([action.condition, action.script.text]),
  );

  checkAppended(pairs, after, 'button action');
  pairs
    .filter(([, j]) => j === undefined)
    .map(([i]) => i!)
    .sort((a, b) => b - a)
    .forEach((index) =>
      session.apply({ kind: 'removeButtonAction', id, index }),
    );

  let index = 0;

  for (const [i, j] of pairs) {
    if (j === undefined) {
      continue;
    }

    const next = after[j];

    if (i === undefined) {
      session.apply({
        kind: 'addButtonAction',
        id,
        condition: next.condition,
        block: session.compile(next.script, next.line ?? 0),
      });
    } else {
      const was = before[i];

      if (was.condition !== next.condition) {
        session.apply({
          kind: 'buttonAction',
          id,
          index,
          condition: next.condition,
        });
      }
      session.script(was.script, next.script);
    }
    index++;
  }
};
