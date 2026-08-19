import type { Event } from 'vscode';
import {
  TreeItem,
  TreeDataProvider,
  EventEmitter,
  TreeItemCollapsibleState,
  FileType,
} from 'vscode';
import { formatCount } from '../common/messages';
import { getNodeUri } from '../common/uri';
import { countFileNodes } from '../model/virtualNode';
import type { ArchiveModel } from '../model/archiveModel';
import type { VirtualNode } from '../model/virtualNode';

const nameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

const compareNames = (a: VirtualNode, b: VirtualNode): number =>
  nameCollator.compare(a.name, b.name);

const sortNodes = (nodes: VirtualNode[]): VirtualNode[] =>
  nodes.sort(compareNames);

export class BigTreeItem extends TreeItem {
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
      this.contextValue = node.isArchiveRoot ? 'bigArchive' : 'bigFolder';
      this.description = `(${formatCount(countFileNodes(node), 'file')})`;
    }
  }
}

export class BigTreeDataProvider implements TreeDataProvider<VirtualNode> {
  private _onDidChangeTreeData: EventEmitter<VirtualNode | undefined | void> =
    new EventEmitter<VirtualNode | undefined | void>();
  readonly onDidChangeTreeData: Event<VirtualNode | undefined | void> =
    this._onDidChangeTreeData.event;

  constructor(private archiveModel: ArchiveModel) {
    this.archiveModel.onDidChangeArchive((change) => {
      const archive =
        change.kind === 'changed' &&
        this.archiveModel.getArchiveByPath(change.archivePath);

      if (archive) {
        this._onDidChangeTreeData.fire(archive.root);
        return;
      }

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

    return new BigTreeItem(element, collapsibleState);
  }

  async getChildren(element?: VirtualNode): Promise<VirtualNode[]> {
    if (!element) {
      await this.archiveModel.whenReady();

      return sortNodes(this.archiveModel.getArchiveRoots());
    }

    if (element.type === FileType.Directory && element.children) {
      return sortNodes(Array.from(element.children.values()));
    }

    return [];
  }
}
