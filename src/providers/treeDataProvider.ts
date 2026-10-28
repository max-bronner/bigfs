import type { Event } from 'vscode';
import { workspace } from 'vscode';
import {
  TreeItem,
  TreeDataProvider,
  EventEmitter,
  ThemeIcon,
  TreeItemCollapsibleState,
  FileType,
} from 'vscode';
import { formatCount } from '../core/messages';
import { countFileNodes, isArchiveRoot } from '../model/virtualNode';
import { getNodePath, getNodeUri } from '../model/nodeAddress';
import type { ArchiveModel } from '../model/archiveModel';
import type { VirtualNode } from '../model/virtualNode';
import {
  isFolderNode,
  isGameRow,
  isSourceNode,
  isVirtualNode,
} from './explorerNode';
import type { ExplorerNode, FolderNode, GameRow } from './explorerNode';
import { GameViewModel } from '../model/gameViewModel';
import { getGameFiles } from '../model/gameView';

/** Compares names as an explorer does: `a2` before `a10`, casing ignored */
const nameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

/** Orders a row the way the explorer does: directories first, then by name */
const compareRows = (a: ExplorerNode, b: ExplorerNode): number => {
  const aIsBranch = isBranch(a);
  const bIsBranch = isBranch(b);

  if (aIsBranch !== bIsBranch) {
    return aIsBranch ? -1 : 1;
  }

  return nameCollator.compare(rowName(a), rowName(b));
};

/** Whether a row holds rows below it */
const isBranch = (element: ExplorerNode): boolean =>
  isGameRow(element)
    ? Boolean(element.node.children)
    : !isVirtualNode(element) || element.type === FileType.Directory;

/** The text a row is ordered by: a source's label, everything else's name */
const rowName = (element: ExplorerNode): string =>
  isSourceNode(element)
    ? element.source.label
    : isGameRow(element)
      ? element.node.name
      : element.name;

/** Setting choosing between the per archive view and the game view */
export const VIEW_SETTING = 'bigfs.explorer.view';

/** Ends the context value of a row in a read-only source, which package.json keeps the edit items off */
const READ_ONLY_SUFFIX = 'ReadOnly';

/** Whether the explorer shows the game view rather than every archive */
export const isGameViewShown = (): boolean =>
  workspace.getConfiguration().get<string>(VIEW_SETTING) === 'game';

/**
 * Tree row of the game view. A file opens the copy the game loads; its
 * description names where that copy comes from, and the tooltip lists the
 * copies it overrides
 */
const createGameItem = (
  { node }: GameRow,
  isReadOnly: (node: VirtualNode) => boolean,
): TreeItem => {
  if (node.children) {
    const item = new TreeItem(node.name, TreeItemCollapsibleState.Collapsed);

    item.id = `game:/${node.path}`;
    item.iconPath = ThemeIcon.Folder;
    item.contextValue = 'bigGameFolder';
    item.description = `(${formatCount(getGameFiles(node).length, 'file')})`;

    return item;
  }

  const winner = node.winner!;
  const uri =
    winner.ref.kind === 'entry' ? getNodeUri(winner.ref.node) : winner.ref.uri;
  const item = new TreeItem(node.name, TreeItemCollapsibleState.None);

  item.id = `game:/${node.path}`;
  item.resourceUri = uri;
  item.description = node.shadowed?.length
    ? `${winner.origin} · overrides ${node.shadowed.length}`
    : winner.origin;
  item.tooltip = [
    `${node.path}`,
    `Loaded from ${winner.origin}`,
    ...(node.shadowed ?? []).map((copy) => `Ignored in ${copy.origin}`),
  ].join('\n');
  item.contextValue =
    winner.ref.kind === 'entry'
      ? `bigFile${isReadOnly(winner.ref.node) ? READ_ONLY_SUFFIX : ''}`
      : 'bigLooseFile';
  item.command = { command: 'vscode.open', title: 'Open', arguments: [uri] };

  return item;
};

const sortRows = (rows: ExplorerNode[]): ExplorerNode[] =>
  rows.sort(compareRows);

/**
 * Tree row for an archive or something inside one. Its id is the node path, so
 * the view can hold on to a row across a redraw, and a file row carries the
 * command that opens it
 */
export class BigTreeItem extends TreeItem {
  /**
   * @param isLoaded - False for an archive whose index table has not been read,
   * which leaves the file count off the row until it has
   * @param isReadOnly - True for a row of the base game, whose menu leaves out
   * everything that edits (the context value carries `ReadOnly`)
   */
  constructor(
    public readonly node: VirtualNode,
    public readonly collapsibleState: TreeItemCollapsibleState,
    isLoaded = true,
    isReadOnly = false,
  ) {
    super(node.name, collapsibleState);

    const suffix = isReadOnly ? READ_ONLY_SUFFIX : '';

    this.id = getNodePath(node);
    this.resourceUri = getNodeUri(node);
    this.tooltip = getNodePath(node);

    if (node.type === FileType.File) {
      this.contextValue = `bigFile${suffix}`;
      this.command = {
        command: 'vscode.open',
        title: 'Open',
        arguments: [this.resourceUri],
      };

      return;
    }

    this.contextValue = `${isArchiveRoot(node) ? 'bigArchive' : 'bigFolder'}${suffix}`;

    // An archive that has not been read yet says nothing about its content
    if (isLoaded) {
      this.description = `(${formatCount(countFileNodes(node), 'file')})`;
    }
  }
}

