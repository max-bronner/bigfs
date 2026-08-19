import { commands, env } from 'vscode';
import { SCHEME } from '../constants';
import { getParentPath } from '../common/paths';
import { getNodeUri } from '../common/uri';
import {
  copyNodes,
  moveNodes,
  resolveTargetDirectory,
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

  const getEntryPath = (node: VirtualNode): string =>
    (archiveModel.getEntryPath(node) ?? '').replace(/\//g, '\\');

  const getAbsolutePath = (node: VirtualNode): string =>
    `${node.archivePath}\\${getEntryPath(node)}`;

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
    const directory = resolveTargetDirectory(archiveModel, target);

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
    const nodesByDirectory = new Map<string, VirtualNode[]>();

    for (const node of getTopLevelNodes(nodes)) {
      const directoryPath = getParentPath(node.path);
      const siblings = nodesByDirectory.get(directoryPath) ?? [];

      siblings.push(node);
      nodesByDirectory.set(directoryPath, siblings);
    }

    for (const [directoryPath, siblings] of nodesByDirectory) {
      const directory = archiveModel.getNode(getNodeUri(directoryPath));

      if (directory) {
        await copyNodes(archiveModel, siblings, directory);
      }
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
