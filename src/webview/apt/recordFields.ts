import type {
  ButtonRecord,
  Character,
  FrameItem,
  TextRecord,
} from '../../formats/apt/aptMovie';
import { PLACE_FLAGS } from '../../formats/apt/aptMovie';
import type {
  AptEdit,
  PlacementChange,
  PlacementField,
  TextRecordChange,
} from '../../formats/apt/aptWriter';
import { describe, send } from './details';
import { button, heading, input, row } from './dom';
import { BUTTON_CONDITIONS, CLIP_EVENTS, bitNames } from './scriptSites';
import { movie } from './state';

/**
 * Controls for every field of the records a movie stores: placements, the
 * other frame items, button records and text runs. Each field commits one
 * edit of its own, so an undo takes back exactly that field.
 */

/** The state bits of a button record, as `Flags.hpp` names them */
export const BUTTON_STATES: [string, number][] = [
  ['up', 0x1],
  ['over', 0x2],
  ['down', 0x4],
  ['hit test', 0x8],
];

/** The bits of a PlaceObject's flags, in bit order */
const PLACE_FLAG_NAMES: [string, number][] = [
  ['move', PLACE_FLAGS.move],
  ['character', PLACE_FLAGS.hasCharacter],
  ['matrix', PLACE_FLAGS.hasMatrix],
  ['colour', PLACE_FLAGS.hasColorTransform],
  ['ratio', PLACE_FLAGS.hasRatio],
  ['name', PLACE_FLAGS.hasName],
  ['clip depth', PLACE_FLAGS.hasClipDepth],
  ['clip actions', PLACE_FLAGS.hasClipActions],
];

/** Bit positions of a colour word's channels R, G, B, A */
const MULTIPLY_SHIFTS = [0, 8, 16, 24];
/** The add term is 0x00RRGGBB by value; its top byte is kept as A */
const ADD_SHIFTS = [16, 8, 0, 24];

const short = <T extends HTMLElement>(element: T, title: string): T => {
  element.classList.add('short');
  element.title = title;
  return element;
};

/** A select of every character of the movie, for a field that names one */
export const characterPicker = (
  chosen: number | undefined,
  onCommit: (id: number) => void,
): HTMLSelectElement => {
  const element = document.createElement('select');
  const characters = movie().characters;

  if (chosen === undefined || !characters[chosen]) {
    element.add(
      new Option(chosen === undefined ? '—' : `#${chosen} (none)`, '', true),
    );
  }
  for (const character of characters) {
    element.add(
      new Option(
        describe(character),
        String(character.id),
        false,
        character.id === chosen,
      ),
    );
  }
  element.onchange = () => {
    if (element.value !== '') {
      onCommit(Number(element.value));
    }
  };
  return element;
};

/** One checkbox per named bit of a word; a change commits the whole word */
export const bitChecks = (
  names: [string, number][],
  value: number,
  onCommit: (value: number) => void,
  isLocked: (bit: number) => boolean = () => false,
): HTMLSpanElement => {
  const element = document.createElement('span');
  let word = value >>> 0;

  element.title = bitNames(value, names);
  for (const [name, bit] of names) {
    const label = document.createElement('label');
    const box = document.createElement('input');

    box.type = 'checkbox';
    box.checked = (word & bit) !== 0;
    box.disabled = isLocked(bit);
    box.onchange = () => {
      word = (box.checked ? word | bit : word & ~bit) >>> 0;
      onCommit(word);
    };
    label.className = 'bit';
    label.append(box, ` ${name}`);
    element.append(label);
  }
  return element;
};

/** Byte inputs, 0 to 255, for the channels of a packed colour word */
const channelInputs = (
  word: number,
  shifts: number[],
  onCommit: (word: number) => void,
): HTMLInputElement[] => {
  let value = word >>> 0;

  return shifts.map((shift, index) =>
    short(
      input((value >>> shift) & 255, (next) => {
        const byte = Math.max(0, Math.min(255, Math.round(next)));

        value = ((value & ~(255 << shift)) | (byte << shift)) >>> 0;
        onCommit(value);
      }),
      'RGBA'[index] + ' 0-255',
    ),
  );
};

/**
 * The multiply and add terms of a colour transform, a byte input per
 * channel R, G, B, A and the whole word as hex
 */
export const colourRows = (
  multiply: number,
  add: number,
  onChange: (change: PlacementChange) => void,
): HTMLElement[] => [
  row(
    'Multiply',
    ...channelInputs(multiply, MULTIPLY_SHIFTS, (colorTransform) =>
      onChange({ colorTransform }),
    ),
    input(multiply, (colorTransform) => onChange({ colorTransform }), 'hex'),
  ),
  row(
    'Add',
    ...channelInputs(add, ADD_SHIFTS, (colorAdd) => onChange({ colorAdd })),
    input(add, (colorAdd) => onChange({ colorAdd }), 'hex'),
  ),
];

