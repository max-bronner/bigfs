import type { MovieText } from '../textModel';
import { alignLists, checkAppended } from './alignLists';
import type { SaveSession } from './saveSession';
import { TextSaveError } from './textSaveError';

/** Writes the imports the text changed, removed or added at the end */
export const saveImports = (
  session: SaveSession,
  before: MovieText,
  after: MovieText,
): void => {
  const pairs = alignLists(before.imports, after.imports, (entry) =>
    JSON.stringify([entry.character, entry.movie, entry.name]),
  );

  checkAppended(pairs, after.imports, 'import');
  pairs
    .filter(([, j]) => j === undefined)
    .map(([i]) => i!)
    .sort((a, b) => b - a)
    .forEach((index) => session.apply({ kind: 'removeImport', index }));

  let index = 0;

  for (const [i, j] of pairs) {
    if (j === undefined) {
      continue;
    }

    const next = after.imports[j];

    if (i === undefined) {
      const id = session.movie.record.characterCount;

      if (next.character !== id) {
        throw new TextSaveError(
          `A new import takes the next character id, ${id}; write import ${id} and add character ${id} placeholder`,
          next.line,
        );
      }
      session.apply({ kind: 'addImport', movie: next.movie, name: next.name });
    } else {
      const was = before.imports[i];

      if (
        was.movie !== next.movie ||
        was.name !== next.name ||
        was.character !== next.character
      ) {
        session.apply({
          kind: 'import',
          index,
          ...(was.movie !== next.movie ? { movie: next.movie } : {}),
          ...(was.name !== next.name ? { name: next.name } : {}),
          ...(was.character !== next.character
            ? { character: next.character }
            : {}),
        });
      }
    }
    index++;
  }
};

/** Writes the exports the text changed, removed or added at the end */
export const saveExports = (
  session: SaveSession,
  before: MovieText,
  after: MovieText,
): void => {
  const pairs = alignLists(before.exports, after.exports, (entry) =>
    JSON.stringify([entry.character, entry.name]),
  );

  checkAppended(pairs, after.exports, 'export');
  pairs
    .filter(([, j]) => j === undefined)
    .map(([i]) => i!)
    .sort((a, b) => b - a)
    .forEach((index) => session.apply({ kind: 'removeExport', index }));

  let index = 0;

  for (const [i, j] of pairs) {
    if (j === undefined) {
      continue;
    }

    const next = after.exports[j];

    if (i === undefined) {
      session.apply({
        kind: 'addExport',
        name: next.name,
        character: next.character,
      });
    } else {
      const was = before.exports[i];

      if (was.name !== next.name || was.character !== next.character) {
        session.apply({
          kind: 'export',
          index,
          ...(was.name !== next.name ? { name: next.name } : {}),
          ...(was.character !== next.character
            ? { character: next.character }
            : {}),
        });
      }
    }
    index++;
  }
};
