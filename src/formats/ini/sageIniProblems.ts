import {
  FRAGMENT_CONTEXT,
  ROOT_CONTEXT,
  UNCHECKED_CONTEXT,
} from './sageIniSchema';
import type { SageIniSchema } from './sageIniSchema';
import { forEachBlock } from './sageIniParser';
import type { SageDocument } from './sageIniParser';

/**
 * Finds what the engine would reject in a parsed SAGE INI document: a keyword
 * the grammar does not hold where it is written, a module type no game
 * registers, a block never closed, and an `End` with nothing to close.
 *
 * A valid mod loads and an invalid one errors, as the engine treats them, so
 * nothing is guessed silently. A fragment's unbalanced `End` tokens are left
 * alone: they close the block of the file that includes it.
 */

/** One problem in a document, positioned on the line and columns it covers */
export interface SageProblem {
  line: number;
  start: number;
  /** Column one past the end, or the end of the line when absent */
  end?: number;
  message: string;
  /**
   * An error is structural and certain. A keyword the grammar does not hold is
   * a warning: the grammar is extracted from the games' editors and accepts
   * 99.95% of what they ship, not all of it. A hint is information about
   * data that is valid but unused, and is no mistake.
   */
  severity: 'error' | 'warning' | 'hint';
}

/** Display names of the games, as a message names them */
const GAME_NAMES = {
  rotwk: 'Rise of the Witch-king',
  bfme2: 'BFME II',
  bfme1: 'BFME',
};

/** Lists every problem a parse alone can tell, without touching the disk */
export const findSageIniProblems = (
  parsed: SageDocument,
  schema: SageIniSchema,
): SageProblem[] => {
  const problems: SageProblem[] = [];
  const game = GAME_NAMES[schema.game];

  for (const {
    isKnown,
    keyword,
    values,
    context,
    line,
    block,
  } of parsed.statements) {
    // Without the game's own grammar a name it lacks proves nothing
    if (!schema.isStrict) {
      break;
    }

    // A module slot naming a module the engine does not register
    if (
      block?.moduleType !== undefined &&
      block.context === UNCHECKED_CONTEXT
    ) {
      problems.push({
        line,
        start: values[0].start,
        end: values[0].end,
        message: `'${block.moduleType}' is not a module ${game} registers`,
        severity: 'warning',
      });
    }

    if (isKnown) {
      continue;
    }

    const where =
      context === ROOT_CONTEXT || context === FRAGMENT_CONTEXT
        ? 'at file scope'
        : `in ${schema.describeContext(context)}`;

    problems.push({
      line,
      start: keyword.start,
      end: keyword.end,
      message: `'${keyword.text}' is not a block or field ${game} reads ${where}`,
      severity: 'warning',
    });
  }

  // Generals' flat particle format is left in the tree and neither title reads
  // it, so each block is one note rather than a warning per line inside it
  if (schema.isStrict) {
    for (const { block, keyword, line } of parsed.statements) {
      if (block?.isLegacy) {
        problems.push({
          line,
          start: keyword.start,
          end: keyword.end,
          message: `'${block.keyword}' at file scope is a format ${game} does not read, so this block has no effect in game`,
          severity: 'hint',
        });
      }
    }
  }

  for (const call of parsed.calls) {
    if (call.error) {
      problems.push({
        line: call.line,
        start: call.start,
        end: call.end,
        message: call.error,
        severity: 'error',
      });
    }
  }

  if (parsed.fileContext === FRAGMENT_CONTEXT) {
    return problems;
  }

  const headers = new Map(
    parsed.statements.flatMap((statement) =>
      statement.block ? [[statement.block, statement.keyword] as const] : [],
    ),
  );

  forEachBlock(parsed.blocks, (block) => {
    if (block.isClosed) {
      return;
    }

    const header = headers.get(block);

    problems.push({
      line: block.startLine,
      start: header?.start ?? 0,
      end: header?.end,
      message: `'${block.keyword}' is never closed with End`,
      severity: 'error',
    });
  });

  for (const line of parsed.strayEnds) {
    problems.push({
      line,
      start: 0,
      message: 'End with no block open to close',
      severity: 'error',
    });
  }

  return problems;
};
