import * as vscode from 'vscode';

const PREFIX = 'mappedImage:';

/** A `MappedImage` block: its name, and the line of its header when last read */
export interface MappedImageSource {
  uri: vscode.Uri;
  name: string;
  line: number;
}

/** Names the region of the `MappedImage` block at a header, in the messages to the preview page */
export const getMappedImageRegionId = ({
  uri,
  name,
  line,
}: MappedImageSource): string => `${PREFIX}${uri.toString()}#${line}#${name}`;

/** Reads a region id back into the block it names, or nothing for any other kind of region */
export const parseMappedImageRegionId = (
  id: string,
): MappedImageSource | undefined => {
  const nameHash = id.lastIndexOf('#');
  const lineHash = id.lastIndexOf('#', nameHash - 1);
  const line = Number(id.slice(lineHash + 1, nameHash));

  return id.startsWith(PREFIX) && lineHash > 0 && Number.isInteger(line)
    ? {
        uri: vscode.Uri.parse(id.slice(PREFIX.length, lineHash)),
        name: id.slice(nameHash + 1),
        line,
      }
    : undefined;
};
