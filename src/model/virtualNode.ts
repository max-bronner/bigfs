import { FileType } from 'vscode';
import { isPathBelow, splitPath } from '../common/paths';

/**
 * A file or directory inside an archive
 */
export interface VirtualNode {
  name: string;
  type: FileType;
  path: string;
  archivePath: string;
  children?: Map<string, VirtualNode>;
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

  const type = isFile ? FileType.File : FileType.Directory;
  const childNode: VirtualNode = parentNode.children.get(childName) ?? {
    name: childName,
    type,
    path: `${parentNode.path}/${childName}`,
    archivePath: parentNode.archivePath,
  };

  if (!isFile && !childNode.children) {
    childNode.children = new Map<string, VirtualNode>();
  }

  parentNode.children.set(childName, childNode);

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

const addDirectoryPath = (
  rootNode: VirtualNode,
  directoryPath: string,
): void => {
  let parentNode = rootNode;

  for (const segment of splitPath(directoryPath)) {
    const existingNode = parentNode.children?.get(segment);

    if (existingNode && existingNode.type !== FileType.Directory) {
      return;
    }

    parentNode = addChild(parentNode, segment, false);
  }
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
  emptyDirectories: Iterable<string>,
): VirtualNode => {
  const rootNode: VirtualNode = {
    name,
    type: FileType.Directory,
    path: rootPath,
    archivePath,
    children: new Map<string, VirtualNode>(),
  };

  for (const entryPath of entryPaths) {
    addEntryPath(rootNode, entryPath);
  }

  for (const directoryPath of emptyDirectories) {
    addDirectoryPath(rootNode, directoryPath);
  }

  return rootNode;
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
 * Finds a node below a directory by its relative path
 */
export const findChild = (
  directory: VirtualNode,
  relativePath: string,
): VirtualNode | undefined => {
  let node: VirtualNode | undefined = directory;

  for (const segment of splitPath(relativePath)) {
    node = node?.children?.get(segment);
  }

  return node;
};
