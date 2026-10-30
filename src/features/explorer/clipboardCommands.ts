import { env } from 'vscode';
import { setContextKey } from '../../platform/contextKeys';
import {
  copyNodes,
  getTargetDirectory,
  transferNodes,
} from './fileActions';
import { getTopLevelNodes } from '../../services/archives/virtualNode';
import type { RegisterNodeCommand } from '../../services/archives/nodeCommands';
import type { VirtualNode } from '../../services/archives/virtualNode';
import type { ArchiveModel } from '../../services/archives/archiveModel';

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

    await setContextKey('hasClipboard', Boolean(content));
  };

  /**
   * Pastes into the target's directory, moving for a cut and copying for a
   * copy, also from another archive or from the base game
   */
  const paste = async (target: VirtualNode): Promise<void> => {
    const directory = getTargetDirectory(target);

    if (!clipboard || !directory) {
      return;
    }

    const { nodes, operation } = clipboard;
    const { transferred, moved } = await transferNodes(
      archiveModel,
      nodes,
      directory,
      operation === 'cut' ? 'move' : 'copy',
    );

    // A copy can be pasted again; a cut is spent only by a paste that took
    // the files out of their archive. One that copied out of the read-only
    // base game, or moved nothing, leaves it waiting
    if (transferred && moved) {
      await setClipboard(undefined);
    }
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

  register('bigfs.cut', async (targets) => {
    await setClipboard({ nodes: [...targets], operation: 'cut' });
  });

  register('bigfs.copy', async (targets) => {
    await setClipboard({ nodes: [...targets], operation: 'copy' });
  });

  register('bigfs.paste', ([target]) => paste(target));
  register('bigfs.duplicate', (targets) => duplicate(targets));

  register('bigfs.copyPath', async (targets) => {
    await env.clipboard.writeText(targets.map(getAbsolutePath).join('\n'));
  });

  register('bigfs.copyRelativePath', async (targets) => {
    await env.clipboard.writeText(targets.map(getEntryPath).join('\n'));
  });
};
