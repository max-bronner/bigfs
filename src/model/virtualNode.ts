import { FileType } from 'vscode';
import { getParentPath, splitPath } from '../common/paths';
import type { Archive } from './archive';

/**
 * A file or directory inside an archive.
 *
 * A node stores the least that identifies it: which archive holds it and
 * where inside that archive it sits. Everything else about its address, the
 * path through the tree and the uri VS Code uses, is rendered from those two
 * rather than stored, so there is one place that knows the shape of an
 * address instead of a string being sliced wherever one is needed.
 *
 * Children are keyed case insensitively, while `name` keeps the casing the
 * entry is stored with.
 */
export interface VirtualNode {
  name: string;
  type: FileType;
  /** Relative to the archive, empty for the archive itself */
  entryPath: string;
  archive: Archive;
  children?: Map<string, VirtualNode>;
}

/** The archive itself, which nothing inside an archive may be confused with */
export const isArchiveRoot = (node: VirtualNode): boolean => !node.entryPath;

/** Where the node sits in the virtual file system, for VS Code to address */
export const getNodePath = (node: VirtualNode): string =>
  node.entryPath
    ? `${node.archive.rootPath}/${node.entryPath}`
    : node.archive.rootPath;

const joinEntryPath = (parentPath: string, name: string): string =>
  parentPath ? `${parentPath}/${name}` : name;

/** Adds a child to a node, reusing it when the tree already holds one */
const addChild = (
  parentNode: VirtualNode,
  childName: string,
  isFile: boolean,
): VirtualNode => {
  if (parentNode.type === FileType.File || !parentNode.children) {
    throw Error(`Node is already a file`);
  }

  const childKey = childName.toLowerCase();
  const type = isFile ? FileType.File : FileType.Directory;
  const childNode: VirtualNode = parentNode.children.get(childKey) ?? {
    name: childName,
    type,
    entryPath: joinEntryPath(parentNode.entryPath, childName),
    archive: parentNode.archive,
  };

  if (!isFile && !childNode.children) {
    childNode.children = new Map<string, VirtualNode>();
  }

  parentNode.children.set(childKey, childNode);

  return childNode;
};

/** Builds the tree of an archive from the entry paths it holds */
export const buildVirtualTree = (
  archive: Archive,
  entryPaths: Iterable<string>,
): VirtualNode => {
  const rootNode: VirtualNode = {
    name: archive.name,
    type: FileType.Directory,
    entryPath: '',
    archive,
    children: new Map<string, VirtualNode>(),
  };

  for (const entryPath of entryPaths) {
    insertFile(rootNode, entryPath);
  }

  return rootNode;
};

const reEntryPath = (node: VirtualNode, entryPath: string): void => {
  node.entryPath = entryPath;

  node.children?.forEach((child) =>
    reEntryPath(child, joinEntryPath(entryPath, child.name)),
  );
};

/** Inserts a file, creating the directories above it */
export const insertFile = (
  rootNode: VirtualNode,
  entryPath: string,
): VirtualNode => {
  const segments = splitPath(entryPath);
  let node = rootNode;

  segments.forEach((segment, index) => {
    node = addChild(node, segment, index === segments.length - 1);
  });

  return node;
};

/**
 * Inserts a directory and the directories above it. A directory exists only
 * in the tree, since an archive stores file paths and nothing else.
 */
export const insertDirectory = (
  rootNode: VirtualNode,
  directoryPath: string,
): VirtualNode => {
  let node = rootNode;

  for (const segment of splitPath(directoryPath)) {
    node = addChild(node, segment, false);
  }

  return node;
};

/** Removes a node and everything below it */
export const removeNode = (rootNode: VirtualNode, entryPath: string): void => {
  const segments = splitPath(entryPath);
  const name = segments.pop();

  if (!name) {
    return;
  }

  findChild(rootNode, segments.join('/'))?.children?.delete(name.toLowerCase());
};

/**
 * Moves a node, carrying everything below it including directories that hold
 * no files of their own
 */
