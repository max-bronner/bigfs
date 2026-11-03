import { PLACE_FLAGS } from '../aptMovie';
import type { Matrix2, Rect } from '../aptMovie';

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

/** A matrix and translation, as a placement or a Text character stores them */
export interface Placement {
  matrix: Matrix2;
  translate: [number, number];
}

/** A frame item as the text holds it */
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

/** A clip action of a placement as the text holds it */
export type ClipActionText = Origin & { events: number; script: ScriptText };

/** A frame of a timeline as the text holds it */
export interface FrameText extends Origin {
  index: number;
  items: ItemText[];
}

/** A button record as the text holds it */
export type ButtonRecordText = Origin & {
  flags: number;
  depth: number;
  character: number;
  placement: Placement;
  color: [number, number, number, number];
  unknown: [number, number, number, number];
};

/** A button action as the text holds it */
export type ButtonActionText = Origin & {
  condition: number;
  script: ScriptText;
};

/** A run of a Text character as the text holds it */
export type TextRunText = Origin & {
  font: number;
  color: [number, number, number, number];
  unknown: Rect;
  penOffset: [number, number];
  textHeight: number;
  glyphs: { index: number; advance: number }[];
};

/** A character as the text holds it */
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

/** A `.const` item as the text holds it */
export type ConstText = Origin & { index: number; value: string | number };
/** An import as the text holds it */
export type ImportText = Origin & {
  character: number;
  movie: string;
  name: string;
};
/** An export as the text holds it */
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
 * Result of `parseMovieText`: the model, and every problem found. A text
 * with problems still gives the parts that read, for an outline and
 * navigation, but is never saved.
 */
export interface ParsedMovieText {
  movie: MovieText;
  problems: TextProblem[];
  ids: IdSite[];
}

/** Names of the four button states, in the order of their bits in a record's flags */
export const BUTTON_STATES = ['up', 'over', 'down', 'hit'];

/** Normalizes script text as the text holds it: no trailing blanks on a line or at the end */
export const normalizeScript = (text: string): string =>
  text.replace(/[ \t]+$/gm, '').replace(/\n+$/, '');

/** Computes the flags word a placement's fields imply */
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
