import { Uri, workspace } from 'vscode';
import path from 'path';
import {
  readArchiveIndexTable,
  readEntryData,
  writeArchiveFile,
} from '../format/archiveFile';
import type { BigFileEntry } from '../format/bigFormat';
import { getParentPath, isPathBelow, movePath } from '../common/paths';
import { buildVirtualTree, getFileNodes } from './virtualNode';
import type { VirtualNode } from './virtualNode';

/**
 * The entries of an archive, addressed by entry path. Handed to a change so
 * the caller never has to know how the entries are keyed.
 */
export interface ArchiveEntries {
  get(entryPath: string): BigFileEntry | undefined;
  set(entryPath: string, entry: BigFileEntry): void;
  delete(entryPath: string): boolean;
}

export type EntriesCallback = (entries: ArchiveEntries) => void;

/**
 * One archive on disk: the entries read from its index table, the tree built
 * from them, and a queue that serializes every access to the file so a
 * reload cannot land in the middle of a save.
 */
export class Archive {
  public readonly archivePath: string;
  public readonly name: string;
  public readonly rootPath: string;

  public readonly root: VirtualNode;

  private magic: string;

  /** Keyed case insensitively; each entry keeps its stored name */
  private entries: Map<string, BigFileEntry>;

  /** Directories that exist in the tree while nothing is stored below them */
  private readonly emptyDirectories = new Set<string>();

  private queue: Promise<unknown> = Promise.resolve();
  private lastWrittenAt = 0;

  private constructor(
    archivePath: string,
    rootPath: string,
    magic: string,
    entries: Map<string, BigFileEntry>,
  ) {
    this.archivePath = archivePath;
    this.name = path.basename(archivePath);
    this.rootPath = rootPath;
    this.magic = magic;
    this.entries = Archive.keyEntries(entries);
    this.root = this.buildTree();
  }

  /**
   * Reads an archive's index table from disk. The root path is where the
   * archive sits in the virtual file system, e.g. `/mods/textures.big`.
   */
  public static async load(
    archivePath: string,
    rootPath: string,
  ): Promise<Archive> {
    const { magic, entries } = await readArchiveIndexTable(archivePath);

    return new Archive(archivePath, rootPath, magic, entries);
  }

  /**
   * How the archive is identified, case insensitively like its content
   */
  public get rootKey(): string {
    return this.rootPath.toLowerCase();
  }

  private static keyEntries(
    entries: Map<string, BigFileEntry>,
  ): Map<string, BigFileEntry> {
    return new Map(
      Array.from(entries.values(), (entry) => [
        entry.name.toLowerCase(),
        entry,
      ]),
    );
  }

