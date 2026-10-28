import type {
  ButtonRecord,
  Character,
  FrameItem,
} from '../../../formats/apt/aptMovie';
import { PLACE_FLAGS } from '../../../formats/apt/aptMovie';
import { CLIP_EVENTS, bitNames } from '../scriptSites';

/**
 * What the block editor knows without a DOM: how a record is named and
 * summarised in its header, which kinds of record may be added at a spot,
 * and the colour and ordering arithmetic its controls share.
 */

export type BlockKind =
  | 'movie'
  | 'shape'
  | 'editText'
  | 'font'
  | 'button'
  | 'sprite'
  | 'image'
  | 'morph'
  | 'text'
  | 'import'
  | 'frame'
  | 'placement'
  | 'frameLabel'
  | 'removeObject'
  | 'background'
  | 'initAction'
  | 'script'
  | 'buttonRecord'
  | 'buttonAction'
  | 'textRun'
  | 'export'
  | 'constant'
  | 'timeline'
  | 'instance';

/** The glyph in front of a block's title */
export const BLOCK_ICONS: Record<BlockKind, string> = {
  movie: '🎬',
  shape: '⬠',
  editText: 'T',
  font: 'Aa',
  button: '▣',
  sprite: '❖',
  image: '▨',
  morph: '⇄',
  text: '¶',
  import: '⇩',
  frame: '▮',
  placement: '⊕',
  frameLabel: '⚑',
  removeObject: '⊖',
  background: '◐',
  initAction: '⚙',
  script: '{ }',
  buttonRecord: '◧',
  buttonAction: '⚡',
  textRun: 'Tr',
  export: '⇧',
  constant: '#',
  timeline: '▤',
  instance: '◎',
};

/** Where a block can be added: the record kinds that fit there */
export type AddSpot = 'movie' | 'frame' | 'button' | 'text';

export interface AddChoice {
  /** A key the page maps to the edit that adds it */
  id: string;
  label: string;
  icon: string;
}

const CHOICES: Record<AddSpot, AddChoice[]> = {
  movie: [
    { id: 'editText', label: 'Text field', icon: BLOCK_ICONS.editText },
    { id: 'sprite', label: 'Sprite', icon: BLOCK_ICONS.sprite },
    { id: 'shape', label: 'Shape', icon: BLOCK_ICONS.shape },
    { id: 'image', label: 'Image', icon: BLOCK_ICONS.image },
    { id: 'button', label: 'Button', icon: BLOCK_ICONS.button },
    { id: 'export', label: 'Export', icon: BLOCK_ICONS.export },
    { id: 'import', label: 'Import', icon: BLOCK_ICONS.import },
  ],
  frame: [
    { id: 'placement', label: 'Placement', icon: BLOCK_ICONS.placement },
    { id: 'frameLabel', label: 'Frame label', icon: BLOCK_ICONS.frameLabel },
    { id: 'background', label: 'Background', icon: BLOCK_ICONS.background },
    { id: 'script', label: 'Frame script', icon: BLOCK_ICONS.script },
  ],
  button: [
    {
      id: 'buttonRecord',
      label: 'State record',
      icon: BLOCK_ICONS.buttonRecord,
    },
    { id: 'script', label: 'Button script', icon: BLOCK_ICONS.script },
  ],
  text: [{ id: 'textRun', label: 'Text run', icon: BLOCK_ICONS.textRun }],
};

/** The kinds of block that may be added at a spot, in menu order */
export const addChoices = (spot: AddSpot): AddChoice[] => CHOICES[spot];

/** The block kind of a character */
export const kindOfCharacter = (character: Character): BlockKind =>
  character.type === 'placeholder'
    ? 'import'
    : character.type === 'unknown'
      ? 'shape'
      : character.type;

