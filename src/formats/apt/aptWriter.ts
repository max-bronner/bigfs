import { PLACE_FLAGS, parseAptMovie } from './aptMovie';
import type { AptMovie, Character, Matrix2, Rect } from './aptMovie';

/**
 * Edits an APT movie without moving anything that is not edited.
 *
 * The file is a memory image whose pointers are absolute offsets, so every
 * record stays where it is: a fixed-size field is overwritten in place, and
 * anything new, from a renamed string to an added character, is appended at
 * the end with the one pointer that leads to it updated. A movie saved with
 * no edits is byte-identical to the one read, and an edited one differs only
 * in the fields edited and the bytes appended.
 */

/** A change to one character's own fields */
export type CharacterChange =
  | { field: 'bounds'; value: Rect }
  | { field: 'text' | 'variable' | 'fontName'; value: string | undefined }
  | {
      field:
        | 'color'
        | 'fontHeight'
        | 'alignment'
        | 'font'
        | 'readonly'
        | 'multiline'
        | 'wordwrap'
        | 'texture'
        | 'geometry';
      value: number;
    };

/** A change to one PlaceObject record */
export interface PlacementChange {
  character?: number;
  depth?: number;
  matrix?: Matrix2;
  translate?: [number, number];
  /** Memory order R, G, B, A */
  colorTransform?: number;
  colorAdd?: number;
  ratio?: number;
  /** An empty string removes the name */
  name?: string;
  /** Sets the "move" bit: modify what is at the depth instead of placing anew */
  isMove?: boolean;
}

/** One edit to a movie, as the inspector sends it */
export type AptEdit =
  | { kind: 'character'; id: number; change: CharacterChange }
  | { kind: 'placement'; offset: number; change: PlacementChange }
  | {
      kind: 'buttonRecord';
      offset: number;
      flags?: number;
      matrix?: Matrix2;
      translate?: [number, number];
      character?: number;
      depth?: number;
    }
  | { kind: 'frameLabel'; offset: number; label: string }
  | { kind: 'export'; index: number; name?: string; character?: number }
  | { kind: 'addExport'; name: string; character: number }
  | { kind: 'removeExport'; index: number }
  | { kind: 'import'; index: number; movie?: string; name?: string }
  | { kind: 'screen'; width: number; height: number }
  | { kind: 'duplicateCharacter'; id: number }
  | {
      kind: 'placeObject';
      timeline: number;
      frame: number;
      depth: number;
      character: number;
      translate?: [number, number];
      matrix?: Matrix2;
      name?: string;
    }
  | { kind: 'removeObject'; timeline: number; frame: number; depth: number }
  | { kind: 'addFrameLabel'; timeline: number; frame: number; label: string }
  | { kind: 'removeItem'; timeline: number; frame: number; offset: number }
  | { kind: 'addFrame'; timeline: number };

/** What an edit made, for the inspector to select */
export interface EditResult {
  /** The id of a character the edit added */
  character?: number;
}

/** Byte offsets of a character's fields, by type and field */
const FIELD_OFFSETS: Record<
  string,
  Record<string, [number, 'u32' | 'f32' | 'string' | 'rect']>
> = {
  shape: { bounds: [8, 'rect'], geometry: [24, 'u32'] },
  editText: {
    bounds: [8, 'rect'],
    font: [24, 'u32'],
    alignment: [28, 'u32'],
    color: [32, 'u32'],
    fontHeight: [36, 'f32'],
    readonly: [40, 'u32'],
    multiline: [44, 'u32'],
    wordwrap: [48, 'u32'],
    text: [52, 'string'],
    variable: [56, 'string'],
  },
  font: { fontName: [8, 'string'] },
  button: { bounds: [12, 'rect'] },
  image: { texture: [8, 'u32'] },
  text: { bounds: [8, 'rect'] },
};

