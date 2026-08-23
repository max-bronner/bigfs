import type { Event } from 'vscode';
import {
  TreeItem,
  TreeDataProvider,
  EventEmitter,
  ThemeIcon,
  TreeItemCollapsibleState,
  FileType,
} from 'vscode';
import { formatCount } from '../common/messages';
import { countFileNodes, isArchiveRoot } from '../model/virtualNode';
import { getNodePath, getNodeUri } from '../model/nodeAddress';
import type { ArchiveModel } from '../model/archiveModel';
import type { VirtualNode } from '../model/virtualNode';
import { isFolderNode, isSourceNode, isVirtualNode } from './explorerNode';
import type { ExplorerNode, FolderNode } from './explorerNode';

/** Compares names as an explorer does: `a2` before `a10`, casing ignored */
const nameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

/** Orders a row the way the explorer does: directories first, then by name */
const compareRows = (a: ExplorerNode, b: ExplorerNode): number => {
  const aIsBranch = !isVirtualNode(a) || a.type === FileType.Directory;
  const bIsBranch = !isVirtualNode(b) || b.type === FileType.Directory;

  if (aIsBranch !== bIsBranch) {
    return aIsBranch ? -1 : 1;
  }

  return nameCollator.compare(rowName(a), rowName(b));
};

/** The text a row is ordered by: a source's label, everything else's name */
const rowName = (element: ExplorerNode): string =>
  isSourceNode(element) ? element.source.label : element.name;

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
   */
  constructor(
    public readonly node: VirtualNode,
    public readonly collapsibleState: TreeItemCollapsibleState,
    isLoaded = true,
  ) {
    super(node.name, collapsibleState);

    this.id = getNodePath(node);
    this.resourceUri = getNodeUri(node);
    this.tooltip = getNodePath(node);

    if (node.type === FileType.File) {
      this.contextValue = 'bigFile';
      this.command = {
        command: 'vscode.open',
        title: 'Open',
        arguments: [this.resourceUri],
      };

      return;
    }

    this.contextValue = isArchiveRoot(node) ? 'bigArchive' : 'bigFolder';

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

  constructor(private archiveModel: ArchiveModel) {
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

    return new BigTreeItem(
      element,
      element.type === FileType.Directory
        ? TreeItemCollapsibleState.Collapsed
        : TreeItemCollapsibleState.None,
      !isArchiveRoot(element) || this.archiveModel.isLoaded(element),
    );
  }

  async getChildren(element?: ExplorerNode): Promise<ExplorerNode[]> {
    if (!element) {
      await this.archiveModel.whenReady();

      const sources = this.archiveModel.getSources();

      // One source needs no row of its own, it would only add a level
      return sources.length === 1
        ? this.listIn(sources[0].id, '')
        : sortRows(sources.map((source) => ({ kind: 'source', source })));
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
