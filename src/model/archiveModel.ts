import {
  workspace,
  window,
  EventEmitter,
  FileSystemError,
  FileType,
  Uri,
} from 'vscode';
import type { FileSystemWatcher, LogOutputChannel } from 'vscode';
import path from 'path';
import { BIG_PATTERN } from '../constants';
import type { BigFileEntry } from '../format/bigFormat';
import {
  getParentPath,
  isPathBelow,
  movePath,
  splitPath,
} from '../common/paths';
import { parseNodeUri } from '../common/uri';
import { Archive } from './archive';
import type { EntriesCallback } from './archive';
import { findChild } from './virtualNode';
import type { VirtualNode } from './virtualNode';

interface EntryMove {
  sourcePath: string;
  targetPath: string;
  filePaths: string[];
}

const hasStoredEntries = (move: EntryMove): boolean =>
  Boolean(move.filePaths.length);

/**
 * The archives of the workspace: finds them on disk, keeps them loaded, and
 * runs the operations that span resolving a URI and changing an archive.
 */
export class ArchiveModel {
  private _onDidChangeArchive = new EventEmitter<string>();
  public readonly onDidChangeArchive = this._onDidChangeArchive.event;

  private archives = new Map<string, Archive>();

  private readonly archiveWatcher: FileSystemWatcher;

  private currentScan: Promise<void>;

  constructor(private log: LogOutputChannel) {
    this.currentScan = this.scanWorkspace();
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
    const archive = this.getArchiveByPath(archivePath);

    try {
      if (archive) {
        const reloaded = await archive.reload();

        if (!reloaded) {
          return;
        }
      } else {
        const loadedArchive = await Archive.load(archivePath);

        this.archives.set(loadedArchive.name, loadedArchive);
      }
    } catch (error) {
      this.log.error(`Failed to reload archive ${archivePath}`, error);
      return;
    }

    this._onDidChangeArchive.fire(archivePath);
  }

  /**
   * Drops an archive that is gone from disk
   */
  private forgetArchive(uri: Uri): void {
    const archive = this.getArchiveByPath(uri.fsPath);

    if (!archive) {
      return;
    }

    this.archives.delete(archive.name);

    this._onDidChangeArchive.fire(archive.archivePath);
  }

  /**
   * Resolves once the latest scan is done, so nothing reads a half-built tree
   */
  public whenReady(): Promise<void> {
    return this.currentScan;
  }

  /**
   * Scans the workspace for archives and loads them
   */
  public scanWorkspace(): Promise<void> {
    this.currentScan = this.runScan();

    return this.currentScan;
  }

  private async runScan(): Promise<void> {
    if (!workspace.workspaceFolders) {
      return;
    }

    const previousArchives = this.archives;

    this.archives = new Map<string, Archive>();

    const archiveUris = await workspace.findFiles(BIG_PATTERN);

    const results = await Promise.allSettled(
      archiveUris.map(async (uri) => {
        const archive = await Archive.load(uri.fsPath);
        const previous = previousArchives.get(archive.name);

        if (previous) {
          archive.adoptEmptyDirectories(previous.getEmptyDirectories());
        }

        this.archives.set(archive.name, archive);
      }),
    );

    const failed = results.filter((result) => result.status === 'rejected');

    if (failed.length) {
      failed.forEach((result) =>
        this.log.error('Failed to read archive', result.reason),
      );

      window.showWarningMessage(
        `${failed.length} of ${archiveUris.length} BIG archives could not be read.`,
      );
    }
  }

  /**
   * Gets the root node of every loaded archive
   */
  public getArchiveRoots(): VirtualNode[] {
    return Array.from(this.archives.values(), (archive) => archive.root);
  }

  /**
   * Gets the archive loaded from a path on disk
   */
  public getArchiveByPath(archivePath: string): Archive | undefined {
    return this.archives.get(path.basename(archivePath));
  }

  /**
   * Gets a node by URI
   */
  public getNode(uri: Uri): VirtualNode | undefined {
    const { archiveName, entrySegments } = parseNodeUri(uri);
    const archive = this.archives.get(archiveName);

    return archive && findChild(archive.root, entrySegments.join('/'));
  }

