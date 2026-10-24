import { stripComment, tokenize } from './sageIniParser';

/**
 * A copy of a definition under a new name: the header renamed, and every
 * game-text label inside that carries the old name (`OBJECT:Old`,
 * `CONTROLBAR:ToolTipOld`) renamed with it, so the copy gets its own text
 * instead of sharing the original's.
 */

export interface LabelRename {
  from: string;
  to: string;
}

export interface Duplicate {
  lines: string[];
  labels: LabelRename[];
}

const LABEL = /^[A-Za-z_]+:\S+$/;

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const duplicateDefinition = (
  lines: string[],
  startLine: number,
  endLine: number,
  newName: string,
): Duplicate => {
  const block = lines.slice(startLine, endLine + 1);
  const [keyword, name] = tokenize(stripComment(block[0] ?? ''));

  if (!keyword || !name) {
    throw new Error('The block has no name to replace');
  }

  const oldName = name.text;
  const header =
    block[0].slice(0, name.start) + newName + block[0].slice(name.end);
  const pattern = new RegExp(escapeRegExp(oldName), 'gi');
  const labels = new Map<string, string>();
  const body = block.slice(1).map((line) => {
    let out = line;

    // Right to left, so earlier columns stay valid
    for (const token of [...tokenize(stripComment(line))].reverse()) {
      if (LABEL.test(token.text) && pattern.test(token.text)) {
        const renamed = token.text.replace(pattern, newName);

        pattern.lastIndex = 0;
        labels.set(token.text, renamed);
        out = out.slice(0, token.start) + renamed + out.slice(token.end);
      }
      pattern.lastIndex = 0;
    }
    return out;
  });

  return {
    lines: [header, ...body],
    labels: [...labels].map(([from, to]) => ({ from, to })),
  };
};

export { strRecord } from './sageStringRecords';
