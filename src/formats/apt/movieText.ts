import {
  PLACE_FLAGS,
  parseAptMovie,
  parseConst,
  parseFrames,
  AptReader,
} from './aptMovie';
import type {
  AptMovie,
  ButtonRecord,
  Character,
  ConstFile,
  Frame,
  FrameItem,
  Matrix2,
  Rect,
} from './aptMovie';

/**
 * The whole of a movie, its `.apt` and its `.const`, as indented text: one
 * record a line where a record fits on one, the records a block holds
 * indented under it, and every action block as its script in a fence. The
 * layout is `docs/apt-text-format.md`.
 *
 * Text and movie meet in `MovieText`, a model that keeps every field the
 * movie parser reads and nothing it derives. `movieToText` builds one from
 * the files, `printMovieText` writes it, and `parseMovieText` reads it back
 * from text a person edited. Numbers are written exactly: a float as the
 * shortest decimal that reads back as the same 32-bit float, a matrix as a
 * scale and rotation only when those rebuild it bit for bit.
 */

/** Where a model node came from in the movie, which edits are aimed at */
export interface Origin {
  /** The record's offset in the `.apt` */
  offset?: number;
  /** The line of the text it was read from, from 0 */
  line?: number;
  /** The last line of its block, from 0 */
  endLine?: number;
}

/** An action block as text */
export interface ScriptText {
  /** `as` and `asm` compile; `listing` is read-only */
  mode: 'as' | 'asm' | 'listing';
  text: string;
  /** The block's offset, for a script read from the movie */
  block?: number;
  /** The fence's first line, from 0 */
  line?: number;
}

export interface Placement {
  matrix: Matrix2;
  translate: [number, number];
}

export type ItemText = Origin &
  (
    | { type: 'action'; script: ScriptText }
    | { type: 'label'; label: string; flags: number; frame: number }
    | {
        type: 'place';
        /** The stored flags word; the fields below decide every bit they gate */
        flags: number;
        depth: number;
        character?: number;
        placement?: Placement;
        /** Multiply term, memory order R, G, B, A */
        colorTransform?: number;
        /** Add term, 0x00RRGGBB */
        colorAdd?: number;
        ratio?: number;
        name?: string;
        clipDepth?: number;
        clipActions?: ClipActionText[];
      }
    | { type: 'remove'; depth: number }
    | { type: 'background'; color: number }
    | { type: 'initAction'; sprite: number; script: ScriptText }
    | { type: 'unknown'; itemType: number }
  );

export type ClipActionText = Origin & { events: number; script: ScriptText };

export interface FrameText extends Origin {
  index: number;
  items: ItemText[];
}

export type ButtonRecordText = Origin & {
  flags: number;
  depth: number;
  character: number;
  placement: Placement;
  color: [number, number, number, number];
  unknown: [number, number, number, number];
};

export type ButtonActionText = Origin & {
  condition: number;
  script: ScriptText;
};

export type TextRunText = Origin & {
  font: number;
  color: [number, number, number, number];
  unknown: Rect;
  penOffset: [number, number];
  textHeight: number;
  glyphs: { index: number; advance: number }[];
};

export type CharacterText = Origin & { id: number } & (
    | {
        type: 'movie';
        /** The Movie record's own fields, written for character 0 only */
        screen?: { width: number; height: number; unknown36: number };
        frames: FrameText[];
      }
    | { type: 'shape'; bounds: Rect; geometry: number }
    | {
        type: 'editText';
        bounds: Rect;
        font: number;
        alignment: number;
        /** ARGB by value */
        color: number;
        fontHeight: number;
        readonly: number;
        multiline: number;
        wordwrap: number;
        text?: string;
        variable?: string;
      }
    | { type: 'font'; name?: string; glyphs: number[] }
    | {
        type: 'button';
        bounds: Rect;
        hitTriangles: number;
        records: ButtonRecordText[];
        actions: ButtonActionText[];
      }
    | { type: 'sprite'; frames: FrameText[] }
    | { type: 'image'; texture: number }
    | { type: 'morph'; startShape: number; endShape: number }
    | {
        type: 'text';
        bounds: Rect;
        placement: Placement;
        runs: TextRunText[];
      }
    | { type: 'placeholder' }
    | { type: 'unknown'; characterType: number }
  );

export type ConstText = Origin & { index: number; value: string | number };
export type ImportText = Origin & {
  character: number;
  movie: string;
  name: string;
};
export type ExportText = Origin & { character: number; name: string };

/** A movie and its `.const`, as the text holds them */
export interface MovieText {
  constants: ConstText[];
  imports: ImportText[];
  exports: ExportText[];
  characters: CharacterText[];
}

/** A problem with the text, at a line and column from 0 */
export interface TextProblem {
  line: number;
  column: number;
  endColumn: number;
  message: string;
}

/** A character id in the text: where a character is declared or named */
export interface IdSite {
  id: number;
  line: number;
  column: number;
  endColumn: number;
  isDeclaration: boolean;
}

/** The first line every text starts with */
export const TEXT_HEADER = 'apt-text 1';

/**
 * What `parseMovieText` returns: the model, and every problem found. A text
 * with problems still gives the parts that read, for an outline and
 * navigation, but is never saved.
 */
export interface ParsedMovieText {
  movie: MovieText;
  problems: TextProblem[];
  ids: IdSite[];
}

// Numbers

const F32 = new Float32Array(1);
const F32_WORD = new Uint32Array(F32.buffer);

/** The bits of a 32-bit float, so -0, 0 and NaN compare the way the file stores them */
export const f32Bits = (value: number): number => {
  F32[0] = value;
  return F32_WORD[0];
};

/** The shortest decimal that reads back as the same 32-bit float */
export const formatF32 = (value: number): string => {
  if (Number.isNaN(value)) {
    return 'nan';
  }
  if (!Number.isFinite(value)) {
    return value > 0 ? 'inf' : '-inf';
  }
  if (Object.is(value, -0)) {
    return '-0';
  }

  const exact = Math.fround(value);

  for (let digits = 1; digits <= 9; digits++) {
    const text = String(Number(exact.toPrecision(digits)));

    if (Math.fround(Number(text)) === exact) {
      return text;
    }
  }
  return String(exact);
};

const hex = (value: number, digits = 8) =>
  `0x${(value >>> 0).toString(16).padStart(digits, '0')}`;

const byteHex = (value: number) => (value & 255).toString(16).padStart(2, '0');

/** cos and sin of degrees, exact on the quarter turns a float would miss */
const turn = (degrees: number): [number, number] => {
  const quarter = degrees / 90;

  if (Number.isInteger(quarter)) {
    return (
      [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
      ] as [number, number][]
    )[((quarter % 4) + 4) % 4];
  }

  const radians = (degrees * Math.PI) / 180;

  return [Math.cos(radians), Math.sin(radians)];
};

/** The matrix a scale and a rotation in degrees make, as the file stores floats */
export const composeMatrix = (
  scaleX: number,
  scaleY: number,
  degrees: number,
): Matrix2 => {
  const [cos, sin] = turn(degrees);

  return [
    Math.fround(scaleX * cos),
    Math.fround(scaleX * sin),
    Math.fround(-scaleY * sin),
    Math.fround(scaleY * cos),
  ];
};

const sameMatrix = (a: Matrix2, b: Matrix2) =>
  a.every((value, index) => f32Bits(value) === f32Bits(b[index]));

