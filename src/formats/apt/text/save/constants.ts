import type { ConstItem } from '../../aptMovie';
import type { MovieText } from '../textModel';
import type { SaveSession } from './saveSession';
import { TextSaveError } from './textSaveError';

/** Writes the `.const` items the text changed, and appends the ones it adds */
export const saveConstants = (
  session: SaveSession,
  before: MovieText,
  after: MovieText,
): void => {
  if (after.constants.length < before.constants.length) {
    throw new TextSaveError(
      'Constants cannot be removed: scripts name them by number',
      after.constants.at(-1)?.line ?? 0,
    );
  }

  after.constants.forEach((item, index) => {
    const was = before.constants[index];

    if (was && was.value !== item.value) {
      const change = { index, value: item.value };

      session.changeConstant(change);
    }
  });
  session.addConstants(
    after.constants
      .slice(before.constants.length)
      .map(
        (item): ConstItem =>
          typeof item.value === 'string'
            ? { kind: 'string', value: item.value, offset: 0 }
            : { kind: 'number', value: item.value },
      ),
  );
};
