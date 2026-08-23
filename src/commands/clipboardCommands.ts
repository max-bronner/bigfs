import { commands, env } from 'vscode';
import { SCHEME } from '../constants';
import {
  copyNodes,
  getTargetDirectory,
  moveNodes,
} from '../actions/fileActions';
import { getTopLevelNodes } from '../model/virtualNode';
import type { RegisterNodeCommand } from './commandCenter';
import type { VirtualNode } from '../model/virtualNode';
import type { ArchiveModel } from '../model/archiveModel';

type ClipboardOperation = 'cut' | 'copy';

/**
 * What a cut or copy left on the tree's own clipboard: held in memory for the
 * session, separate from the system clipboard the copy path commands write to
 */
interface ClipboardContent {
  nodes: VirtualNode[];
  operation: ClipboardOperation;
}

/**
 * Registers the palette and context menu entries for cut, copy, paste,
 * duplicate and the two copy path commands, through the register callback the
 * command center hands out
 */
export const registerClipboardCommands = (
  register: RegisterNodeCommand,
  archiveModel: ArchiveModel,
): void => {
  let clipboard: ClipboardContent | undefined;

  /**
   * Gets the entry path with the backslash separators the index table stores,
   * which is the form a path pasted outside the editor is expected in
   */
  const getEntryPath = (node: VirtualNode): string =>
    node.entryPath.replace(/\//g, '\\');

  /** Gets the archive's path on disk with the entry appended, which no file system will open */
  const getAbsolutePath = (node: VirtualNode): string =>
    `${node.archive.archivePath}\\${getEntryPath(node)}`;

  /** Sets the clipboard and the context key the paste menu entry is gated on */
  const setClipboard = async (
    content: ClipboardContent | undefined,
  ): Promise<void> => {
    clipboard = content;

    await commands.executeCommand(
      'setContext',
      `${SCHEME}.hasClipboard`,
      Boolean(content),
    );
  };

  /** Pastes into the target's directory, moving for a cut and copying for a copy */
  const paste = async (target: VirtualNode): Promise<void> => {
    const directory = getTargetDirectory(target);

    if (!clipboard || !directory) {
      return;
    }

    if (clipboard.operation === 'copy') {
      await copyNodes(archiveModel, clipboard.nodes, directory);
      return; // a copy can be pasted again, a cut is spent by the paste
    }

    await moveNodes(archiveModel, clipboard.nodes, directory);

    await setClipboard(undefined);
  };

  /**
   * Copies each node beside itself under a free name, a directory at a time
   * because a copy targets one directory
   */
  const duplicate = async (nodes: readonly VirtualNode[]): Promise<void> => {
    const siblingsByDirectory = new Map<VirtualNode, VirtualNode[]>();

    for (const node of getTopLevelNodes(nodes)) {
      const directory = node.parent;

      if (!directory) {
        continue;
      }

      const siblings = siblingsByDirectory.get(directory) ?? [];

      siblings.push(node);
      siblingsByDirectory.set(directory, siblings);
    }

    for (const [directory, siblings] of siblingsByDirectory) {
      await copyNodes(archiveModel, siblings, directory);
    }
  };

  register('cut', async (targets) => {
    await setClipboard({ nodes: [...targets], operation: 'cut' });
  });

  register('copy', async (targets) => {
    await setClipboard({ nodes: [...targets], operation: 'copy' });
  });

  register('paste', ([target]) => paste(target));
  register('duplicate', (targets) => duplicate(targets));

  register('copyPath', async (targets) => {
    await env.clipboard.writeText(targets.map(getAbsolutePath).join('\n'));
  });

  register('copyRelativePath', async (targets) => {
    await env.clipboard.writeText(targets.map(getEntryPath).join('\n'));
  });
};