/** The words after `at x,y` that give a matrix exactly: none, a scale, a rotation, or the four floats */
const transformWords = (matrix: Matrix2): string[] => {
  const [a, b, c, d] = matrix;

  if (Object.is(b, 0) && Object.is(c, 0)) {
    return f32Bits(a) === f32Bits(1) && f32Bits(d) === f32Bits(1)
      ? []
      : ['scale', `${formatF32(a)},${formatF32(d)}`];
  }

  const scaleX = Math.hypot(a, b);
  const scaleY = scaleX ? (a * d - b * c) / scaleX : 0;
  const degrees = (Math.atan2(b, a) * 180) / Math.PI;
  // The shortest decimals of each that rebuild the stored floats exactly
  const candidates = (value: number, most: number) => [
    ...new Set(
      Array.from({ length: most }, (_, index) =>
        Number(value.toPrecision(index + 1)),
      ),
    ),
  ];

  if (scaleX && Number.isFinite(scaleY) && Number.isFinite(degrees)) {
    // Scales are printed and read back as 32-bit floats, degrees as doubles
    const scales = (value: number) => [
      ...new Set(candidates(value, 9).map((each) => formatF32(each))),
    ];
    const read = (text: string) => Math.fround(Number(text));

    for (const x of scales(scaleX)) {
      for (const y of scales(scaleY)) {
        for (const rotation of candidates(degrees, 17)) {
          const degreesText = Object.is(rotation, -0) ? '-0' : String(rotation);

          if (
            sameMatrix(
              composeMatrix(read(x), read(y), Number(degreesText)),
              matrix,
            )
          ) {
            return [
              ...(f32Bits(read(x)) === f32Bits(1) &&
              f32Bits(read(y)) === f32Bits(1)
                ? []
                : ['scale', `${x},${y}`]),
              'rot',
              degreesText,
            ];
          }
        }
      }
    }
  }

  return ['matrix', matrix.map(formatF32).join(',')];
};

const placementWords = ({ matrix, translate }: Placement): string[] => [
  'at',
  translate.map(formatF32).join(','),
  ...transformWords(matrix),
];

// Strings

/** A string in double quotes; bytes outside printable Latin-1 are escaped */
export const quote = (text: string): string =>
  `"${Array.from(text, (char) => {
    const code = char.charCodeAt(0);

    if (char === '"' || char === '\\') {
      return `\\${char}`;
    }
    if (char === '\n') {
      return '\\n';
    }
    if (char === '\t') {
      return '\\t';
    }
    if (char === '\r') {
      return '\\r';
    }
    return code < 0x20 || (code >= 0x7f && code < 0xa0)
      ? `\\x${byteHex(code)}`
      : char;
  }).join('')}"`;

// From the movie

/** The fields a placed button or text needs, whatever the record */
const placementOf = (
  matrix: Matrix2,
  translate: [number, number],
): Placement => ({
  matrix: [...matrix] as Matrix2,
  translate: [...translate] as [number, number],
});

/** Reads the script of a block, given its offset */
export type ScriptReader = (block: number) => ScriptText;

/** Script text as the text holds it: no trailing blanks on a line or at the end */
export const normalizeScript = (text: string): string =>
  text.replace(/[ \t]+$/gm, '').replace(/\n+$/, '');

const itemOf = (
  item: FrameItem,
  reader: AptReader,
  script: ScriptReader,
): ItemText => {
  const origin = { offset: item.offset };

  switch (item.type) {
    case 'action':
      return { ...origin, type: 'action', script: script(item.block) };
    case 'frameLabel':
      return {
        ...origin,
        type: 'label',
        label: item.label,
        flags: item.flags,
        frame: item.frame,
      };
    case 'placeObject': {
      const list =
        item.flags & PLACE_FLAGS.hasClipActions
          ? reader.u32(item.offset + 60)
          : 0;
      const array = list ? reader.u32(list + 4) : 0;

      return {
        ...origin,
        type: 'place',
        flags: item.flags,
        depth: item.depth,
        character: item.character,
        placement:
          item.matrix && item.translate
            ? placementOf(item.matrix, item.translate)
            : undefined,
        colorTransform: item.colorTransform,
        colorAdd: item.colorAdd,
        ratio: item.ratio,
        name: item.name,
        clipDepth: item.clipDepth,
        clipActions: item.clipActions?.map((action, index) => ({
          offset: array + index * 12,
          events: action.events,
          script: script(action.block),
        })),
      };
    }
    case 'removeObject':
      return { ...origin, type: 'remove', depth: item.depth };
    case 'backgroundColor':
      return { ...origin, type: 'background', color: item.color };
    case 'initAction':
      return {
        ...origin,
        type: 'initAction',
        sprite: item.sprite,
        script: script(item.block),
      };
    default:
      return { ...origin, type: 'unknown', itemType: item.itemType };
  }
};

const framesOf = (
  frames: Frame[],
  reader: AptReader,
  script: ScriptReader,
): FrameText[] =>
  frames.map((frame, index) => ({
    index,
    items: frame.items.map((item) => itemOf(item, reader, script)),
  }));

const buttonRecordOf = (record: ButtonRecord): ButtonRecordText => ({
  offset: record.offset,
  flags: record.flags,
  depth: record.depth,
  character: record.character,
  placement: placementOf(record.matrix, record.translate),
  color: [...record.color],
  unknown: [...record.unknown],
});

const characterOf = (
  character: Character,
  reader: AptReader,
  script: ScriptReader,
): CharacterText => {
  const head = { id: character.id, offset: character.offset };

  switch (character.type) {
    case 'movie':
      return {
        ...head,
        type: 'movie',
        screen:
          character.id === 0
            ? {
                width: character.record.screenWidth,
                height: character.record.screenHeight,
                unknown36: character.record.unknown36,
              }
            : undefined,
        frames: framesOf(
          parseFrames(
            reader,
            character.record.frameCount,
            character.record.framesOffset,
          ),
          reader,
          script,
        ),
      };
    case 'shape':
      return {
        ...head,
        type: 'shape',
        bounds: character.bounds,
        geometry: character.geometry,
      };
    case 'editText':
      return {
        ...head,
        type: 'editText',
        bounds: character.bounds,
        font: character.font,
        alignment: character.alignment,
        color: character.color,
        fontHeight: character.fontHeight,
        readonly: character.readonly,
        multiline: character.multiline,
        wordwrap: character.wordwrap,
        text: character.text,
        variable: character.variable,
      };
    case 'font':
      return {
        ...head,
        type: 'font',
        name: character.name,
        glyphs: character.glyphs,
      };
    case 'button': {
      const actions = reader.u32(character.offset + 56);

      return {
        ...head,
        type: 'button',
        bounds: character.bounds,
        hitTriangles: character.hitTriangles,
        records: character.records.map(buttonRecordOf),
        actions: character.actions.map((action, index) => ({
          offset: actions + index * 8,
          condition: action.condition,
          script: script(action.block),
        })),
      };
    }
    case 'sprite':
      return {
        ...head,
        type: 'sprite',
        frames: framesOf(
          parseFrames(reader, character.frameCount, character.framesOffset),
          reader,
          script,
        ),
      };
    case 'image':
      return { ...head, type: 'image', texture: character.texture };
    case 'morph':
      return {
        ...head,
        type: 'morph',
        startShape: character.startShape,
        endShape: character.endShape,
      };
    case 'text':
      return {
        ...head,
        type: 'text',
        bounds: character.bounds,
        placement: placementOf(character.matrix, character.translate),
        runs: character.records.map((run) => ({
          offset: run.offset,
          font: run.font,
          color: [...run.color],
          unknown: [...run.unknown],
          penOffset: [...run.penOffset],
          textHeight: run.textHeight,
          glyphs: run.glyphs.map((glyph) => ({ ...glyph })),
        })),
      };
    case 'placeholder':
      return { ...head, type: 'placeholder' };
    default:
      return {
        ...head,
        type: 'unknown',
        characterType: character.characterType,
      };
  }
};

