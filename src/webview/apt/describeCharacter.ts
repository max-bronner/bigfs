import type { Character } from '../../formats/apt/aptMovie';
import { movie } from './state';
import { resolve } from './resolve';

/** Each character type's name as the page shows it */
export const TYPE_NAMES: Record<Character['type'], string> = {
  movie: 'Movie',
  shape: 'Shape',
  editText: 'EditText',
  font: 'Font',
  button: 'Button',
  sprite: 'Sprite',
  image: 'Image',
  morph: 'Morph',
  text: 'Text',
  placeholder: 'Import',
  unknown: 'Unknown',
};

/** A character's label in the list: its id, type and any export or import name */
export const describeCharacter = (character: Character): string => {
  const source = movie();
  const exported = source.exports
    .filter((each) => each.character === character.id)
    .map((each) => each.name);
  const imported = source.imports.find(
    (each) => each.character === character.id,
  );
  const extra = exported.length
    ? exported.join(', ')
    : imported
      ? imported.movie +
        ':' +
        imported.name +
        (resolve(source, character.id) ? '' : ' (unresolved)')
      : character.type === 'editText'
        ? (character.variable ?? character.text ?? '')
        : '';

  return (
    '#' +
    character.id +
    ' ' +
    TYPE_NAMES[character.type] +
    (extra ? ' · ' + extra : '')
  );
};