/** Number inputs for a tuple, each committing the whole tuple */
export const numberInputs = <T extends number[]>(
  values: T,
  names: string[],
  onCommit: (values: T) => void,
): HTMLInputElement[] => {
  const current = [...values] as T;

  return current.map((value, index) =>
    short(
      input(value, (next) => {
        current[index] = next;
        onCommit([...current] as T);
      }),
      names[index],
    ),
  );
};

/** Reads `index:advance` pairs or plain ids, comma separated */
const parseList = (text: string): number[][] =>
  text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.split(':').map(Number));

/** A line input for a list of numbers, refusing one that is not */
export const listInput = (
  text: string,
  width: number,
  onCommit: (values: number[][]) => void,
): HTMLInputElement => {
  const element = input(
    text,
    (value) => {
      const values = parseList(value);

      if (
        values.some(
          (each) =>
            each.length !== width ||
            each.some((part) => !Number.isInteger(part)),
        )
      ) {
        element.classList.add('invalid');
        return;
      }
      onCommit(values);
    },
    'line',
  ) as HTMLInputElement;

  return element;
};

/** The value a field takes when its flag is turned on without one */
const turnedOn = (
  item: Extract<FrameItem, { type: 'placeObject' }>,
  bit: number,
): PlacementChange => {
  switch (bit) {
    case PLACE_FLAGS.hasCharacter:
      return { character: item.character ?? 1 };
    case PLACE_FLAGS.hasMatrix:
      return { matrix: item.matrix ?? [1, 0, 0, 1], translate: item.translate };
    case PLACE_FLAGS.hasColorTransform:
      return { colorTransform: item.colorTransform ?? 0xffffffff };
    case PLACE_FLAGS.hasRatio:
      return { ratio: item.ratio ?? 0 };
    case PLACE_FLAGS.hasClipDepth:
      return { clipDepth: item.clipDepth ?? item.depth };
    default:
      return {};
  }
};

const FLAG_FIELDS: [number, PlacementField][] = [
  [PLACE_FLAGS.hasCharacter, 'character'],
  [PLACE_FLAGS.hasMatrix, 'matrix'],
  [PLACE_FLAGS.hasColorTransform, 'colorTransform'],
  [PLACE_FLAGS.hasRatio, 'ratio'],
  [PLACE_FLAGS.hasName, 'name'],
  [PLACE_FLAGS.hasClipDepth, 'clipDepth'],
];

/**
 * Every field of a PlaceObject: its flags, depth, character, matrix, the
 * multiply and add colour, ratio, name, clip depth and the clip events of
 * each clip action. A field whose flag is off shows what the record would
 * get and setting it turns the flag on.
 */
export const placementFields = (
  item: Extract<FrameItem, { type: 'placeObject' }>,
  remove?: HTMLElement,
): HTMLElement[] => {
  const placement = (change: PlacementChange) =>
    send({ kind: 'placement', offset: item.offset, change });
  const flagChange = (word: number) => {
    const changed = (word ^ item.flags) >>> 0;
    const change: PlacementChange = {};

    if (changed & PLACE_FLAGS.move) {
      change.isMove = (word & PLACE_FLAGS.move) !== 0;
    }
    for (const [bit, field] of FLAG_FIELDS) {
      if (changed & bit) {
        if (word & bit) {
          Object.assign(change, turnedOn(item, bit));
        } else {
          change.clear = [...(change.clear ?? []), field];
        }
      }
    }
    placement(change);
  };
  const multiply = item.colorTransform ?? 0xffffffff;
  const add = item.colorAdd ?? 0;

  return [
    heading(`Place @${item.depth} · 0x${item.offset.toString(16)}`),
    row(
      'Flags',
      bitChecks(PLACE_FLAG_NAMES, item.flags, flagChange, (bit) =>
        // Clip actions come and go with their handlers; a name needs a name
        [PLACE_FLAGS.hasClipActions, PLACE_FLAGS.hasName].includes(bit),
      ),
      ...(remove ? [remove] : []),
    ),
    row(
      'Depth',
      input(item.depth, (depth) => placement({ depth })),
    ),
    row(
      'Character',
      characterPicker(item.character, (character) => placement({ character })),
    ),
    row(
      'Matrix',
      ...numberInputs(
        [...(item.matrix ?? [1, 0, 0, 1]), ...(item.translate ?? [0, 0])],
        ['a', 'b', 'c', 'd', 'x', 'y'],
        (values) =>
          placement({
            matrix: [values[0], values[1], values[2], values[3]],
            translate: [values[4], values[5]],
          }),
      ),
    ),
    ...colourRows(multiply, add, placement),
    row(
      'Ratio',
      input(item.ratio ?? 0, (ratio) => placement({ ratio })),
    ),
    row(
      'Name',
      input(item.name ?? '', (name) => placement({ name }), 'line'),
    ),
    row(
      'Clip depth',
      input(item.clipDepth ?? 0, (clipDepth) => placement({ clipDepth })),
    ),
    ...(item.clipActions ?? []).map((clip, index) =>
      row(
        `Clip action ${index}`,
        bitChecks(CLIP_EVENTS, clip.events, (events) =>
          send({ kind: 'clipAction', offset: item.offset, index, events }),
        ),
      ),
    ),
  ];
};

