import { workspace, EventEmitter, FileType, Uri } from 'vscode';
import { BIG_PATTERN } from '../constants';
import type { BigFileArchive, BigFileEntry } from '../types';
import { readBigArchive, writeBigArchive } from './bigParser';
import { VirtualNode } from '../types';
import path from 'path';

export class VirtualFileService {
  private _onDidChangeArchives = new EventEmitter<Uri>();
  public readonly onDidChangeArchives = this._onDidChangeArchives.event;

  private archiveStorage = new Map<string, BigFileArchive>();
  private virtualFileTree = new Map<string, VirtualNode>();

  constructor() {
    this.scanWorkspace();
  }

  /**
   * Scans the workspace for BIG files and loads them into the file service
   */
  public async scanWorkspace(): Promise<void> {
    if (!workspace.workspaceFolders) {
      return;
    }

    this.clearAll();

    const archiveUris = await workspace.findFiles(BIG_PATTERN, null, 100);
    await Promise.all(archiveUris.map((uri) => this.addBigToVirtualTree(uri)));
  }

  /**
   * Gets a node by URI
   */
  public getNode(uri: Uri): VirtualNode | undefined {
    const { archiveName, nodes } = this.parseUri(uri);
    let parentNode = this.virtualFileTree.get(archiveName);

    if (!parentNode || !nodes.length) {
      throw new Error('Node not found');
    }

    for (const node of nodes) {
      if (!parentNode.children?.has(node)) {
        return undefined;
      }
      parentNode = parentNode.children.get(node)!;
    }

    return parentNode;
  }

  /**
   * Gets file content by URI
   */
  public getFile(uri: Uri): Uint8Array | undefined {
    const node = this.getNode(uri);
    if (!node || node.type !== FileType.File) {
      throw new Error('File not found or is not a file');
    }

    const filePath = this.getFilePathFromNode(node);
    const archive = this.archiveStorage.get(node.archivePath);

    if (!archive) {
      return undefined;
    }

    const entry = archive.entries.get(filePath);
    return entry?.fileBuffer;
  }

  /**
   * Gets all archive root nodes
   */
  public getArchives(): Map<string, VirtualNode> {
    return this.virtualFileTree;
  }

  /**
   * Writes file content to the archive storage
   */
  public async writeFile(uri: Uri, content: Uint8Array): Promise<void> {
    const node = this.getNode(uri);
    if (!node || node.type !== FileType.File) {
      throw new Error('File not found or is not a file');
    }

    const filePath = this.getFilePathFromNode(node);
    const archive = this.archiveStorage.get(node.archivePath);

    if (!archive) {
      throw new Error('Archive not found');
    }

    const entry = archive.entries.get(filePath);
    if (!entry) {
      throw new Error('Entry not found in archive');
    }

    entry.fileBuffer = content;
    await this.saveArchive(node.archivePath);
  }

  /**
   * Loads an archive file and adds it to the virtual file tree
   */
  private async addBigToVirtualTree(uri: Uri): Promise<void> {
    const archiveData = await readBigArchive(uri);
    const archiveName = path.basename(uri.path);
    const archivePath = uri.fsPath;

    this.archiveStorage.set(archivePath, archiveData);

    const rootNode = this.createVirtualFileTree(
      archiveName,
      archivePath,
      archiveData.entries
    );
    this.virtualFileTree.set(archiveName, rootNode);

    this._onDidChangeArchives.fire(uri);
  }

  /**
   * Adds a file to the virtual file tree
   */
  private addFileToVirtualTree(
    archiveFile: BigFileEntry,
    archiveNode: VirtualNode
  ): void {
    const filePathParts = this.parseFilePath(archiveFile.name);
    let parentNode = archiveNode;

    filePathParts.forEach((nodeName, index) => {
      const isFile = index === filePathParts.length - 1;
      this.addNodeToVirtualTree(parentNode, nodeName, isFile);
      parentNode = parentNode.children!.get(nodeName)!;
    });
  }

  /**
   * Adds a new child node to an existing node in the virtual file tree
   */
  private addNodeToVirtualTree(
    parentNode: VirtualNode,
    childName: string,
    isFile: boolean
  ): VirtualNode {
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

    if (!isFile) {
      childNode.children = new Map<string, VirtualNode>();
    }

    parentNode.children.set(childName, childNode);

    return childNode;
  }

  /**
   * Creates a virtual file tree from archive entries
   */
  private createVirtualFileTree(
    archiveName: string,
    archivePath: string,
    entries: Map<string, BigFileEntry>
  ): VirtualNode {
    const rootNode: VirtualNode = {
      name: archiveName,
      type: FileType.Directory,
      path: `/${archiveName}`,
      archivePath,
      children: new Map<string, VirtualNode>(),
    };

    entries.forEach((entry) => {
      this.addFileToVirtualTree(entry, rootNode);
    });

    return rootNode;
  }

  /**
   * Gets the file path from a node (for archive lookup)
   */
  private getFilePathFromNode(node: VirtualNode): string {
    // Extract the file path from the node's path by removing the archive name
    const pathParts = node.path.split('/').filter((part) => part.length);
    return pathParts.slice(1).join('/'); // Remove archive name, keep the rest
  }

  /**
   * Saves an archive to disk
   */
  private async saveArchive(archivePath: string): Promise<void> {
    const archive = this.archiveStorage.get(archivePath);

    if (!archive) {
      throw new Error('Archive not found');
    }

    try {
      const newArchiveBuffer = writeBigArchive(archive);
      const archiveUri = Uri.file(archivePath);
      await workspace.fs.writeFile(archiveUri, newArchiveBuffer);
    } catch (error) {
      console.error('Failed to save archive:', error);
      throw error;
    }
  }

  /**
   * Parses a BIG file URI into the archive name and the nodes of the file path as an array
   */
  private parseUri(uri: Uri): { archiveName: string; nodes: string[] } {
    const [archiveName, ...nodes] = uri.path
      .split('/')
      .filter((part) => part.length);

    return { archiveName, nodes };
  }

  /**
   * Parses a file path into its components
   */
  private parseFilePath(filePath: string): string[] {
    const parsedPath = path.parse(filePath);
    const filePathParts = parsedPath.dir
      .split('/')
      .filter((part) => part.length);

    filePathParts.push(parsedPath.base);
    return filePathParts;
  }

  /**
   * Clears all data
   */
  private clearAll(): void {
    this.archiveStorage.clear();
    this.virtualFileTree.clear();
  }
}
