import {
  workspace,
  window,
  EventEmitter,
  FileType,
  FileSystemError,
  Uri,
} from 'vscode';
import { BIG_PATTERN } from '../constants';
import type { ArchiveLayout, ParsedArchive, BigFileEntry } from '../types';
import {
  readArchiveIndexTable,
  readEntryData,
  writeArchiveFile,
} from './archiveIO';
import { VirtualNode } from '../types';
import path from 'path';

type EntriesCallback = (entries: Map<string, BigFileEntry>) => void;

export class VirtualFileService {
  private _onDidChangeArchives = new EventEmitter<Uri>();
  public readonly onDidChangeArchives = this._onDidChangeArchives.event;

  private archiveStorage = new Map<string, ParsedArchive>();
  private virtualFileTree = new Map<string, VirtualNode>();
  private saveQueues = new Map<string, Promise<unknown>>();

  private emptyDirectories = new Map<string, Set<string>>();

  private readonly initialScan: Promise<void>;

  constructor() {
    this.initialScan = this.scanWorkspace();
  }

  /**
   * Resolves after initial scan to avoid showing empty message when still loading
   */
  public whenReady(): Promise<void> {
    return this.initialScan;
  }

  /**
   * Scans the workspace for BIG files and loads them into the file service
   */
  public async scanWorkspace(): Promise<void> {
    if (!workspace.workspaceFolders) {
      return;
    }

    this.clearAll();

    const archiveUris = await workspace.findFiles(BIG_PATTERN, null);

    const results = await Promise.allSettled(
      archiveUris.map((uri) => this.addArchiveToTree(uri)),
    );

    const failed = results.filter((result) => result.status === 'rejected');

    if (failed.length) {
      failed.forEach((result) =>
        console.error('Failed to read archive:', result.reason),
      );

      window.showWarningMessage(
        `${failed.length} of ${archiveUris.length} BIG archives could not be read.`,
      );
    }
  }

  /**
   * Gets a node by URI
   */
  public getNode(uri: Uri): VirtualNode | undefined {
    return this.getNodeChain(uri).at(-1);
  }

  private getNodeChain(uri: Uri): VirtualNode[] {
    const { archiveName, nodes } = this.parseUri(uri);
    const rootNode = this.virtualFileTree.get(archiveName);

    if (!rootNode) {
      return [];
    }

    const chain = [rootNode];

    for (const nodeName of nodes) {
      const childNode = chain.at(-1)!.children?.get(nodeName);

      if (!childNode) {
        return [];
      }

      chain.push(childNode);
    }

    return chain;
  }

  /**
   * Gets file content by URI
   */
  public async getFile(uri: Uri): Promise<Uint8Array | undefined> {
    const node = this.getNode(uri);

    if (!node) {
      return undefined;
    }

    const entry = this.getEntry(node);

    if (!entry) {
      return undefined;
    }

    return readEntryData(node.archivePath, entry);
  }

  public getFileSize(uri: Uri): number {
    const node = this.getNode(uri);

    if (!node) {
      return 0;
    }

    const entry = this.getEntry(node);

    if (!entry) {
      return 0;
    }

    return entry.pendingData?.length ?? entry.size;
  }

  private getEntry(node: VirtualNode): BigFileEntry | undefined {
    if (node.type !== FileType.File) {
      return undefined;
    }

    const archive = this.archiveStorage.get(node.archivePath);

    return archive?.entries.get(this.getFilePathFromNode(node));
  }

  /**
   * Gets all archive root nodes
   */
  public getArchives(): Map<string, VirtualNode> {
    return this.virtualFileTree;
  }

  /**
   * Gets the archive storage
   */
  public getArchiveStorage(name: string): ParsedArchive | undefined {
    return this.archiveStorage.get(name);
  }

  /**
   * Resolves URI address to the archive and its file inside
   */
  private getArchiveContext(uri: Uri): {
    archivePath: string;
    entryPath: string;
  } {
    const { archiveName, nodes } = this.parseUri(uri);
    const rootNode = this.virtualFileTree.get(archiveName);

    if (!rootNode) {
      throw FileSystemError.FileNotFound(uri);
    }

    return { archivePath: rootNode.archivePath, entryPath: nodes.join('/') };
  }

  /**
   * Writes file content to the archive storage
   */
  public async writeFile(uri: Uri, content: Uint8Array): Promise<void> {
    const { archivePath, entryPath } = this.getArchiveContext(uri);

    if (!entryPath) {
      throw FileSystemError.NoPermissions('Cannot write to the archive root');
    }

    if (this.getNode(uri)?.type === FileType.Directory) {
      throw FileSystemError.FileIsADirectory(uri);
    }

    const writeEntry: EntriesCallback = (entries) => {
      entries.set(entryPath, {
        name: entryPath,
        offset: 0, // assigned when the archive is written
        size: content.length,
        pendingData: content,
      });
    };

    await this.saveArchive(archivePath, writeEntry);
  }

  /**
   * Creates a directory for file management.
   * Nothing written to archive file, archives only contain files with path, no directories
   */
  public createDirectory(uri: Uri): void {
    const { archivePath, entryPath } = this.getArchiveContext(uri);

    if (!entryPath) {
      throw FileSystemError.NoPermissions('Cannot create the archive root');
    }

    const directories =
      this.emptyDirectories.get(archivePath) ?? new Set<string>();

    directories.add(entryPath);
    this.emptyDirectories.set(archivePath, directories);

    this.rebuildTree(archivePath);
  }

