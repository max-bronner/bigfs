import * as vscode from 'vscode';

const PREFIX = 'ru:';

/** Where a `.ru` file's texture style is: the line of its `s tc:` entry */
export interface RuSource {
  uri: vscode.Uri;
  line: number;
}

/** Names the region a `.ru` texture style samples, in the messages to the preview page */
export const getRuRegionId = ({ uri, line }: RuSource): string =>
  `${PREFIX}${uri.toString()}#${line}`;

/** Reads a region id back into the style line it names, or nothing for any other kind of region */
export const parseRuRegionId = (id: string): RuSource | undefined => {
  const hash = id.lastIndexOf('#');
  const line = Number(id.slice(hash + 1));

  return id.startsWith(PREFIX) && hash > 0 && Number.isInteger(line)
    ? { uri: vscode.Uri.parse(id.slice(PREFIX.length, hash)), line }
    : undefined;
};
