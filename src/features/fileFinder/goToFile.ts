import { ThemeIcon, Uri, commands, window } from 'vscode';
import type { ExtensionContext, QuickPickItem } from 'vscode';
import { formatCount } from '../../core/messages';
import { rankFiles } from '../../core/rankFiles';
import type { RankableFile } from '../../core/rankFiles';
import { listFileCopies } from '../../game/install/listFileCopies';
import type { FileCopy } from '../../game/install/listFileCopies';
import type {
  GameFileRef,
  GameViewModel,
  GameViewNode,
} from '../../services/archives/gameViewModel';
import { getNodeUri } from '../../services/archives/nodeAddress';

/** A file the finder offers: one copy of a path in the game view */
interface FinderFile extends RankableFile {
  uri: Uri;
  copy: FileCopy<GameFileRef>;
}

/** A row of the finder's list */
interface FinderItem extends QuickPickItem {
  file: FinderFile;
}

/** Rows shown at once, which is more than anyone scrolls through */
const MAX_ITEMS = 100;

/** Files remembered as recently opened */
const MAX_RECENT = 30;

const RECENT_STATE_KEY = 'bigfs.recentFiles';

const REVEAL_BUTTON = {
  iconPath: new ThemeIcon('list-tree'),
  tooltip: 'Reveal in BIG Archives',
};

/** The index of each game view, built once per view since a rebuild replaces it */
const indexes = new WeakMap<GameViewNode, FinderFile[]>();

/** Lists the copies of every file of the game view, from the index tables alone */
const getFinderFiles = (root: GameViewNode): FinderFile[] => {
  let files = indexes.get(root);

  if (!files) {
    files = listFileCopies(root).map((copy) => {
      const uri =
        copy.ref.kind === 'entry' ? getNodeUri(copy.ref.node) : copy.ref.uri;

      return {
        name: copy.name,
        path: copy.entryPath,
        key: uri.toString(),
        isPreferred: copy.isLoaded,
        uri,
        copy,
      };
    });
    indexes.set(root, files);
  }

  return files;
};

/** Builds the row for a file: its name, the folder and archive it is in, and whether the game loads it */
const toItem = (file: FinderFile): FinderItem => {
  const { copy } = file;
  const folder = copy.entryPath.slice(0, -copy.name.length).replace(/\/$/, '');
  const verdict =
    copy.copies < 2
      ? undefined
      : copy.isLoaded
        ? '$(check) The game loads this copy'
        : `$(circle-slash) Ignored by the game: ${copy.loadedFrom} loads it instead`;

  return {
    label: copy.name,
    description: [folder, copy.origin].filter(Boolean).join('  ·  '),
    detail: verdict,
    // The list is ranked here, so VS Code's own filter must not hide a row; it still highlights what it matches
    alwaysShow: true,
    buttons: [REVEAL_BUTTON],
    file,
  };
};

/**
 * Opens a quick pick that finds a file of any archive or loose in an install
 * by fuzzy match on its name and path. It is built from the index tables, so
 * no entry is read, and a path several archives hold is listed once per
 * archive with the copy the game loads marked.
 */
export const goToFile = async (
  context: ExtensionContext,
  gameView: GameViewModel,
): Promise<void> => {
  const pick = window.createQuickPick<FinderItem>();
  let files: FinderFile[] = [];

  const getRecent = (): string[] =>
    context.globalState.get<string[]>(RECENT_STATE_KEY, []);

  const refresh = (): void => {
    pick.items = rankFiles(pick.value, files, getRecent(), MAX_ITEMS).map(
      toItem,
    );
  };

  pick.matchOnDescription = true;
  // Not in the typings, but the list otherwise re-sorts the ranked rows by label
  (pick as { sortByLabel?: boolean }).sortByLabel = false;
  pick.placeholder = 'Loading the files of every archive...';
  pick.busy = true;
  pick.onDidChangeValue(refresh);
  pick.onDidTriggerItemButton(({ item }) => {
    const { uri, copy } = item.file;

    pick.hide();
    void commands.executeCommand(
      copy.ref.kind === 'entry' ? 'bigfs.revealEntry' : 'revealInExplorer',
      uri,
    );
  });
  pick.onDidAccept(() => {
    const [item] = pick.selectedItems;

    if (!item) {
      return;
    }

    void context.globalState.update(
      RECENT_STATE_KEY,
      [
        item.file.key,
        ...getRecent().filter((key) => key !== item.file.key),
      ].slice(0, MAX_RECENT),
    );
    pick.hide();
    void commands.executeCommand('vscode.open', item.file.uri);
  });
  pick.onDidHide(() => pick.dispose());
  pick.show();

  try {
    files = getFinderFiles(await gameView.getRoot());
    pick.placeholder = `Type a file name or path (${formatCount(files.length, 'file')})`;
    refresh();
  } finally {
    pick.busy = false;
  }
};
