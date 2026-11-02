import type { ArchiveModel } from '../../services/archives/archiveModel';
import {
  isFolderRow,
  isGameRow,
  isSourceRow,
  isVirtualNode,
} from '../../services/archives/explorerRow';
import type {
  ExplorerRow,
  SourceRow,
} from '../../services/archives/explorerRow';
import type {
  GameViewModel,
  GameViewNode,
} from '../../services/archives/gameViewModel';

/**
 * Gets the row a row sits below, which the tree view needs to reveal a row
 * that has not been expanded to yet. Nothing for a top row.
 */
export const getParentRow = async (
  element: ExplorerRow,
  archives: ArchiveModel,
  gameView: GameViewModel,
): Promise<ExplorerRow | undefined> => {
  const getSourceRow = (sourceId: string): SourceRow | undefined => {
    const sources = archives.getSources();
    const source = sources.find((candidate) => candidate.id === sourceId);

    // A single source shows no row of its own
    return source && sources.length > 1
      ? { kind: 'source', source }
      : undefined;
  };

  const getFolderParent = (
    sourceId: string,
    directories: string[],
  ): ExplorerRow | undefined =>
    directories.length
      ? {
          kind: 'folder',
          sourceId,
          path: directories.join('/'),
          name: directories.at(-1)!,
        }
      : getSourceRow(sourceId);

  if (isSourceRow(element)) {
    return undefined;
  }

  if (isFolderRow(element)) {
    return getFolderParent(
      element.sourceId,
      element.path.split('/').slice(0, -1),
    );
  }

  if (isGameRow(element)) {
    const segments = element.node.path.split('/').slice(0, -1);
    let node: GameViewNode | undefined = await gameView.getRoot();

    for (const segment of segments) {
      node = node?.children?.get(segment);
    }

    return segments.length && node ? { kind: 'game', node } : undefined;
  }

  if (isVirtualNode(element)) {
    if (element.parent) {
      return element.parent;
    }

    const { sourceId, pathInSource } = element.archive;

    return getFolderParent(sourceId, pathInSource.split('/').slice(0, -1));
  }

  return undefined;
};