/**
 * The model of a movie as it stands in its files. `script` reads each
 * action block; the save path passes a cheap one when it only needs the
 * record fields again.
 */
export const movieToText = (
  apt: Uint8Array,
  constBytes: Uint8Array,
  script: ScriptReader,
  parsed?: { movie: AptMovie; constFile: ConstFile },
): MovieText => {
  const read: ScriptReader = (block) => {
    const each = script(block);

    return { ...each, text: normalizeScript(each.text), block };
  };
  const constFile = parsed?.constFile ?? parseConst(constBytes);
  const movie = parsed?.movie ?? parseAptMovie(apt, constFile.movieOffset);
  const reader = new AptReader(apt);
  const record = movie.record;

  return {
    constants: constFile.items.map((item, index) => ({
      offset: constFile.itemsOffset + index * 8,
      index,
      value: item.value,
    })),
    imports: movie.imports.map((entry, index) => ({
      offset: record.importsOffset + index * 16,
      ...entry,
    })),
    exports: movie.exports.map((entry, index) => ({
      offset: record.exportsOffset + index * 8,
      ...entry,
    })),
    characters: movie.characters.map((character) =>
      characterOf(character, reader, read),
    ),
  };
};

// Printing

const BUTTON_STATES = ['up', 'over', 'down', 'hit'];

const statesText = (flags: number): string => {
  const words = BUTTON_STATES.filter((_, bit) => flags & (1 << bit));
  const rest = (flags & ~0xf) >>> 0;

  return [...words, ...(rest ? [hex(rest)] : [])].join(',') || 'none';
};

const colorBytes = (value: number): number[] => [
  value & 255,
  (value >>> 8) & 255,
  (value >>> 16) & 255,
  value >>> 24,
];

const addBytes = (value: number): number[] => [
  (value >>> 16) & 255,
  (value >>> 8) & 255,
  value & 255,
  value >>> 24,
];

/** The flags word a placement's fields imply */
export const impliedPlaceFlags = (
  item: Extract<ItemText, { type: 'place' }>,
  isMove: boolean,
): number =>
  (isMove ? PLACE_FLAGS.move : 0) |
  (item.character !== undefined ? PLACE_FLAGS.hasCharacter : 0) |
  (item.placement ? PLACE_FLAGS.hasMatrix : 0) |
  (item.colorTransform !== undefined ? PLACE_FLAGS.hasColorTransform : 0) |
  (item.ratio !== undefined ? PLACE_FLAGS.hasRatio : 0) |
  (item.name !== undefined ? PLACE_FLAGS.hasName : 0) |
  (item.clipDepth !== undefined ? PLACE_FLAGS.hasClipDepth : 0) |
  (item.clipActions ? PLACE_FLAGS.hasClipActions : 0);

const scriptLines = (script: ScriptText, indent: string): string[] => {
  const body = normalizeScript(script.text);

  return [
    `${indent}\`\`\`${script.mode}`,
    ...(body
      ? body.split('\n').map((line) => `${indent}${line}`.trimEnd())
      : []),
    `${indent}\`\`\``,
  ];
};

const itemLines = (item: ItemText, indent: string, frame: number): string[] => {
  const inner = `${indent}  `;

  switch (item.type) {
    case 'action':
      return [`${indent}action`, ...scriptLines(item.script, inner)];
    case 'label':
      return [
        [
          `${indent}label ${quote(item.label)}`,
          ...(item.flags ? [`flags=${item.flags}`] : []),
          ...(item.frame !== frame ? [`frame=${item.frame}`] : []),
        ].join(' '),
      ];
    case 'place': {
      const isMove = (item.flags & PLACE_FLAGS.move) !== 0;
      const words = [
        'place',
        ...(isMove ? ['move'] : []),
        `depth=${item.depth}`,
        ...(item.character !== undefined ? [`char=${item.character}`] : []),
        ...(item.name !== undefined ? [`name=${quote(item.name)}`] : []),
        ...(item.placement ? placementWords(item.placement) : []),
        ...(item.colorTransform !== undefined
          ? [
              'color',
              `*${colorBytes(item.colorTransform).join(',')}`,
              `+${addBytes(item.colorAdd ?? 0).join(',')}`,
            ]
          : []),
        ...(item.ratio !== undefined ? [`ratio=${formatF32(item.ratio)}`] : []),
        ...(item.clipDepth !== undefined ? [`clip=${item.clipDepth}`] : []),
      ];

      if (item.flags !== impliedPlaceFlags(item, isMove)) {
        words.push(`flags=${hex(item.flags, 2)}`);
      }

      return [
        `${indent}${words.join(' ')}`,
        ...(item.clipActions ?? []).flatMap((action) => [
          `${inner}action events=${hex(action.events)}`,
          ...scriptLines(action.script, `${inner}  `),
        ]),
      ];
    }
    case 'remove':
      return [`${indent}remove depth=${item.depth}`];
    case 'background':
      return [`${indent}bg #${colorBytes(item.color).map(byteHex).join('')}`];
    case 'initAction':
      return [
        `${indent}initaction sprite=${item.sprite}`,
        ...scriptLines(item.script, inner),
      ];
    case 'unknown':
      return [`${indent}unknown type=${item.itemType}`];
  }
};

const frameLines = (frame: FrameText, indent: string): string[] => {
  const [first, ...rest] = frame.items;
  // A label first in its frame, as the editor adds one, goes on the frame's line
  const isTitle =
    first?.type === 'label' && !first.flags && first.frame === frame.index;

  return [
    `${indent}frame ${frame.index}${isTitle ? ` ${quote(first.label)}` : ''}`,
    ...(isTitle ? rest : frame.items).flatMap((item) =>
      itemLines(item, `${indent}  `, frame.index),
    ),
  ];
};

const rectText = (rect: Rect | number[]) => rect.map(formatF32).join(',');

const isAll = (values: number[], value: number) =>
  values.every((each) => f32Bits(each) === f32Bits(value));

