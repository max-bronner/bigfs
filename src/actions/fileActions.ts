import { FileType, Uri, window, workspace } from 'vscode';
import path from 'path';
import { getAvailableName, getParentPath, isPathBelow } from '../common/paths';
import { getNodeUri } from '../common/uri';
import { confirmDelete, resolveConflicts } from '../ui/dialogs';
import { findChild, getTopLevelNodes } from '../model/virtualNode';
import type { VirtualNode } from '../model/virtualNode';
import type { ArchiveModel } from '../model/archiveModel';

interface ImportedFile {
  name: string;
  content: Uint8Array;
}

/**
 * Gets the directory a node targets: itself for a directory, its parent for a file
 */
export const getTargetDirectoryPath = (node: VirtualNode): string =>
  node.type === FileType.Directory ? node.path : getParentPath(node.path);

/**
 * Resolves the directory node an operation on a target node applies to
 */
export const resolveTargetDirectory = (
  archiveModel: ArchiveModel,
  target: VirtualNode,
): VirtualNode | undefined =>
  archiveModel.getNode(getNodeUri(getTargetDirectoryPath(target)));

const canMoveInto = (source: VirtualNode, target: VirtualNode): boolean => {
  const isAlreadyInTarget = getParentPath(source.path) === target.path;
  const isTargetInsideSource = isPathBelow(target.path, source.path);

  return !isAlreadyInTarget && !isTargetInsideSource;
};

/**
 * Keeps the sources belonging to the target's archive and warns about the rest
 */
const getSourcesInArchive = (
  sources: readonly VirtualNode[],
  targetDirectory: VirtualNode,
  operation: string,
): VirtualNode[] => {
  const topLevelSources = getTopLevelNodes(sources);

  const sourcesInArchive = topLevelSources.filter(
    (source) => source.archivePath === targetDirectory.archivePath,
  );

  if (sourcesInArchive.length < topLevelSources.length) {
    window.showWarningMessage(
      `Entries can only be ${operation} inside the archive they belong to.`,
    );
  }

  return sourcesInArchive;
};

export const moveNodes = async (
  archiveModel: ArchiveModel,
  sources: readonly VirtualNode[],
  targetDirectory: VirtualNode,
): Promise<number> => {
  const sourcesInArchive = getSourcesInArchive(
    sources,
    targetDirectory,
    'moved',
  );

  const movableSources = sourcesInArchive.filter((source) =>
    canMoveInto(source, targetDirectory),
  );

  const hasNodeConflict = (node: VirtualNode) =>
    targetDirectory.children?.has(node.name) ?? false;

  const acceptedNodes = await resolveConflicts(movableSources, hasNodeConflict);

  if (!acceptedNodes.length) {
    return 0;
  }

  const acceptedUris = acceptedNodes.map((node) => getNodeUri(node.path));

  await archiveModel.moveEntries(acceptedUris, getNodeUri(targetDirectory.path));

  return acceptedNodes.length;
};

export const copyNodes = async (
  archiveModel: ArchiveModel,
  sources: readonly VirtualNode[],
  targetDirectory: VirtualNode,
): Promise<number> => {
  const sourcesInArchive = getSourcesInArchive(
    sources,
    targetDirectory,
    'copied',
  );

  if (!sourcesInArchive.length) {
    return 0;
  }

  const takenNames = new Set(targetDirectory.children?.keys() ?? []);
  const copies: { sourceUri: Uri; targetName: string }[] = [];

  for (const source of sourcesInArchive) {
    const targetName = getAvailableName(takenNames, source.name);

    takenNames.add(targetName);
    copies.push({ sourceUri: getNodeUri(source.path), targetName });
  }

  await archiveModel.copyEntries(copies, getNodeUri(targetDirectory.path));

  return copies.length;
};

export const deleteNodes = async (
  archiveModel: ArchiveModel,
  nodes: readonly VirtualNode[],
): Promise<number> => {
  const topLevelNodes = getTopLevelNodes(nodes);

  if (!topLevelNodes.length) {
    return 0;
  }

  const confirmed = await confirmDelete(topLevelNodes.map((node) => node.name));

  if (!confirmed) {
    return 0;
  }

  const urisByArchive = new Map<string, Uri[]>();

  for (const node of topLevelNodes) {
    const uris = urisByArchive.get(node.archivePath) ?? [];

    uris.push(getNodeUri(node.path));
    urisByArchive.set(node.archivePath, uris);
  }

  for (const uris of urisByArchive.values()) {
    await archiveModel.deleteEntries(uris);
  }

  return topLevelNodes.length;
};

const readFiles = async (sourceUris: Uri[]): Promise<ImportedFile[]> => {
  const files: ImportedFile[] = [];

  const read = async (uri: Uri, parentPath: string): Promise<void> => {
    const name = path.posix.basename(uri.path);
    const relativePath = parentPath ? `${parentPath}/${name}` : name;
    const { type } = await workspace.fs.stat(uri);

    if (type === FileType.File) {
      files.push({
        name: relativePath,
        content: await workspace.fs.readFile(uri),
      });

      return;
    }

    if (type !== FileType.Directory) {
      return;
    }

    const children = await workspace.fs.readDirectory(uri);

    for (const [childName] of children) {
      await read(Uri.joinPath(uri, childName), relativePath);
    }
  };

  for (const uri of sourceUris) {
    await read(uri, '');
  }

  return files;
};

export const importFromDisk = async (
  archiveModel: ArchiveModel,
  sourceUris: Uri[],
  targetDirectory: VirtualNode,
): Promise<number> => {
  const files = await readFiles(sourceUris);

  const hasFileConflict = (file: ImportedFile) =>
    Boolean(findChild(targetDirectory, file.name));

  const acceptedFiles = await resolveConflicts(files, hasFileConflict);

  if (!acceptedFiles.length) {
    return 0;
  }

  await archiveModel.addFiles(getNodeUri(targetDirectory.path), acceptedFiles);

  return acceptedFiles.length;
};
