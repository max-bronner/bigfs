import type { TextProblem } from './textModel';
import { ParseError, tokenize } from './tokenizer';
import type { Token } from './tokenizer';

/** One line of the text, with the lines indented under it */
export interface LineNode {
  line: number;
  indent: number;
  tokens: Token[];
  children: LineNode[];
  /** A fence's body, for a node that is one */
  fence?: { mode: string; text: string; endLine: number };
  endLine: number;
}

/** How deep blocks may nest */
const MAX_DEPTH = 16;

/** Turns lines into nodes by indentation, with fences kept whole */
export const buildTree = (
  lines: string[],
  problems: TextProblem[],
): LineNode[] => {
  const root: LineNode = {
    line: -1,
    indent: -1,
    tokens: [],
    children: [],
    endLine: -1,
  };
  const stack: LineNode[] = [root];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith(';')) {
      continue;
    }
    if (/^\t/.test(line) || /^ *\t/.test(line)) {
      problems.push({
        line: index,
        column: 0,
        endColumn: indent,
        message: 'Indent with spaces, not tabs',
      });
      continue;
    }

    while (stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1];

    // The format nests five deep; far deeper is a mistake, and would recurse without bound
    if (stack.length > MAX_DEPTH) {
      problems.push({
        line: index,
        column: 0,
        endColumn: line.length,
        message: 'This line is indented deeper than any block nests',
      });
      continue;
    }

    if (trimmed.startsWith('```')) {
      const mode = trimmed.slice(3).trim();
      const body: string[] = [];
      let end = index + 1;

      for (; end < lines.length; end++) {
        const each = lines[end];

        if (
          each.trim() === '```' &&
          each.length - each.trimStart().length === indent
        ) {
          break;
        }
        if (each.trim() && !each.startsWith(' '.repeat(indent))) {
          problems.push({
            line: end,
            column: 0,
            endColumn: each.length,
            message: 'A script line is indented less than its fence',
          });
        }
        body.push(
          each.slice(Math.min(indent, each.length - each.trimStart().length)),
        );
      }

      if (end >= lines.length) {
        problems.push({
          line: index,
          column: indent,
          endColumn: line.length,
          message: 'This fence is never closed with ```',
        });
      }

      parent.children.push({
        line: index,
        indent,
        tokens: [],
        children: [],
        fence: { mode, text: body.join('\n'), endLine: end },
        endLine: end,
      });
      index = end;
      continue;
    }

    let tokens: Token[];

    try {
      tokens = tokenize(line);
    } catch (error) {
      const failure = error as ParseError;

      problems.push({
        line: index,
        column: failure.column,
        endColumn: failure.endColumn || line.length,
        message: failure.message,
      });
      continue;
    }

    const node: LineNode = {
      line: index,
      indent,
      tokens,
      children: [],
      endLine: index,
    };

    parent.children.push(node);
    stack.push(node);
  }

  const close = (node: LineNode): number => {
    node.endLine = Math.max(node.endLine, ...node.children.map(close));
    return node.endLine;
  };

  close(root);
  return root.children;
};

/** Lists the lines each block of a text spans: every line with lines indented under it, and every fence */
export const findTextBlocks = (text: string): { start: number; end: number }[] => {
  const blocks: { start: number; end: number }[] = [];
  const visit = (nodes: LineNode[]) => {
    for (const node of nodes) {
      if (node.endLine > node.line) {
        blocks.push({ start: node.line, end: node.endLine });
      }
      visit(node.children);
    }
  };

  visit(buildTree(text.split(/\r?\n/), []));
  return blocks;
};