const characterLines = (character: CharacterText): string[] => {
  const head = `character ${character.id} `;
  const inner = '  ';

  switch (character.type) {
    case 'movie':
      return [
        `${head}movie${
          character.screen
            ? ` screen=${character.screen.width}x${character.screen.height} unknown36=${character.screen.unknown36}`
            : ''
        }`,
        ...character.frames.flatMap((frame) => frameLines(frame, inner)),
      ];
    case 'shape':
      return [
        `${head}shape bounds=${rectText(character.bounds)} geometry=${character.geometry}`,
      ];
    case 'editText': {
      const color = character.color;

      return [
        [
          `${head}edittext bounds=${rectText(character.bounds)}`,
          `font=${character.font}`,
          `align=${character.alignment}`,
          `color=#${[color >>> 16, color >>> 8, color, color >>> 24].map(byteHex).join('')}`,
          `height=${formatF32(character.fontHeight)}`,
          `readonly=${character.readonly}`,
          `multiline=${character.multiline}`,
          `wordwrap=${character.wordwrap}`,
          ...(character.text !== undefined
            ? [`text=${quote(character.text)}`]
            : []),
          ...(character.variable !== undefined
            ? [`var=${quote(character.variable)}`]
            : []),
        ].join(' '),
      ];
    }
    case 'font':
      return [
        [
          `${head}font`,
          ...(character.name !== undefined
            ? [`name=${quote(character.name)}`]
            : []),
          ...(character.glyphs.length
            ? [`glyphs=${character.glyphs.join(',')}`]
            : []),
        ].join(' '),
      ];
    case 'button':
      return [
        `${head}button bounds=${rectText(character.bounds)} hit-triangles=${character.hitTriangles}`,
        ...character.records.map((record) =>
          [
            `${inner}record states=${statesText(record.flags)}`,
            `depth=${record.depth}`,
            `char=${record.character}`,
            ...placementWords(record.placement),
            ...(isAll(record.color, 1)
              ? []
              : ['color', rectText(record.color)]),
            ...(isAll(record.unknown, 0)
              ? []
              : ['unknown', rectText(record.unknown)]),
          ].join(' '),
        ),
        ...character.actions.flatMap((action) => [
          `${inner}action condition=${hex(action.condition)}`,
          ...scriptLines(action.script, `${inner}  `),
        ]),
      ];
    case 'sprite':
      return [
        `${head}sprite`,
        ...character.frames.flatMap((frame) => frameLines(frame, inner)),
      ];
    case 'image':
      return [`${head}image texture=${character.texture}`];
    case 'morph':
      return [
        `${head}morph start=${character.startShape} end=${character.endShape}`,
      ];
    case 'text':
      return [
        [
          `${head}text bounds=${rectText(character.bounds)}`,
          ...placementWords(character.placement),
        ].join(' '),
        ...character.runs.map((run) =>
          [
            `${inner}run font=${run.font}`,
            'color',
            rectText(run.color),
            ...(isAll(run.unknown, 0)
              ? []
              : ['unknown', rectText(run.unknown)]),
            'pen',
            rectText(run.penOffset),
            `height=${formatF32(run.textHeight)}`,
            ...(run.glyphs.length
              ? [
                  `glyphs=${run.glyphs
                    .map((glyph) => `${glyph.index}:${glyph.advance}`)
                    .join(',')}`,
                ]
              : []),
          ].join(' '),
        ),
      ];
    case 'placeholder':
      return [`${head}placeholder`];
    case 'unknown':
      return [`${head}unknown type=${character.characterType}`];
  }
};

/** Writes a model as text; `name` titles it in the opening comment */
export const printMovieText = (movie: MovieText, name?: string): string =>
  [
    TEXT_HEADER,
    ...(name
      ? [
          `; ${name}.apt with ${name}.const. Edit and save to write the movie;`,
          '; the format is docs/apt-text-format.md in the bigFS repository.',
        ]
      : []),
    '',
    'const',
    ...movie.constants.map(
      (item) =>
        `  ${item.index} ${typeof item.value === 'string' ? quote(item.value) : item.value}`,
    ),
    '',
    ...movie.imports.map(
      (entry) =>
        `import ${entry.character} ${quote(entry.movie)} ${quote(entry.name)}`,
    ),
    ...movie.exports.map(
      (entry) => `export ${entry.character} ${quote(entry.name)}`,
    ),
    ...(movie.imports.length || movie.exports.length ? [''] : []),
    ...movie.characters.flatMap(characterLines),
    '',
  ].join('\n');

// Parsing

interface Token {
  /** The word, or the string's contents */
  text: string;
  /** For `key=value`, the key; `text` is then the value */
  key?: string;
  isString: boolean;
  column: number;
  endColumn: number;
}

class ParseError extends Error {
  public constructor(
    message: string,
    public readonly column = 0,
    public readonly endColumn = 0,
  ) {
    super(message);
  }
}

/** Reads a quoted string starting at `start`; returns it and the column after it */
const readString = (line: string, start: number): [string, number] => {
  let text = '';
  let at = start + 1;

  while (at < line.length && line[at] !== '"') {
    const char = line[at];

    if (char !== '\\') {
      if (char.charCodeAt(0) > 0xff) {
        throw new ParseError(
          `"${char}" is not Latin-1; a movie string holds Latin-1 only`,
          at,
          at + 1,
        );
      }
      text += char;
      at++;
      continue;
    }

    const escape = line[at + 1];

    if (escape === 'x' && /^[0-9a-fA-F]{2}$/.test(line.slice(at + 2, at + 4))) {
      text += String.fromCharCode(parseInt(line.slice(at + 2, at + 4), 16));
      at += 4;
    } else if (escape !== undefined && '"\\ntr'.includes(escape)) {
      text +=
        { n: '\n', t: '\t', r: '\r' }[escape as 'n' | 't' | 'r'] ?? escape;
      at += 2;
    } else {
      throw new ParseError('Unknown escape in a string', at, at + 2);
    }
  }

  if (line[at] !== '"') {
    throw new ParseError('A string is not closed', start, line.length);
  }
  if (text.includes('\0')) {
    throw new ParseError('A movie string cannot hold NUL', start, at + 1);
  }
  return [text, at + 1];
};

/** Splits a line into words, strings and `key=value` pairs; `;` starts a comment */
const tokenize = (line: string): Token[] => {
  const tokens: Token[] = [];
  let at = 0;

  while (at < line.length) {
    if (/\s/.test(line[at])) {
      at++;
      continue;
    }
    if (line[at] === ';') {
      break;
    }

    const start = at;

    if (line[at] === '"') {
      const [text, end] = readString(line, at);

      tokens.push({ text, isString: true, column: start, endColumn: end });
      at = end;
      continue;
    }

    while (at < line.length && !/[\s="]/.test(line[at])) {
      at++;
    }

    if (line[at] === '=') {
      const key = line.slice(start, at);

      at++;
      if (line[at] === '"') {
        const [text, end] = readString(line, at);

        tokens.push({
          key,
          text,
          isString: true,
          column: start,
          endColumn: end,
        });
        at = end;
        continue;
      }

      const valueStart = at;

      while (at < line.length && !/[\s"]/.test(line[at])) {
        at++;
      }
      tokens.push({
        key,
        text: line.slice(valueStart, at),
        isString: false,
        column: start,
        endColumn: at,
      });
      continue;
    }

    if (line[at] === '"') {
      throw new ParseError('A string must stand apart or follow =', at, at + 1);
    }
    tokens.push({
      text: line.slice(start, at),
      isString: false,
      column: start,
      endColumn: at,
    });
  }
  return tokens;
};

/** One line of the text, with the lines indented under it */
interface Node {
  line: number;
  indent: number;
  tokens: Token[];
  children: Node[];
  /** A fence's body, for a node that is one */
  fence?: { mode: string; text: string; endLine: number };
  endLine: number;
}

/** Reads a whole number, decimal or 0x hex, in a range */
const integer = (
  token: Token,
  min: number,
  max: number,
  what: string,
): number => {
  const text = token.text;
  const value = /^-?0x[0-9a-f]+$/i.test(text)
    ? (text.startsWith('-') ? -1 : 1) * parseInt(text.replace(/^-?0x/i, ''), 16)
    : /^-?\d+$/.test(text)
      ? Number(text)
      : NaN;

  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new ParseError(
      `${what} must be a whole number from ${min} to ${max}, not "${text}"`,
      token.column,
      token.endColumn,
    );
  }
  return value;
};

const u32 = (token: Token, what: string) => integer(token, 0, 0xffffffff, what);
const i32 = (token: Token, what: string) =>
  integer(token, -0x80000000, 0x7fffffff, what);

const floatOf = (text: string, token: Token, what: string): number => {
  const value =
    text === 'nan'
      ? NaN
      : text === 'inf'
        ? Infinity
        : text === '-inf'
          ? -Infinity
          : /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text)
            ? Number(text)
            : undefined;

  if (value === undefined) {
    throw new ParseError(
      `${what} must be a number, not "${text}"`,
      token.column,
      token.endColumn,
    );
  }
  return Math.fround(value);
};