/** Bytes each character type's record takes, for a duplicate */
const RECORD_LENGTHS: Record<string, number> = {
  shape: 28,
  editText: 60,
  font: 20,
  button: 60,
  sprite: 20,
  image: 12,
  morph: 16,
  text: 56,
};

/** An `.apt` image that grows at its end */
export class AptImage {
  private data: Uint8Array;
  private view: DataView;
  private size: number;

  public constructor(bytes: Uint8Array) {
    this.data = new Uint8Array(Math.max(64, bytes.length * 2));
    this.data.set(bytes);
    this.size = bytes.length;
    this.view = new DataView(this.data.buffer);
  }

  /** The length of the image as it stands */
  public get length(): number {
    return this.size;
  }

  /** The image as it stands */
  public get bytes(): Uint8Array {
    return this.data.slice(0, this.size);
  }

  private reserve(length: number, align = 4): number {
    const at = (this.size + align - 1) & ~(align - 1);

    if (at + length > this.data.length) {
      const grown = new Uint8Array(
        Math.max(this.data.length * 2, at + length + 1024),
      );

      grown.set(this.data.subarray(0, this.size));
      this.data = grown;
      this.view = new DataView(this.data.buffer);
    }

    this.data.fill(0, this.size, at + length);
    this.size = at + length;

    return at;
  }

  private check(offset: number, length: number): void {
    if (offset < 0 || offset + length > this.size) {
      throw new Error(
        `Write of ${length} bytes at ${offset} is outside the movie`,
      );
    }
  }

  public u32(offset: number): number {
    this.check(offset, 4);
    return this.view.getUint32(offset, true);
  }

  public setU32(offset: number, value: number): void {
    this.check(offset, 4);
    this.view.setUint32(offset, value >>> 0, true);
  }

  public setI32(offset: number, value: number): void {
    this.check(offset, 4);
    this.view.setInt32(offset, value, true);
  }

  public setF32(offset: number, value: number): void {
    this.check(offset, 4);
    this.view.setFloat32(offset, value, true);
  }

  /** Appends a NUL-terminated Latin-1 string and returns its offset */
  public appendString(text: string): number {
    if (/[^\x00-\xff]/.test(text) || text.includes('\0')) {
      throw new Error(
        'A movie string holds Latin-1 characters only, without NUL',
      );
    }

    const at = this.reserve(text.length + 1, 1);

    for (let index = 0; index < text.length; index++) {
      this.data[at + index] = text.charCodeAt(index);
    }

    return at;
  }

  /** Appends words, aligned to four bytes, and returns their offset */
  public appendWords(words: number[]): number {
    const at = this.reserve(words.length * 4);

    words.forEach((word, index) =>
      this.view.setUint32(at + index * 4, word >>> 0, true),
    );

    return at;
  }

  /** Appends a copy of existing bytes, aligned to four, and returns its offset */
  public appendCopy(offset: number, length: number): number {
    this.check(offset, length);

    const copy = this.data.slice(offset, offset + length);
    const at = this.reserve(length);

    this.data.set(copy, at);

    return at;
  }

  /** Appends raw bytes at an alignment, and returns their offset */
  public appendBytes(bytes: Uint8Array, align = 4): number {
    const at = this.reserve(bytes.length, align);

    this.data.set(bytes, at);

    return at;
  }

  /**
   * Moves an array of words to the end with room for `extra` more, points
   * `pointerAt` at the copy and returns its offset
   */
  public growArray(pointerAt: number, count: number, extra: number): number {
    const from = this.u32(pointerAt);
    const words = Array.from({ length: count }, (_, index) =>
      this.u32(from + index * 4),
    );
    const at = this.appendWords([...words, ...new Array(extra).fill(0)]);

    this.setU32(pointerAt, at);

    return at;
  }
}

/** Where a timeline's frame count and frame array pointer are */
const timelineFields = (
  movie: AptMovie,
  timeline: number,
): { countAt: number; pointerAt: number } => {
  const character = movie.characters[timeline];

  if (character?.type === 'movie' || character?.type === 'sprite') {
    return { countAt: character.offset + 8, pointerAt: character.offset + 12 };
  }

  throw new Error(`#${timeline} has no timeline`);
};

