import type { Event } from 'vscode';
import {
  Uri,
  TreeItem,
  TreeDataProvider,
  EventEmitter,
  TreeItemCollapsibleState,
  TreeDragAndDropController,
  FileType,
  DataTransfer,
  DataTransferItem,
  window,
} from 'vscode';
import type { VirtualFileService } from './virtualFileService';
import {
  getNodeUri,
  getParentPath,
  importFromDisk,
  moveNodes,
} from './fileOperations';
import type { VirtualNode } from '../types';

const nameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

const compareNames = (a: VirtualNode, b: VirtualNode): number =>
  nameCollator.compare(a.name, b.name);

const sortNodes = (nodes: VirtualNode[]): VirtualNode[] =>
  nodes.sort(compareNames);

export class BigTreeNode extends TreeItem {
  constructor(
    public readonly node: VirtualNode,
    public readonly collapsibleState: TreeItemCollapsibleState,
  ) {
    super(node.name, collapsibleState);

    this.id = node.path;
    this.resourceUri = getNodeUri(node.path);
    this.tooltip = node.path;

    if (node.type === FileType.File) {
      this.contextValue = 'bigFile';
      this.command = {
        command: 'vscode.open',
        title: 'Open',
        arguments: [this.resourceUri],
      };
    } else {
      const isArchiveRoot = node.path === `/${node.name}`;

      this.contextValue = isArchiveRoot ? 'bigArchive' : 'bigFolder';
      this.description = `(${node.children?.size} files)`;
    }
  }
}

export class BigExplorerProvider
  implements
    TreeDataProvider<VirtualNode>,
    TreeDragAndDropController<VirtualNode>
{
  readonly dropMimeTypes = [
    'application/vnd.code.tree.bigArchiveExplorer',
    'text/uri-list',
  ];
  readonly dragMimeTypes = ['application/vnd.code.tree.bigArchiveExplorer'];

  private _onDidChangeTreeData: EventEmitter<VirtualNode | undefined | void> =
    new EventEmitter<VirtualNode | undefined | void>();
  readonly onDidChangeTreeData: Event<VirtualNode | undefined | void> =
    this._onDidChangeTreeData.event;

  constructor(private fileService: VirtualFileService) {
    this.fileService.onDidChangeArchives(() => {
      this.refresh();
    });
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: VirtualNode): TreeItem {
    const collapsibleState =
      element.type === FileType.Directory
        ? TreeItemCollapsibleState.Collapsed
        : TreeItemCollapsibleState.None;
    return new BigTreeNode(element, collapsibleState);
  }

  async getChildren(element?: VirtualNode): Promise<VirtualNode[]> {
    if (!element) {
      await this.fileService.whenReady();

      return sortNodes(Array.from(this.fileService.getArchives().values()));
    }

    if (element.type === FileType.Directory && element.children) {
      return sortNodes(Array.from(element.children.values()));
    }

    return [];
  }

  async handleDrag(
    source: readonly VirtualNode[],
    dataTransfer: DataTransfer,
  ): Promise<void> {
    dataTransfer.set(this.dragMimeTypes[0], new DataTransferItem(source));
  }

  async handleDrop(
    target: VirtualNode | undefined,
    dataTransfer: DataTransfer,
  ): Promise<void> {
    const directory = target && this.resolveDropDirectory(target);

    if (!directory) {
      return;
    }

    try {
      const internalData = dataTransfer.get(this.dropMimeTypes[0]);

      if (internalData) {
        const moved = await moveNodes(
          this.fileService,
          internalData.value as VirtualNode[],
          directory,
        );

        if (moved) {
          const items = `${moved} item${moved === 1 ? '' : 's'}`;

          window.showInformationMessage(`Moved ${items} to ${directory.name}.`);
        }

        return;
      }

      const externalData = dataTransfer.get(this.dropMimeTypes[1]);

      if (externalData) {
        const sourceUris = String(externalData.value)
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => Uri.parse(line));

        const imported = await importFromDisk(
          this.fileService,
          sourceUris,
          directory,
        );

        if (imported) {
          const files = `${imported} file${imported === 1 ? '' : 's'}`;

          window.showInformationMessage(`Added ${files} to ${directory.name}.`);
        }
      }
    } catch (error) {
      window.showErrorMessage(`Drop failed: ${error}`);
    }
  }

  private resolveDropDirectory(target: VirtualNode): VirtualNode | undefined {
    if (target.type === FileType.Directory) {
      return target;
    }

    return this.fileService.getNode(getNodeUri(getParentPath(target.path)));
  }
}
