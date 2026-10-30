import { PLACE_FLAGS } from '../aptMovie';
import type { Rect } from '../aptMovie';
import {
  BUTTON_STATES,
  TEXT_HEADER,
  impliedPlaceFlags,
  normalizeScript,
} from './textModel';
import type {
  CharacterText,
  FrameText,
  ItemText,
  MovieText,
  ScriptText,
} from './textModel';
import { byteHex, f32Bits, formatF32, hex, placementWords } from './numbers';

/** Quotes a string in double quotes, escaping bytes outside printable Latin-1 */
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
