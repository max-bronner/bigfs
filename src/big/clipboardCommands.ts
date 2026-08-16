import { commands, env, window, FileType } from 'vscode';
import type { ExtensionContext, TreeView } from 'vscode';
import { SCHEME } from '../constants';
import {
  copyNodes,
  getNodeUri,
  getParentPath,
  getTopLevelNodes,
  moveNodes,
} from './fileOperations';
import type { VirtualNode } from '../types';
import type { VirtualFileService } from './virtualFileService';

type ClipboardOperation = 'cut' | 'copy';

interface ClipboardContent {
  nodes: VirtualNode[];
  operation: ClipboardOperation;
}

const getEntryPath = (node: VirtualNode): string => {
  const [, ...segments] = node.path.split('/').filter(Boolean);

  return segments.join('\\');
};

const getAbsolutePath = (node: VirtualNode): string =>
  `${node.archivePath}\\${getEntryPath(node)}`;

const getTargetDirectoryPath = (node: VirtualNode): string =>
  node.type === FileType.Directory ? node.path : getParentPath(node.path);

export const registerClipboardCommands = (
  context: ExtensionContext,
  fileService: VirtualFileService,
  treeView: TreeView<VirtualNode>,
): void => {
  let clipboard: ClipboardContent | undefined;

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

  const resolveDirectory = (target: VirtualNode): VirtualNode | undefined =>
    fileService.getNode(getNodeUri(getTargetDirectoryPath(target)));

  const paste = async (target: VirtualNode): Promise<void> => {
    const directory = resolveDirectory(target);

    if (!clipboard || !directory) {
      return;
    }

    if (clipboard.operation === 'copy') {
      await copyNodes(fileService, clipboard.nodes, directory);
      return;
    }

    await moveNodes(fileService, clipboard.nodes, directory);

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
      const directory = fileService.getNode(getNodeUri(directoryPath));

      if (directory) {
        await copyNodes(fileService, siblings, directory);
      }
    }
  };

  const getTargets = (
    target?: VirtualNode,
    selection?: VirtualNode[],
  ): VirtualNode[] => {
    if (selection?.length) {
      return selection;
    }

    return target ? [target] : [...treeView.selection];
  };

  const register = (
    name: string,
    run: (targets: VirtualNode[]) => Promise<void>,
  ): void => {
    const execute = async (
      target?: VirtualNode,
      selection?: VirtualNode[],
    ): Promise<void> => {
      const targets = getTargets(target, selection);

      if (!targets.length) {
        return;
      }

      try {
        await run(targets);
      } catch (error) {
        window.showErrorMessage(
          error instanceof Error ? error.message : String(error),
        );
      }
    };

    context.subscriptions.push(
      commands.registerCommand(`${SCHEME}.${name}`, execute),
    );
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