/** The title of a frame item's block */
export const itemTitle = (item: FrameItem): string => {
  switch (item.type) {
    case 'placeObject':
      return `Place @${item.depth}`;
    case 'frameLabel':
      return 'Frame label';
    case 'removeObject':
      return `Remove @${item.depth}`;
    case 'backgroundColor':
      return 'Background';
    case 'action':
      return 'Frame script';
    case 'initAction':
      return `Init action #${item.sprite}`;
    default:
      return `Item type ${item.itemType}`;
  }
};

/** The block kind of a frame item */
export const itemKind = (item: FrameItem): BlockKind => {
  switch (item.type) {
    case 'placeObject':
      return 'placement';
    case 'frameLabel':
      return 'frameLabel';
    case 'removeObject':
      return 'removeObject';
    case 'backgroundColor':
      return 'background';
    case 'action':
      return 'script';
    case 'initAction':
      return 'initAction';
    default:
      return 'frame';
  }
};

/** One line saying what a frame item does, for its collapsed header */
export const itemSummary = (item: FrameItem): string => {
  switch (item.type) {
    case 'placeObject': {
      const parts: string[] = [];

      if (item.character !== undefined) {
        parts.push(`#${item.character}`);
      }
      if (item.name) {
        parts.push(`"${item.name}"`);
      }
      if (item.translate) {
        parts.push(`at ${item.translate[0]}, ${item.translate[1]}`);
      }
      if (item.flags & PLACE_FLAGS.move) {
        parts.push('move');
      }
      if (item.clipActions?.length) {
        parts.push(
          item.clipActions
            .map((clip) => bitNames(clip.events, CLIP_EVENTS))
            .join(', '),
        );
      }
      return parts.join(' · ');
    }
    case 'frameLabel':
      return `"${item.label}"`;
    case 'backgroundColor':
      return '0x' + (item.color >>> 0).toString(16).padStart(8, '0');
    case 'action':
      return '0x' + item.block.toString(16);
    default:
      return '';
  }
};

/** One line for a button record's header */
export const buttonRecordSummary = (record: ButtonRecord): string => {
  const states = (
    [
      ['up', 0x1],
      ['over', 0x2],
      ['down', 0x4],
      ['hit', 0x8],
    ] as [string, number][]
  )
    .filter(([, bit]) => record.flags & bit)
    .map(([name]) => name);

  return `#${record.character} @${record.depth} · ${states.join(' ') || 'no state'}`;
};

/** A new position for an item dragged or nudged from `from`, kept in `0..length-1` */
export const moveTarget = (length: number, from: number, to: number): number =>
  Math.max(0, Math.min(length - 1, to));

/** Floats `0..1` as bytes, rounded and clamped */
export const floatsToBytes = (
  color: readonly number[],
): [number, number, number, number] =>
  color.map((each) => Math.max(0, Math.min(255, Math.round(each * 255)))) as [
    number,
    number,
    number,
    number,
  ];

/** Bytes as floats `0..1` */
export const bytesToFloats = (
  bytes: readonly number[],
): [number, number, number, number] =>
  bytes.map((each) => Math.max(0, Math.min(255, each)) / 255) as [
    number,
    number,
    number,
    number,
  ];

/** `rgba(...)` for a swatch; alpha is a byte */
export const cssColour = (r: number, g: number, b: number, a = 255): string =>
  `rgba(${r}, ${g}, ${b}, ${Math.round((a / 255) * 100) / 100})`;

/** `#rrggbb` for a colour input */
export const hexColour = (r: number, g: number, b: number): string =>
  '#' + [r, g, b].map((each) => each.toString(16).padStart(2, '0')).join('');

/** The bytes of `#rrggbb`, or undefined when it is not that */
export const parseHexColour = (
  text: string,
): [number, number, number] | undefined => {
  const found = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(text.trim());

  return found
    ? [parseInt(found[1], 16), parseInt(found[2], 16), parseInt(found[3], 16)]
    : undefined;
};

/** Whether `text` matches a search typed into a picker, every word in any order */
export const matchesSearch = (text: string, query: string): boolean => {
  const haystack = text.toLowerCase();

  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
};
