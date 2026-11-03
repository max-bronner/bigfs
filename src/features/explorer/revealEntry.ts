import type { TreeView, Uri } from 'vscode';
import { window } from 'vscode';
import type { ArchiveModel } from '../../services/archives/archiveModel';
import type { ExplorerRow } from '../../services/archives/explorerRow';
import type {
  GameViewModel,
  GameViewNode,
} from '../../services/archives/gameViewModel';
import { isGameViewShown } from './treeDataProvider';

/** Finds the game view row for an entry path, by walking down from the root */
const findGameNode = (
  root: GameViewNode,
  entryPath: string,
): GameViewNode | undefined =>
  entryPath
    .toLowerCase()
    .split('/')
    .reduce<GameViewNode | undefined>(
      (node, segment) => node?.children?.get(segment),
      root,
    );

/**
 * Selects the row for the entry a uri names in the archive explorer, opening
 * the rows above it. In the game view that is the row for the entry's path.
 */
export const revealEntry = async (
  uri: Uri,
  treeView: TreeView<ExplorerRow>,
  archives: ArchiveModel,
  gameView: GameViewModel,
): Promise<void> => {
  const node = await archives.resolveNode(uri);

  if (!node) {
    void window.showWarningMessage('That entry is not in a BIG archive.');
    return;
  }

  const row = isGameViewShown()
    ? await gameView.getRoot().then((root) => {
        const gameNode = findGameNode(root, node.entryPath);

        return gameNode && { kind: 'game' as const, node: gameNode };
      })
    : node;

  if (row) {
    await treeView.reveal(row, { select: true, focus: true });
  }
};
