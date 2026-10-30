import { Uri, DataTransfer, DataTransferItem, FileType, window } from 'vscode';
import type { TreeDragAndDropController } from 'vscode';
import { importFromDisk, transferNodes } from './fileActions';
import { formatCount } from '../../core/messages';
import type { ArchiveModel } from '../../services/archives/archiveModel';
import type { VirtualNode } from '../../services/archives/virtualNode';
import { isVirtualNode } from '../../services/archives/explorerRow';
import type { ExplorerNode } from '../../services/archives/explorerRow';

/**
 * Drag and drop controller for the archive explorer. It moves nodes inside an
 * archive and takes files dropped in from outside VS Code, both through the
 * same actions the commands use
 */
export class BigDragAndDropController implements TreeDragAndDropController<ExplorerNode> {
  /**
   * The explorer's own drag type, whose last segment has to be the view id, and
   * the type a drop from outside VS Code arrives as
   */
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
    // Only nodes can be dragged: a source or a folder on disk is not ours
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
      return; // a source or a folder on disk holds no entries to drop into
    }

    try {
      const internalData = dataTransfer.get(this.dropMimeTypes[0]);

      if (internalData) {
        const { transferred, moved } = await transferNodes(
          this.archiveModel,
          internalData.value as VirtualNode[],
          directory,
          'move',
        );

        if (transferred) {
          window.showInformationMessage(
            `${moved ? 'Moved' : 'Copied'} ${formatCount(transferred, 'file')} to ${directory.name}.`,
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

  /** Where a drop lands: the target, or the directory holding a target file */
  private resolveDropDirectory(target: VirtualNode): VirtualNode | undefined {
    if (target.type === FileType.Directory) {
      return target;
    }

    return target.parent;
  }
}
