import { parseAptMovie, parseConst } from '../../aptMovie';
import type { AptMovie, ConstItem } from '../../aptMovie';
import { addBlock, appendConstItems, replaceBlock } from '../../aptScript';
import { applyAptEdit } from '../../writer/applyAptEdit';
import { AptImage } from '../../writer/aptImage';
import { changeConstItem } from '../../writer/changeConstItem';
import type {
  AptEdit,
  ConstItemChange,
  EditResult,
} from '../../writer/aptEdit';
import { movieToText } from '../fromMovie';
import type { MovieText, ScriptText } from '../textModel';
import { TextSaveError } from './textSaveError';

/** A script one or more places run, and what the text wants it to be */
export interface ScriptSite {
  block: number;
  before: ScriptText;
  after: ScriptText;
}

/**
 * The state of one save: the copy of the movie being edited, what has been
 * applied to it, and the scripts the text shows. Each concern of the save
 * reads the movie and applies its edits through it.
 */
export interface SaveSession {
  readonly edits: AptEdit[];
  readonly constChanges: ConstItemChange[];
  readonly constAdded: ConstItem[];
  readonly scripts: { block: number; start: number }[];
  readonly image: AptImage;
  readonly constBytes: Uint8Array;
  readonly movie: AptMovie;
  /** Every place a script is shown, as `script` noted them */
  readonly sites: readonly ScriptSite[];
  /** Timelines whose frames are written back in the text's order */
  readonly orders: Map<number, (number[] | undefined)[]>;
  /** The movie as it now stands, scripts as last known */
  current(): MovieText;
  apply(edit: AptEdit): EditResult;
  changeConstant(change: ConstItemChange): void;
  addConstants(items: ConstItem[]): void;
  /** Compiles a script to a new block; returns where it starts */
  compile(script: ScriptText, line: number): number;
  /** Notes a script the text shows at a place that runs `before`'s block */
  script(before: ScriptText, after: ScriptText): void;
  /** Compiles a block's new script over it, wherever the compiler puts it */
  replaceScript(block: number, after: ScriptText): void;
}

/** Creates the session a save of `before`'s files runs in, over a copy of them */
export const createSaveSession = (
  apt: Uint8Array,
  initialConstBytes: Uint8Array,
  before: MovieText,
): SaveSession => {
  const edits: AptEdit[] = [];
  const constChanges: ConstItemChange[] = [];
  const constAdded: ConstItem[] = [];
  const scripts: { block: number; start: number }[] = [];
  const image = new AptImage(apt);
  let constBytes = initialConstBytes;
  const movieOffset = parseConst(constBytes).movieOffset;
  let parsed: AptMovie | undefined;
  // The text of the movie as it stands, until an edit or a script changes it
  let text: MovieText | undefined;
  // Every block's script as last known, which a cheap read of the movie reuses
  const known = new Map<number, ScriptText>();
  const sites: ScriptSite[] = [];
  const orders = new Map<number, (number[] | undefined)[]>();

  const remember = (script: ScriptText) => {
    if (script.block !== undefined) {
      known.set(script.block, script);
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

  const constants = (): ConstItem[] => parseConst(constBytes).items;

  const movie = (): AptMovie => {
    parsed ??= parseAptMovie(image.bytes, movieOffset);
    return parsed;
  };

  const addConstants = (items: ConstItem[]): void => {
    if (items.length) {
      constBytes = appendConstItems(constBytes, items);
      text = undefined;
      constAdded.push(...items);
    }
  };

  return {
    edits,
    constChanges,
    constAdded,
    scripts,
    image,
    get constBytes() {
      return constBytes;
    },
    get movie() {
      return movie();
    },
    sites,
    orders,

    current() {
      text ??= movieToText(
        image.bytes,
        constBytes,
        (block) => known.get(block) ?? { mode: 'listing', text: '', block },
        { movie: movie(), constFile: parseConst(constBytes) },
      );
      return text;
    },

    apply(edit) {
      const result = applyAptEdit(image, movieOffset, edit);

      parsed = undefined;
      text = undefined;
      edits.push(edit);
      return result;
    },

    changeConstant(change) {
      constBytes = changeConstItem(constBytes, change);
      text = undefined;
      constChanges.push(change);
    },

    addConstants,

    compile(script, line) {
      if (script.mode === 'listing') {
        throw new TextSaveError(
          'A listing cannot be compiled; write the script in an ```as fence',
          script.line ?? line,
        );
      }

      try {
        const { start, added } = addBlock(image, script.text, constants());

        parsed = undefined;
        text = undefined;
        addConstants(added);
        known.set(start, { ...script, block: start });
        return start;
      } catch (error) {
        throw new TextSaveError(
          `The script does not compile: ${error instanceof Error ? error.message : String(error)}`,
          script.line ?? line,
        );
      }
    },

    script(before, after) {
      if (before.block !== undefined) {
        sites.push({ block: before.block, before, after });
      }
    },

    replaceScript(block, after) {
      const { start, added } = replaceBlock(
        image,
        movieOffset,
        block,
        after.text,
        constants(),
      );

      parsed = undefined;
      text = undefined;
      addConstants(added);
      known.set(start, { ...after, block: start });
      scripts.push({ block, start });
    },
  };
};