  /**
   * Deletes a file or a directory with all of its contents from the archive
   */
  public async delete(uri: Uri): Promise<void> {
    const chain = this.getNodeChain(uri);
    const node = chain.at(-1);

    if (!node) {
      throw FileSystemError.FileNotFound(uri);
    }

    if (!chain.at(-2)?.children) {
      throw FileSystemError.NoPermissions('Archives cannot be deleted');
    }

    const { archivePath, entryPath } = this.getArchiveContext(uri);
    const filePaths = this.getEntryPaths(node);

    this.forgetEmptyDirectories(archivePath, entryPath);

    if (!filePaths.length) {
      this.rebuildTree(archivePath);
      return;
    }

    const removeEntries: EntriesCallback = (entries) => {
      filePaths.forEach((filePath) => {
        const isDeleted = entries.delete(filePath);

        if (!isDeleted) {
          throw new Error(`Entry missing from archive: ${filePath}`);
        }
      });
    };

    await this.saveArchive(archivePath, removeEntries);
  }

  /**
   * Gets the archive entry paths of a node and of all files below it
   */
  private getEntryPaths(node: VirtualNode): string[] {
    if (node.type === FileType.File) {
      return [this.getFilePathFromNode(node)];
    }

    const filePaths: string[] = [];

    node.children?.forEach((childNode) =>
      filePaths.push(...this.getEntryPaths(childNode)),
    );

    return filePaths;
  }

  /**
   * Loads an archive file and adds it to the virtual file tree
   */
  private async addArchiveToTree(uri: Uri): Promise<void> {
    const archivePath = uri.fsPath;
    const archiveName = path.basename(archivePath);
    const archiveData = await readArchiveIndexTable(archivePath);

    this.archiveStorage.set(archivePath, archiveData);

    const rootNode = this.createVirtualFileTree(
      archiveName,
      archivePath,
      archiveData.entries,
    );
    this.virtualFileTree.set(archiveName, rootNode);

    this._onDidChangeArchives.fire(uri);
  }

  /**
   * Adds a file to the virtual file tree
   */
  private addFileToVirtualTree(
    archiveFile: BigFileEntry,
    archiveNode: VirtualNode,
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
    isFile: boolean,
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

    if (!isFile && !childNode.children) {
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
    entries: Map<string, BigFileEntry>,
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

    this.emptyDirectories
      .get(archivePath)
      ?.forEach((directoryPath) =>
        this.addEmptyDirectory(rootNode, directoryPath),
      );

    return rootNode;
  }

  /**
   * Adds empty directory to path
   */
  private addEmptyDirectory(
    rootNode: VirtualNode,
    directoryPath: string,
  ): void {
    let parentNode = rootNode;

    for (const segment of directoryPath.split('/')) {
      const existingNode = parentNode.children?.get(segment);

      if (existingNode && existingNode.type !== FileType.Directory) {
        return;
      }

      parentNode = this.addNodeToVirtualTree(parentNode, segment, false);
    }
  }

  /**
   * Drops tracked empty directories of path
   */
  private forgetEmptyDirectories(archivePath: string, entryPath: string): void {
    const directories = this.emptyDirectories.get(archivePath);

    if (!directories) {
      return;
    }

    directories.forEach((directoryPath) => {
      if (
        directoryPath === entryPath ||
        directoryPath.startsWith(`${entryPath}/`)
      ) {
        directories.delete(directoryPath);
      }
    });
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
   * Applies changes in a queue to an archive and saves it to disk
   */
  private async saveArchive(
    archivePath: string,
    modifyEntries: EntriesCallback,
  ): Promise<void> {
    const queue = this.saveQueues.get(archivePath) ?? Promise.resolve();
    const save = queue.then(() =>
      this.writeArchive(archivePath, modifyEntries),
    );

    this.saveQueues.set(
      archivePath,
      save.catch(() => undefined),
    );

    return save;
  }

  /**
   * Writes archive to disk
   */
  private async writeArchive(
    archivePath: string,
    modifyEntries: EntriesCallback,
  ): Promise<void> {
    const archive = this.archiveStorage.get(archivePath);

    if (!archive) {
      throw new Error('Archive not found');
    }

    const entries = new Map(archive.entries);
    modifyEntries(entries);

    let layout: ArchiveLayout;

    try {
      layout = await writeArchiveFile(archivePath, archive.magic, entries);
    } catch (error) {
      console.error('Failed to save archive:', error);
      throw error;
    }

    layout.placedEntries.forEach(({ entry, offset, size }) => {
      entry.offset = offset;
      entry.size = size;

      delete entry.pendingData;
    });

    archive.entries = entries;

    this.rebuildTree(archivePath);
  }

  /**
   * Rebuilds archive's tree from its entries
   */
  private rebuildTree(archivePath: string): void {
    const archive = this.archiveStorage.get(archivePath);
    const archiveName = path.basename(archivePath);

    if (!archive || !this.virtualFileTree.has(archiveName)) {
      return;
    }

    this.virtualFileTree.set(
      archiveName,
      this.createVirtualFileTree(archiveName, archivePath, archive.entries),
    );

    this._onDidChangeArchives.fire(Uri.file(archivePath));
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