  /**
   * Resolves a URI to its archive and the entry path inside it
   */
  private getArchiveContext(uri: Uri): { archive: Archive; entryPath: string } {
    const { archiveName, entrySegments } = parseNodeUri(uri);
    const archive = this.archives.get(archiveName);

    if (!archive) {
      throw FileSystemError.FileNotFound(uri);
    }

    return { archive, entryPath: entrySegments.join('/') };
  }

  private getEntryForNode(node: VirtualNode): BigFileEntry | undefined {
    if (node.type !== FileType.File) {
      return undefined;
    }

    const archive = this.getArchiveByPath(node.archivePath);

    return archive?.getEntry(archive.getEntryPath(node));
  }

  /**
   * Reads a file node's content straight from the archive on disk
   */
  public async getFileContent(
    node: VirtualNode,
  ): Promise<Uint8Array | undefined> {
    const archive = this.getArchiveByPath(node.archivePath);
    const entry = this.getEntryForNode(node);

    return archive && entry ? archive.readEntry(entry) : undefined;
  }

  /**
   * Gets a file's size from the index, never from its content
   */
  public getFileSize(node: VirtualNode): number {
    const entry = this.getEntryForNode(node);

    if (!entry) {
      return 0;
    }

    return entry.pendingData?.length ?? entry.size;
  }

  /**
   * Writes an archive and reports the failure before passing it on
   */
  private async modifyEntries(
    archive: Archive,
    modify: EntriesCallback,
  ): Promise<void> {
    try {
      await archive.modifyEntries(modify);
    } catch (error) {
      this.log.error(`Failed to save archive ${archive.archivePath}`, error);
      throw error;
    }
  }

  /**
   * Rebuilds an archive's tree and tells the consumers about it
   */
  private refreshArchive(archive: Archive): void {
    archive.rebuildTree();

    this._onDidChangeArchive.fire(archive.archivePath);
  }

  /**
   * Rejects a path whose parents run through an existing file
   */
  private ensureWritablePath(archive: Archive, entryPath: string): void {
    let node: VirtualNode | undefined = archive.root;

    for (const segment of splitPath(getParentPath(entryPath))) {
      node = node?.children?.get(segment);

      if (!node) {
        return; // the rest of the chain does not exist yet
      }

      if (node.type === FileType.File) {
        throw FileSystemError.FileNotADirectory(node.path);
      }
    }
  }

  /**
   * Writes file content into an archive
   */
  public async writeFile(uri: Uri, content: Uint8Array): Promise<void> {
    const { archive, entryPath } = this.getArchiveContext(uri);

    if (!entryPath) {
      throw FileSystemError.NoPermissions('Cannot write to the archive root');
    }

    if (this.getNode(uri)?.type === FileType.Directory) {
      throw FileSystemError.FileIsADirectory(uri);
    }

    this.ensureWritablePath(archive, entryPath);

    await this.modifyEntries(archive, (entries) => {
      entries.set(entryPath, {
        name: entryPath,
        offset: 0, // assigned when the archive is written
        size: content.length,
        pendingData: content,
      });
    });

    this.refreshArchive(archive);
  }

  /**
   * Creates a directory for file management. Nothing is written to the
   * archive, which stores file paths and knows no directories of its own.
   */
  public createDirectory(uri: Uri): void {
    const { archive, entryPath } = this.getArchiveContext(uri);

    if (!entryPath) {
      throw FileSystemError.NoPermissions('Cannot create the archive root');
    }

    this.ensureWritablePath(archive, entryPath);

    archive.keepEmptyDirectory(entryPath);

    this.refreshArchive(archive);
  }

  /**
   * Deletes a file, or a directory with everything below it
   */
  public async delete(uri: Uri): Promise<void> {
    await this.deleteEntries([uri]);
  }

