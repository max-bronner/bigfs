import { Uri, workspace } from 'vscode';
import path from 'path';
import {
  openArchiveReader,
  readArchiveIndexTable,
  readEntryData,
  writeArchiveFile,
} from '../binary/archiveFile';
import type { BigFileEntry } from '../binary/bigFormat';
import { movePath } from '../common/paths';
import {
  buildVirtualTree,
  copyNode,
  getFileNodes,
  insertDirectory,
  insertFile,
  moveNode,
  removeNode,
  syncFiles,
} from './virtualNode';
import type { VirtualNode } from './virtualNode';

/** Where the content of a written entry comes from */
export type EntrySource =
  | { kind: 'data'; content: Uint8Array }
  | { kind: 'file'; path: string; size: number };

/**
 * A described mutation. A path may name a file or a directory: removing,
 * moving or copying a directory carries every entry below it.
 */
export type EntryChange =
  | { kind: 'put'; path: string; source: EntrySource }
  | { kind: 'remove'; path: string }
  | { kind: 'move'; from: string; to: string }
  | { kind: 'copy'; from: string; to: string }
  | { kind: 'addDirectory'; path: string };

const keysUnder = (
  entries: Map<string, BigFileEntry>,
  entryPath: string,
): string[] => {
  const key = entryPath.toLowerCase();
  const prefix = `${key}/`;

  return Array.from(entries.keys()).filter(
    (entryKey) => entryKey === key || entryKey.startsWith(prefix),
  );
};

/** Applies a change to the entries, and reports whether any of them moved */
const changeEntries = (
  entries: Map<string, BigFileEntry>,
  change: EntryChange,
): boolean => {
  switch (change.kind) {
    case 'addDirectory':
      // An archive stores file paths, so a directory exists only in the tree
      return false;

    case 'put': {
      const { source } = change;

      entries.set(change.path.toLowerCase(), {
        name: change.path,
        offset: 0, // assigned when the archive is written
        size: source.kind === 'data' ? source.content.length : source.size,
        pendingData: source.kind === 'data' ? source.content : undefined,
        pendingFile: source.kind === 'file' ? source.path : undefined,
      });

      return true;
    }

    case 'remove': {
      const keys = keysUnder(entries, change.path);

      keys.forEach((key) => entries.delete(key));

      return keys.length > 0;
    }

    case 'move':
    case 'copy': {
      const keys = keysUnder(entries, change.from);

      for (const key of keys) {
        const entry = entries.get(key);

        if (!entry) {
          continue;
        }

        const movedPath = movePath(entry.name, change.from, change.to);

        if (change.kind === 'move') {
          entries.delete(key);
        }

        entries.set(movedPath.toLowerCase(), { ...entry, name: movedPath });
      }

      return keys.length > 0;
    }
  }
};

/** Applies the same change to the tree, which owns the directories */
const changeTree = (rootNode: VirtualNode, change: EntryChange): void => {
  switch (change.kind) {
    case 'put':
      insertFile(rootNode, change.path);
      break;
    case 'addDirectory':
      insertDirectory(rootNode, change.path);
      break;
    case 'remove':
      removeNode(rootNode, change.path);
      break;
    case 'move':
      moveNode(rootNode, change.from, change.to);
      break;
    case 'copy':
      copyNode(rootNode, change.from, change.to);
      break;
  }
};

/**
 * One archive on disk: the entries read from its index table, the tree built
 * from them, and a queue that serializes every access to the file so a
 * reload cannot land in the middle of a save.
 *
 * The entries own the content and the tree owns the structure. A directory
 * lives only in the tree, which is why it survives having its last file
 * removed without anything tracking it.
 */
export class Archive {
  public readonly archivePath: string;
  public readonly name: string;
  public readonly rootPath: string;

  /** Which source holds it, and where inside that source it sits */
  public readonly sourceId: string;
  public readonly pathInSource: string;

  /** Kept for the life of the archive: the tree view holds on to it */
  public readonly root: VirtualNode;

  private magic = '';

  /** Keyed case insensitively; each entry keeps its stored name */
  private entries = new Map<string, BigFileEntry>();

  /** Set while the index table is being read, which happens on first use */
  private loading?: Promise<void>;
  private loaded = false;

  private queue: Promise<unknown> = Promise.resolve();
  private lastWrittenAt = 0;

  private constructor(
    archivePath: string,
    sourceId: string,
    pathInSource: string,
  ) {
    this.archivePath = archivePath;
    this.name = path.basename(archivePath);
    this.sourceId = sourceId;
    this.pathInSource = pathInSource;
    this.rootPath = `/${sourceId}/${pathInSource}`;
    this.root = buildVirtualTree(this.name, this.rootPath, this.archivePath, []);
  }

