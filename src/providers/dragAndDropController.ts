import {
  Uri,
  DataTransfer,
  DataTransferItem,
  FileType,
  window,
} from 'vscode';
import type { TreeDragAndDropController } from 'vscode';
import { importFromDisk, moveNodes } from '../actions/fileActions';
import { formatCount } from '../common/messages';
import type { ArchiveModel } from '../model/archiveModel';
import type { VirtualNode } from '../model/virtualNode';
import { isVirtualNode } from './explorerNode';
import type { ExplorerNode } from './explorerNode';

export class BigDragAndDropController
  implements TreeDragAndDropController<ExplorerNode>
{
  readonly dropMimeTypes = [
    'application/vnd.code.tree.bigArchiveExplorer',
    'text/uri-list',
  ];
  readonly dragMimeTypes = ['application/vnd.code.tree.bigArchiveExplorer'];

  constructor(private archiveModel: ArchiveModel) {}

  async handleDrag(
    source: readonly ExplorerNode[],
    dataTransfer: DataTransfer,
  ): Promise<void> {
    // Only entries can be dragged: a source or a folder on disk is not ours
    dataTransfer.set(
      this.dragMimeTypes[0],
      new DataTransferItem(source.filter(isVirtualNode)),
    );
  }

  async handleDrop(
    target: ExplorerNode | undefined,
    dataTransfer: DataTransfer,
  ): Promise<void> {
    const directory =
      target && isVirtualNode(target)
        ? this.resolveDropDirectory(target)
        : undefined;

    if (!directory) {
      return;
    }

    try {
      const internalData = dataTransfer.get(this.dropMimeTypes[0]);

      if (internalData) {
        const moved = await moveNodes(
          this.archiveModel,
          internalData.value as VirtualNode[],
          directory,
        );

        if (moved) {
          window.showInformationMessage(
            `Moved ${formatCount(moved, 'item')} to ${directory.name}.`,
          );
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
          this.archiveModel,
          sourceUris,
          directory,
        );

        if (imported) {
          window.showInformationMessage(
            `Added ${formatCount(imported, 'file')} to ${directory.name}.`,
          );
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

    return target.parent;
  }
}