const floats = (token: Token, count: number, what: string): number[] => {
  const parts = token.text.split(',');

  if (parts.length !== count) {
    throw new ParseError(
      `${what} takes ${count} numbers separated by commas`,
      token.column,
      token.endColumn,
    );
  }
  return parts.map((part) => floatOf(part, token, what));
};

/** The words of a line after its keyword, by key, with the bare words in order */
class Fields {
  private readonly keyed = new Map<string, Token>();
  private readonly used = new Set<string>();
  public readonly bare: Token[] = [];

  public constructor(
    tokens: Token[],
    private readonly what: string,
  ) {
    for (const token of tokens) {
      if (token.key === undefined) {
        this.bare.push(token);
      } else if (this.keyed.has(token.key)) {
        throw new ParseError(
          `${token.key}= is given twice`,
          token.column,
          token.endColumn,
        );
      } else {
        this.keyed.set(token.key, token);
      }
    }
  }

  public optional(key: string): Token | undefined {
    this.used.add(key);
    return this.keyed.get(key);
  }

  public required(key: string, line: Token[]): Token {
    const token = this.optional(key);

    if (!token) {
      const last = line[line.length - 1];

      throw new ParseError(
        `${this.what} needs ${key}=`,
        line[0]?.column ?? 0,
        last?.endColumn ?? 0,
      );
    }
    return token;
  }

  public string(key: string): string | undefined {
    const token = this.optional(key);

    if (token && !token.isString) {
      throw new ParseError(
        `${key}= takes a quoted string`,
        token.column,
        token.endColumn,
      );
    }
    return token?.text;
  }

  /** Fails on a key the line does not take */
  public finish(): void {
    for (const [key, token] of this.keyed) {
      if (!this.used.has(key)) {
        throw new ParseError(
          `${this.what} has no field ${key}`,
          token.column,
          token.endColumn,
        );
      }
    }
  }
}

/** Reads `at x,y`, `scale sx,sy`, `rot deg` and `matrix a,b,c,d` from bare words */
const readPlacement = (
  bare: Token[],
  extra: Record<
    string,
    { arity: number; read: (values: Token[]) => void }
  > = {},
  flags: Record<string, () => void> = {},
  allowPlacement = true,
): Placement | undefined => {
  let translate: [number, number] | undefined;
  let scale: [number, number] | undefined;
  let rotation: number | undefined;
  let matrix: Matrix2 | undefined;
  const seen = new Set<string>();

  for (let index = 0; index < bare.length; index++) {
    const word = bare[index];

    if (word.isString) {
      throw new ParseError(
        'A string here needs a key, as name="..."',
        word.column,
        word.endColumn,
      );
    }
    if (flags[word.text]) {
      flags[word.text]();
      continue;
    }

    const known =
      (allowPlacement &&
        ['at', 'scale', 'rot', 'matrix'].includes(word.text)) ||
      extra[word.text] !== undefined;
    const arity = extra[word.text]?.arity ?? 1;
    const values = bare.slice(index + 1, index + 1 + arity);
    const value = values[0];

    if (!known) {
      throw new ParseError(
        `Unexpected "${word.text}"`,
        word.column,
        word.endColumn,
      );
    }
    if (seen.has(word.text)) {
      throw new ParseError(
        `${word.text} is given twice`,
        word.column,
        word.endColumn,
      );
    }
    if (
      values.length < arity ||
      values.some((each) => each.isString || each.key !== undefined)
    ) {
      throw new ParseError(
        `${word.text} needs ${arity === 1 ? 'a value' : `${arity} values`} after it`,
        word.column,
        word.endColumn,
      );
    }
    seen.add(word.text);
    index += arity;

    switch (word.text) {
      case 'at':
        translate = floats(value, 2, 'at') as [number, number];
        break;
      case 'scale':
        scale = floats(value, 2, 'scale') as [number, number];
        break;
      case 'rot':
        // Degrees are not stored, so they are read at full precision
        floats(value, 1, 'rot');
        rotation = Number(value.text);
        break;
      case 'matrix':
        matrix = floats(value, 4, 'matrix') as Matrix2;
        break;
      default:
        extra[word.text].read(values);
    }
  }

  if (matrix && (scale || rotation !== undefined)) {
    throw new ParseError(
      'matrix replaces scale and rot; give one or the other',
    );
  }
  if (!translate && !scale && rotation === undefined && !matrix) {
    return undefined;
  }
  return {
    translate: translate ?? [0, 0],
    matrix:
      matrix ??
      (rotation !== undefined
        ? composeMatrix(scale?.[0] ?? 1, scale?.[1] ?? 1, rotation)
        : [scale?.[0] ?? 1, 0, 0, scale?.[1] ?? 1]),
  };
};

/** How deep blocks may nest */
const MAX_DEPTH = 16;

/** Turns lines into nodes by indentation, with fences kept whole */
const buildTree = (lines: string[], problems: TextProblem[]): Node[] => {
  const root: Node = {
    line: -1,
    indent: -1,
    tokens: [],
    children: [],
    endLine: -1,
  };
  const stack: Node[] = [root];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith(';')) {
      continue;
    }
    if (/^\t/.test(line) || /^ *\t/.test(line)) {
      problems.push({
        line: index,
        column: 0,
        endColumn: indent,
        message: 'Indent with spaces, not tabs',
      });
      continue;
    }

    while (stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1];

    // The format nests five deep; far deeper is a mistake, and would recurse without bound
    if (stack.length > MAX_DEPTH) {
      problems.push({
        line: index,
        column: 0,
        endColumn: line.length,
        message: 'This line is indented deeper than any block nests',
      });
      continue;
    }

    if (trimmed.startsWith('```')) {
      const mode = trimmed.slice(3).trim();
      const body: string[] = [];
      let end = index + 1;

      for (; end < lines.length; end++) {
        const each = lines[end];

        if (
          each.trim() === '```' &&
          each.length - each.trimStart().length === indent
        ) {
          break;
        }
        if (each.trim() && !each.startsWith(' '.repeat(indent))) {
          problems.push({
            line: end,
            column: 0,
            endColumn: each.length,
            message: 'A script line is indented less than its fence',
          });
        }
        body.push(
          each.slice(Math.min(indent, each.length - each.trimStart().length)),
        );
      }

      if (end >= lines.length) {
        problems.push({
          line: index,
          column: indent,
          endColumn: line.length,
          message: 'This fence is never closed with ```',
        });
      }

      parent.children.push({
        line: index,
        indent,
        tokens: [],
        children: [],
        fence: { mode, text: body.join('\n'), endLine: end },
        endLine: end,
      });
      index = end;
      continue;
    }

    let tokens: Token[];

    try {
      tokens = tokenize(line);
    } catch (error) {
      const failure = error as ParseError;

      problems.push({
        line: index,
        column: failure.column,
        endColumn: failure.endColumn || line.length,
        message: failure.message,
      });
      continue;
    }

    const node: Node = {
      line: index,
      indent,
      tokens,
      children: [],
      endLine: index,
    };

    parent.children.push(node);
    stack.push(node);
  }

  const close = (node: Node): number => {
    node.endLine = Math.max(node.endLine, ...node.children.map(close));
    return node.endLine;
  };

  close(root);
  return root.children;
};

