import {
  workspace,
  window,
  EventEmitter,
  FileType,
  FileSystemError,
  Uri,
} from 'vscode';
import type { FileSystemWatcher } from 'vscode';
import { BIG_PATTERN } from '../constants';
import type {
  ArchiveLayout,
  ParsedArchive,
  BigFileEntry,
} from '../format/bigFormat';
import {
  readArchiveIndexTable,
  readEntryData,
  writeArchiveFile,
} from '../format/archiveFile';
import { VirtualNode } from '../model/virtualNode';
import {
  getParentPath,
  isPathBelow,
  movePath,
  splitPath,
} from '../common/paths';
import { parseNodeUri } from '../common/uri';
import path from 'path';

type EntriesCallback = (entries: Map<string, BigFileEntry>) => void;

interface EntryMove {
  sourcePath: string;
  targetPath: string;
  filePaths: string[];
}

const hasStoredEntries = (move: EntryMove): boolean =>
  Boolean(move.filePaths.length);

export class VirtualFileService {
  private _onDidChangeArchives = new EventEmitter<string>();
  public readonly onDidChangeArchives = this._onDidChangeArchives.event;

  private archiveStorage = new Map<string, ParsedArchive>();
  private virtualFileTree = new Map<string, VirtualNode>();
  private saveQueues = new Map<string, Promise<unknown>>();

  private emptyDirectories = new Map<string, Set<string>>();

  private readonly archiveWatcher: FileSystemWatcher;

  private lastWrittenAt = new Map<string, number>();

  private readonly initialScan: Promise<void>;

  constructor() {
    this.initialScan = this.scanWorkspace();
    this.archiveWatcher = this.watchArchives();
  }

  public dispose(): void {
    this.archiveWatcher.dispose();
  }

  /**
   * Follows the archives on disk, so edits made outside the editor show up
   */
  private watchArchives(): FileSystemWatcher {
    const watcher = workspace.createFileSystemWatcher(BIG_PATTERN);

    watcher.onDidChange((uri) => this.reloadArchive(uri));
    watcher.onDidCreate((uri) => this.reloadArchive(uri));
    watcher.onDidDelete((uri) => this.forgetArchive(uri));

    return watcher;
  }

  /**
   * Reads an archive again after it changed on disk
   */
  private async reloadArchive(uri: Uri): Promise<void> {
    const archivePath = uri.fsPath;

    if (await this.hasOwnWrite(archivePath)) {
      return;
    }

    try {
      await this.addArchiveToTree(uri);
    } catch (error) {
      console.error('Failed to reload archive:', error);
      return;
    }

    this._onDidChangeArchives.fire(archivePath);
  }

  /**
   * Drops an archive that is gone from disk
   */
  private forgetArchive(uri: Uri): void {
    const archivePath = uri.fsPath;

    this.archiveStorage.delete(archivePath);
    this.virtualFileTree.delete(path.basename(archivePath));
    this.emptyDirectories.delete(archivePath);
    this.lastWrittenAt.delete(archivePath);

    this._onDidChangeArchives.fire(archivePath);
  }

