import { Uri } from 'vscode';
import { SCHEME } from '../constants';
import { isPathBelow, splitPath } from '../common/paths';
import type { Archive } from './archive';
import type { VirtualNode } from './virtualNode';

/**
 * How a node is addressed, in one place.
 *
 * A node knows its archive and where it sits inside it. Everything else is
 * rendered from those two: the path through the tree, and the uri VS Code
 * addresses it by. Reading a uri back is the only parse, and it lives here
 * beside the rendering it has to agree with.
 */

export interface ResolvedUri {
  archive: Archive;
  /** Empty when the uri names the archive itself */
  entryPath: string;
}

/** Where the node sits in the virtual file system */
export const getNodePath = (node: VirtualNode): string =>
  node.entryPath
    ? `${node.archive.rootPath}/${node.entryPath}`
    : node.archive.rootPath;

/** How VS Code addresses the node */
export const getNodeUri = (node: VirtualNode): Uri =>
  Uri.from({ scheme: SCHEME, path: getNodePath(node) });

/**
 * How VS Code addresses something in a directory that may not exist yet,
 * which is how a file is created: the uri comes first, the node follows
 */
export const getChildUri = (directory: VirtualNode, name: string): Uri =>
  Uri.from({ scheme: SCHEME, path: `${getNodePath(directory)}/${name}` });

/**
 * Finds the archive a uri points into and the path inside it. The longest
 * root wins, so an archive below a directory named like another archive
 * still resolves.
 */
export const parseNodeUri = (
  uri: Uri,
  archives: Iterable<Archive>,
): ResolvedUri | undefined => {
  const wanted = uri.path.toLowerCase();
  let match: Archive | undefined;

  for (const archive of archives) {
    if (
      isPathBelow(wanted, archive.rootKey) &&
      archive.rootKey.length > (match?.rootKey.length ?? 0)
    ) {
      match = archive;
    }
  }

  if (!match) {
    return undefined;
  }

  return {
    archive: match,
    entryPath: splitPath(uri.path.slice(match.rootPath.length)).join('/'),
  };
};
