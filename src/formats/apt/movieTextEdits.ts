import { parseAptMovie, parseConst } from './aptMovie';
import type { AptMovie, ConstItem } from './aptMovie';
import {
  addBlock,
  appendConstItems,
  decompileBlock,
  replaceBlock,
} from './aptScript';
import { AptImage, applyAptEdit, changeConstItem } from './aptWriter';
import type {
  AptEdit,
  CharacterChange,
  ConstItemChange,
  EditResult,
  PlacementChange,
  PlacementField,
} from './aptWriter';
import type { FrameSpec } from './aptTimeline';
import { f32Bits, movieToText, printMovieText } from './movieText';
import type {
  ButtonActionText,
  ButtonRecordText,
  CharacterText,
  ClipActionText,
  FrameText,
  ItemText,
  MovieText,
  ScriptText,
  TextRunText,
} from './movieText';

/**
 * Saving a movie's text: the differences between the movie as it stands and
 * the text as edited become the editor's own edits, `AptEdit`s through
 * `applyAptEdit` and scripts through the compiler, so a field that was not
 * edited is not written and a movie whose text did not change is not touched
 * at all.
 *
 * Lists are matched before they are compared. Entries that print alike are
 * the same entry; between them, entries of the same kind pair in order and
 * are edited field by field; what is left over is removed or added. Frame
 * items are written back in the order the text gives them, so moving a
 * line moves the record; other lists take additions at their end.
 *
 * Everything is applied to a copy, and the result is read back and printed:
 * a save is accepted only when that print equals the text, so the text
 * either becomes the movie exactly or the movie stays as it was.
 */

/** A save that cannot be made, at the line of the text that asks for it */
export class TextSaveError extends Error {
  public constructor(
    message: string,
    public readonly line = 0,
  ) {
    super(message);
  }
}

/** What saving a text made */
export interface TextSave {
  apt: Uint8Array;
  constBytes: Uint8Array;
  /** The movie edits applied, in order, with the blocks scripts were compiled to */
  edits: AptEdit[];
  constChanges: ConstItemChange[];
  /** `.const` items appended, by a new item in the text or a compiled script */
  constAdded: ConstItem[];
  /** Blocks whose script changed, and where the compiled script went */
  scripts: { block: number; start: number }[];
}

/** Reads every action block of a movie as the text shows it */
export const blockScripts =
  (apt: Uint8Array, constants: readonly ConstItem[]) =>
  (block: number): ScriptText => {
    try {
      const script = decompileBlock(apt, block, constants);

      return {
        mode:
          script.mode === 'script'
            ? 'as'
            : script.mode === 'assembly'
              ? 'asm'
              : 'listing',
        text: script.text,
        block,
      };
    } catch (error) {
      return {
        mode: 'listing',
        text: `; the block at ${block} cannot be read: ${
          error instanceof Error ? error.message : String(error)
        }`,
        block,
      };
    }
  };

/** The text of a movie and its `.const`, every script decompiled */
export const movieText = (
  apt: Uint8Array,
  constBytes: Uint8Array,
  name?: string,
): string =>
  printMovieText(
    movieToText(
      apt,
      constBytes,
      blockScripts(apt, parseConst(constBytes).items),
    ),
    name,
  );

/** Pairs two lists: alike entries first, then entries of the same kind in order */
export const alignLists = <T>(
  before: T[],
  after: T[],
  key: (entry: T) => string,
  kind: (entry: T) => string = () => '',
): [number | undefined, number | undefined][] => {
  const a = before.map(key);
  const b = after.map(key);
  const lengths = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );

  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i][j] =
        a[i] === b[j]
          ? lengths[i + 1][j + 1] + 1
          : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }

  const pairs: [number | undefined, number | undefined][] = [];
  let gapA: number[] = [];
  let gapB: number[] = [];
  const flush = () => {
    const used = new Set<number>();

    for (const j of gapB) {
      const i = gapA.find(
        (each) => !used.has(each) && kind(before[each]) === kind(after[j]),
      );

      if (i === undefined) {
        pairs.push([undefined, j]);
      } else {
        used.add(i);
        pairs.push([i, j]);
      }
    }
    gapA
      .filter((each) => !used.has(each))
      .forEach((i) => pairs.push([i, undefined]));
    gapA = [];
    gapB = [];
  };
  let i = 0;
  let j = 0;

  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      flush();
      pairs.push([i++, j++]);
    } else if (
      j >= b.length ||
      (i < a.length && lengths[i + 1][j] >= lengths[i][j + 1])
    ) {
      gapA.push(i++);
    } else {
      gapB.push(j++);
    }
  }
  flush();
  return pairs;
};

