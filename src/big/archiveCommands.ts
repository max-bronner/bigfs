import { commands, window, workspace, FileType } from 'vscode';
import type { ExtensionContext, TreeView } from 'vscode';
import { SCHEME } from '../constants';
import { deleteNodes, getNodeUri, getParentPath } from './fileOperations';
import type { VirtualNode } from '../types';
import type { VirtualFileService } from './virtualFileService';

const SEPARATOR_PATTERN = /[\\/]/;

interface NamePrompt {
  title: string;
  takenNames: Set<string>;
  currentName?: string;
}

const getTargetDirectoryPath = (node: VirtualNode): string =>
  node.type === FileType.Directory ? node.path : getParentPath(node.path);

const readChildNames = async (directoryPath: string): Promise<Set<string>> => {
  const children = await workspace.fs.readDirectory(getNodeUri(directoryPath));

  return new Set(children.map(([name]) => name));
};

const askForName = async (prompt: NamePrompt): Promise<string | undefined> => {
  const validateName = (input: string): string | undefined => {
    const name = input.trim();

    if (!name) {
      return 'A name is required.';
    }

    if (SEPARATOR_PATTERN.test(name)) {
      return 'A name cannot contain a path separator.';
    }

    if (name !== prompt.currentName && prompt.takenNames.has(name)) {
      return `${name} already exists here.`;
    }

    return undefined;
  };

  const name = await window.showInputBox({
    title: prompt.title,
    value: prompt.currentName,
    validateInput: validateName,
  });

  return name?.trim();
};

const createFile = async (target: VirtualNode): Promise<void> => {
  const directoryPath = getTargetDirectoryPath(target);
  const takenNames = await readChildNames(directoryPath);

  const name = await askForName({ title: 'New File', takenNames });

  if (!name) {
    return;
  }

  const uri = getNodeUri(`${directoryPath}/${name}`);

  await workspace.fs.writeFile(uri, new Uint8Array());
  await commands.executeCommand('vscode.open', uri);
};

const createFolder = async (target: VirtualNode): Promise<void> => {
  const directoryPath = getTargetDirectoryPath(target);
  const takenNames = await readChildNames(directoryPath);

  const name = await askForName({ title: 'New Folder', takenNames });

  if (!name) {
    return;
  }

  await workspace.fs.createDirectory(getNodeUri(`${directoryPath}/${name}`));
};

const renameNode = async (target: VirtualNode): Promise<void> => {
  const parentPath = getParentPath(target.path);
  const takenNames = await readChildNames(parentPath);

  const name = await askForName({
    title: 'Rename',
    takenNames,
    currentName: target.name,
  });

  if (!name || name === target.name) {
    return;
  }

  await workspace.fs.rename(
    getNodeUri(target.path),
    getNodeUri(`${parentPath}/${name}`),
    { overwrite: false },
  );
};

export const registerArchiveCommands = (
  context: ExtensionContext,
  fileService: VirtualFileService,
  treeView: TreeView<VirtualNode>,
): void => {
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

  register('newFile', ([target]) => createFile(target));
  register('newFolder', ([target]) => createFolder(target));
  register('rename', ([target]) => renameNode(target));
  register('delete', async (targets) => {
    await deleteNodes(fileService, targets);
  });
};
