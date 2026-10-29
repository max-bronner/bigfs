import { decodeBlock, printListing } from './aptBytecode';
import { compileScript, normalize } from './aptCompiler';
import { LiftMode, lift } from './aptDecompiler';
import {
  AptReader,
  ConstItem,
  parseAptMovie,
  parseConst,
  parseSpriteFrames,
} from './aptMovie';
import { ScriptError, parseScript } from './aptScriptParser';
import { printStatements } from './aptScriptSyntax';
import { AptImage } from './writer/aptImage';
import { describeError } from '../../core/errors';

/**
 * Reading and replacing action blocks as script text.
 *
 * A block is shown as a script only once compiling that script has been
 * shown to give back code that runs the same as the block: the instructions
 * are compared after `normalize`, which leaves out only differences in
 * encoding. A block that fails is shown one instruction a line in the same
 * language, which is checked the same way; failing that, as a read-only
 * listing. An unchanged block is never rewritten, so its bytes stay as
 * shipped; a changed one is compiled to the end of the movie and every
 * pointer to the old block is moved to it.
 */

export interface BlockScript {
  text: string;
  /** How the text was made; `listing` cannot be compiled back */
  mode: LiftMode | 'listing';
  /** Why a better mode was not possible */
  note?: string;
}

/** Compiles into a scratch image and decodes the result back */
const recompile = (text: string, constants: readonly ConstItem[]) => {
  const scratch = new AptImage(new Uint8Array(0));
  const items = [...constants];
  const start = compileScript(parseScript(text), scratch, items);

  return { code: decodeBlock(scratch.bytes, start), items };
};

/** The block at `block` as text, in the best mode that is checked exact */
export const decompileBlock = (
  apt: Uint8Array,
  block: number,
  constants: readonly ConstItem[],
): BlockScript => {
  const code = decodeBlock(apt, block);
  const expected = JSON.stringify(normalize(code, constants));
  let note: string | undefined;

  for (const mode of ['script', 'assembly'] as const) {
    let text = '';

    try {
      text = printStatements(lift(code, { constants, mode }));

      const result = recompile(text, constants);

      if (JSON.stringify(normalize(result.code, result.items)) === expected) {
        return { text, mode, note };
      }

      note = `The ${mode} form did not compile back to the same code`;
    } catch (error) {
      note = `The ${mode} form failed: ${describeError(error)}`;
    }
  }

  return { text: printListing(code, constants), mode: 'listing', note };
};

/** Every place in the movie that points at the block at `block` */
export const findBlockPointers = (
  apt: Uint8Array,
  movieOffset: number,
  block: number,
): number[] => {
  const reader = new AptReader(apt);
  const movie = parseAptMovie(apt, movieOffset);
  const sites: number[] = [];
  const timelines = [
    movie.frames,
    ...movie.characters.flatMap((character) =>
      character.type === 'sprite' ? [parseSpriteFrames(apt, character)] : [],
    ),
  ];

  for (const frames of timelines) {
    for (const frame of frames) {
      for (const item of frame.items) {
        if (item.type === 'action' && item.block === block) {
          sites.push(item.offset + 4);
        } else if (item.type === 'initAction' && item.block === block) {
          sites.push(item.offset + 8);
        } else if (item.type === 'placeObject' && item.clipActions) {
          const array = reader.u32(reader.u32(item.offset + 60) + 4);

          item.clipActions.forEach((action, index) => {
            if (action.block === block) {
              sites.push(array + index * 12 + 8);
            }
          });
        }
      }
    }
  }

  for (const character of movie.characters) {
    if (character.type === 'button') {
      const actions = reader.u32(character.offset + 56);

      character.actions.forEach((action, index) => {
        if (action.block === block) {
          sites.push(actions + index * 8 + 4);
        }
      });
    }
  }

  return [...new Set(sites)];
};

/**
 * Compiles `text` and points every user of the block at `block` to it.
 * Returns where the new code starts and the `.const` items it needs that
 * were not there before.
 */
export const replaceBlock = (
  image: AptImage,
  movieOffset: number,
  block: number,
  text: string,
  constants: readonly ConstItem[],
): { start: number; added: ConstItem[] } => {
  const sites = findBlockPointers(image.bytes, movieOffset, block);

  if (!sites.length) {
    throw new Error(
      `Nothing in the movie runs the block at 0x${block.toString(16)}`,
    );
  }

  const items = [...constants];
  const start = compileScript(parseScript(text), image, items);

  for (const site of sites) {
    image.setU32(site, start);
  }

  return { start, added: items.slice(constants.length) };
};

/** Appends items to a `.const` file, moving its item array to the end */
export const appendConstItems = (
  bytes: Uint8Array,
  added: ConstItem[],
): Uint8Array => {
  if (!added.length) {
    return bytes;
  }

  const parsed = parseConst(bytes);
  const image = new AptImage(bytes);
  const reader = new AptReader(bytes);
  const words: number[] = [];

  for (let index = 0; index < parsed.items.length; index++) {
    words.push(
      reader.u32(parsed.itemsOffset + index * 8),
      reader.u32(parsed.itemsOffset + index * 8 + 4),
    );
  }

  for (const item of added) {
    words.push(
      item.kind === 'string' ? 1 : 4,
      item.kind === 'string'
        ? image.appendString(item.value)
        : item.value >>> 0,
    );
  }

  const at = image.appendWords(words);

  image.setU32(0x18, parsed.items.length + added.length);
  image.setU32(0x1c, at);

  return image.bytes;
};

/** Compiles `text` as a new block at the end of the movie, for a new script to run */
export const addBlock = (
  image: AptImage,
  text: string,
  constants: readonly ConstItem[],
): { start: number; added: ConstItem[] } => {
  const items = [...constants];
  const start = compileScript(parseScript(text), image, items);

  return { start, added: items.slice(constants.length) };
};

/** Where a script fails to compile, if it does; `line` and `column` from 1 */
export const checkScript = (
  text: string,
  constants: readonly ConstItem[],
): { message: string; line?: number; column?: number } | undefined => {
  try {
    recompile(text, constants);
    return undefined;
  } catch (error) {
    return error instanceof ScriptError
      ? {
          message: error.message.replace(/^\d+:\d+: /, ''),
          line: error.line,
          column: error.column,
        }
      : { message: describeError(error) };
  }
};
