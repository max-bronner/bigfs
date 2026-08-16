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
const DELETE_LABEL = 'Delete';

export const getNodeUri = (nodePath: string): Uri =>
  Uri.from({ scheme: SCHEME, path: nodePath });

export const getParentPath = (nodePath: string): string =>
  nodePath.slice(0, nodePath.lastIndexOf('/'));

const isPathBelow = (nodePath: string, ancestorPath: string): boolean =>
  nodePath === ancestorPath || nodePath.startsWith(`${ancestorPath}/`);

const getListedNames = (names: string[]): string => {
  const listedNames = names.slice(0, MAX_LISTED_NAMES);
  const hiddenCount = names.length - listedNames.length;

  if (hiddenCount) {
    listedNames.push(`and ${hiddenCount} more`);
  }

  return listedNames.join(', ');
};

const getOverwriteMessage = (
  names: string[],
): { message: string; detail: string } => {
  const subject =
    names.length === 1 ? 'item already exists' : 'items already exist';

  return {
    message: `${names.length} ${subject} here.`,
    detail: getListedNames(names),
  };
};

const getDeleteMessage = (
  names: string[],
): { message: string; detail: string } => {
  const subject =
    names.length === 1 ? 'this item' : `these ${names.length} items`;

  return {
    message: `Permanently delete ${subject} from the archive?`,
    detail: getListedNames(names),
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

const getAvailableName = (takenNames: Set<string>, name: string): string => {
  if (!takenNames.has(name)) {
    return name;
  }

  const extension = path.posix.extname(name);
  const baseName = name.slice(0, name.length - extension.length);

  let availableName = `${baseName} copy${extension}`;
  let copyNumber = 2;

  while (takenNames.has(availableName)) {
    availableName = `${baseName} copy ${copyNumber}${extension}`;
    copyNumber += 1;
  }

  return availableName;
};

export const copyNodes = async (
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
      'Entries can only be copied inside the archive they belong to.',
    );
  }

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

  await fileService.copyEntries(copies, getNodeUri(targetDirectory.path));

  return copies.length;
};

export const deleteNodes = async (
  fileService: VirtualFileService,
  nodes: readonly VirtualNode[],
): Promise<number> => {
  const topLevelNodes = getTopLevelNodes(nodes);

  if (!topLevelNodes.length) {
    return 0;
  }

  const { message, detail } = getDeleteMessage(
    topLevelNodes.map((node) => node.name),
  );

  const selectedOption = await window.showWarningMessage(
    message,
    { modal: true, detail },
    DELETE_LABEL,
  );

  if (selectedOption !== DELETE_LABEL) {
    return 0;
  }

  const urisByArchive = new Map<string, Uri[]>();

  for (const node of topLevelNodes) {
    const uris = urisByArchive.get(node.archivePath) ?? [];

    uris.push(getNodeUri(node.path));
    urisByArchive.set(node.archivePath, uris);
  }

  for (const uris of urisByArchive.values()) {
    await fileService.deleteEntries(uris);
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