/** Appends an item to a frame of a timeline, moving its item array */
const addFrameItem = (
  image: AptImage,
  movie: AptMovie,
  timeline: number,
  frame: number,
  record: number[],
): void => {
  const { countAt, pointerAt } = timelineFields(movie, timeline);
  const frameCount = image.u32(countAt);

  if (frame < 0 || frame >= frameCount) {
    throw new Error(`#${timeline} has no frame ${frame}`);
  }

  const frameAt = image.u32(pointerAt) + frame * 8;
  const itemCount = image.u32(frameAt);
  const items = image.growArray(frameAt + 4, itemCount, 1);

  image.setU32(items + itemCount * 4, image.appendWords(record));
  image.setU32(frameAt, itemCount + 1);
};

/** A PlaceObject record of 64 bytes, as words */
const placeObjectWords = (
  flags: number,
  depth: number,
  character: number,
  matrix: Matrix2,
  translate: [number, number],
  name: number,
): number[] => {
  const f = (value: number) =>
    new Uint32Array(new Float32Array([value]).buffer)[0];

  return [
    3,
    flags,
    depth >>> 0,
    character,
    ...matrix.map(f),
    f(translate[0]),
    f(translate[1]),
    0xffffffff,
    0,
    f(0),
    name,
    0,
    0,
  ];
};

/** Writes a field of a character in place, or repoints a string field */
const changeCharacter = (
  image: AptImage,
  character: Character,
  change: CharacterChange,
): void => {
  const field = FIELD_OFFSETS[character.type]?.[change.field];

  if (!field) {
    throw new Error(`A ${character.type} has no field ${change.field}`);
  }

  const [delta, type] = field;
  const at = character.offset + delta;

  if (type === 'rect') {
    (change.value as Rect).forEach((value, index) =>
      image.setF32(at + index * 4, value),
    );
  } else if (type === 'string') {
    const value = change.value as string | undefined;

    image.setU32(at, value === undefined ? 0 : image.appendString(value));
  } else if (type === 'f32') {
    image.setF32(at, change.value as number);
  } else {
    image.setU32(at, change.value as number);
  }
};

/** Applies a change to a PlaceObject record in place, setting its flags to match */
const changePlacement = (
  image: AptImage,
  offset: number,
  change: PlacementChange,
): void => {
  if (image.u32(offset) !== 3) {
    throw new Error(`No PlaceObject at ${offset}`);
  }

  let flags = image.u32(offset + 4);
  const set = (bit: number, isOn: boolean) => {
    flags = isOn ? flags | bit : flags & ~bit;
  };

  if (change.character !== undefined) {
    image.setU32(offset + 12, change.character);
    set(PLACE_FLAGS.hasCharacter, true);
  }

  if (change.depth !== undefined) {
    image.setI32(offset + 8, change.depth);
  }

  if (change.matrix || change.translate) {
    // A matrix not given keeps the stored one, or identity when there was none
    const hadMatrix = (flags & PLACE_FLAGS.hasMatrix) !== 0;

    if (change.matrix) {
      change.matrix.forEach((value, index) =>
        image.setF32(offset + 16 + index * 4, value),
      );
    } else if (!hadMatrix) {
      [1, 0, 0, 1].forEach((value, index) =>
        image.setF32(offset + 16 + index * 4, value),
      );
    }

    if (change.translate) {
      image.setF32(offset + 32, change.translate[0]);
      image.setF32(offset + 36, change.translate[1]);
    } else if (!hadMatrix) {
      image.setF32(offset + 32, 0);
      image.setF32(offset + 36, 0);
    }

    set(PLACE_FLAGS.hasMatrix, true);
  }

  if (change.colorTransform !== undefined || change.colorAdd !== undefined) {
    if (!(flags & PLACE_FLAGS.hasColorTransform)) {
      image.setU32(offset + 40, 0xffffffff);
      image.setU32(offset + 44, 0);
    }

    if (change.colorTransform !== undefined) {
      image.setU32(offset + 40, change.colorTransform);
    }

    if (change.colorAdd !== undefined) {
      image.setU32(offset + 44, change.colorAdd);
    }

    set(PLACE_FLAGS.hasColorTransform, true);
  }

  if (change.ratio !== undefined) {
    image.setF32(offset + 48, change.ratio);
    set(PLACE_FLAGS.hasRatio, true);
  }

  if (change.name !== undefined) {
    image.setU32(
      offset + 52,
      change.name ? image.appendString(change.name) : 0,
    );
    set(PLACE_FLAGS.hasName, Boolean(change.name));
  }

  if (change.isMove !== undefined) {
    set(PLACE_FLAGS.move, change.isMove);
  }

  image.setU32(offset + 4, flags);
};