export const moveNode = (
  rootNode: VirtualNode,
  from: string,
  to: string,
): void => {
  const node = findChild(rootNode, from);

  if (!node) {
    return;
  }

  removeNode(rootNode, from);

  const name = splitPath(to).at(-1);

  if (!name) {
    return;
  }

  const parent = insertDirectory(rootNode, getParentPath(to));

  node.name = name;
  parent.children?.set(name.toLowerCase(), node);
  reEntryPath(node, joinEntryPath(parent.entryPath, name));
};

/** Mirrors a node at another path */
export const copyNode = (
  rootNode: VirtualNode,
  from: string,
  to: string,
): void => {
  const source = findChild(rootNode, from);

  if (!source) {
    return;
  }

  if (source.type === FileType.File) {
    insertFile(rootNode, to);
    return;
  }

  insertDirectory(rootNode, to);

  source.children?.forEach((child) =>
    copyNode(rootNode, `${from}/${child.name}`, `${to}/${child.name}`),
  );
};

/**
 * Brings the files of a tree in line with the entries of an archive that was
 * read again. Directories are left alone, so the ones a user created and the
 * ones whose files were removed elsewhere both survive.
 */
export const syncFiles = (
  rootNode: VirtualNode,
  entryPaths: Iterable<string>,
): void => {
  const wanted = new Set(
    Array.from(entryPaths, (entryPath) => entryPath.toLowerCase()),
  );

  const prune = (node: VirtualNode): void => {
    node.children?.forEach((child, key) => {
      if (child.type !== FileType.File) {
        prune(child);
        return;
      }

      if (!wanted.has(child.entryPath.toLowerCase())) {
        node.children?.delete(key);
      }
    });
  };

  prune(rootNode);

  for (const entryPath of entryPaths) {
    insertFile(rootNode, entryPath);
  }
};

/**
 * Finds the file that stands where a path expects a directory, if any.
 * Archives store file paths, so nothing can be written below a file.
 */
export const findBlockingFile = (
  rootNode: VirtualNode,
  entryPath: string,
): VirtualNode | undefined => {
  let node: VirtualNode | undefined = rootNode;

  for (const segment of splitPath(getParentPath(entryPath))) {
    node = node?.children?.get(segment.toLowerCase());

    if (!node) {
      return undefined; // the rest of the chain does not exist yet
    }

    if (node.type === FileType.File) {
      return node;
    }
  }

  return undefined;
};

/** Finds a node below a directory by its relative path */
export const findChild = (
  directory: VirtualNode,
  relativePath: string,
): VirtualNode | undefined => {
  let node: VirtualNode | undefined = directory;

  for (const segment of splitPath(relativePath)) {
    node = node?.children?.get(segment.toLowerCase());
  }

  return node;
};

/** Counts the files at or below a node */
export const countFileNodes = (node: VirtualNode): number => {
  if (node.type === FileType.File) {
    return 1;
  }

  let count = 0;

  for (const child of node.children?.values() ?? []) {
    count += countFileNodes(child);
  }

  return count;
};

/** Gets the file nodes at or below a node */
export const getFileNodes = (node: VirtualNode): VirtualNode[] => {
  if (node.type === FileType.File) {
    return [node];
  }

  const fileNodes: VirtualNode[] = [];

  for (const child of node.children?.values() ?? []) {
    fileNodes.push(...getFileNodes(child));
  }

  return fileNodes;
};

/**
 * Drops the nodes that sit below another node of the same selection. Two
 * archives can hold the same entry path, so the archive is part of the
 * comparison rather than the path alone.
 */
export const getTopLevelNodes = (
  nodes: readonly VirtualNode[],
): VirtualNode[] => {
  const isBelow = (node: VirtualNode, other: VirtualNode): boolean =>
    node.archive === other.archive &&
    node.entryPath.startsWith(`${other.entryPath}/`);

  return nodes.filter(
    (node) => !nodes.some((other) => other !== node && isBelow(node, other)),
  );
};