const sameFloats = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length &&
  a.every((value, index) => f32Bits(value) === f32Bits(b[index]));

const sameFloat = (a: number | undefined, b: number | undefined) =>
  a === undefined || b === undefined ? a === b : f32Bits(a) === f32Bits(b);

const printItem = (item: ItemText): string =>
  JSON.stringify(item, (key, value) =>
    key === 'offset' || key === 'line' || key === 'endLine' || key === 'block'
      ? undefined
      : typeof value === 'number' &&
          (!Number.isInteger(value) || Object.is(value, -0))
        ? f32Bits(value)
        : value,
  );

/** A script one or more places run, and what the text wants it to be */
interface ScriptSite {
  block: number;
  before: ScriptText;
  after: ScriptText;
}

class TextSaver {
  public readonly edits: AptEdit[] = [];
  public readonly constChanges: ConstItemChange[] = [];
  public readonly constAdded: ConstItem[] = [];
  public readonly scripts: { block: number; start: number }[] = [];
  public image: AptImage;
  public constBytes: Uint8Array;
  private readonly movieOffset: number;
  private parsed?: AptMovie;
  /** Every block's script as last known, which a cheap read of the movie reuses */
  private readonly known = new Map<number, ScriptText>();
  private readonly sites: ScriptSite[] = [];
  /** Timelines whose frames are written back in the text's order */
  private readonly orders = new Map<number, (number[] | undefined)[]>();

  public constructor(
    apt: Uint8Array,
    constBytes: Uint8Array,
    before: MovieText,
  ) {
    this.image = new AptImage(apt);
    this.constBytes = constBytes;
    this.movieOffset = parseConst(constBytes).movieOffset;

    const remember = (script: ScriptText) => {
      if (script.block !== undefined) {
        this.known.set(script.block, script);
      }
    };

    for (const character of before.characters) {
      if (character.type === 'button') {
        character.actions.forEach((action) => remember(action.script));
      }
      if (character.type === 'sprite' || character.type === 'movie') {
        for (const item of character.frames.flatMap((frame) => frame.items)) {
          if (item.type === 'action' || item.type === 'initAction') {
            remember(item.script);
          } else if (item.type === 'place') {
            item.clipActions?.forEach((action) => remember(action.script));
          }
        }
      }
    }
  }

  private get constants(): ConstItem[] {
    return parseConst(this.constBytes).items;
  }

  public get movie(): AptMovie {
    this.parsed ??= parseAptMovie(this.image.bytes, this.movieOffset);
    return this.parsed;
  }

  /** The movie as it now stands, scripts as last known */
  public current(): MovieText {
    return movieToText(
      this.image.bytes,
      this.constBytes,
      (block) => this.known.get(block) ?? { mode: 'listing', text: '', block },
      { movie: this.movie, constFile: parseConst(this.constBytes) },
    );
  }

  public apply(edit: AptEdit): EditResult {
    const result = applyAptEdit(this.image, this.movieOffset, edit);

    this.parsed = undefined;
    this.edits.push(edit);
    return result;
  }

  private addConstants(items: ConstItem[]): void {
    if (items.length) {
      this.constBytes = appendConstItems(this.constBytes, items);
      this.constAdded.push(...items);
    }
  }

  /** Compiles a script to a new block; returns where it starts */
  public compile(script: ScriptText, line: number): number {
    if (script.mode === 'listing') {
      throw new TextSaveError(
        'A listing cannot be compiled; write the script in an ```as fence',
        script.line ?? line,
      );
    }

    try {
      const { start, added } = addBlock(
        this.image,
        script.text,
        this.constants,
      );

      this.parsed = undefined;
      this.addConstants(added);
      this.known.set(start, { ...script, block: start });
      return start;
    } catch (error) {
      throw new TextSaveError(
        `The script does not compile: ${error instanceof Error ? error.message : String(error)}`,
        script.line ?? line,
      );
    }
  }

  /** Notes a script the text shows at a place that runs `before`'s block */
  public script(before: ScriptText, after: ScriptText): void {
    if (before.block !== undefined) {
      this.sites.push({ block: before.block, before, after });
    }
  }

  // Constants

