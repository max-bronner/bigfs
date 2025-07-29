import type { Event } from 'vscode';
import {
  Uri,
  TreeItem,
  TreeDataProvider,
  EventEmitter,
  TreeItemCollapsibleState,
  FileType,
  ThemeIcon,
} from 'vscode';
import type { VirtualFileService } from './virtualFileService';
import type { VirtualNode } from '../types';

export class BigTreeNode extends TreeItem {
  constructor(
    public readonly node: VirtualNode,
    public readonly collapsibleState: TreeItemCollapsibleState
  ) {
    super(node.name, collapsibleState);

    if (node.type === FileType.File) {
      this.command = {
        command: 'bigfs.openFile',
        title: 'Open File',
        arguments: [Uri.parse(`bigfs:${node.path}`)],
      };
      this.iconPath = new ThemeIcon('file');
    } else {
      this.iconPath = new ThemeIcon('folder');
      this.description = `(${node.children?.size} files)`;
    }
    this.tooltip = node.path;
  }
}

export class BigExplorerProvider implements TreeDataProvider<VirtualNode> {
  private _onDidChangeTreeData: EventEmitter<VirtualNode | undefined | void> =
    new EventEmitter<VirtualNode | undefined | void>();
  readonly onDidChangeTreeData: Event<VirtualNode | undefined | void> =
    this._onDidChangeTreeData.event;

  constructor(private fileService: VirtualFileService) {
    this.fileService.onDidChangeArchives(() => {
      this._onDidChangeTreeData.fire();
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

  getChildren(element?: VirtualNode): Thenable<VirtualNode[]> {
    if (!element) {
      const archives = this.fileService.getArchives();
      return Promise.resolve(Array.from(archives.values()));
    }

    if (element.type === FileType.Directory && element.children) {
      return Promise.resolve(Array.from(element.children.values()));
    }

    return Promise.resolve([]);
  }
}
