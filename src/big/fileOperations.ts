import { FileType, Uri, window, workspace } from 'vscode';
import path from 'path';
import { SCHEME } from '../constants';
import type { VirtualNode } from '../types';
import type { VirtualFileService } from './virtualFileService';

interface ImportedFile {
  name: string;
  content: Uint8Array;
}

type OverwriteChoice = 'replace' | 'skip' | 'cancel';

const MAX_LISTED_NAMES = 5;

const REPLACE_LABEL = 'Replace';
const SKIP_LABEL = 'Skip';

export const getNodeUri = (nodePath: string): Uri =>
  Uri.from({ scheme: SCHEME, path: nodePath });

export const getParentPath = (nodePath: string): string =>
  nodePath.slice(0, nodePath.lastIndexOf('/'));

const isPathBelow = (nodePath: string, ancestorPath: string): boolean =>
  nodePath === ancestorPath || nodePath.startsWith(`${ancestorPath}/`);

const getOverwriteMessage = (
  names: string[],
): { message: string; detail: string } => {
  const listedFiles = names.slice(0, MAX_LISTED_NAMES);
  const hiddenFileCount = names.length - listedFiles.length;

  if (hiddenFileCount) {
    listedFiles.push(`and ${hiddenFileCount} more`);
  }

  const subject =
    names.length === 1 ? 'item already exists' : 'items already exist';

  return {
    message: `${names.length} ${subject} here.`,
    detail: listedFiles.join(', '),
  };
};

const askForOverwrite = async (names: string[]): Promise<OverwriteChoice> => {
  const { message, detail } = getOverwriteMessage(names);

  const selectedOption = await window.showWarningMessage(
    message,
    { modal: true, detail },
    REPLACE_LABEL,
    SKIP_LABEL,
  );

  switch (selectedOption) {
    case REPLACE_LABEL:
      return 'replace';
    case SKIP_LABEL:
      return 'skip';
    default:
      return 'cancel';
  }
};

const resolveConflicts = async <T extends { name: string }>(
  items: T[],
  isConflicting: (item: T) => boolean,
): Promise<T[]> => {
  const conflictingItems = items.filter(isConflicting);

  if (!conflictingItems.length) {
    return items;
  }

  const conflictingItemNames = conflictingItems.map((item) => item.name);
  const selectedOption = await askForOverwrite(conflictingItemNames);

  switch (selectedOption) {
    case 'replace':
      return items;
    case 'skip':
      return items.filter((item) => !isConflicting(item));
    case 'cancel':
      return [];
    default:
      return [];
  }
};

const findChild = (
  directory: VirtualNode,
  relativePath: string,
): VirtualNode | undefined => {
  let node: VirtualNode | undefined = directory;

  const pathSegments = relativePath.split('/');

  for (const segment of pathSegments) {
    node = node?.children?.get(segment);
  }

  return node;
};

export const getTopLevelNodes = (
  nodes: readonly VirtualNode[],
): VirtualNode[] => {
  const isNested = (node: VirtualNode) =>
    nodes.some((other) => other !== node && isPathBelow(node.path, other.path));

  return nodes.filter((node) => !isNested(node));
};

const canMoveInto = (source: VirtualNode, target: VirtualNode): boolean => {
  const isAlreadyInTarget = getParentPath(source.path) === target.path;
  const isTargetInsideSource = isPathBelow(target.path, source.path);

  return !isAlreadyInTarget && !isTargetInsideSource;
};

export const moveNodes = async (
  fileService: VirtualFileService,
  sources: readonly VirtualNode[],
  targetDirectory: VirtualNode,
): Promise<number> => {
  const topLevelSources = getTopLevelNodes(sources);

  const isInTargetArchive = (source: VirtualNode) =>
    source.archivePath === targetDirectory.archivePath;

  const sourcesInArchive = topLevelSources.filter(isInTargetArchive);

  if (sourcesInArchive.length < topLevelSources.length) {
    window.showWarningMessage(
      'Entries can only be moved inside the archive they belong to.',
    );
  }

  const isMovable = (source: VirtualNode) =>
    canMoveInto(source, targetDirectory);

  const movableSources = sourcesInArchive.filter(isMovable);

  const hasNodeConflict = (node: VirtualNode) =>
    targetDirectory.children?.has(node.name) ?? false;

  const acceptedNodes = await resolveConflicts(movableSources, hasNodeConflict);

  if (!acceptedNodes.length) {
    return 0;
  }

  const acceptedUris = acceptedNodes.map((node) => getNodeUri(node.path));

  await fileService.moveEntries(acceptedUris, getNodeUri(targetDirectory.path));

  return acceptedNodes.length;
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
  fileService: VirtualFileService,
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

  await fileService.addFiles(getNodeUri(targetDirectory.path), acceptedFiles);

  return acceptedFiles.length;
};
