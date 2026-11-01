import * as vscode from 'vscode';

const PREFIX = 'mappedImage:';

/** Where a `MappedImage` block's header is */
export interface MappedImageSource {
  uri: vscode.Uri;
  line: number;
}

/** Names the region of the `MappedImage` block at a header, in the messages to the preview page */
export const getMappedImageRegionId = ({ uri, line }: MappedImageSource): string =>
  `${PREFIX}${uri.toString()}#${line}`;

/** Reads a region id back into the block it names, or nothing for any other kind of region */
export const parseMappedImageRegionId = (
  id: string,
): MappedImageSource | undefined => {
  const hash = id.lastIndexOf('#');
  const line = Number(id.slice(hash + 1));

  return id.startsWith(PREFIX) && hash > 0 && Number.isInteger(line)
    ? { uri: vscode.Uri.parse(id.slice(PREFIX.length, hash)), line }
    : undefined;
};
