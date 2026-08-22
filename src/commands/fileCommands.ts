import { commands, window, workspace } from 'vscode';
import { formatCount } from '../common/messages';
import { getChildUri, getNodeUri } from '../model/nodeAddress';
import { askForName } from '../ui/dialogs';
import {
  deleteNodes,
  getTargetDirectory,
  importFromDisk,
} from '../actions/fileActions';
import type { RegisterNodeCommand } from './commandCenter';
import type { VirtualNode } from '../model/virtualNode';
import type { ArchiveModel } from '../model/archiveModel';

const readChildNames = async (
  directory: VirtualNode,
): Promise<Set<string>> => {
  const children = await workspace.fs.readDirectory(getNodeUri(directory));

  return new Set(children.map(([name]) => name));
};

/**
 * Creating goes through the file system api rather than the model, so the
 * editor learns about the new file the same way it would on disk
 */
const createFile = async (target: VirtualNode): Promise<void> => {
  const directory = getTargetDirectory(target);

  if (!directory) {
    return;
  }

  const name = await askForName({
    title: 'New File',
    takenNames: await readChildNames(directory),
  });

  if (!name) {
    return;
  }

  const uri = getChildUri(directory, name);

  await workspace.fs.writeFile(uri, new Uint8Array());
  await commands.executeCommand('vscode.open', uri);
};

const createFolder = async (target: VirtualNode): Promise<void> => {
  const directory = getTargetDirectory(target);

  if (!directory) {
    return;
  }

  const name = await askForName({
    title: 'New Folder',
    takenNames: await readChildNames(directory),
  });

  if (!name) {
    return;
  }

  await workspace.fs.createDirectory(getChildUri(directory, name));
};

const renameNode = async (target: VirtualNode): Promise<void> => {
  const directory = target.parent;

  if (!directory) {
    return; // an archive is renamed on disk, not here
  }

  const name = await askForName({
    title: 'Rename',
    takenNames: await readChildNames(directory),
    currentName: target.name,
  });

  if (!name || name === target.name) {
    return;
  }

  await workspace.fs.rename(getNodeUri(target), getChildUri(directory, name), {
    overwrite: false,
  });
};

const addFiles = async (
  archiveModel: ArchiveModel,
  target: VirtualNode,
): Promise<void> => {
  const directory = getTargetDirectory(target);

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

  const importedCount = await importFromDisk(
    archiveModel,
    sourceUris,
    directory,
  );

  if (importedCount) {
    window.showInformationMessage(
      `Added ${formatCount(importedCount, 'file')} to ${directory.name}.`,
    );
  }
};

export const registerFileCommands = (
  register: RegisterNodeCommand,
  archiveModel: ArchiveModel,
): void => {
  register('newFile', ([target]) => createFile(target));
  register('newFolder', ([target]) => createFolder(target));
  register('rename', ([target]) => renameNode(target));
  register('addFiles', ([target]) => addFiles(archiveModel, target));
  register('delete', async (targets) => {
    await deleteNodes(archiveModel, targets);
  });
};
