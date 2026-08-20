import { FileType } from 'vscode';
import { getParentPath, isPathBelow, splitPath } from '../common/paths';

/**
 * A file or directory inside an archive. Children are keyed case
 * insensitively, while `name` keeps the casing the entry is stored with.
 */
export interface VirtualNode {
  name: string;
  type: FileType;
  path: string;
  archivePath: string;
  children?: Map<string, VirtualNode>;
  /** Set on the node an archive is mounted at, which cannot be edited */
  isArchiveRoot?: boolean;
}

/**
 * Adds a child to a node, reusing it when the tree already holds one
 */
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
    path: `${parentNode.path}/${childName}`,
    archivePath: parentNode.archivePath,
  };

  if (!isFile && !childNode.children) {
    childNode.children = new Map<string, VirtualNode>();
  }

  parentNode.children.set(childKey, childNode);

  return childNode;
};

const addEntryPath = (rootNode: VirtualNode, entryPath: string): void => {
  const segments = splitPath(entryPath);
  let parentNode = rootNode;

  segments.forEach((segment, index) => {
    const isFile = index === segments.length - 1;

    parentNode = addChild(parentNode, segment, isFile);
  });
};

/**
 * Builds an archive's tree from its entry paths, plus the directories that
 * are tracked while nothing is stored below them
 */
export const buildVirtualTree = (
  name: string,
  rootPath: string,
  archivePath: string,
  entryPaths: Iterable<string>,
): VirtualNode => {
  const rootNode: VirtualNode = {
    name,
    type: FileType.Directory,
    path: rootPath,
    archivePath,
    children: new Map<string, VirtualNode>(),
    isArchiveRoot: true,
  };

  for (const entryPath of entryPaths) {
    addEntryPath(rootNode, entryPath);
  }

  return rootNode;
};

const repath = (node: VirtualNode, nodePath: string): void => {
  node.path = nodePath;

  node.children?.forEach((child) => repath(child, `${nodePath}/${child.name}`));
};

/**
 * Inserts a file, creating the directories above it
 */
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

/**
 * Removes a node and everything below it
 */
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
  repath(node, `${parent.path}/${name}`);
};

/**
 * Mirrors a node at another path
 */
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

  const prune = (node: VirtualNode, prefix: string): void => {
    node.children?.forEach((child, key) => {
      const childPath = prefix ? `${prefix}/${child.name}` : child.name;

      if (child.type !== FileType.File) {
        prune(child, childPath);
        return;
      }

      if (!wanted.has(childPath.toLowerCase())) {
        node.children?.delete(key);
      }
    });
  };

  prune(rootNode, '');

  for (const entryPath of entryPaths) {
    insertFile(rootNode, entryPath);
  }
};

/**
 * Gets the file nodes at or below a node
 */
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
 * Counts the files at or below a node
 */
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

/**
 * Drops the nodes that sit below another node of the same selection
 */
export const getTopLevelNodes = (
  nodes: readonly VirtualNode[],
): VirtualNode[] => {
  const isNested = (node: VirtualNode) =>
    nodes.some((other) => other !== node && isPathBelow(node.path, other.path));

  return nodes.filter((node) => !isNested(node));
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

/**
 * Finds a node below a directory by its relative path
 */
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
