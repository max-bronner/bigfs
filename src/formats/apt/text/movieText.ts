import { parseConst } from '../aptMovie';
import type { ConstItem } from '../aptMovie';
import { decompileBlock } from '../aptScript';
import { movieToText } from './fromMovie';
import type { ScriptText } from './textModel';
import { printMovieText } from './printer';

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
