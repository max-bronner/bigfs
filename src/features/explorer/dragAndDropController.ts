import { Uri, DataTransfer, DataTransferItem, FileType, window } from 'vscode';
import type { TreeDragAndDropController } from 'vscode';
import { importFromDisk, transferNodes } from './fileActions';
import { copyArchivesInto } from './archiveFileActions';
import { formatCount } from '../../core/messages';
import type { ArchiveModel } from '../../services/archives/archiveModel';
import type { VirtualNode } from '../../services/archives/virtualNode';
import {
  isFolderRow,
  isGameRow,
  isSourceRow,
  isVirtualNode,
} from '../../services/archives/explorerRow';
import type { ExplorerRow } from '../../services/archives/explorerRow';

/**
 * Drag and drop controller for the archive explorer. It moves nodes inside an
 * archive and between archives, takes files and folders dropped in from
 * outside VS Code, and takes archives dropped on a folder on disk, all through
 * the same actions the commands use
 */
export class BigDragAndDropController implements TreeDragAndDropController<ExplorerRow> {
  /**
   * The explorer's own drag type, whose last segment has to be the view id, and
   * the type a drop from outside VS Code arrives as
   */
  readonly dropMimeTypes = [
    'application/vnd.code.tree.bigArchiveExplorer',
    'text/uri-list',
  ];
  /** The explorer's own drag type, the only one a drag from it carries */
  readonly dragMimeTypes = ['application/vnd.code.tree.bigArchiveExplorer'];

  constructor(private archiveModel: ArchiveModel) {}

  /** Puts the dragged nodes on the transfer under the explorer's own type */
  async handleDrag(
    source: readonly ExplorerRow[],
    dataTransfer: DataTransfer,
  ): Promise<void> {
    // Only nodes can be dragged: a source or a folder on disk is not ours
    dataTransfer.set(
      this.dragMimeTypes[0],
      new DataTransferItem(source.filter(isVirtualNode)),
    );
  }

  /**
   * Moves nodes dragged inside the explorer, or adds files dropped from
   * outside, into the directory at the drop target
   */
  async handleDrop(
    target: ExplorerRow | undefined,
    dataTransfer: DataTransfer,
  ): Promise<void> {
    if (target && isGameRow(target)) {
      window.showWarningMessage(
        'The game view only shows what the game loads. Drop into an archive of the workspace instead.',
      );

      return;
    }

    try {
      if (target && (isSourceRow(target) || isFolderRow(target))) {
        await this.dropOnDiskFolder(target, dataTransfer);

        return;
      }

      const directory =
        target && isVirtualNode(target)
          ? this.resolveDropDirectory(target)
          : undefined;

      if (directory) {
        await this.dropIntoArchive(directory, dataTransfer);
      }
    } catch (error) {
      window.showErrorMessage(`Drop failed: ${error}`);
    }
  }

  /** Copies the archives a drop carries into the folder on disk it landed on */
  private async dropOnDiskFolder(
    target: ExplorerRow,
    dataTransfer: DataTransfer,
  ): Promise<void> {
    const copied = await copyArchivesInto(
      this.archiveModel,
      target,
      this.readDroppedUris(dataTransfer),
    );

    if (copied) {
      window.showInformationMessage(`Copied ${formatCount(copied, 'archive')}.`);
    }
  }

  /** Moves or adds what a drop carries into a directory of an archive */
  private async dropIntoArchive(
    directory: VirtualNode,
    dataTransfer: DataTransfer,
  ): Promise<void> {
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

    const sourceUris = this.readDroppedUris(dataTransfer);

    if (!sourceUris.length) {
      return;
    }

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

  /** Reads the uris a drop from outside the explorer carries, one per line */
  private readDroppedUris(dataTransfer: DataTransfer): Uri[] {
    const value = dataTransfer.get(this.dropMimeTypes[1])?.value;

    return String(value ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => Uri.parse(line));
  }

  /** Resolves where a drop lands: the target, or the directory holding a target file */
  private resolveDropDirectory(target: VirtualNode): VirtualNode | undefined {
    if (target.type === FileType.Directory) {
      return target;
    }

    return target.parent;
  }
}