/**
 * Applies one edit to a movie. `apt` is changed in place where the edit
 * allows and grown at its end otherwise; the movie is parsed again from it
 * for the next edit.
 */
export const applyAptEdit = (
  image: AptImage,
  movieOffset: number,
  edit: AptEdit,
): EditResult => {
  const movie = parseAptMovie(image.bytes, movieOffset);
  const record = movie.record;

  switch (edit.kind) {
    case 'character': {
      const character = movie.characters[edit.id];

      if (!character) {
        throw new Error(`No character #${edit.id}`);
      }

      changeCharacter(image, character, edit.change);
      return {};
    }
    case 'placement':
      changePlacement(image, edit.offset, edit.change);
      return {};
    case 'buttonRecord': {
      if (edit.flags !== undefined) {
        image.setU32(edit.offset, edit.flags);
      }
      if (edit.character !== undefined) {
        image.setU32(edit.offset + 4, edit.character);
      }
      if (edit.depth !== undefined) {
        image.setI32(edit.offset + 8, edit.depth);
      }
      edit.matrix?.forEach((value, index) =>
        image.setF32(edit.offset + 12 + index * 4, value),
      );

      if (edit.translate) {
        image.setF32(edit.offset + 28, edit.translate[0]);
        image.setF32(edit.offset + 32, edit.translate[1]);
      }

      return {};
    }
    case 'frameLabel':
      if (image.u32(edit.offset) !== 2) {
        throw new Error(`No frame label at ${edit.offset}`);
      }

      image.setU32(edit.offset + 4, image.appendString(edit.label));
      return {};
    case 'export': {
      const at = record.exportsOffset + edit.index * 8;

      if (edit.index < 0 || edit.index >= record.exportCount) {
        throw new Error(`No export ${edit.index}`);
      }

      if (edit.name !== undefined) {
        image.setU32(at, image.appendString(edit.name));
      }
      if (edit.character !== undefined) {
        image.setU32(at + 4, edit.character);
      }
      return {};
    }
    case 'addExport': {
      const array = image.appendWords(
        Array.from({ length: record.exportCount * 2 }, (_, index) =>
          image.u32(record.exportsOffset + index * 4),
        ).concat([image.appendString(edit.name), edit.character]),
      );

      image.setU32(record.offset + 52, array);
      image.setU32(record.offset + 48, record.exportCount + 1);
      return {};
    }
    case 'removeExport': {
      if (edit.index < 0 || edit.index >= record.exportCount) {
        throw new Error(`No export ${edit.index}`);
      }

      // Shifted down in place; the array only shrinks
      for (let index = edit.index; index < record.exportCount - 1; index++) {
        const at = record.exportsOffset + index * 8;

        image.setU32(at, image.u32(at + 8));
        image.setU32(at + 4, image.u32(at + 12));
      }

      image.setU32(record.offset + 48, record.exportCount - 1);
      return {};
    }
    case 'import': {
      const at = record.importsOffset + edit.index * 16;

      if (edit.index < 0 || edit.index >= record.importCount) {
        throw new Error(`No import ${edit.index}`);
      }

      if (edit.movie !== undefined) {
        image.setU32(at, image.appendString(edit.movie));
      }
      if (edit.name !== undefined) {
        image.setU32(at + 4, image.appendString(edit.name));
      }
      return {};
    }
    case 'screen':
      image.setU32(record.offset + 28, edit.width);
      image.setU32(record.offset + 32, edit.height);
      return {};
    case 'duplicateCharacter': {
      const source = movie.characters[edit.id];
      const length = source && RECORD_LENGTHS[source.type];

      if (!source || !length) {
        throw new Error(`#${edit.id} cannot be duplicated`);
      }

      const copy = image.appendCopy(source.offset, length);
      const id = record.characterCount;
      const array = image.growArray(record.offset + 24, id, 1);

      image.setU32(array + id * 4, copy);
      image.setU32(record.offset + 20, id + 1);

      // A shape's geometry and an image's texture are named by its id
      if (source.type === 'shape') {
        image.setU32(copy + 24, id);
      }
      if (source.type === 'image') {
        image.setU32(copy + 8, id);
      }

      // A copy gets its own frames and button records, so editing it never
      // edits the original
      if (source.type === 'sprite') {
        image.growArray(copy + 12, source.frameCount * 2, 0);
      }

      if (source.type === 'button') {
        image.growArray(copy + 48, source.records.length * 17, 0);
      }

      return { character: id };
    }
    case 'placeObject': {
      const name = edit.name ? image.appendString(edit.name) : 0;
      const flags =
        PLACE_FLAGS.hasCharacter |
        PLACE_FLAGS.hasMatrix |
        (name ? PLACE_FLAGS.hasName : 0);

      addFrameItem(
        image,
        movie,
        edit.timeline,
        edit.frame,
        placeObjectWords(
          flags,
          edit.depth,
          edit.character,
          edit.matrix ?? [1, 0, 0, 1],
          edit.translate ?? [0, 0],
          name,
        ),
      );
      return {};
    }
    case 'removeObject':
      addFrameItem(image, movie, edit.timeline, edit.frame, [
        4,
        edit.depth >>> 0,
      ]);
      return {};
    case 'addFrameLabel':
      addFrameItem(image, movie, edit.timeline, edit.frame, [
        2,
        image.appendString(edit.label),
        0,
        edit.frame,
      ]);
      return {};
    case 'removeItem': {
      const { countAt, pointerAt } = timelineFields(movie, edit.timeline);

      if (edit.frame < 0 || edit.frame >= image.u32(countAt)) {
        throw new Error(`#${edit.timeline} has no frame ${edit.frame}`);
      }

      const frameAt = image.u32(pointerAt) + edit.frame * 8;
      const count = image.u32(frameAt);
      // Copied before it shrinks: another frame may share the array
      const items = image.growArray(frameAt + 4, count, 0);
      const position = Array.from({ length: count }, (_, index) =>
        image.u32(items + index * 4),
      ).indexOf(edit.offset);

      if (position < 0) {
        throw new Error(`Frame ${edit.frame} has no item at ${edit.offset}`);
      }

      for (let index = position; index < count - 1; index++) {
        image.setU32(items + index * 4, image.u32(items + (index + 1) * 4));
      }

      image.setU32(frameAt, count - 1);
      return {};
    }
    case 'addFrame': {
      const { countAt, pointerAt } = timelineFields(movie, edit.timeline);
      const count = image.u32(countAt);
      const frames = image.appendWords(
        Array.from({ length: count * 2 }, (_, index) =>
          image.u32(image.u32(pointerAt) + index * 4),
        ).concat([0, 0]),
      );

      image.setU32(pointerAt, frames);
      image.setU32(countAt, count + 1);
      return {};
    }
  }
};
