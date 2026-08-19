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
import { getParentPath } from '../common/paths';
import { getNodeUri } from '../common/uri';
import type { ArchiveModel } from '../model/archiveModel';
import type { VirtualNode } from '../model/virtualNode';

export class BigDragAndDropController
  implements TreeDragAndDropController<VirtualNode>
{
  readonly dropMimeTypes = [
    'application/vnd.code.tree.bigArchiveExplorer',
    'text/uri-list',
  ];
  readonly dragMimeTypes = ['application/vnd.code.tree.bigArchiveExplorer'];

  constructor(private archiveModel: ArchiveModel) {}

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

    return this.archiveModel.getNode(getNodeUri(getParentPath(target.path)));
  }
}