/** The fields of a frame item that is not a placement, or nothing for an action */
export const frameItemFields = (
  item: FrameItem,
  remove: HTMLElement,
): HTMLElement[] => {
  switch (item.type) {
    case 'placeObject':
      return placementFields(item, remove);
    case 'frameLabel':
      return [
        row(
          'Label',
          input(
            item.label,
            (label) => send({ kind: 'frameLabel', offset: item.offset, label }),
            'line',
          ),
          short(
            input(item.flags, (flags) =>
              send({ kind: 'frameLabel', offset: item.offset, flags }),
            ),
            'flags',
          ),
          short(
            input(item.frame, (frame) =>
              send({ kind: 'frameLabel', offset: item.offset, frame }),
            ),
            'frame the label names',
          ),
          remove,
        ),
      ];
    case 'removeObject':
      return [
        row(
          'Remove @',
          input(item.depth, (depth) =>
            send({ kind: 'removeObjectDepth', offset: item.offset, depth }),
          ),
          remove,
        ),
      ];
    case 'backgroundColor':
      return [
        row(
          'Background',
          input(
            item.color,
            (color) =>
              send({ kind: 'backgroundColor', offset: item.offset, color }),
            'hex',
          ),
          remove,
        ),
      ];
    case 'initAction':
      return [
        row(
          'Init action',
          characterPicker(item.sprite, (sprite) =>
            send({ kind: 'initAction', offset: item.offset, sprite }),
          ),
          remove,
        ),
      ];
    default:
      return [];
  }
};

/** Every field of a button record: states, character, depth, matrix, colour and the unknown floats */
export const buttonRecordFields = (
  id: number,
  record: ButtonRecord,
  index: number,
): HTMLElement[] => {
  const write = (
    change: Omit<Extract<AptEdit, { kind: 'buttonRecord' }>, 'kind' | 'offset'>,
  ) => send({ kind: 'buttonRecord', offset: record.offset, ...change });

  return [
    row(
      `Record ${index}`,
      bitChecks(BUTTON_STATES, record.flags, (flags) => write({ flags })),
      button('×', () => send({ kind: 'removeButtonRecord', id, index })),
    ),
    row(
      '',
      characterPicker(record.character, (character) => write({ character })),
      short(
        input(record.depth, (depth) => write({ depth })),
        'depth',
      ),
    ),
    row(
      'Matrix',
      ...numberInputs(
        [...record.matrix, ...record.translate],
        ['a', 'b', 'c', 'd', 'x', 'y'],
        (values) =>
          write({
            matrix: [values[0], values[1], values[2], values[3]],
            translate: [values[4], values[5]],
          }),
      ),
    ),
    row(
      'Colour',
      ...numberInputs(record.color, ['R', 'G', 'B', 'A'], (color) =>
        write({ color }),
      ),
    ),
    row(
      'Unknown',
      ...numberInputs(record.unknown, ['+52', '+56', '+60', '+64'], (unknown) =>
        write({ unknown }),
      ),
    ),
  ];
};

/** Every field of one run of a Text character */
export const textRecordFields = (
  character: Extract<Character, { type: 'text' }>,
  record: TextRecord,
  index: number,
): HTMLElement[] => {
  const write = (change: TextRecordChange) =>
    send({ kind: 'textRecord', id: character.id, index, change });

  return [
    row(
      `Run ${index}`,
      characterPicker(record.font, (font) => write({ font })),
      button('×', () =>
        send({ kind: 'removeTextRecord', id: character.id, index }),
      ),
    ),
    row(
      'Colour',
      ...numberInputs(record.color, ['R', 'G', 'B', 'A'], (color) =>
        write({ color }),
      ),
    ),
    row(
      'Pen',
      ...numberInputs(record.penOffset, ['x', 'y'], (penOffset) =>
        write({ penOffset }),
      ),
      short(
        input(record.textHeight, (textHeight) => write({ textHeight })),
        'text height',
      ),
    ),
    row(
      'Unknown',
      ...numberInputs(record.unknown, ['+20', '+24', '+28', '+32'], (unknown) =>
        write({ unknown }),
      ),
    ),
    row(
      'Glyphs',
      listInput(
        record.glyphs
          .map((glyph) => `${glyph.index}:${glyph.advance}`)
          .join(', '),
        2,
        (pairs) =>
          write({
            glyphs: pairs.map(([glyph, advance]) => ({
              index: glyph,
              advance,
            })),
          }),
      ),
    ),
  ];
};

/** The conditions of a button action, as checkboxes */
export const buttonConditionChecks = (
  id: number,
  index: number,
  condition: number,
): HTMLSpanElement =>
  bitChecks(BUTTON_CONDITIONS, condition, (value) =>
    send({ kind: 'buttonAction', id, index, condition: value }),
  );