  /**
   * Whether the archive on disk is still the one this service last wrote
   */
  private async hasOwnWrite(archivePath: string): Promise<boolean> {
    const writtenAt = this.lastWrittenAt.get(archivePath);

    if (!writtenAt) {
      return false;
    }

    try {
      const { mtime } = await workspace.fs.stat(Uri.file(archivePath));

      return mtime === writtenAt;
    } catch {
      return false;
    }
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

    const archiveUris = await workspace.findFiles(BIG_PATTERN);

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

  /**
   * Gets a node together with every directory above it, starting at the archive
   */
  private getNodeChain(uri: Uri): VirtualNode[] {
    const { archiveName, entrySegments } = parseNodeUri(uri);
    const rootNode = this.virtualFileTree.get(archiveName);

    if (!rootNode) {
      return [];
    }

    const chain = [rootNode];

    for (const nodeName of entrySegments) {
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

    return node ? this.getFileContent(node) : undefined;
  }

  /**
   * Reads the content of a node straight from the archive on disk
   */
  public async getFileContent(
    node: VirtualNode,
  ): Promise<Uint8Array | undefined> {
    const entry = this.getEntry(node);

    return entry ? readEntryData(node.archivePath, entry) : undefined;
  }

  /**
   * Gets the size of a file from the index, never from its content
   */
  public getFileSize(node: VirtualNode): number {
    const entry = this.getEntry(node);

    if (!entry) {
      return 0;
    }

    return entry.pendingData?.length ?? entry.size;
  }

  /**
   * Gets the archive entry a file node stands for
   */
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
    const { archiveName, entrySegments } = parseNodeUri(uri);
    const rootNode = this.virtualFileTree.get(archiveName);

    if (!rootNode) {
      throw FileSystemError.FileNotFound(uri);
    }

    return {
      archivePath: rootNode.archivePath,
      entryPath: entrySegments.join('/'),
    };
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

    this.keepEmptyDirectory(archivePath, entryPath);
    this.rebuildTree(archivePath);
  }

  /**
   * Tracks a directory that has nothing stored below it
   */
  private keepEmptyDirectory(archivePath: string, entryPath: string): void {
    const directories =
      this.emptyDirectories.get(archivePath) ?? new Set<string>();

    directories.add(entryPath);
    this.emptyDirectories.set(archivePath, directories);
  }

  /**
   * Keeps the directories in virtual file system available
   */
  private keepEmptiedDirectories(
    archivePath: string,
    removedPaths: Iterable<string>,
  ): void {
    const archive = this.archiveStorage.get(archivePath);

    if (!archive) {
      return;
    }

    const hasEntriesBelow = (directoryPath: string): boolean => {
      const prefix = `${directoryPath}/`;

      for (const entryPath of archive.entries.keys()) {
        if (entryPath.startsWith(prefix)) {
          return true;
        }
      }

      return false;
    };

    for (const removedPath of removedPaths) {
      let directoryPath = getParentPath(removedPath);

      while (directoryPath && !hasEntriesBelow(directoryPath)) {
        this.keepEmptyDirectory(archivePath, directoryPath);
        directoryPath = getParentPath(directoryPath);
      }
    }
  }

  /**
   * Delete file or directory with all of its contents from archive
   */
  public async delete(uri: Uri): Promise<void> {
    await this.deleteEntries([uri]);
  }

  /**
   * Delete entries of one archive in a batch
   */
  public async deleteEntries(uris: Uri[]): Promise<void> {
    if (!uris.length) {
      return;
    }

    const { archivePath } = this.getArchiveContext(uris[0]);
    const entryPaths: string[] = [];
    const removedPaths = new Set<string>();

    for (const uri of uris) {
      const chain = this.getNodeChain(uri);
      const node = chain.at(-1);

      if (!node) {
        throw FileSystemError.FileNotFound(uri);
      }

      const isArchiveRoot = !chain.at(-2)?.children;

      if (isArchiveRoot) {
        throw FileSystemError.NoPermissions('Archives cannot be deleted');
      }

      const context = this.getArchiveContext(uri);

      if (context.archivePath !== archivePath) {
        throw FileSystemError.NoPermissions(
          'Cannot delete from several archives at once',
        );
      }

      entryPaths.push(context.entryPath);

      for (const filePath of this.getEntryPaths(node)) {
        removedPaths.add(filePath);
      }
    }

    const forgetTargets = () => {
      for (const entryPath of entryPaths) {
        this.forgetEmptyDirectories(archivePath, entryPath);
      }
    };

    if (!removedPaths.size) {
      forgetTargets();
      this.rebuildTree(archivePath);
      return;
    }

    const removeEntries: EntriesCallback = (entries) => {
      for (const filePath of removedPaths) {
        if (!entries.delete(filePath)) {
          throw FileSystemError.FileNotFound(
            `Entry missing from archive: ${filePath}`,
          );
        }
      }
    };

    await this.saveArchive(archivePath, removeEntries);

    this.keepEmptiedDirectories(archivePath, removedPaths);
    forgetTargets();

    this.rebuildTree(archivePath);
  }

  /**
   * Renames or moves a file or a directory with everything below it
   */
  public async rename(oldUri: Uri, newUri: Uri): Promise<void> {
    const target = this.getArchiveContext(newUri);
    const move = this.getEntryMove(
      oldUri,
      target.archivePath,
      target.entryPath,
    );

    await this.applyMoves(target.archivePath, [move]);
  }

  /**
   * Moves entries into a directory with their names.
   */
  public async moveEntries(
    sourceUris: Uri[],
    targetDirectoryUri: Uri,
  ): Promise<void> {
    const target = this.getArchiveContext(targetDirectoryUri);
    const moves: EntryMove[] = [];

    for (const sourceUri of sourceUris) {
      const name = path.posix.basename(sourceUri.path);
      const targetPath = target.entryPath
        ? `${target.entryPath}/${name}`
        : name;

      moves.push(this.getEntryMove(sourceUri, target.archivePath, targetPath));
    }

    await this.applyMoves(target.archivePath, moves);
  }

  /**
   * Copies entries into a directory in batches
   */
  public async copyEntries(
    copies: { sourceUri: Uri; targetName: string }[],
    targetDirectoryUri: Uri,
  ): Promise<void> {
    const target = this.getArchiveContext(targetDirectoryUri);
    const entryCopies: EntryMove[] = [];

    for (const { sourceUri, targetName } of copies) {
      const targetPath = target.entryPath
        ? `${target.entryPath}/${targetName}`
        : targetName;

      entryCopies.push(
        this.getEntryMove(sourceUri, target.archivePath, targetPath),
      );
    }

    if (!entryCopies.some(hasStoredEntries)) {
      return;
    }

    const copyEntries: EntriesCallback = (entries) => {
      for (const { sourcePath, targetPath, filePaths } of entryCopies) {
        for (const filePath of filePaths) {
          const entry = entries.get(filePath);

          if (!entry) {
            throw FileSystemError.FileNotFound(
              `Entry missing from archive: ${filePath}`,
            );
          }

          const copiedPath = movePath(filePath, sourcePath, targetPath);

          entries.set(copiedPath, { ...entry, name: copiedPath });
        }
      }
    };

    await this.saveArchive(target.archivePath, copyEntries);
  }

  /**
   * Adds files to a directory.
   */
  public async addFiles(
    targetDirectoryUri: Uri,
    files: { name: string; content: Uint8Array }[],
  ): Promise<void> {
    const { archivePath, entryPath } =
      this.getArchiveContext(targetDirectoryUri);

    const addEntries: EntriesCallback = (entries) => {
      for (const { name, content } of files) {
        const filePath = entryPath ? `${entryPath}/${name}` : name;

        entries.set(filePath, {
          name: filePath,
          offset: 0, // assigned when the archive is written
          size: content.length,
          pendingData: content,
        });
      }
    };

    await this.saveArchive(archivePath, addEntries);
  }

  /**
   * Check affected URIs and if move is valid
   */
  private getEntryMove(
    sourceUri: Uri,
    targetArchivePath: string,
    targetPath: string,
  ): EntryMove {
    const source = this.getArchiveContext(sourceUri);
    const node = this.getNode(sourceUri);

    if (!node) {
      throw FileSystemError.FileNotFound(sourceUri);
    }

    if (source.archivePath !== targetArchivePath) {
      throw FileSystemError.NoPermissions('Cannot move between archives');
    }

    if (!source.entryPath || !targetPath) {
      throw FileSystemError.NoPermissions('Cannot move the archive itself');
    }

    if (isPathBelow(targetPath, source.entryPath)) {
      throw FileSystemError.NoPermissions('Cannot move an entry into itself');
    }

    return {
      sourcePath: source.entryPath,
      targetPath,
      filePaths: this.getEntryPaths(node),
    };
  }

  /**
   * Apply planned moves as a batch
   */
  private async applyMoves(
    archivePath: string,
    moves: EntryMove[],
  ): Promise<void> {
    const relocateSources = () => {
      for (const { sourcePath, targetPath } of moves) {
        this.moveEmptyDirectories(archivePath, sourcePath, targetPath);
      }
    };

    if (!moves.some(hasStoredEntries)) {
      relocateSources();
      this.rebuildTree(archivePath);
      return;
    }

    const moveEntryPaths: EntriesCallback = (entries) => {
      for (const { sourcePath, targetPath, filePaths } of moves) {
        for (const filePath of filePaths) {
          const entry = entries.get(filePath);

          if (!entry) {
            throw FileSystemError.FileNotFound(
              `Entry missing from archive: ${filePath}`,
            );
          }

          const movedPath = movePath(filePath, sourcePath, targetPath);

          entries.delete(filePath);
          entries.set(movedPath, { ...entry, name: movedPath });
        }
      }
    };

    await this.saveArchive(archivePath, moveEntryPaths);

    const movedPaths: string[] = [];

    for (const move of moves) {
      movedPaths.push(...move.filePaths);
    }

    this.keepEmptiedDirectories(archivePath, movedPaths);
    relocateSources();

    this.rebuildTree(archivePath);
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
  }

  /**
   * Adds a file to the virtual file tree
   */
  private addFileToVirtualTree(
    archiveFile: BigFileEntry,
    archiveNode: VirtualNode,
  ): void {
    const filePathParts = splitPath(archiveFile.name);
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

    for (const segment of splitPath(directoryPath)) {
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
      if (isPathBelow(directoryPath, entryPath)) {
        directories.delete(directoryPath);
      }
    });
  }

  /**
   * Moves tracked empty directories along with the entry they sit under
   */
  private moveEmptyDirectories(
    archivePath: string,
    sourcePath: string,
    targetPath: string,
  ): void {
    const directories = this.emptyDirectories.get(archivePath);

    if (!directories) {
      return;
    }

    Array.from(directories)
      .filter((directoryPath) => isPathBelow(directoryPath, sourcePath))
      .forEach((directoryPath) => {
        directories.delete(directoryPath);
        directories.add(movePath(directoryPath, sourcePath, targetPath));
      });
  }

  /**
   * Gets the archive entry path a node stands for
   */
  private getFilePathFromNode(node: VirtualNode): string {
    return splitPath(node.path).slice(1).join('/');
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
      throw FileSystemError.Unavailable(archivePath);
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

    const { mtime } = await workspace.fs.stat(Uri.file(archivePath));

    this.lastWrittenAt.set(archivePath, mtime);

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

    this._onDidChangeArchives.fire(archivePath);
  }

  /**
   * Clears all data
   */
  private clearAll(): void {
    this.archiveStorage.clear();
    this.virtualFileTree.clear();
  }
}