  public saveConstants(before: MovieText, after: MovieText): void {
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

        this.constBytes = changeConstItem(this.constBytes, change);
        this.constChanges.push(change);
      }
    });
    this.addConstants(
      after.constants
        .slice(before.constants.length)
        .map(
          (item): ConstItem =>
            typeof item.value === 'string'
              ? { kind: 'string', value: item.value, offset: 0 }
              : { kind: 'number', value: item.value },
        ),
    );
  }

  // Imports and exports

  public saveImports(before: MovieText, after: MovieText): void {
    const pairs = alignLists(before.imports, after.imports, (entry) =>
      JSON.stringify([entry.character, entry.movie, entry.name]),
    );

    this.checkAppended(pairs, after.imports, 'import');
    pairs
      .filter(([, j]) => j === undefined)
      .map(([i]) => i!)
      .sort((a, b) => b - a)
      .forEach((index) => this.apply({ kind: 'removeImport', index }));

    let index = 0;

    for (const [i, j] of pairs) {
      if (j === undefined) {
        continue;
      }

      const next = after.imports[j];

      if (i === undefined) {
        const id = this.movie.record.characterCount;

        if (next.character !== id) {
          throw new TextSaveError(
            `A new import takes the next character id, ${id}; write import ${id} and add character ${id} placeholder`,
            next.line,
          );
        }
        this.apply({ kind: 'addImport', movie: next.movie, name: next.name });
      } else {
        const was = before.imports[i];

        if (
          was.movie !== next.movie ||
          was.name !== next.name ||
          was.character !== next.character
        ) {
          this.apply({
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
  }

  public saveExports(before: MovieText, after: MovieText): void {
    const pairs = alignLists(before.exports, after.exports, (entry) =>
      JSON.stringify([entry.character, entry.name]),
    );

    this.checkAppended(pairs, after.exports, 'export');
    pairs
      .filter(([, j]) => j === undefined)
      .map(([i]) => i!)
      .sort((a, b) => b - a)
      .forEach((index) => this.apply({ kind: 'removeExport', index }));

    let index = 0;

    for (const [i, j] of pairs) {
      if (j === undefined) {
        continue;
      }

      const next = after.exports[j];

      if (i === undefined) {
        this.apply({
          kind: 'addExport',
          name: next.name,
          character: next.character,
        });
      } else {
        const was = before.exports[i];

        if (was.name !== next.name || was.character !== next.character) {
          this.apply({
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
  }

  /** Refuses an addition in the middle of a list that only grows at its end */
  private checkAppended(
    pairs: [number | undefined, number | undefined][],
    after: { line?: number }[],
    what: string,
  ): void {
    let added: number | undefined;

    for (const [i, j] of pairs) {
      if (j === undefined) {
        continue;
      }
      if (i === undefined) {
        added ??= j;
      } else if (added !== undefined) {
        throw new TextSaveError(
          `A new ${what} goes after the existing ones`,
          after[added].line,
        );
      }
    }
  }

  // Characters

  public saveCharacters(after: MovieText): void {
    const current = this.current();

    if (after.characters.length < current.characters.length) {
      throw new TextSaveError(
        `Characters cannot be taken out of the list, ids would change; write character ${after.characters.length} placeholder to empty a slot`,
        after.characters.at(-1)?.endLine ?? 0,
      );
    }

    for (const next of after.characters) {
      let was: CharacterText | undefined = current.characters[next.id];

      if (!was) {
        if (
          next.type !== 'editText' &&
          next.type !== 'sprite' &&
          next.type !== 'shape' &&
          next.type !== 'image' &&
          next.type !== 'button'
        ) {
          throw new TextSaveError(
            `A new character is an edittext, sprite, shape, image or button; a ${next.type} cannot be added`,
            next.line,
          );
        }

        const { character } = this.apply({
          kind: 'addCharacter',
          type: next.type,
        });

        if (character !== next.id) {
          throw new TextSaveError(
            `The new character took id ${character}, not ${next.id}`,
            next.line,
          );
        }
        was = this.current().characters[next.id];
      }

      if (next.type === 'placeholder' && was.type !== 'placeholder') {
        this.apply({ kind: 'removeCharacter', id: next.id });
        continue;
      }
      if (was.type !== next.type) {
        throw new TextSaveError(
          `Character ${next.id} is a ${was.type}; a character's type cannot change`,
          next.line,
        );
      }
      this.saveCharacter(was, next);
    }
  }

  private character(id: number, change: CharacterChange): void {
    this.apply({ kind: 'character', id, change });
  }

  private saveCharacter(was: CharacterText, next: CharacterText): void {
    const line = next.line ?? 0;
    const id = next.id;
    const field = (
      before: unknown,
      after: unknown,
      change: () => CharacterChange,
    ) => {
      const differs =
        typeof before === 'number' && typeof after === 'number'
          ? !sameFloat(before, after)
          : Array.isArray(before) && Array.isArray(after)
            ? !sameFloats(before as number[], after as number[])
            : before !== after;

      if (differs) {
        this.character(id, change());
      }
    };

    switch (next.type) {
      case 'movie': {
        if (was.type !== 'movie') {
          return;
        }
        if (next.screen && was.screen) {
          if (
            next.screen.width !== was.screen.width ||
            next.screen.height !== was.screen.height
          ) {
            this.apply({
              kind: 'screen',
              width: next.screen.width,
              height: next.screen.height,
            });
          }
          if (next.screen.unknown36 !== was.screen.unknown36) {
            this.apply({
              kind: 'movieUnknown36',
              value: next.screen.unknown36,
            });
          }
        } else if (Boolean(next.screen) !== Boolean(was.screen)) {
          throw new TextSaveError(
            'Only character 0 carries screen= and unknown36=',
            line,
          );
        }
        return;
      }
      case 'shape':
        if (was.type === 'shape') {
          field(was.bounds, next.bounds, () => ({
            field: 'bounds',
            value: next.bounds,
          }));
          field(was.geometry, next.geometry, () => ({
            field: 'geometry',
            value: next.geometry,
          }));
        }
        return;
      case 'editText':
        if (was.type === 'editText') {
          field(was.bounds, next.bounds, () => ({
            field: 'bounds',
            value: next.bounds,
          }));
          for (const key of [
            'font',
            'alignment',
            'color',
            'fontHeight',
            'readonly',
            'multiline',
            'wordwrap',
          ] as const) {
            field(was[key], next[key], () => ({
              field: key,
              value: next[key],
            }));
          }
          for (const key of ['text', 'variable'] as const) {
            field(was[key], next[key], () => ({
              field: key,
              value: next[key],
            }));
          }
        }
        return;
      case 'font':
        if (was.type === 'font') {
          field(was.name, next.name, () => ({
            field: 'fontName',
            value: next.name,
          }));
          if (was.glyphs.join() !== next.glyphs.join()) {
            this.character(id, { field: 'glyphs', value: next.glyphs });
          }
        }
        return;
      case 'image':
        if (was.type === 'image') {
          field(was.texture, next.texture, () => ({
            field: 'texture',
            value: next.texture,
          }));
        }
        return;
      case 'morph':
        if (was.type === 'morph') {
          field(was.startShape, next.startShape, () => ({
            field: 'startShape',
            value: next.startShape,
          }));
          field(was.endShape, next.endShape, () => ({
            field: 'endShape',
            value: next.endShape,
          }));
        }
        return;
      case 'text':
        if (was.type === 'text') {
          field(was.bounds, next.bounds, () => ({
            field: 'bounds',
            value: next.bounds,
          }));
          field(was.placement.matrix, next.placement.matrix, () => ({
            field: 'matrix',
            value: next.placement.matrix,
          }));
          field(was.placement.translate, next.placement.translate, () => ({
            field: 'translate',
            value: next.placement.translate,
          }));
          this.saveRuns(id, was.runs, next.runs);
        }
        return;
      case 'button':
        if (was.type === 'button') {
          field(was.bounds, next.bounds, () => ({
            field: 'bounds',
            value: next.bounds,
          }));
          if (was.hitTriangles !== next.hitTriangles) {
            throw new TextSaveError(
              'hit-triangles counts the hit mesh, which the text does not hold; it cannot change',
              line,
            );
          }
          this.saveButtonRecords(id, was.records, next.records);
          this.saveButtonActions(id, was.actions, next.actions);
        }
        return;
      case 'unknown':
        if (
          was.type === 'unknown' &&
          was.characterType !== next.characterType
        ) {
          throw new TextSaveError('An unknown character keeps its type', line);
        }
        return;
      default:
        return;
    }
  }

  private saveRuns(
    id: number,
    before: TextRunText[],
    after: TextRunText[],
  ): void {
    const pairs = alignLists(before, after, (run) => printItem(run as never));

    this.checkAppended(pairs, after, 'run');
    pairs
      .filter(([, j]) => j === undefined)
      .map(([i]) => i!)
      .sort((a, b) => b - a)
      .forEach((index) => this.apply({ kind: 'removeTextRecord', id, index }));

    let index = 0;

    for (const [i, j] of pairs) {
      if (j === undefined) {
        continue;
      }

      const next = after[j];
      const was =
        i === undefined
          ? (this.apply({ kind: 'addTextRecord', id, font: next.font }),
            this.current().characters[id] as Extract<
              CharacterText,
              { type: 'text' }
            >).runs[index]
          : before[i];
      const change = {
        ...(was.font !== next.font ? { font: next.font } : {}),
        ...(!sameFloats(was.color, next.color) ? { color: next.color } : {}),
        ...(!sameFloats(was.unknown, next.unknown)
          ? { unknown: next.unknown }
          : {}),
        ...(!sameFloats(was.penOffset, next.penOffset)
          ? { penOffset: next.penOffset }
          : {}),
        ...(!sameFloat(was.textHeight, next.textHeight)
          ? { textHeight: next.textHeight }
          : {}),
        ...(JSON.stringify(was.glyphs) !== JSON.stringify(next.glyphs)
          ? { glyphs: next.glyphs }
          : {}),
      };

      if (Object.keys(change).length) {
        this.apply({ kind: 'textRecord', id, index, change });
      }
      index++;
    }
  }

  private saveButtonRecords(
    id: number,
    before: ButtonRecordText[],
    after: ButtonRecordText[],
  ): void {
    const pairs = alignLists(before, after, (record) =>
      printItem(record as never),
    );

    this.checkAppended(pairs, after, 'button record');
    pairs
      .filter(([, j]) => j === undefined)
      .map(([i]) => i!)
      .sort((a, b) => b - a)
      .forEach((index) =>
        this.apply({ kind: 'removeButtonRecord', id, index }),
      );

    let index = 0;

    for (const [i, j] of pairs) {
      if (j === undefined) {
        continue;
      }

      const next = after[j];
      let was: ButtonRecordText;

      if (i === undefined) {
        this.apply({
          kind: 'addButtonRecord',
          id,
          flags: next.flags,
          character: next.character,
          depth: next.depth,
          matrix: next.placement.matrix,
          translate: next.placement.translate,
        });
        was = (
          this.current().characters[id] as Extract<
            CharacterText,
            { type: 'button' }
          >
        ).records[index];
      } else {
        was = before[i];
      }

      const change = {
        ...(was.flags !== next.flags ? { flags: next.flags } : {}),
        ...(was.character !== next.character
          ? { character: next.character }
          : {}),
        ...(was.depth !== next.depth ? { depth: next.depth } : {}),
        ...(!sameFloats(was.placement.matrix, next.placement.matrix)
          ? { matrix: next.placement.matrix }
          : {}),
        ...(!sameFloats(was.placement.translate, next.placement.translate)
          ? { translate: next.placement.translate }
          : {}),
        ...(!sameFloats(was.color, next.color) ? { color: next.color } : {}),
        ...(!sameFloats(was.unknown, next.unknown)
          ? { unknown: next.unknown }
          : {}),
      };

      if (Object.keys(change).length) {
        this.apply({ kind: 'buttonRecord', offset: was.offset!, ...change });
      }
      index++;
    }
  }

  private saveButtonActions(
    id: number,
    before: ButtonActionText[],
    after: ButtonActionText[],
  ): void {
    const pairs = alignLists(before, after, (action) =>
      JSON.stringify([action.condition, action.script.text]),
    );

    this.checkAppended(pairs, after, 'button action');
    pairs
      .filter(([, j]) => j === undefined)
      .map(([i]) => i!)
      .sort((a, b) => b - a)
      .forEach((index) =>
        this.apply({ kind: 'removeButtonAction', id, index }),
      );

    let index = 0;

    for (const [i, j] of pairs) {
      if (j === undefined) {
        continue;
      }

      const next = after[j];

      if (i === undefined) {
        this.apply({
          kind: 'addButtonAction',
          id,
          condition: next.condition,
          block: this.compile(next.script, next.line ?? 0),
        });
      } else {
        const was = before[i];

        if (was.condition !== next.condition) {
          this.apply({
            kind: 'buttonAction',
            id,
            index,
            condition: next.condition,
          });
        }
        this.script(was.script, next.script);
      }
      index++;
    }
  }

  // Timelines

  public saveTimelines(after: MovieText): void {
    for (const next of after.characters) {
      if (next.type === 'sprite' || next.type === 'movie') {
        this.saveTimeline(next.id, next.frames, next.line ?? 0);
      }
    }
  }

  /** The current frames of a timeline */
  private frames(timeline: number): FrameText[] {
    const character = this.current().characters[timeline];

    return character.type === 'sprite' || character.type === 'movie'
      ? character.frames
      : [];
  }

  private saveTimeline(
    timeline: number,
    after: FrameText[],
    line: number,
  ): void {
    let before = this.frames(timeline);

    if (!after.length) {
      throw new TextSaveError('A timeline keeps at least one frame', line);
    }
    for (let count = before.length; count < after.length; count++) {
      this.apply({ kind: 'addFrame', timeline });
    }
    before = this.frames(timeline);

    const orders: (number[] | undefined)[] = [];
    let isReordered = after.length < before.length;

    after.forEach((frame, index) => {
      const order = this.saveFrame(timeline, index, before[index].items, frame);

      orders.push(order);
      isReordered ||= order !== undefined;
    });

    if (isReordered) {
      this.orders.set(timeline, orders);
    }
  }

  /**
   * Edits the items of one frame in place and adds the new ones at its end.
   * Returns the order the frame's records must be written in, when edits
   * in place and removals cannot give it.
   */
  private saveFrame(
    timeline: number,
    frame: number,
    before: ItemText[],
    after: FrameText,
  ): number[] | undefined {
    const pairs = alignLists(
      before,
      after.items,
      printItem,
      (item) => item.type,
    );
    const order: number[] = [];

    for (const [i, j] of pairs) {
      if (j === undefined) {
        continue;
      }

      const next = after.items[j];

      order.push(
        i === undefined
          ? this.addItem(timeline, frame, next)
          : this.saveItem(before[i], next),
      );
    }

    const kept = before.map((item) => item.offset!);
    const removed = pairs
      .filter(([, j]) => j === undefined)
      .map(([i]) => before[i!].offset!);
    const remaining = [...kept];

    for (const offset of removed) {
      remaining.splice(remaining.indexOf(offset), 1);
    }

    const added = order.filter((offset) => !kept.includes(offset));

    if (JSON.stringify([...remaining, ...added]) === JSON.stringify(order)) {
      for (const offset of removed) {
        this.apply({ kind: 'removeItem', timeline, frame, offset });
      }
      return undefined;
    }
    return order;
  }

  /** Adds an item the text has and the movie does not; returns its record's offset */
  private addItem(timeline: number, frame: number, next: ItemText): number {
    const line = next.line ?? 0;
    const offsetOfLast = () => {
      const items = this.frames(timeline)[frame].items;

      return items[items.length - 1].offset!;
    };

    switch (next.type) {
      case 'action': {
        const block = this.compile(next.script, line);

        this.apply({ kind: 'addFrameScript', timeline, frame, block });
        return offsetOfLast();
      }
      case 'label': {
        this.apply({
          kind: 'addFrameLabel',
          timeline,
          frame,
          label: next.label,
        });

        const offset = offsetOfLast();

        if (next.flags || next.frame !== frame) {
          this.apply({
            kind: 'frameLabel',
            offset,
            ...(next.flags ? { flags: next.flags } : {}),
            ...(next.frame !== frame ? { frame: next.frame } : {}),
          });
        }
        return offset;
      }
      case 'place': {
        this.apply({
          kind: 'placeObject',
          timeline,
          frame,
          depth: next.depth,
          character: next.character ?? 0,
          ...(next.placement
            ? {
                matrix: next.placement.matrix,
                translate: next.placement.translate,
              }
            : {}),
          ...(next.name ? { name: next.name } : {}),
        });

        return this.saveItem(this.frames(timeline)[frame].items.at(-1)!, next);
      }
      case 'remove':
        this.apply({
          kind: 'removeObject',
          timeline,
          frame,
          depth: next.depth,
        });
        return offsetOfLast();
      case 'background':
        this.apply({
          kind: 'addBackgroundColor',
          timeline,
          frame,
          color: next.color,
        });
        return offsetOfLast();
      case 'initAction':
        throw new TextSaveError(
          'An init action cannot be added from text; add a frame action instead',
          line,
        );
      case 'unknown':
        throw new TextSaveError('An unknown item cannot be added', line);
    }
  }

  /** Edits an item in place to match the text; returns its record's offset */
  private saveItem(was: ItemText, next: ItemText): number {
    const offset = was.offset!;
    const line = next.line ?? 0;

    switch (next.type) {
      case 'action':
        if (was.type === 'action') {
          this.script(was.script, next.script);
        }
        break;
      case 'label':
        if (was.type === 'label') {
          const change = {
            ...(was.label !== next.label ? { label: next.label } : {}),
            ...(was.flags !== next.flags ? { flags: next.flags } : {}),
            ...(was.frame !== next.frame ? { frame: next.frame } : {}),
          };

          if (Object.keys(change).length) {
            this.apply({ kind: 'frameLabel', offset, ...change });
          }
        }
        break;
      case 'remove':
        if (was.type === 'remove' && was.depth !== next.depth) {
          this.apply({ kind: 'removeObjectDepth', offset, depth: next.depth });
        }
        break;
      case 'background':
        if (was.type === 'background' && was.color !== next.color) {
          this.apply({ kind: 'backgroundColor', offset, color: next.color });
        }
        break;
      case 'initAction':
        if (was.type === 'initAction') {
          if (was.sprite !== next.sprite) {
            this.apply({ kind: 'initAction', offset, sprite: next.sprite });
          }
          this.script(was.script, next.script);
        }
        break;
      case 'unknown':
        if (was.type === 'unknown' && was.itemType !== next.itemType) {
          throw new TextSaveError('An unknown item keeps its type', line);
        }
        break;
      case 'place':
        if (was.type === 'place') {
          this.savePlacement(was, next);
        }
        break;
    }
    return offset;
  }

  private savePlacement(
    was: Extract<ItemText, { type: 'place' }>,
    next: Extract<ItemText, { type: 'place' }>,
  ): void {
    const offset = was.offset!;
    const line = next.line ?? 0;
    const clear: PlacementField[] = [];
    const change: PlacementChange = {};

    if (((was.flags ^ next.flags) & ~0xff) !== 0) {
      throw new TextSaveError(
        'flags= above 0xff are not gated by a field and cannot change',
        line,
      );
    }
    if (was.depth !== next.depth) {
      change.depth = next.depth;
    }
    if (was.character !== next.character) {
      if (next.character === undefined) {
        clear.push('character');
      } else {
        change.character = next.character;
      }
    }
    if (
      Boolean(was.placement) !== Boolean(next.placement) ||
      (was.placement &&
        next.placement &&
        (!sameFloats(was.placement.matrix, next.placement.matrix) ||
          !sameFloats(was.placement.translate, next.placement.translate)))
    ) {
      if (next.placement) {
        change.matrix = next.placement.matrix;
        change.translate = next.placement.translate;
      } else {
        clear.push('matrix');
      }
    }
    if (
      was.colorTransform !== next.colorTransform ||
      was.colorAdd !== next.colorAdd
    ) {
      if (next.colorTransform === undefined) {
        clear.push('colorTransform');
      } else {
        change.colorTransform = next.colorTransform;
        change.colorAdd = next.colorAdd ?? 0;
      }
    }
    if (!sameFloat(was.ratio, next.ratio)) {
      if (next.ratio === undefined) {
        clear.push('ratio');
      } else {
        change.ratio = next.ratio;
      }
    }
    if (was.name !== next.name) {
      if (next.name === undefined) {
        clear.push('name');
      } else {
        change.name = next.name;
      }
    }
    if (was.clipDepth !== next.clipDepth) {
      if (next.clipDepth === undefined) {
        clear.push('clipDepth');
      } else {
        change.clipDepth = next.clipDepth;
      }
    }
    if ((was.flags & 1) !== (next.flags & 1)) {
      change.isMove = (next.flags & 1) !== 0;
    }
    if (clear.length) {
      change.clear = clear;
    }
    if (Object.keys(change).length) {
      this.apply({ kind: 'placement', offset, change });
    }
    this.saveClipActions(offset, was.clipActions ?? [], next.clipActions ?? []);
  }

  private saveClipActions(
    offset: number,
    before: ClipActionText[],
    after: ClipActionText[],
  ): void {
    const pairs = alignLists(before, after, (action) =>
      JSON.stringify([action.events, action.script.text]),
    );

    this.checkAppended(pairs, after, 'clip action');
    pairs
      .filter(([, j]) => j === undefined)
      .map(([i]) => i!)
      .sort((a, b) => b - a)
      .forEach((index) =>
        this.apply({ kind: 'removeClipAction', offset, index }),
      );

    let index = 0;

    for (const [i, j] of pairs) {
      if (j === undefined) {
        continue;
      }

      const next = after[j];

      if (i === undefined) {
        this.apply({
          kind: 'addClipAction',
          offset,
          events: next.events,
          block: this.compile(next.script, next.line ?? 0),
        });
      } else {
        const was = before[i];

        if (was.events !== next.events) {
          this.apply({
            kind: 'clipAction',
            offset,
            index,
            events: next.events,
          });
        }
        this.script(was.script, next.script);
      }
      index++;
    }
  }

  /** Writes the frames whose records were reordered, reusing every other frame */
  public writeOrders(): void {
    for (const [timeline, orders] of this.orders) {
      const frames: FrameSpec[] = orders.map((order, index) =>
        order ? { items: order.map((reuse) => ({ reuse })) } : { reuse: index },
      );

      this.apply({ kind: 'setTimeline', timeline, frames });
    }
  }

  // Scripts

  /** Compiles every script the text changed, once per block */
  public saveScripts(): void {
    const byBlock = new Map<number, ScriptSite[]>();

    for (const site of this.sites) {
      byBlock.set(site.block, [...(byBlock.get(site.block) ?? []), site]);
    }

    for (const [block, sites] of byBlock) {
      const texts = new Set(sites.map((site) => site.after.text));
      const changed = sites.find(
        (site) => site.after.text !== site.before.text,
      );

      if (!changed) {
        continue;
      }
      if (texts.size > 1) {
        throw new TextSaveError(
          `This script runs in ${sites.length} places (lines ${sites
            .map((site) => (site.after.line ?? 0) + 1)
            .join(', ')}); edit every copy alike`,
          changed.after.line,
        );
      }
      if (changed.before.mode === 'listing') {
        throw new TextSaveError(
          'This block shows as a listing, which cannot be compiled back',
          changed.after.line,
        );
      }
      if (changed.after.mode === 'listing') {
        throw new TextSaveError(
          'A listing cannot be compiled; write the script in an ```as fence',
          changed.after.line,
        );
      }

      try {
        const { start, added } = replaceBlock(
          this.image,
          this.movieOffset,
          block,
          changed.after.text,
          this.constants,
        );

        this.parsed = undefined;
        this.addConstants(added);
        this.known.set(start, { ...changed.after, block: start });
        this.scripts.push({ block, start });
      } catch (error) {
        throw new TextSaveError(
          `The script does not compile: ${error instanceof Error ? error.message : String(error)}`,
          changed.after.line,
        );
      }
    }
  }
}

/** The text as the save checks it: what a field edit cannot reach is left out */
const comparable = (movie: MovieText): string =>
  printMovieText(movie).replace(/ flags=0x[0-9a-f]+$/gm, '');

/**
 * Turns the text of a movie as edited into edits of the movie as it stands.
 * `before` is the model the text was made from. Throws `TextSaveError` for
 * a text that cannot be saved; nothing is changed then.
 */
export const saveMovieText = (
  apt: Uint8Array,
  constBytes: Uint8Array,
  before: MovieText,
  after: MovieText,
): TextSave => {
  const saver = new TextSaver(apt, constBytes, before);

  saver.saveConstants(before, after);
  saver.saveImports(before, after);
  saver.saveCharacters(after);
  saver.saveExports(saver.current(), after);
  saver.saveTimelines(after);
  saver.saveScripts();
  saver.writeOrders();

  const result = saver.current();
  const wanted = comparable(after).split('\n');
  const made = comparable(result).split('\n');
  const differs = wanted.findIndex((line, index) => line !== made[index]);

  if (differs >= 0 || made.length !== wanted.length) {
    const index = differs >= 0 ? differs : wanted.length;

    throw new TextSaveError(
      `The movie cannot be made to read "${wanted[index] ?? ''}"; saving it gives "${made[index] ?? ''}"`,
      lineOf(after, wanted[index]),
    );
  }

  return {
    apt: saver.edits.length || saver.scripts.length ? saver.image.bytes : apt,
    constBytes: saver.constBytes,
    edits: saver.edits,
    constChanges: saver.constChanges,
    constAdded: saver.constAdded,
    scripts: saver.scripts,
  };
};

/** Where a printed line came from, best effort, for a problem the check found */
const lineOf = (movie: MovieText, printed: string | undefined): number => {
  const id = /^character (\d+)/.exec(printed ?? '')?.[1];

  return id !== undefined ? (movie.characters[Number(id)]?.line ?? 0) : 0;
};
