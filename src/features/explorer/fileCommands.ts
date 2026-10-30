import { commands, window, workspace } from 'vscode';
import { formatCount } from '../../core/messages';
import { getChildUri, getNodeUri } from '../../services/archives/nodeAddress';
import { askForName } from '../../platform/dialogs';
import {
  deleteNodes,
  getTargetDirectory,
  importFromDisk,
} from './fileActions';
import type { RegisterNodeCommand } from '../../services/archives/nodeCommands';
import type { VirtualNode } from '../../services/archives/virtualNode';
import type { ArchiveModel } from '../../services/archives/archiveModel';

/**
 * Gets the names already used in a directory, through the file system provider
 * so an archive that has not been read yet is loaded first
 */
const readChildNames = async (
  directory: VirtualNode,
): Promise<Set<string>> => {
  const children = await workspace.fs.readDirectory(getNodeUri(directory));

  return new Set(children.map(([name]) => name));
};

/**
 * Creates an empty file beside or below the target and opens it. Goes through
 * the file system api rather than the model, so the editor learns about the
 * new file the same way it would on disk.
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

/**
 * Creates a directory beside or below the target. Nothing reaches the archive:
 * a directory exists only in the tree until a file below it is stored.
 */
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

/** Renames a node from a prompt, refusing a name already taken beside it */
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

/**
 * Adds files picked from disk to the target's directory, and tells the user
 * how many landed
 */
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

/**
 * Registers the palette and context menu entries for creating, renaming,
 * adding and deleting nodes, through the register callback
 * `createNodeCommandRegistrar` hands out
 */
export const registerFileCommands = (
  register: RegisterNodeCommand,
  archiveModel: ArchiveModel,
): void => {
  register('bigfs.newFile', ([target]) => createFile(target));
  register('bigfs.newFolder', ([target]) => createFolder(target));
  register('bigfs.rename', ([target]) => renameNode(target));
  register('bigfs.addFiles', ([target]) => addFiles(archiveModel, target));
  register('bigfs.delete', async (targets) => {
    await deleteNodes(archiveModel, targets);
  });
};