  /**
   * Puts an archive in the tree without reading it. The root path is where it
   * sits in the virtual file system, e.g. `/mods/textures.big`.
   *
   * Reading the index table of a large archive costs a noticeable fraction of
   * a second, and a workspace holds many, so it waits until something asks
   * for the content.
   */
  public static create(
    archivePath: string,
    sourceId: string,
    pathInSource: string,
  ): Archive {
    return new Archive(archivePath, sourceId, pathInSource);
  }

  /** Reads the index table, once, however many callers ask for it */
  public ensureLoaded(): Promise<void> {
    this.loading ??= this.enqueue(async () => {
      const { magic, entries } = await readArchiveIndexTable(this.archivePath);

      this.magic = magic;
      this.entries = Archive.keyEntries(entries);

      syncFiles(
        this.root,
        Array.from(this.entries.values(), (entry) => entry.name),
      );

      this.loaded = true;
    });

    return this.loading;
  }

  /** Whether the content has been read, as opposed to only listed */
  public get isLoaded(): boolean {
    return this.loaded;
  }

  /** Whether a read is under way, which a view shows as being busy */
  public get isLoading(): boolean {
    return Boolean(this.loading) && !this.loaded;
  }

  /** How the archive is identified, case insensitively like its content */
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

  /** Runs a task once every earlier access to this archive has finished */
  public enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task);

    this.queue = run.catch(() => undefined);

    return run;
  }

  /**
   * Reads the archive again after it changed on disk. Resolves to whether
   * anything was reloaded.
   */
  public reload(): Promise<boolean> {
    if (!this.loading) {
      return Promise.resolve(false); // never read, so nothing to bring up to date
    }

    return this.enqueue(async () => {
      if (await this.hasOwnWrite()) {
        return false;
      }

      const { magic, entries } = await readArchiveIndexTable(this.archivePath);

      this.magic = magic;
      this.entries = Archive.keyEntries(entries);

      syncFiles(
        this.root,
        Array.from(this.entries.values(), (entry) => entry.name),
      );

      return true;
    });
  }

  /** Whether the file on disk is still the one this archive last wrote */
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
   * Applies changes to the entries and the tree together, writing the archive
   * only when the entries actually moved. Creating a directory touches no
   * bytes on disk.
   */
  public async applyChanges(changes: readonly EntryChange[]): Promise<void> {
    // Outside the queue: the entries have to be there before they can change
    await this.ensureLoaded();

    return this.enqueue(async () => {
      const entries = new Map(this.entries);
      let writeNeeded = false;

      for (const change of changes) {
        writeNeeded = changeEntries(entries, change) || writeNeeded;
      }

      if (writeNeeded) {
        const layout = await writeArchiveFile(
          this.archivePath,
          this.magic,
          entries,
        );

        layout.placedEntries.forEach(({ entry, offset, size }) => {
          entry.offset = offset;
          entry.size = size;

          delete entry.pendingData;
          delete entry.pendingFile;
        });

        this.entries = entries;

        const { mtime } = await workspace.fs.stat(Uri.file(this.archivePath));

        this.lastWrittenAt = mtime;
      }

      for (const change of changes) {
        changeTree(this.root, change);
      }
    });
  }

  /** Gets the entry stored under an entry path */
  public getEntry(entryPath: string): BigFileEntry | undefined {
    return this.entries.get(entryPath.toLowerCase());
  }

  /** Reads an entry's data straight from the archive on disk */
  public readEntry(entry: BigFileEntry): Promise<Uint8Array> {
    return readEntryData(this.archivePath, entry);
  }

  /**
   * Reads several file nodes with the archive open only once, queued behind
   * every earlier access so nothing writes underneath the reader
   */
  public async readFileNodes<T extends { node: VirtualNode }>(
    items: readonly T[],
    onFile: (item: T, content: Uint8Array) => Promise<void>,
  ): Promise<void> {
    await this.ensureLoaded();

    return this.enqueue(async () => {
      const reader = await openArchiveReader(this.archivePath);

      try {
        for (const item of items) {
          const entry = this.getEntry(this.getEntryPath(item.node));

          if (!entry) {
            throw new Error(`Entry missing from archive: ${item.node.path}`);
          }

          await onFile(item, await reader.readEntry(entry));
        }
      } finally {
        await reader.close();
      }
    });
  }

  /** Gets the entry path a node stands for */
  public getEntryPath(node: VirtualNode): string {
    return node.path.slice(this.rootPath.length + 1);
  }

  /** Gets the entry paths of all files at or below a node */
  public getFileEntryPaths(node: VirtualNode): string[] {
    return getFileNodes(node).map((fileNode) => this.getEntryPath(fileNode));
  }
}
