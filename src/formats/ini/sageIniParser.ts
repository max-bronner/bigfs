import {
  FRAGMENT_CONTEXT,
  ROOT_CONTEXT,
  UNCHECKED_CONTEXT,
} from './sageIniSchema';
import { scanCalls } from './sageIniPreprocessor';
import type { SageCall } from './sageIniPreprocessor';
import type { SageIniSchema } from './sageIniSchema';

/**
 * Line oriented parser for the SAGE INI dialect, producing the block tree the
 * outline and folding are drawn from and the positioned statements the
 * semantic, hover and definition providers work off.
 *
 * Whether a line opens a block cannot be decided from its syntax, so the
 * grammar decides, per context. A keyword the grammar does not hold is marked
 * unknown, which the diagnostics report; only then does an indentation guess
 * decide its nesting, so one wrong line does not misplace the rest.
 *
 * The parser records problems and never stops on them. `.inc` files are
 * fragments pasted inside a block of the file that includes them, so they are
 * parsed with `isFragment`: any keyword of any context may open them, and the
 * diagnostics leave their unbalanced `End` tokens alone.
 */

/** A token and where it sits on its line, so a provider can build a range */
export interface SageToken {
  text: string;
  /** Column the token starts at */
  start: number;
  /** Column one past the token's last character */
  end: number;
}

/** A block, and the blocks nested inside it */
export interface SageBlock {
  /** As written, so the outline shows the casing the author used */
  keyword: string;
  /** Everything after the keyword on the header line, when there was any */
  name?: string;
  /** First value of a module slot header, which picks the field set */
  moduleType?: string;
  /** Second value of a module slot header, unique within one Object */
  moduleTag?: string;
  /** Where this block's children are looked up in the schema */
  context: string;
  /** Whether the games read no block of this kind, so only its nesting is kept */
  isLegacy?: boolean;
  startLine: number;
  /** Line of the closing `End`, or the last line when the block never closed */
  endLine: number;
  /** Whether an `End` closed it, rather than the end of the file */
  isClosed: boolean;
  children: SageBlock[];
}

/** One keyed line, whether it opened a block or held a value */
export interface SageStatement {
  line: number;
  keyword: SageToken;
  values: SageToken[];
  /** The context the keyword was looked up in, which is its parent's */
  context: string;
  kind: 'block' | 'field';
  /**
   * Whether the grammar accepts the keyword in its context. When it does not,
   * `kind` is only a guess from indentation, kept so one wrong line does not
   * misplace every line after it.
   */
  isKnown: boolean;
  /** Set when the keyword opened a block */
  block?: SageBlock;
}

/**
 * An `#include` and the path it names. Resolution is relative to the
 * directory of the including file, case insensitive, and always written with
 * backslashes.
 */
export interface SageInclude {
  line: number;
  /** Columns of the path inside its quotes, so a link underlines just that */
  start: number;
  end: number;
  /** As written, backslash separated */
  path: string;
}

/** A `#define` and where its name sits, so navigation can start from it */
export interface SageMacroDefinition {
  line: number;
  start: number;
  end: number;
  name: string;
  value: string;
  /** Column the value's first character sits at, so its tokens can be placed */
  valueStart: number;
}

/** An embedded Lua region, which the block parse skips over */
export interface SageScript {
  /** Line of `BeginScript` */
  startLine: number;
  /** Line of `EndScript`, or the last line when the region never closed */
  endLine: number;
}

/** Parse result of one INI file: its block tree, statements and directives */
export interface SageDocument {
  /** The context the file's own top lines are read in: root, or a fragment's */
  fileContext: string;
  blocks: SageBlock[];
  statements: SageStatement[];
  /** Lines holding an `End` with no block open to close */
  strayEnds: number[];
  /** Every arithmetic call written in a value, `#ADD( a b )` and its kin */
  calls: SageCall[];
  includes: SageInclude[];
  macros: SageMacroDefinition[];
  scripts: SageScript[];
}

