import {
  TreeItem,
  TreeDataProvider,
  TreeItemCollapsibleState,
  FileType,
} from 'vscode';
import type { FileService } from './virtualFileSystem';
import { VirtualNode } from './virtualFileSystem';

export class BigTreeNode extends TreeItem {
  constructor(
    public readonly node: VirtualNode,
    public readonly collapsibleState: TreeItemCollapsibleState
  ) {
    super(node.name, collapsibleState);
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
