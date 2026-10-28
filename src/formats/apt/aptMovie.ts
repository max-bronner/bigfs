/**
 * Parser for APT, the UI format of the SAGE games: a Flash 6 movie stored as
 * a memory image, every pointer an absolute offset from the start of the
 * `.apt` file. Ported from mint's `crates/sage/apt`; layouts and every rule
 * below are from mint's `docs/research/apt-format.md`, measured over both
 * games' 165 shipped movies.
 *
 * A movie is four files in one BIG: `<name>.apt` (the image), `<name>.const`
 * (the constant pool, and the offset of the Movie record: the `.apt`'s own
 * prologue is never read), `<name>.dat` (which image file holds each Image
 * character) and `<name>_geometry/<n>.ru` (one Shape's triangles each).
 *
 * Every read is bounds checked; a damaged or hostile file is an error that
 * names the offset, never a read past the buffer.
 */

/** The word every character, and the Movie record, carries after its type */
export const CHARACTER_SIGNATURE = 0x09876543;

/** The `.const` file's opening bytes */
const CONST_MAGIC = 'Apt constant file\x1a\0\0';

/** Little-endian, bounds-checked reads over one file */
export class AptReader {
  private readonly view: DataView;

  public constructor(public readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  private check(offset: number, length: number): void {
    if (
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset + length > this.bytes.length
    ) {
      throw new Error(
        `Read of ${length} bytes at ${offset} is outside the ${this.bytes.length} byte file`,
      );
    }
  }

  public u8(offset: number): number {
    this.check(offset, 1);
    return this.bytes[offset];
  }

  public u16(offset: number): number {
    this.check(offset, 2);
    return this.view.getUint16(offset, true);
  }

  public u32(offset: number): number {
    this.check(offset, 4);
    return this.view.getUint32(offset, true);
  }

  public i32(offset: number): number {
    this.check(offset, 4);
    return this.view.getInt32(offset, true);
  }

  public f32(offset: number): number {
    this.check(offset, 4);
    return this.view.getFloat32(offset, true);
  }

  /** A NUL-terminated string, decoded as Latin-1 so every byte survives */
  public cstr(offset: number, maxLength = 65536): string {
    this.check(offset, 1);

    const end = this.bytes.indexOf(0, offset);

    if (end < 0 || end - offset > maxLength) {
      throw new Error(`Unterminated string at ${offset}`);
    }

    return String.fromCharCode(...this.bytes.subarray(offset, end));
  }

  /** A string a pointer names, or nothing for the null pointer */
  public optionalString(pointer: number): string | undefined {
    return pointer === 0 ? undefined : this.cstr(pointer);
  }
}

/** One item of a `.const` file */
export type ConstItem =
  | { kind: 'string'; value: string; offset: number }
  | { kind: 'number'; value: number };

/** A parsed `.const` file */
export interface ConstFile {
  /** Where the Movie record sits in the `.apt` */
  movieOffset: number;
  items: ConstItem[];
  /** Where the item array starts, which an append moves */
  itemsOffset: number;
}

/** Parses a `.const` file */
export const parseConst = (bytes: Uint8Array): ConstFile => {
  const reader = new AptReader(bytes);

  if (
    String.fromCharCode(...bytes.subarray(0, CONST_MAGIC.length)) !==
    CONST_MAGIC
  ) {
    throw new Error('Not an APT constant file');
  }

  const movieOffset = reader.u32(0x14);
  const count = reader.u32(0x18);
  const itemsOffset = reader.u32(0x1c);

  if (itemsOffset + count * 8 > bytes.length) {
    throw new Error(`.const claims ${count} items, more than the file holds`);
  }

  const items: ConstItem[] = [];

  for (let index = 0; index < count; index++) {
    const type = reader.u32(itemsOffset + index * 8);
    const value = reader.u32(itemsOffset + index * 8 + 4);

    if (type === 1) {
      items.push({ kind: 'string', value: reader.cstr(value), offset: value });
    } else if (type === 4) {
      items.push({ kind: 'number', value });
    } else {
      throw new Error(`.const item ${index} has unknown type ${type}`);
    }
  }

  return { movieOffset, items, itemsOffset };
};

/** An axis-aligned box: left, top, right, bottom */
export type Rect = [number, number, number, number];

/** A 2x2 matrix in the stored field order m00, m01, m10, m11 */
export type Matrix2 = [number, number, number, number];

/** The fields of a Movie record */
export interface MovieRecord {
  offset: number;
  frameCount: number;
  framesOffset: number;
  characterCount: number;
  charactersOffset: number;
  screenWidth: number;
  screenHeight: number;
  /** Usually 33, meaning unknown; mint measured 40 and 83 once each */
  unknown36: number;
  importCount: number;
  importsOffset: number;
  exportCount: number;
  exportsOffset: number;
}

/** One button state: a character placed at a depth for some of four states */
export interface ButtonRecord {
  offset: number;
  /** Bit 0 up, 1 over, 2 down, 3 hit test; hit-test-only records draw nothing */
  flags: number;
  character: number;
  depth: number;
  matrix: Matrix2;
  translate: [number, number];
  /** Multiply colour as floats R, G, B, A (OpenSAGE's `ButtonRecord.Color`) */
  color: [number, number, number, number];
  /** Four floats OpenSAGE reads and names only as unknown */
  unknown: [number, number, number, number];
}

/** One glyph of a text record: an index whose meaning is unconfirmed, and an advance */
export interface TextGlyph {
  index: number;
  advance: number;
}

/**
 * One run of a Text character, 56 bytes: font, a colour stored as a rect of
 * floats, a rect read as unknown, the pen offset, the height and the glyphs
 */
export interface TextRecord {
  offset: number;
  font: number;
  /** R, G, B, A, read cross-wired from the stored rect as mint and AptConverter do */
  color: [number, number, number, number];
  unknown: Rect;
  penOffset: [number, number];
  textHeight: number;
  glyphs: TextGlyph[];
}

/** A button's action block and when it runs */
export interface ButtonAction {
  condition: number;
  block: number;
}

/** One entry of a movie's character dictionary */
export type Character = { id: number; offset: number } & (
  | { type: 'shape'; bounds: Rect; geometry: number }
  | {
      type: 'editText';
      bounds: Rect;
      font: number;
      alignment: number;
      /** ARGB by value: alpha in the top byte */
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
      records: ButtonRecord[];
      actions: ButtonAction[];
      hitTriangles: number;
    }
  | { type: 'sprite'; frameCount: number; framesOffset: number }
  | { type: 'image'; texture: number }
  | { type: 'morph'; startShape: number; endShape: number }
  | { type: 'movie'; record: MovieRecord }
  | {
      type: 'text';
      bounds: Rect;
      matrix: Matrix2;
      translate: [number, number];
      records: TextRecord[];
    }
  /** A slot an import fills at load time */
  | { type: 'placeholder' }
  | { type: 'unknown'; characterType: number }
);

/** The type names of a character, by stored type */
const CHARACTER_TYPES: Record<number, string> = {
  1: 'shape',
  2: 'editText',
  3: 'font',
  4: 'button',
  5: 'sprite',
  7: 'image',
  8: 'morph',
  9: 'movie',
  10: 'text',
};

/** The bits of a PlaceObject's flags word */
export const PLACE_FLAGS = {
  move: 0x01,
  hasCharacter: 0x02,
  hasMatrix: 0x04,
  hasColorTransform: 0x08,
  hasRatio: 0x10,
  hasName: 0x20,
  hasClipDepth: 0x40,
  hasClipActions: 0x80,
};

/** One item of a frame, at the offset its record sits */
export type FrameItem = { offset: number } & (
  | { type: 'action'; block: number }
  | { type: 'frameLabel'; label: string; flags: number; frame: number }
  | {
      type: 'placeObject';
      flags: number;
      depth: number;
      character?: number;
      matrix?: Matrix2;
      translate?: [number, number];
      /** Multiply term, memory order R, G, B, A */
      colorTransform?: number;
      /** Add term, 0x00RRGGBB */
      colorAdd?: number;
      ratio?: number;
      name?: string;
      clipDepth?: number;
      clipActions?: { events: number; block: number }[];
    }
  | { type: 'removeObject'; depth: number }
  | { type: 'backgroundColor'; color: number }
  | { type: 'initAction'; sprite: number; block: number }
  | { type: 'unknown'; itemType: number }
);

/** One frame of a timeline: its items in order */
export interface Frame {
  items: FrameItem[];
}

/** An import: a placeholder slot filled from another movie's export */
export interface AptImport {
  movie: string;
  name: string;
  character: number;
}

/** An export: a name another movie imports, and the character it means */
export interface AptExport {
  name: string;
  character: number;
}

/** A parsed movie */
export interface AptMovie {
  record: MovieRecord;
  characters: Character[];
  imports: AptImport[];
  exports: AptExport[];
  /** The movie's own timeline */
  frames: Frame[];
}

const readRect = (reader: AptReader, at: number): Rect => [
  reader.f32(at),
  reader.f32(at + 4),
  reader.f32(at + 8),
  reader.f32(at + 12),
];

const readMatrix = (reader: AptReader, at: number): Matrix2 => [
  reader.f32(at),
  reader.f32(at + 4),
  reader.f32(at + 8),
  reader.f32(at + 12),
];

/** Reads a Movie record at an offset */
export const parseMovieRecord = (
  reader: AptReader,
  offset: number,
): MovieRecord => {
  if (
    reader.u32(offset) !== 9 ||
    reader.u32(offset + 4) !== CHARACTER_SIGNATURE
  ) {
    throw new Error(`No Movie record at ${offset}`);
  }

  return {
    offset,
    frameCount: reader.u32(offset + 8),
    framesOffset: reader.u32(offset + 12),
    characterCount: reader.u32(offset + 20),
    charactersOffset: reader.u32(offset + 24),
    screenWidth: reader.u32(offset + 28),
    screenHeight: reader.u32(offset + 32),
    unknown36: reader.u32(offset + 36),
    importCount: reader.u32(offset + 40),
    importsOffset: reader.u32(offset + 44),
    exportCount: reader.u32(offset + 48),
    exportsOffset: reader.u32(offset + 52),
  };
};

/** Refuses a count no file of this size could hold */
const checkCount = (reader: AptReader, count: number, stride: number): void => {
  if (count * stride > reader.bytes.length) {
    throw new Error(`A count of ${count} cannot fit in the file`);
  }
};

/** Reads a text record; its colour maps the rect's top, left, bottom, right to R, G, B, A */
const parseTextRecord = (reader: AptReader, at: number): TextRecord => {
  const [left, top, right, bottom] = readRect(reader, at + 4);
  const count = reader.u32(at + 48);
  const glyphs = reader.u32(at + 52);

  checkCount(reader, count, 8);

  return {
    offset: at,
    font: reader.u32(at),
    color: [top, left, bottom, right],
    unknown: readRect(reader, at + 20),
    penOffset: [reader.f32(at + 36), reader.f32(at + 40)],
    textHeight: reader.f32(at + 44),
    glyphs: Array.from({ length: count }, (_, index) => ({
      index: reader.u32(glyphs + index * 8),
      advance: reader.i32(glyphs + index * 8 + 4),
    })),
  };
};

const parseCharacter = (
  reader: AptReader,
  id: number,
  offset: number,
): Character => {
  let type: number;

  try {
    type = reader.u32(offset);

    if (reader.u32(offset + 4) !== CHARACTER_SIGNATURE) {
      return { id, offset, type: 'placeholder' };
    }
  } catch {
    return { id, offset, type: 'placeholder' };
  }

  switch (CHARACTER_TYPES[type]) {
    case 'shape':
      return {
        id,
        offset,
        type: 'shape',
        bounds: readRect(reader, offset + 8),
        geometry: reader.u32(offset + 24),
      };
    case 'editText':
      return {
        id,
        offset,
        type: 'editText',
        bounds: readRect(reader, offset + 8),
        font: reader.u32(offset + 24),
        alignment: reader.u32(offset + 28),
        color: reader.u32(offset + 32),
        fontHeight: reader.f32(offset + 36),
        readonly: reader.u32(offset + 40),
        multiline: reader.u32(offset + 44),
        wordwrap: reader.u32(offset + 48),
        text: reader.optionalString(reader.u32(offset + 52)),
        variable: reader.optionalString(reader.u32(offset + 56)),
      };
    case 'font': {
      const count = reader.u32(offset + 12);
      const table = reader.u32(offset + 16);

      checkCount(reader, count, 4);

      return {
        id,
        offset,
        type: 'font',
        name: reader.optionalString(reader.u32(offset + 8)),
        glyphs: Array.from({ length: count }, (_, index) =>
          reader.u32(table + index * 4),
        ),
      };
    }
    case 'button': {
      const recordCount = reader.u32(offset + 44);
      const recordsOffset = reader.u32(offset + 48);
      const actionCount = reader.u32(offset + 52);
      const actionsOffset = reader.u32(offset + 56);

      checkCount(reader, recordCount, 68);
      checkCount(reader, actionCount, 8);

      return {
        id,
        offset,
        type: 'button',
        bounds: readRect(reader, offset + 12),
        hitTriangles: reader.u32(offset + 28),
        records: Array.from({ length: recordCount }, (_, index) => {
          const at = recordsOffset + index * 68;

          return {
            offset: at,
            flags: reader.u32(at),
            character: reader.u32(at + 4),
            depth: reader.i32(at + 8),
            matrix: readMatrix(reader, at + 12),
            translate: [reader.f32(at + 28), reader.f32(at + 32)],
            color: readMatrix(reader, at + 36),
            unknown: readMatrix(reader, at + 52),
          };
        }),
        actions: Array.from({ length: actionCount }, (_, index) => ({
          condition: reader.u32(actionsOffset + index * 8),
          block: reader.u32(actionsOffset + index * 8 + 4),
        })),
      };
    }
    case 'sprite':
      return {
        id,
        offset,
        type: 'sprite',
        frameCount: reader.u32(offset + 8),
        framesOffset: reader.u32(offset + 12),
      };
    case 'image':
      return { id, offset, type: 'image', texture: reader.u32(offset + 8) };
    case 'morph':
      return {
        id,
        offset,
        type: 'morph',
        startShape: reader.u32(offset + 8),
        endShape: reader.u32(offset + 12),
      };
    case 'movie':
      return {
        id,
        offset,
        type: 'movie',
        record: parseMovieRecord(reader, offset),
      };
    case 'text': {
      const count = reader.u32(offset + 48);
      const records = reader.u32(offset + 52);

      checkCount(reader, count, 56);

      return {
        id,
        offset,
        type: 'text',
        bounds: readRect(reader, offset + 8),
        matrix: readMatrix(reader, offset + 24),
        translate: [reader.f32(offset + 40), reader.f32(offset + 44)],
        records: Array.from({ length: count }, (_, index) =>
          parseTextRecord(reader, records + index * 56),
        ),
      };
    }
    default:
      return { id, offset, type: 'unknown', characterType: type };
  }
};

const parseFrameItem = (reader: AptReader, offset: number): FrameItem => {
  const type = reader.u32(offset);

  switch (type) {
    case 1:
      return { offset, type: 'action', block: reader.u32(offset + 4) };
    case 2:
      return {
        offset,
        type: 'frameLabel',
        label: reader.cstr(reader.u32(offset + 4)),
        flags: reader.u32(offset + 8),
        frame: reader.u32(offset + 12),
      };
    case 3: {
      const flags = reader.u32(offset + 4);
      const has = (bit: number) => (flags & bit) !== 0;
      const clipActionsOffset = has(PLACE_FLAGS.hasClipActions)
        ? reader.u32(offset + 60)
        : 0;
      let clipActions: { events: number; block: number }[] | undefined;

      // A clip action pointer of 0 with the flag set means no handlers
      if (clipActionsOffset) {
        const count = reader.u32(clipActionsOffset);
        const array = reader.u32(clipActionsOffset + 4);

        checkCount(reader, count, 12);
        clipActions = Array.from({ length: count }, (_, index) => ({
          events: reader.u32(array + index * 12),
          block: reader.u32(array + index * 12 + 8),
        }));
      }

      return {
        offset,
        type: 'placeObject',
        flags,
        depth: reader.i32(offset + 8),
        character: has(PLACE_FLAGS.hasCharacter)
          ? reader.u32(offset + 12)
          : undefined,
        matrix: has(PLACE_FLAGS.hasMatrix)
          ? readMatrix(reader, offset + 16)
          : undefined,
        translate: has(PLACE_FLAGS.hasMatrix)
          ? [reader.f32(offset + 32), reader.f32(offset + 36)]
          : undefined,
        colorTransform: has(PLACE_FLAGS.hasColorTransform)
          ? reader.u32(offset + 40)
          : undefined,
        colorAdd: has(PLACE_FLAGS.hasColorTransform)
          ? reader.u32(offset + 44)
          : undefined,
        ratio: has(PLACE_FLAGS.hasRatio) ? reader.f32(offset + 48) : undefined,
        name: has(PLACE_FLAGS.hasName)
          ? reader.optionalString(reader.u32(offset + 52))
          : undefined,
        clipDepth: has(PLACE_FLAGS.hasClipDepth)
          ? reader.i32(offset + 56)
          : undefined,
        clipActions,
      };
    }
    case 4:
      return { offset, type: 'removeObject', depth: reader.i32(offset + 4) };
    case 5:
      return { offset, type: 'backgroundColor', color: reader.u32(offset + 4) };
    case 8:
      return {
        offset,
        type: 'initAction',
        sprite: reader.u32(offset + 4),
        block: reader.u32(offset + 8),
      };
    default:
      return { offset, type: 'unknown', itemType: type };
  }
};

/** Reads a timeline: `count` frames of `{item count, -> item pointer array}` */
export const parseFrames = (
  reader: AptReader,
  count: number,
  offset: number,
): Frame[] => {
  checkCount(reader, count, 8);

  return Array.from({ length: count }, (_, index) => {
    const itemCount = reader.u32(offset + index * 8);
    const items = reader.u32(offset + index * 8 + 4);

    checkCount(reader, itemCount, 4);

    return {
      items: Array.from({ length: itemCount }, (_, item) =>
        parseFrameItem(reader, reader.u32(items + item * 4)),
      ),
    };
  });
};

/** Parses a movie from its `.apt` bytes and the Movie record offset its `.const` gives */
export const parseAptMovie = (
  apt: Uint8Array,
  movieOffset: number,
): AptMovie => {
  const reader = new AptReader(apt);
  const record = parseMovieRecord(reader, movieOffset);

  checkCount(reader, record.characterCount, 4);
  checkCount(reader, record.importCount, 16);
  checkCount(reader, record.exportCount, 8);

  return {
    record,
    characters: Array.from({ length: record.characterCount }, (_, id) =>
      parseCharacter(reader, id, reader.u32(record.charactersOffset + id * 4)),
    ),
    imports: Array.from({ length: record.importCount }, (_, index) => {
      const at = record.importsOffset + index * 16;

      return {
        movie: reader.cstr(reader.u32(at)),
        name: reader.cstr(reader.u32(at + 4)),
        character: reader.u32(at + 8),
      };
    }),
    exports: Array.from({ length: record.exportCount }, (_, index) => {
      const at = record.exportsOffset + index * 8;

      return {
        name: reader.cstr(reader.u32(at)),
        character: reader.u32(at + 4),
      };
    }),
    frames: parseFrames(reader, record.frameCount, record.framesOffset),
  };
};

/** Reads the frames of a sprite character */
export const parseSpriteFrames = (
  apt: Uint8Array,
  sprite: Extract<Character, { type: 'sprite' }>,
): Frame[] =>
  parseFrames(new AptReader(apt), sprite.frameCount, sprite.framesOffset);