/** The lines each block of a text spans, every line with lines indented under it and every fence */
export const textBlocks = (text: string): { start: number; end: number }[] => {
  const blocks: { start: number; end: number }[] = [];
  const visit = (nodes: Node[]) => {
    for (const node of nodes) {
      if (node.endLine > node.line) {
        blocks.push({ start: node.line, end: node.endLine });
      }
      visit(node.children);
    }
  };

  visit(buildTree(text.split(/\r?\n/), []));
  return blocks;
};

/** Reads the model back from text, collecting every problem rather than stopping at the first */
export const parseMovieText = (text: string): ParsedMovieText => {
  const lines = text.split(/\r?\n/);
  const problems: TextProblem[] = [];
  const ids: IdSite[] = [];
  const movie: MovieText = {
    constants: [],
    imports: [],
    exports: [],
    characters: [],
  };

  const firstLine = lines.findIndex(
    (line) => line.trim() && !line.trim().startsWith(';'),
  );

  if (firstLine < 0 || lines[firstLine].trim() !== TEXT_HEADER) {
    problems.push({
      line: Math.max(0, firstLine),
      column: 0,
      endColumn: lines[Math.max(0, firstLine)]?.length ?? 0,
      message: `The text must start with "${TEXT_HEADER}"`,
    });
    return { movie, problems, ids };
  }

  const nodes = buildTree(lines.slice(), problems).filter(
    (node) => node.line !== firstLine,
  );

  /** Runs a reader over one node, turning a failure into a problem there */
  const attempt = <T>(node: Node, read: () => T): T | undefined => {
    try {
      return read();
    } catch (error) {
      const failure =
        error instanceof ParseError ? error : new ParseError(String(error));

      problems.push({
        line: node.line,
        column: failure.endColumn ? failure.column : node.indent,
        endColumn: failure.endColumn || lines[node.line].length,
        message: failure.message,
      });
      return undefined;
    }
  };

  const id = (token: Token, isDeclaration = false): number => {
    const value = u32(token, 'A character id');
    const offset = token.key !== undefined ? token.key.length + 1 : 0;

    ids.push({
      id: value,
      line: currentLine,
      column: token.column + offset,
      endColumn: token.endColumn,
      isDeclaration,
    });
    return value;
  };
  let currentLine = 0;

  const noChildren = (node: Node, what: string) => {
    for (const child of node.children) {
      problems.push({
        line: child.line,
        column: child.indent,
        endColumn: lines[child.line].length,
        message: `${what} holds nothing indented under it`,
      });
    }
  };

  const keyword = (node: Node) => (node.fence ? '```' : node.tokens[0]?.text);

  const scriptOf = (node: Node, what: string): ScriptText | undefined => {
    const fences = node.children.filter((child) => child.fence);
    const others = node.children.filter((child) => !child.fence);

    for (const other of others) {
      problems.push({
        line: other.line,
        column: other.indent,
        endColumn: lines[other.line].length,
        message: `${what} holds only its script fence`,
      });
    }
    if (fences.length !== 1) {
      problems.push({
        line: (fences[1] ?? node).line,
        column: node.indent,
        endColumn: lines[node.line].length,
        message: `${what} needs exactly one \`\`\` fence holding its script`,
      });
      return undefined;
    }

    const fence = fences[0].fence!;

    if (!['as', 'asm', 'listing'].includes(fence.mode)) {
      problems.push({
        line: fences[0].line,
        column: fences[0].indent,
        endColumn: lines[fences[0].line].length,
        message: 'A fence is ```as, ```asm or ```listing',
      });
      return undefined;
    }
    return {
      mode: fence.mode as ScriptText['mode'],
      text: normalizeScript(fence.text),
      line: fences[0].line,
    };
  };

  const readItem = (node: Node, frame: number): ItemText | undefined => {
    currentLine = node.line;

    const [head, ...rest] = node.tokens;
    const origin = { line: node.line, endLine: node.endLine };

    switch (head?.text) {
      case 'action': {
        const fields = new Fields(rest, 'action');

        fields.finish();
        if (fields.bare.length) {
          throw new ParseError('A frame action takes no fields');
        }

        const script = scriptOf(node, 'An action');

        return script && { ...origin, type: 'action', script };
      }
      case 'label': {
        noChildren(node, 'A label');

        const [name, ...more] = rest;

        if (!name?.isString || name.key !== undefined) {
          throw new ParseError('label takes its name in quotes');
        }

        const fields = new Fields(more, 'label');
        const flags = fields.optional('flags');
        const at = fields.optional('frame');

        fields.finish();
        if (fields.bare.length) {
          throw new ParseError(
            `Unexpected "${fields.bare[0].text}"`,
            fields.bare[0].column,
            fields.bare[0].endColumn,
          );
        }
        return {
          ...origin,
          type: 'label',
          label: name.text,
          flags: flags ? u32(flags, 'flags') : 0,
          frame: at ? u32(at, 'frame') : frame,
        };
      }
      case 'place': {
        const fields = new Fields(rest, 'place');
        const depth = i32(fields.required('depth', node.tokens), 'depth');
        const character = fields.optional('char');
        const name = fields.string('name');
        const ratio = fields.optional('ratio');
        const clip = fields.optional('clip');
        const flags = fields.optional('flags');
        let isMove = false;
        let color: [number, number] | undefined;

        fields.finish();

        const readColor = ([multiply, add]: Token[]) => {
          if (!multiply.text.startsWith('*') || !add.text.startsWith('+')) {
            throw new ParseError(
              'color takes *r,g,b,a then +r,g,b,a',
              multiply.column,
              add.endColumn,
            );
          }

          const bytes = (token: Token) => {
            const parts = token.text.slice(1).split(',');

            if (parts.length !== 4) {
              throw new ParseError(
                'A colour term is four bytes, r,g,b,a',
                token.column,
                token.endColumn,
              );
            }
            return parts.map((part) =>
              integer({ ...token, text: part }, 0, 255, 'A colour byte'),
            );
          };
          const [r, g, b, a] = bytes(multiply);
          const [ar, ag, ab, aa] = bytes(add);

          color = [
            (r | (g << 8) | (b << 16) | (a << 24)) >>> 0,
            ((ar << 16) | (ag << 8) | ab | (aa << 24)) >>> 0,
          ];
        };
        const placement = readPlacement(
          fields.bare,
          { color: { arity: 2, read: readColor } },
          { move: () => (isMove = true) },
        );

        const clipActions = node.children.length
          ? node.children.map((child) => {
              currentLine = child.line;

              const [word, ...more] = child.tokens;

              if (word?.text !== 'action') {
                throw new ParseError(
                  'A placement holds only its clip actions, action events=...',
                );
              }

              const actionFields = new Fields(more, 'A clip action');
              const events = u32(
                actionFields.required('events', child.tokens),
                'events',
              );

              actionFields.finish();

              const script = scriptOf(child, 'A clip action');

              if (!script) {
                throw new ParseError('A clip action needs its script');
              }
              return {
                line: child.line,
                endLine: child.endLine,
                events,
                script,
              };
            })
          : undefined;
        currentLine = node.line;

        const item: Extract<ItemText, { type: 'place' }> = {
          ...origin,
          type: 'place',
          flags: 0,
          depth,
          character: character && id(character),
          placement,
          colorTransform: color?.[0],
          colorAdd: color?.[1],
          ratio: ratio && floatOf(ratio.text, ratio, 'ratio'),
          name,
          clipDepth: clip && i32(clip, 'clip'),
          clipActions,
        };

        item.flags = flags
          ? u32(flags, 'flags')
          : impliedPlaceFlags(item, isMove);
        return item;
      }
      case 'remove': {
        noChildren(node, 'A remove');

        const fields = new Fields(rest, 'remove');
        const depth = i32(fields.required('depth', node.tokens), 'depth');

        fields.finish();
        return { ...origin, type: 'remove', depth };
      }
      case 'bg': {
        noChildren(node, 'A background colour');

        const color = rest[0];

        if (!color || rest.length > 1 || !/^#[0-9a-f]{8}$/i.test(color.text)) {
          throw new ParseError('bg takes a colour, #rrggbbaa');
        }

        const bytes = [1, 3, 5, 7].map((at) =>
          parseInt(color.text.slice(at, at + 2), 16),
        );

        return {
          ...origin,
          type: 'background',
          color:
            (bytes[0] |
              (bytes[1] << 8) |
              (bytes[2] << 16) |
              (bytes[3] << 24)) >>>
            0,
        };
      }
      case 'initaction': {
        const fields = new Fields(rest, 'initaction');
        const sprite = id(fields.required('sprite', node.tokens));

        fields.finish();

        const script = scriptOf(node, 'An init action');

        return script && { ...origin, type: 'initAction', sprite, script };
      }
      case 'unknown': {
        noChildren(node, 'An unknown item');

        const fields = new Fields(rest, 'unknown');
        const type = u32(fields.required('type', node.tokens), 'type');

        fields.finish();
        return { ...origin, type: 'unknown', itemType: type };
      }
      default:
        throw new ParseError(
          `A frame holds action, label, place, remove, bg, initaction or unknown, not "${head?.text ?? ''}"`,
        );
    }
  };

  const readFrames = (node: Node): FrameText[] => {
    const frames: FrameText[] = [];

    for (const child of node.children) {
      attempt(child, () => {
        currentLine = child.line;

        const [word, number, title, ...more] = child.tokens;

        if (word?.text !== 'frame' || !number) {
          throw new ParseError('A timeline holds frame blocks: frame <n>');
        }

        const index = u32(number, 'A frame number');

        if (index !== frames.length) {
          throw new ParseError(
            `Frames are numbered in order from 0; this one should be ${frames.length}`,
            number.column,
            number.endColumn,
          );
        }
        if (more.length || (title && (!title.isString || title.key))) {
          throw new ParseError(
            'A frame line is frame <n> or frame <n> "label"',
          );
        }

        const frame: FrameText = {
          index,
          line: child.line,
          endLine: child.endLine,
          items: title
            ? [
                {
                  line: child.line,
                  type: 'label',
                  label: title.text,
                  flags: 0,
                  frame: index,
                },
              ]
            : [],
        };

        frames.push(frame);
        for (const itemNode of child.children) {
          const item = attempt(itemNode, () => readItem(itemNode, index));

          if (item) {
            frame.items.push(item);
          }
        }
      });
    }
    return frames;
  };

  const readCharacter = (node: Node): CharacterText | undefined => {
    const [, idToken, typeToken, ...rest] = node.tokens;

    if (!idToken || !typeToken) {
      throw new ParseError('A character line is character <id> <type> ...');
    }

    const head = {
      id: id(idToken, true),
      line: node.line,
      endLine: node.endLine,
    };
    const fields = new Fields(rest, typeToken.text);
    const rect = (key: string) =>
      floats(fields.required(key, node.tokens), 4, key) as Rect;
    const number = (key: string) => u32(fields.required(key, node.tokens), key);
    const float = (key: string) => {
      const token = fields.required(key, node.tokens);

      return floatOf(token.text, token, key);
    };
    const done = <T>(character: T): T => {
      fields.finish();
      if (fields.bare.length) {
        throw new ParseError(
          `Unexpected "${fields.bare[0].text}"`,
          fields.bare[0].column,
          fields.bare[0].endColumn,
        );
      }
      return character;
    };
    const flat = <T>(character: T): T => {
      noChildren(node, `A ${typeToken.text}`);
      return done(character);
    };

    switch (typeToken.text) {
      case 'movie': {
        const screen = fields.optional('screen');
        const unknown36 = fields.optional('unknown36');
        let size:
          | { width: number; height: number; unknown36: number }
          | undefined;

        if (screen) {
          const match = /^(\d+)x(\d+)$/.exec(screen.text);

          if (!match) {
            throw new ParseError(
              'screen takes <width>x<height>',
              screen.column,
              screen.endColumn,
            );
          }
          size = {
            width: u32({ ...screen, text: match[1] }, 'The width'),
            height: u32({ ...screen, text: match[2] }, 'The height'),
            unknown36: unknown36 ? u32(unknown36, 'unknown36') : 33,
          };
        }
        done(undefined);
        return {
          ...head,
          type: 'movie',
          screen: size,
          frames: readFrames(node),
        };
      }
      case 'shape':
        return flat({
          ...head,
          type: 'shape',
          bounds: rect('bounds'),
          geometry: number('geometry'),
        });
      case 'edittext': {
        const colorToken = fields.required('color', node.tokens);

        if (!/^#[0-9a-f]{8}$/i.test(colorToken.text)) {
          throw new ParseError(
            'color takes #rrggbbaa',
            colorToken.column,
            colorToken.endColumn,
          );
        }

        const [r, g, b, a] = [1, 3, 5, 7].map((at) =>
          parseInt(colorToken.text.slice(at, at + 2), 16),
        );
        const fontToken = fields.required('font', node.tokens);

        return flat({
          ...head,
          type: 'editText',
          bounds: rect('bounds'),
          font: id(fontToken),
          alignment: number('align'),
          color: ((a << 24) | (r << 16) | (g << 8) | b) >>> 0,
          fontHeight: float('height'),
          readonly: number('readonly'),
          multiline: number('multiline'),
          wordwrap: number('wordwrap'),
          text: fields.string('text'),
          variable: fields.string('var'),
        });
      }
      case 'font': {
        const glyphs = fields.optional('glyphs');

        return flat({
          ...head,
          type: 'font',
          name: fields.string('name'),
          glyphs: glyphs?.text
            ? glyphs.text
                .split(',')
                .map((part) => u32({ ...glyphs, text: part }, 'A glyph'))
            : [],
        });
      }
      case 'button': {
        const bounds = rect('bounds');
        const hitTriangles = number('hit-triangles');
        const records: ButtonRecordText[] = [];
        const actions: ButtonActionText[] = [];

        done(undefined);
        for (const child of node.children) {
          attempt(child, () => {
            currentLine = child.line;

            const [word, ...more] = child.tokens;
            const childFields = new Fields(more, word?.text ?? '');

            if (word?.text === 'record') {
              noChildren(child, 'A button record');

              const states = childFields.required('states', child.tokens);
              const flags =
                states.text === 'none'
                  ? 0
                  : states.text.split(',').reduce((sum, part) => {
                      const bit = BUTTON_STATES.indexOf(part);

                      return (
                        sum |
                        (bit >= 0
                          ? 1 << bit
                          : u32({ ...states, text: part }, 'A state'))
                      );
                    }, 0) >>> 0;
              const depth = i32(
                childFields.required('depth', child.tokens),
                'depth',
              );
              const character = id(childFields.required('char', child.tokens));
              let color = [1, 1, 1, 1];
              let unknown = [0, 0, 0, 0];

              childFields.finish();

              const placement = readPlacement(childFields.bare, {
                color: {
                  arity: 1,
                  read: ([value]) => (color = floats(value, 4, 'color')),
                },
                unknown: {
                  arity: 1,
                  read: ([value]) => (unknown = floats(value, 4, 'unknown')),
                },
              });

              records.push({
                line: child.line,
                endLine: child.endLine,
                flags,
                depth,
                character,
                placement: placement ?? {
                  matrix: [1, 0, 0, 1],
                  translate: [0, 0],
                },
                color: color as ButtonRecordText['color'],
                unknown: unknown as ButtonRecordText['unknown'],
              });
            } else if (word?.text === 'action') {
              const condition = u32(
                childFields.required('condition', child.tokens),
                'condition',
              );

              childFields.finish();

              const script = scriptOf(child, 'A button action');

              if (script) {
                actions.push({
                  line: child.line,
                  endLine: child.endLine,
                  condition,
                  script,
                });
              }
            } else {
              throw new ParseError('A button holds record and action lines');
            }
          });
        }
        return {
          ...head,
          type: 'button',
          bounds,
          hitTriangles,
          records,
          actions,
        };
      }
      case 'sprite':
        done(undefined);
        return { ...head, type: 'sprite', frames: readFrames(node) };
      case 'image':
        return flat({ ...head, type: 'image', texture: number('texture') });
      case 'morph':
        return flat({
          ...head,
          type: 'morph',
          startShape: id(fields.required('start', node.tokens)),
          endShape: id(fields.required('end', node.tokens)),
        });
      case 'text': {
        const bounds = rect('bounds');

        fields.finish();

        const placement = readPlacement(fields.bare) ?? {
          matrix: [1, 0, 0, 1],
          translate: [0, 0],
        };
        const runs: TextRunText[] = [];

        for (const child of node.children) {
          attempt(child, () => {
            currentLine = child.line;

            const [word, ...more] = child.tokens;

            if (word?.text !== 'run') {
              throw new ParseError('A text holds run lines');
            }
            noChildren(child, 'A run');

            const runFields = new Fields(more, 'run');
            const font = id(runFields.required('font', child.tokens));
            const height = runFields.required('height', child.tokens);
            const glyphs = runFields.optional('glyphs');
            let color: number[] | undefined;
            let unknown = [0, 0, 0, 0];
            let pen: number[] | undefined;

            runFields.finish();
            readPlacement(
              runFields.bare,
              {
                color: {
                  arity: 1,
                  read: ([value]) => (color = floats(value, 4, 'color')),
                },
                unknown: {
                  arity: 1,
                  read: ([value]) => (unknown = floats(value, 4, 'unknown')),
                },
                pen: {
                  arity: 1,
                  read: ([value]) => (pen = floats(value, 2, 'pen')),
                },
              },
              {},
              false,
            );
            if (!color || !pen) {
              throw new ParseError('A run needs color r,g,b,a and pen x,y');
            }
            runs.push({
              line: child.line,
              endLine: child.endLine,
              font,
              color: color as TextRunText['color'],
              unknown: unknown as Rect,
              penOffset: pen as [number, number],
              textHeight: floatOf(height.text, height, 'height'),
              glyphs: glyphs?.text
                ? glyphs.text.split(',').map((part) => {
                    const match = /^(\d+):(-?\d+)$/.exec(part);

                    if (!match) {
                      throw new ParseError(
                        'A glyph is <index>:<advance>',
                        glyphs.column,
                        glyphs.endColumn,
                      );
                    }
                    return {
                      index: u32(
                        { ...glyphs, text: match[1] },
                        'A glyph index',
                      ),
                      advance: i32({ ...glyphs, text: match[2] }, 'An advance'),
                    };
                  })
                : [],
            });
          });
        }
        return { ...head, type: 'text', bounds, placement, runs };
      }
      case 'placeholder':
        return flat({ ...head, type: 'placeholder' });
      case 'unknown':
        return flat({
          ...head,
          type: 'unknown',
          characterType: number('type'),
        });
      default:
        throw new ParseError(
          `"${typeToken.text}" is not a character type`,
          typeToken.column,
          typeToken.endColumn,
        );
    }
  };

  let characterCount = 0;

  for (const node of nodes) {
    currentLine = node.line;

    switch (keyword(node)) {
      case 'const':
        attempt(node, () => {
          if (node.tokens.length > 1) {
            throw new ParseError('const holds its items indented under it');
          }
        });
        for (const child of node.children) {
          const item = attempt(child, () => {
            const [index, value, ...more] = child.tokens;

            if (!index || !value || more.length || index.key || value.key) {
              throw new ParseError(
                'A constant is <index> "string" or <index> <number>',
              );
            }

            const at = u32(index, 'A constant index');

            if (at !== movie.constants.length) {
              throw new ParseError(
                `Constants are numbered in order from 0; this one should be ${movie.constants.length}`,
                index.column,
                index.endColumn,
              );
            }
            noChildren(child, 'A constant');
            return {
              line: child.line,
              index: at,
              value: value.isString
                ? value.text
                : u32(value, 'A number constant'),
            };
          });

          if (item) {
            movie.constants.push(item);
          }
        }
        break;
      case 'import':
        attempt(node, () => {
          const [, character, from, name, ...more] = node.tokens;

          noChildren(node, 'An import');
          if (!character || !from?.isString || !name?.isString || more.length) {
            throw new ParseError('An import is import <id> "movie" "name"');
          }
          movie.imports.push({
            line: node.line,
            character: id(character),
            movie: from.text,
            name: name.text,
          });
        });
        break;
      case 'export':
        attempt(node, () => {
          const [, character, name, ...more] = node.tokens;

          noChildren(node, 'An export');
          if (!character || !name?.isString || more.length) {
            throw new ParseError('An export is export <id> "name"');
          }
          movie.exports.push({
            line: node.line,
            character: id(character),
            name: name.text,
          });
        });
        break;
      case 'character': {
        const expected = characterCount++;
        const character = attempt(node, () => readCharacter(node));

        if (character && character.id !== expected) {
          problems.push({
            line: node.line,
            column: node.tokens[1].column,
            endColumn: node.tokens[1].endColumn,
            message: `Characters are listed by id from 0; this one should be ${expected}`,
          });
        } else if (character) {
          movie.characters.push(character);
        }
        break;
      }
      default:
        problems.push({
          line: node.line,
          column: node.indent,
          endColumn: lines[node.line].length,
          message: `Expected const, import, export or character, not "${keyword(node) ?? ''}"`,
        });
    }
  }

  return { movie, problems, ids };
};