const END_PATTERN = /^end$/i;
const BEGIN_SCRIPT_PATTERN = /^\s*BeginScript\s*$/i;
const END_SCRIPT_PATTERN = /^\s*EndScript\s*$/i;
/**
 * A quoted run read as one token, up to the closing quote or an `=`, as EA's
 * own string reader does, or else a run of anything but whitespace and `=`.
 * An unterminated quote runs to the end of the line.
 */
const TOKEN_PATTERN = /"([^"=]*)"?|[^\s="]+/g;
const INCLUDE_PATTERN = /^\s*#include\s+"([^"]*)"/i;
const MACRO_PATTERN = /^\s*#define\s+([A-Za-z_][A-Za-z0-9_]*)\s*(.*)$/i;

/**
 * Cuts a line down to the part before its comment, so every column left still
 * lines up with the original. Both `;` and `//`
 * run to end of line and either may appear inside the other, so whichever
 * opens first wins.
 */
export const stripComment = (line: string): string => {
  const semicolon = line.indexOf(';');
  const slashes = line.indexOf('//');
  const markers = [semicolon, slashes].filter((at) => at >= 0);

  return markers.length ? line.slice(0, Math.min(...markers)) : line;
};

/**
 * Splits a comment-stripped line, treating `=` as whitespace like the engine
 * does. A quoted value is one token, its text and columns without the quotes.
 */
export const tokenize = (content: string): SageToken[] => {
  const tokens: SageToken[] = [];

  TOKEN_PATTERN.lastIndex = 0;

  for (
    let match = TOKEN_PATTERN.exec(content);
    match;
    match = TOKEN_PATTERN.exec(content)
  ) {
    const [whole, quoted] = match;
    const text = quoted ?? whole;
    const start = quoted === undefined ? match.index : match.index + 1;

    tokens.push({ text, start, end: start + text.length });
  }

  return tokens;
};

/** Measures how far a line is indented, counting a tab as one column */
const indentOf = (line: string): number =>
  line.length - line.trimStart().length;

/**
 * Guesses whether a line opens a block by looking for its `End`, used only for
 * a keyword the schema does not hold. A line at indent `I` opens a block when
 * the next line indented no further is an `End` at exactly `I`.
 */
const opensBlockByIndent = (lines: string[], index: number): boolean => {
  const indent = indentOf(lines[index]);

  for (let next = index + 1; next < lines.length; next += 1) {
    const content = stripComment(lines[next]);

    if (!content.trim()) {
      continue;
    }

    if (indentOf(lines[next]) > indent) {
      continue;
    }

    return END_PATTERN.test(content.trim()) && indentOf(lines[next]) === indent;
  }

  return false;
};

/**
 * Whether a line defines an emotion inline rather than naming one:
 * `AddEmotion = OVERRIDE Name` opens a block closed by `End`, while a plain
 * `AddEmotion = Name` is a field. The argument decides it, so no per-context
 * table can.
 */
const opensInlineDefinition = (
  keyword: SageToken,
  values: readonly SageToken[],
): boolean =>
  keyword.text === 'AddEmotion' && values[0]?.text.toUpperCase() === 'OVERRIDE';

/**
 * Parses a file into its block tree and its statements. `lines` is the
 * document split on newlines; every line number in the result indexes into it.
 */
