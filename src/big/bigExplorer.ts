import { TreeItem, TreeDataProvider, TreeItemCollapsibleState } from 'vscode';
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
    return new BigTreeNode(element, TreeItemCollapsibleState.Collapsed);
  }

  getChildren(element?: VirtualNode): Thenable<VirtualNode[]> {
    return Promise.resolve([]);
  }
}
