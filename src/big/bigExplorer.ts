import {
  TreeItem,
  TreeDataProvider,
  TreeItemCollapsibleState,
  FileType,
  ThemeIcon,
} from 'vscode';
import type { FileService } from './virtualFileSystem';
import { VirtualNode } from './virtualFileSystem';

export class BigTreeNode extends TreeItem {
  constructor(
    public readonly node: VirtualNode,
    public readonly collapsibleState: TreeItemCollapsibleState
  ) {
    super(node.name, collapsibleState);

    if (node.type === FileType.File) {
      this.iconPath = new ThemeIcon('file');
    } else {
      this.iconPath = new ThemeIcon('folder');
      this.description = `(${node.children?.size} files)`;
    }
    this.tooltip = node.path;
  }
}

export class BigExplorerProvider implements TreeDataProvider<VirtualNode> {
  constructor(private fileService: FileService) {}

  getTreeItem(element: VirtualNode): TreeItem {
    const collapsibleState =
      element.type === FileType.Directory
        ? TreeItemCollapsibleState.Collapsed
        : TreeItemCollapsibleState.None;
    return new BigTreeNode(element, collapsibleState);
  }

  getChildren(element?: VirtualNode): Thenable<VirtualNode[]> {
    return Promise.resolve([]);
  }
}