/**
 * Tree data provider backing the archive explorer. It shows the sources, the
 * folders on disk that hold archives, and the tree inside each archive, and an
 * archive is read only when a row of it is expanded
 */
export class BigTreeDataProvider implements TreeDataProvider<ExplorerNode> {
  /**
   * Fired with one archive root to redraw that archive, or with nothing to
   * redraw the whole view
   */
  private _onDidChangeTreeData: EventEmitter<ExplorerNode | undefined | void> =
    new EventEmitter<ExplorerNode | undefined | void>();
  readonly onDidChangeTreeData: Event<ExplorerNode | undefined | void> =
    this._onDidChangeTreeData.event;

  constructor(
    private archiveModel: ArchiveModel,
    private gameView: GameViewModel = new GameViewModel(archiveModel),
  ) {
    gameView.onDidChange(() => {
      if (isGameViewShown()) {
        this.refresh();
      }
    });

    this.archiveModel.onDidChangeArchive((change) => {
      const archive =
        change.type === 'changed' &&
        this.archiveModel.getArchiveByPath(change.archivePath);

      if (archive) {
        // The view holds this root, so firing it redraws only this archive
        this._onDidChangeTreeData.fire(archive.root);
        return;
      }

      this.refresh();
    });
  }

  /**
   * Redraws the whole view, for when the set of archives may have changed
   * rather than the content of one of them
   */
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ExplorerNode): TreeItem {
    if (isSourceNode(element)) {
      const item = new TreeItem(
        element.source.label,
        TreeItemCollapsibleState.Expanded,
      );

      item.id = `/${element.source.id}`;
      item.iconPath = new ThemeIcon('root-folder');
      item.resourceUri = element.source.baseUri;
      item.contextValue = 'bigSource';

      return item;
    }

    if (isFolderNode(element)) {
      const item = new TreeItem(
        element.name,
        TreeItemCollapsibleState.Collapsed,
      );

      item.id = `/${element.sourceId}/${element.path}`;
      item.iconPath = ThemeIcon.Folder;
      item.contextValue = 'bigDiskFolder';

      return item;
    }

    if (isGameRow(element)) {
      return createGameItem(element, (node) =>
        this.archiveModel.isReadOnly(node.archive),
      );
    }

    return new BigTreeItem(
      element,
      element.type === FileType.Directory
        ? TreeItemCollapsibleState.Collapsed
        : TreeItemCollapsibleState.None,
      !isArchiveRoot(element) || this.archiveModel.isLoaded(element),
      this.archiveModel.isReadOnly(element.archive),
    );
  }

  async getChildren(element?: ExplorerNode): Promise<ExplorerNode[]> {
    if (!element && isGameViewShown()) {
      return this.listGameRows(await this.gameView.getRoot());
    }

    if (!element) {
      await this.archiveModel.whenReady();

      const sources = this.archiveModel.getSources();

      // One source needs no row of its own, it would only add a level
      return sources.length === 1
        ? this.listIn(sources[0].id, '')
        : sortRows(sources.map((source) => ({ kind: 'source', source })));
    }

    if (isGameRow(element)) {
      return this.listGameRows(element.node);
    }

    if (isSourceNode(element)) {
      return this.listIn(element.source.id, '');
    }

    if (isFolderNode(element)) {
      return this.listIn(element.sourceId, element.path);
    }

    if (element.type !== FileType.Directory) {
      return [];
    }

    if (isArchiveRoot(element)) {
      // The content is read the first time an archive is opened
      await this.archiveModel.loadArchiveOf(element);
    }

    return sortRows(Array.from(element.children?.values() ?? []));
  }

  /** Lists the rows below a game view directory */
  private listGameRows(node: GameRow['node']): ExplorerNode[] {
    return sortRows(
      Array.from(node.children?.values() ?? [], (child) => ({
        kind: 'game' as const,
        node: child,
      })),
    );
  }

  /**
   * Lists the rows of one folder on disk: the archives directly in it, and the
   * folders that hold archives further down. A folder with no archive anywhere
   * below it never appears
   */
  private listIn(sourceId: string, directoryPath: string): ExplorerNode[] {
    const prefix = directoryPath ? `${directoryPath}/` : '';
    const folders = new Map<string, FolderNode>();
    const rows: ExplorerNode[] = [];

    for (const archive of this.archiveModel.getArchivesOf(sourceId)) {
      if (!archive.pathInSource.startsWith(prefix)) {
        continue;
      }

      const rest = archive.pathInSource.slice(prefix.length);
      const separator = rest.indexOf('/');

      if (separator < 0) {
        rows.push(archive.root);
        continue;
      }

      const name = rest.slice(0, separator);

      folders.set(name, {
        kind: 'folder',
        sourceId,
        path: `${prefix}${name}`,
        name,
      });
    }

    return sortRows([...folders.values(), ...rows]);
  }
}
