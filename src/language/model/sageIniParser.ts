import { ROOT_CONTEXT } from './sageIniSchema';
import type { SageIniSchema } from './sageIniSchema';

/**
 * Line oriented parser for the SAGE INI dialect, producing the block tree the
 * outline and folding are drawn from and the positioned statements the
 * semantic, hover and definition providers work off.
 *
 * Whether a line opens a block cannot be decided from its syntax, so the
 * schema decides and an indentation guess covers the keywords the corpus never
 * recorded. The two agree on more than 99% of the corpus, and the guess only
 * runs for a keyword the table does not hold.
 *
 * The parser is deliberately forgiving. `.inc` files are fragments meant to be
 * pasted inside a block, so they open with a nested keyword and carry
 * unbalanced `End` tokens; treating that as an error would report hundreds of
 * false problems on the first workspace anyone opens.
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
  startLine: number;
  /** Line of the closing `End`, or the last line when the block never closed */
  endLine: number;
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
}

/** An embedded Lua region, which the block parse skips over */
export interface SageScript {
  startLine: number;
  endLine: number;
}

/** What one file parsed to */
export interface SageDocument {
  blocks: SageBlock[];
  statements: SageStatement[];
  includes: SageInclude[];
  macros: SageMacroDefinition[];
  scripts: SageScript[];
}

const END_PATTERN = /^end$/i;
const BEGIN_SCRIPT_PATTERN = /^\s*BeginScript\s*$/i;
const END_SCRIPT_PATTERN = /^\s*EndScript\s*$/i;
const TOKEN_PATTERN = /[^\s=]+/g;
const INCLUDE_PATTERN = /^\s*#include\s+"([^"]*)"/i;
const MACRO_PATTERN = /^\s*#define\s+([A-Za-z_][A-Za-z0-9_]*)\s*(.*)$/i;

/**
 * Cuts a line down to the part before its comment, padding the rest with
 * spaces so every column still lines up with the original. Both `;` and `//`
 * run to end of line and either may appear inside the other, so whichever
 * opens first wins.
 */
export const stripComment = (line: string): string => {
  const semicolon = line.indexOf(';');
  const slashes = line.indexOf('//');
  const markers = [semicolon, slashes].filter((at) => at >= 0);

  return markers.length ? line.slice(0, Math.min(...markers)) : line;
};

/** Splits a comment-stripped line, treating `=` as whitespace like the engine does */
export const tokenize = (content: string): SageToken[] => {
  const tokens: SageToken[] = [];

  TOKEN_PATTERN.lastIndex = 0;

  for (
    let match = TOKEN_PATTERN.exec(content);
    match;
    match = TOKEN_PATTERN.exec(content)
  ) {
    tokens.push({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  return tokens;
};

/** How far a line is indented, counting a tab as one column */
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
 * Parses a file into its block tree and its statements. `lines` is the
 * document split on newlines; every line number in the result indexes into it.
 */
export const parseSageIni = (
  lines: string[],
  schema: SageIniSchema,
): SageDocument => {
  const blocks: SageBlock[] = [];
  const statements: SageStatement[] = [];
  const includes: SageInclude[] = [];
  const macros: SageMacroDefinition[] = [];
  const scripts: SageScript[] = [];
  const open: SageBlock[] = [];

  let scriptStart = -1;

  lines.forEach((line, index) => {
    if (scriptStart >= 0) {
      if (END_SCRIPT_PATTERN.test(line)) {
        scripts.push({ startLine: scriptStart, endLine: index });
        scriptStart = -1;
      }

      return; // the region is Lua, not blocks
    }

    if (BEGIN_SCRIPT_PATTERN.test(line)) {
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

        macros.push({
          line: index,
          start,
          end: start + macro[1].length,
          name: macro[1],
          value: macro[2].trim(),
        });
      }

      return; // preprocessor directives are not statements
    }

    const [keyword, ...values] = tokenize(content);

    if (!keyword) {
      return;
    }

    if (END_PATTERN.test(keyword.text) && !values.length) {
      const closing = open.pop();

      if (closing) {
        closing.endLine = index;
      }

      return; // an unmatched End belongs to an .inc fragment, so it is ignored
    }

    const context = open.length ? open[open.length - 1].context : ROOT_CONTEXT;
    const kind =
      schema.classify(context, keyword.text) ??
      (opensBlockByIndent(lines, index) ? 'block' : 'field');

    const statement: SageStatement = {
      line: index,
      keyword,
      values,
      context,
      kind,
    };

    statements.push(statement);

    if (kind !== 'block') {
      return;
    }

    const isSlot = schema.isModuleSlot(keyword.text);
    const moduleType = isSlot ? values[0]?.text : undefined;

    const block: SageBlock = {
      keyword: keyword.text,
      name: values.length
        ? values.map((token) => token.text).join(' ')
        : undefined,
      moduleType,
      moduleTag: isSlot ? values[1]?.text : undefined,
      context: schema.childContext(keyword.text, moduleType),
      startLine: index,
      endLine: index,
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

  return { blocks, statements, includes, macros, scripts };
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