export const parseSageIni = (
  lines: string[],
  schema: SageIniSchema,
  { isFragment = false }: { isFragment?: boolean } = {},
): SageDocument => {
  const fileContext = isFragment ? FRAGMENT_CONTEXT : ROOT_CONTEXT;
  const blocks: SageBlock[] = [];
  const statements: SageStatement[] = [];
  const strayEnds: number[] = [];
  const calls: SageCall[] = [];
  const includes: SageInclude[] = [];
  const macros: SageMacroDefinition[] = [];
  const scripts: SageScript[] = [];
  const open: SageBlock[] = [];

  let scriptStart = -1;

  lines.forEach((line, index) => {
    // A comment may follow either marker, so both are matched without it
    if (scriptStart >= 0) {
      if (END_SCRIPT_PATTERN.test(stripComment(line))) {
        scripts.push({ startLine: scriptStart, endLine: index });
        scriptStart = -1;
      }

      return; // the region is Lua, not blocks
    }

    if (BEGIN_SCRIPT_PATTERN.test(stripComment(line))) {
      scriptStart = index;
      return;
    }

    const content = stripComment(line);
    const trimmed = content.trim();

    if (!trimmed) {
      return; // blank or comment only
    }

    if (trimmed.startsWith('#')) {
      const include = INCLUDE_PATTERN.exec(content);

      if (include) {
        const start = content.indexOf(include[1]);

        includes.push({
          line: index,
          start,
          end: start + include[1].length,
          path: include[1],
        });
      }

      const macro = MACRO_PATTERN.exec(content);

      if (macro) {
        const start = content.indexOf(macro[1]);
        const value = macro[2].trim();

        macros.push({
          line: index,
          start,
          end: start + macro[1].length,
          name: macro[1],
          value,
          valueStart: value
            ? content.indexOf(value, start + macro[1].length)
            : content.length,
        });
      }

      return; // preprocessor directives are not statements
    }

    const [keyword, ...values] = tokenize(content);

    if (!keyword) {
      return;
    }

    if (content.includes('#')) {
      calls.push(...scanCalls(content, index));
    }

    // Retail compares only the first token against `End` and ignores the rest
    // of the line (mint's reader.rs `Stmt::is_end`), so `End  StateName = X`
    // closes a block as well
    if (END_PATTERN.test(keyword.text)) {
      const closing = open.pop();

      if (closing) {
        closing.endLine = index;
        closing.isClosed = true;
      } else {
        strayEnds.push(index);
      }

      return;
    }

    const context = open.length ? open[open.length - 1].context : fileContext;
    const resolution = opensInlineDefinition(keyword, values)
      ? { kind: 'block' as const, childContext: UNCHECKED_CONTEXT }
      : schema.resolve(
          context,
          keyword.text,
          values.map((token) => token.text),
        );
    const isKnown = resolution !== undefined || !schema.isChecked(context);

    // A keyword the grammar does not hold still has to be nested somehow;
    // indentation is the best guess at whether the author meant a block
    const kind =
      resolution?.kind ??
      (opensBlockByIndent(lines, index) ? 'block' : 'field');

    const statement: SageStatement = {
      line: index,
      keyword,
      values,
      context,
      kind,
      isKnown,
    };

    statements.push(statement);

    if (kind !== 'block') {
      return;
    }

    const moduleType = resolution?.moduleType;

    const block: SageBlock = {
      keyword: keyword.text,
      name: values.length
        ? values.map((token) => token.text).join(' ')
        : undefined,
      moduleType,
      moduleTag: moduleType === undefined ? undefined : values[1]?.text,
      context: resolution?.childContext ?? UNCHECKED_CONTEXT,
      isLegacy: resolution?.isLegacy,
      startLine: index,
      endLine: index,
      isClosed: false,
      children: [],
    };

    statement.block = block;

    const parent = open[open.length - 1];

    if (parent) {
      parent.children.push(block);
    } else {
      blocks.push(block);
    }

    open.push(block);
  });

  // A fragment can end mid-block, so whatever is still open ends with the file
  const lastLine = Math.max(lines.length - 1, 0);

  open.forEach((block) => {
    block.endLine = lastLine;
  });

  if (scriptStart >= 0) {
    scripts.push({ startLine: scriptStart, endLine: lastLine });
  }

  return {
    fileContext,
    blocks,
    statements,
    strayEnds,
    calls,
    includes,
    macros,
    scripts,
  };
};

/** Walks every block of a document, parents before children */
export const forEachBlock = (
  blocks: readonly SageBlock[],
  visit: (block: SageBlock) => void,
): void => {
  blocks.forEach((block) => {
    visit(block);
    forEachBlock(block.children, visit);
  });
};

/**
 * Whether an entry path names a fragment, pasted inside a block of the file
 * that includes it, rather than a file the engine loads at file scope
 */
export const isFragmentPath = (entryPath: string): boolean =>
  !entryPath.toLowerCase().endsWith('.ini');
