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
import { getNodeUri } from '../common/uri';
import {
  countFileNodes,
  getNodePath,
  isArchiveRoot,
} from '../model/virtualNode';
import type { ArchiveModel } from '../model/archiveModel';
import type { VirtualNode } from '../model/virtualNode';
import {
  isFolderNode,
  isSourceNode,
  isVirtualNode,
} from './explorerNode';
import type { ExplorerNode, FolderNode } from './explorerNode';

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

const rowName = (element: ExplorerNode): string =>
  isSourceNode(element) ? element.source.label : element.name;

const sortRows = (rows: ExplorerNode[]): ExplorerNode[] => rows.sort(compareRows);

export class BigTreeItem extends TreeItem {
  constructor(
    public readonly node: VirtualNode,
    public readonly collapsibleState: TreeItemCollapsibleState,
    isLoaded = true,
  ) {
    super(node.name, collapsibleState);

    this.id = getNodePath(node);
    this.resourceUri = getNodeUri(getNodePath(node));
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

export class BigTreeDataProvider implements TreeDataProvider<ExplorerNode> {
  private _onDidChangeTreeData: EventEmitter<ExplorerNode | undefined | void> =
    new EventEmitter<ExplorerNode | undefined | void>();
  readonly onDidChangeTreeData: Event<ExplorerNode | undefined | void> =
    this._onDidChangeTreeData.event;

  constructor(private archiveModel: ArchiveModel) {
    this.archiveModel.onDidChangeArchive((change) => {
      const archive =
        change.kind === 'changed' &&
        this.archiveModel.getArchiveByPath(change.archivePath);

      if (archive) {
        // Redraw the archive that changed, not every archive in the view
        this._onDidChangeTreeData.fire(archive.root);
        return;
      }

      this.refresh();
    });
  }

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
   * The rows of one folder on disk: the archives directly in it, and the
   * folders that hold archives further down
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