  /**
   * Runs a task once every earlier access to this archive has finished
   */
  public enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task);

    this.queue = run.catch(() => undefined);

    return run;
  }

  /**
   * Reads the archive again after it changed on disk.
   * Resolves to whether anything was reloaded.
   */
  public reload(): Promise<boolean> {
    return this.enqueue(async () => {
      if (await this.hasOwnWrite()) {
        return false;
      }

      const { magic, entries } = await readArchiveIndexTable(this.archivePath);

      this.magic = magic;
      this.entries = Archive.keyEntries(entries);
      this.rebuildTree();

      return true;
    });
  }

  /**
   * Whether the file on disk is still the one this archive last wrote
   */
  private async hasOwnWrite(): Promise<boolean> {
    if (!this.lastWrittenAt) {
      return false;
    }

    try {
      const { mtime } = await workspace.fs.stat(Uri.file(this.archivePath));

      return mtime === this.lastWrittenAt;
    } catch {
      return false;
    }
  }

  /**
   * Applies a change to the entries and writes the archive to disk
   */
  public modifyEntries(modify: EntriesCallback): Promise<void> {
    return this.enqueue(() => this.writeToDisk(modify));
  }

  private async writeToDisk(modify: EntriesCallback): Promise<void> {
    const entries = new Map(this.entries);

    modify({
      get: (entryPath) => entries.get(entryPath.toLowerCase()),
      set: (entryPath, entry) => {
        entries.set(entryPath.toLowerCase(), entry);
      },
      delete: (entryPath) => entries.delete(entryPath.toLowerCase()),
    });

    const layout = await writeArchiveFile(this.archivePath, this.magic, entries);

    layout.placedEntries.forEach(({ entry, offset, size }) => {
      entry.offset = offset;
      entry.size = size;

      delete entry.pendingData;
    });

    this.entries = entries;

    const { mtime } = await workspace.fs.stat(Uri.file(this.archivePath));

    this.lastWrittenAt = mtime;
  }

  /**
   * Gets the entry stored under an entry path
   */
  public getEntry(entryPath: string): BigFileEntry | undefined {
    return this.entries.get(entryPath.toLowerCase());
  }

  /**
   * Reads an entry's data straight from the archive on disk
   */
  public readEntry(entry: BigFileEntry): Promise<Uint8Array> {
    return readEntryData(this.archivePath, entry);
  }

  /**
   * Gets the entry path a node stands for
   */
  public getEntryPath(node: VirtualNode): string {
    return node.path.slice(this.rootPath.length + 1);
  }

  /**
   * Gets the entry paths of all files at or below a node
   */
  public getFileEntryPaths(node: VirtualNode): string[] {
    return getFileNodes(node).map((fileNode) => this.getEntryPath(fileNode));
  }

  /**
   * Whether any entry is stored below a directory path
   */
  public hasEntriesBelow(directoryPath: string): boolean {
    const prefix = `${directoryPath.toLowerCase()}/`;

    for (const entryKey of this.entries.keys()) {
      if (entryKey.startsWith(prefix)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Tracks a directory that has nothing stored below it
   */
  public keepEmptyDirectory(directoryPath: string): void {
    this.emptyDirectories.add(directoryPath);
  }

  /**
   * Keeps the directories whose last entries were just removed
   */
  public keepEmptiedDirectories(removedPaths: Iterable<string>): void {
    for (const removedPath of removedPaths) {
      let directoryPath = getParentPath(removedPath);

      while (directoryPath && !this.hasEntriesBelow(directoryPath)) {
        this.keepEmptyDirectory(directoryPath);
        directoryPath = getParentPath(directoryPath);
      }
    }
  }

  /**
   * Drops the tracked directories at or below an entry path
   */
  public forgetEmptyDirectories(entryPath: string): void {
    const ancestorKey = entryPath.toLowerCase();

    this.emptyDirectories.forEach((directoryPath) => {
      if (isPathBelow(directoryPath.toLowerCase(), ancestorKey)) {
        this.emptyDirectories.delete(directoryPath);
      }
    });
  }

  /**
   * Moves the tracked directories along with the entry they sit under
   */
  public moveEmptyDirectories(sourcePath: string, targetPath: string): void {
    const sourceKey = sourcePath.toLowerCase();

    Array.from(this.emptyDirectories)
      .filter((directoryPath) =>
        isPathBelow(directoryPath.toLowerCase(), sourceKey),
      )
      .forEach((directoryPath) => {
        this.emptyDirectories.delete(directoryPath);
        this.emptyDirectories.add(
          movePath(directoryPath, sourcePath, targetPath),
        );
      });
  }

  /**
   * Gets the tracked directories, so a reloaded archive can take them over
   */
  public getEmptyDirectories(): Iterable<string> {
    return this.emptyDirectories;
  }

  /**
   * Takes over the tracked directories of an archive this one replaces
   */
  public adoptEmptyDirectories(directoryPaths: Iterable<string>): void {
    for (const directoryPath of directoryPaths) {
      this.emptyDirectories.add(directoryPath);
    }

    this.rebuildTree();
  }

  /**
   * Rebuilds the tree from the current entries.
   *
   * The root node keeps its identity: the tree view holds on to the elements
   * it was handed, and refreshing one archive means firing the very root it
   * already knows.
   */
  public rebuildTree(): void {
    this.root.children = this.buildTree().children;
  }

  private buildTree(): VirtualNode {
    return buildVirtualTree(
      this.name,
      this.rootPath,
      this.archivePath,
      Array.from(this.entries.values(), (entry) => entry.name),
      this.emptyDirectories,
    );
  }
}
