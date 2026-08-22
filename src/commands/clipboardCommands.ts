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

interface ClipboardContent {
  nodes: VirtualNode[];
  operation: ClipboardOperation;
}

export const registerClipboardCommands = (
  register: RegisterNodeCommand,
  archiveModel: ArchiveModel,
): void => {
  let clipboard: ClipboardContent | undefined;

  // Copied for use outside the editor, where the archive separator is a
  // backslash the way the index table stores it
  const getEntryPath = (node: VirtualNode): string =>
    node.entryPath.replace(/\//g, '\\');

  const getAbsolutePath = (node: VirtualNode): string =>
    `${node.archive.archivePath}\\${getEntryPath(node)}`;

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

  const paste = async (target: VirtualNode): Promise<void> => {
    const directory = getTargetDirectory(target);

    if (!clipboard || !directory) {
      return;
    }

    if (clipboard.operation === 'copy') {
      await copyNodes(archiveModel, clipboard.nodes, directory);
      return;
    }

    await moveNodes(archiveModel, clipboard.nodes, directory);

    await setClipboard(undefined);
  };

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
