import { parseConst } from '../aptMovie';
import type { ConstItem } from '../aptMovie';
import { decompileBlock } from '../aptScript';
import { movieToText } from './fromMovie';
import type { ScriptText } from './textModel';
import { printMovieText } from './printer';
import { describeError } from '../../../core/errors';

/**
 * Creates the reader `movieToText` decompiles each action block of a movie
 * with, falling back to a comment when the block cannot be read
 */
export const createScriptReader =
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
        text: `; the block at ${block} cannot be read: ${describeError(error)}`,
        block,
      };
    }
  };

/** Prints a movie and its `.const` as text, every script decompiled */
export const printMovieFiles = (
  apt: Uint8Array,
  constBytes: Uint8Array,
  name?: string,
): string =>
  printMovieText(
    movieToText(
      apt,
      constBytes,
      createScriptReader(apt, parseConst(constBytes).items),
    ),
    name,
  );
