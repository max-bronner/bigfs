import { commands, window, workspace } from 'vscode';
import { formatCount } from '../common/messages';
import { getParentPath } from '../common/paths';
import { getNodeUri } from '../common/uri';
import { askForName } from '../ui/dialogs';
import {
  deleteNodes,
  getTargetDirectoryPath,
  importFromDisk,
  resolveTargetDirectory,
} from '../actions/fileActions';
import type { RegisterNodeCommand } from './commandCenter';
import type { VirtualNode } from '../types';
import type { VirtualFileService } from '../big/virtualFileService';

const readChildNames = async (directoryPath: string): Promise<Set<string>> => {
  const children = await workspace.fs.readDirectory(getNodeUri(directoryPath));

  return new Set(children.map(([name]) => name));
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

const addFiles = async (
  fileService: VirtualFileService,
  target: VirtualNode,
): Promise<void> => {
  const directory = resolveTargetDirectory(fileService, target);

  if (!directory) {
    return;
  }

  const sourceUris = await window.showOpenDialog({
    canSelectMany: true,
    openLabel: 'Add to Archive',
  });

  if (!sourceUris?.length) {
    return;
  }

  const importedCount = await importFromDisk(fileService, sourceUris, directory);

  if (importedCount) {
    window.showInformationMessage(
      `Added ${formatCount(importedCount, 'file')} to ${directory.name}.`,
    );
  }
};

export const registerFileCommands = (
  register: RegisterNodeCommand,
  fileService: VirtualFileService,
): void => {
  register('newFile', ([target]) => createFile(target));
  register('newFolder', ([target]) => createFolder(target));
  register('rename', ([target]) => renameNode(target));
  register('addFiles', ([target]) => addFiles(fileService, target));
  register('delete', async (targets) => {
    await deleteNodes(fileService, targets);
  });
};