  /**
   * Deletes entries of one archive in a batch
   */
  public async deleteEntries(uris: Uri[]): Promise<void> {
    if (!uris.length) {
      return;
    }

    const { archive } = this.getArchiveContext(uris[0]);
    const entryPaths: string[] = [];
    const removedPaths = new Set<string>();

    for (const uri of uris) {
      const context = this.getArchiveContext(uri);

      if (context.archive !== archive) {
        throw FileSystemError.NoPermissions(
          'Cannot delete from several archives at once',
        );
      }

      if (!context.entryPath) {
        throw FileSystemError.NoPermissions('Archives cannot be deleted');
      }

      const node = this.getNode(uri);

      if (!node) {
        throw FileSystemError.FileNotFound(uri);
      }

      entryPaths.push(context.entryPath);

      for (const filePath of archive.getFileEntryPaths(node)) {
        removedPaths.add(filePath);
      }
    }

    if (removedPaths.size) {
      await this.modifyEntries(archive, (entries) => {
        for (const filePath of removedPaths) {
          if (!entries.delete(filePath)) {
            throw FileSystemError.FileNotFound(
              `Entry missing from archive: ${filePath}`,
            );
          }
        }
      });

      archive.keepEmptiedDirectories(removedPaths);
    }

    for (const entryPath of entryPaths) {
      archive.forgetEmptyDirectories(entryPath);
    }

    this.refreshArchive(archive);
  }

  /**
   * Renames or moves a file, or a directory with everything below it
   */
  public async rename(oldUri: Uri, newUri: Uri): Promise<void> {
    const target = this.getArchiveContext(newUri);
    const move = this.getEntryMove(oldUri, target.archive, target.entryPath);

    await this.applyMoves(target.archive, [move]);
  }

  /**
   * Moves entries into a directory under their own names
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

      moves.push(this.getEntryMove(sourceUri, target.archive, targetPath));
    }

    await this.applyMoves(target.archive, moves);
  }

  /**
   * Copies entries into a directory in a batch
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
        this.getEntryMove(sourceUri, target.archive, targetPath),
      );
    }

    if (!entryCopies.some(hasStoredEntries)) {
      return;
    }

    await this.modifyEntries(target.archive, (entries) => {
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
    });

    this.refreshArchive(target.archive);
  }

  /**
   * Adds files to a directory
   */
  public async addFiles(
    targetDirectoryUri: Uri,
    files: { name: string; content: Uint8Array }[],
  ): Promise<void> {
    const { archive, entryPath } = this.getArchiveContext(targetDirectoryUri);

    for (const { name } of files) {
      this.ensureWritablePath(
        archive,
        entryPath ? `${entryPath}/${name}` : name,
      );
    }

    await this.modifyEntries(archive, (entries) => {
      for (const { name, content } of files) {
        const filePath = entryPath ? `${entryPath}/${name}` : name;

        entries.set(filePath, {
          name: filePath,
          offset: 0, // assigned when the archive is written
          size: content.length,
          pendingData: content,
        });
      }
    });

    this.refreshArchive(archive);
  }

  /**
   * Plans a move and checks that it is allowed
   */
  private getEntryMove(
    sourceUri: Uri,
    targetArchive: Archive,
    targetPath: string,
  ): EntryMove {
    const source = this.getArchiveContext(sourceUri);
    const node = this.getNode(sourceUri);

    if (!node) {
      throw FileSystemError.FileNotFound(sourceUri);
    }

    if (source.archive !== targetArchive) {
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
      filePaths: targetArchive.getFileEntryPaths(node),
    };
  }

  /**
   * Applies planned moves as a batch
   */
  private async applyMoves(
    archive: Archive,
    moves: EntryMove[],
  ): Promise<void> {
    if (moves.some(hasStoredEntries)) {
      await this.modifyEntries(archive, (entries) => {
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
      });

      archive.keepEmptiedDirectories(moves.flatMap((move) => move.filePaths));
    }

    for (const { sourcePath, targetPath } of moves) {
      archive.moveEmptyDirectories(sourcePath, targetPath);
    }

    this.refreshArchive(archive);
  }
}
