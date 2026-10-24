import { Uri, workspace } from 'vscode';
import path from 'path';
import {
  IN_PLACE_THRESHOLD,
  openArchiveReader,
  readArchiveIndexTable,
  readEntryData,
  writeArchiveFile,
  writeEntryInPlace,
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

/**
 * Gets the keys of the entries at or below a path, which is how a change to a
 * directory reaches the files it holds
 */
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

        // A moved entry is written under its new path, not the name it had
        entries.set(movedPath.toLowerCase(), {
          ...entry,
          name: movedPath,
          storedName: undefined,
        });
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
  /** Absolute path on disk, which is what `binary` opens */
  public readonly archivePath: string;
  public readonly name: string;

  /** Where the archive is mounted in the virtual file system */
  public readonly rootPath: string;

  /** Which source holds it, and where inside that source it sits */
  public readonly sourceId: string;
  public readonly pathInSource: string;

  /** Kept for the life of the archive: the tree view holds on to it */
  public readonly root: VirtualNode;

  /** The tag the file opens with, kept so a rewrite stays the format it was */
  private magic = '';

  /** The bytes between the index table and the data, written back as read */
  private trailer: Uint8Array = new Uint8Array(0);

  /** Keyed case insensitively; each entry keeps its stored name */
  private entries = new Map<string, BigFileEntry>();

  /**
   * Entries hidden by a later entry of the same name in another casing, keyed
   * by the entry that hides them. Shipped archives contain such pairs and the
   * engine reads the later one, so they are never shown, but they are written
   * back until the visible entry is changed.
   */
  private shadowedEntries = new Map<BigFileEntry, BigFileEntry[]>();

  /** Set by the first read and kept, so later callers join that one */
  private loading?: Promise<void>;
  private loaded = false;

  /** Every access to the file, in the order it was asked for */
  private queue: Promise<unknown> = Promise.resolve();

  /** Mtime of this archive's own last write, zero until it has made one */
  private lastWrittenAt = 0;

  /** Mtime of the archive file when its index table was last read */
  private readAt = 0;

  /**
   * When each entry this session wrote was written, by lowercased path. An
   * entry nobody wrote reports `readAt`, so saving one entry does not make
   * every other open entry of the archive look changed on disk.
   */
  private entryWrittenAt = new Map<string, number>();

  /**
   * Builds the tree before anything is read, so the root the view holds on to
   * exists from the start. Reached through `create`.
   */
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
    this.root = buildVirtualTree(this, []);
  }

  /**
   * Creates an archive without reading it. Reading the index table of a large
   * archive costs a noticeable fraction of a second, and a workspace holds
   * many, so it waits until something asks for the content.
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
      const { magic, trailer, entries } = await readArchiveIndexTable(
        this.archivePath,
      );

      this.magic = magic;
      this.trailer = trailer;
      this.keyEntries(entries);
      this.readAt = await this.statMtime();
      this.entryWrittenAt.clear();

      syncFiles(
        this.root,
        Array.from(this.entries.values(), (entry) => entry.name),
      );

      this.loaded = true;
    });

    return this.loading;
  }

  /** Whether the index table has been read; the scan only lists the file */
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

  /**
   * Keys the entries a read returns by their lowercased name, since the index
   * table stores the casing an entry was added with and matches without it.
   * The last entry of a name wins, as in the engine, and hides the others.
   */
  private keyEntries(entries: readonly BigFileEntry[]): void {
    this.entries = new Map();
    this.shadowedEntries = new Map();

    for (const entry of entries) {
      const key = entry.name.toLowerCase();
      const hidden = this.entries.get(key);

      if (hidden) {
        const shadows = this.shadowedEntries.get(hidden) ?? [];

        this.shadowedEntries.delete(hidden);
        this.shadowedEntries.set(entry, [...shadows, hidden]);
      }

      this.entries.set(key, entry);
    }
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

      const { magic, trailer, entries } = await readArchiveIndexTable(
        this.archivePath,
      );

      this.magic = magic;
      this.trailer = trailer;
      this.keyEntries(entries);
      this.readAt = await this.statMtime();
      this.entryWrittenAt.clear();

      syncFiles(
        this.root,
        Array.from(this.entries.values(), (entry) => entry.name),
      );

      return true;
    });
  }

  /** The archive file's mtime, or zero when it cannot be read */
  private async statMtime(): Promise<number> {
    try {
      return (await workspace.fs.stat(Uri.file(this.archivePath))).mtime;
    } catch {
      return 0;
    }
  }

  /**
   * When an entry last changed, as its editor compares it: when this session
   * wrote it, or otherwise when the archive was read
   */
  public getModifiedAt(entryPath: string): number {
    return this.entryWrittenAt.get(entryPath.toLowerCase()) ?? this.readAt;
  }

  /**
   * Writes the one changed entry over its old data when the archive is large
   * and the data fits, which costs the entry's size instead of the archive's.
   * Resolves to whether it did; when not, nothing was written.
   */
  private async tryWriteInPlace(
    entries: Map<string, BigFileEntry>,
    changes: readonly EntryChange[],
  ): Promise<boolean> {
    const [change] = changes;

    if (
      changes.length !== 1 ||
      change.kind !== 'put' ||
      change.source.kind !== 'data'
    ) {
      return false;
    }

    const key = change.path.toLowerCase();
    const existing = this.entries.get(key);

    if (!existing || this.shadowedEntries.has(existing)) {
      return false;
    }

    const { size } = await workspace.fs.stat(Uri.file(this.archivePath));
    const content = change.source.content;

    if (
      size < IN_PLACE_THRESHOLD ||
      !(await writeEntryInPlace(this.archivePath, existing, content))
    ) {
      return false;
    }

    this.entries = new Map(entries);
    this.entries.set(key, { ...existing, size: content.length });

    return true;
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

      if (writeNeeded && (await this.tryWriteInPlace(entries, changes))) {
        this.lastWrittenAt = await this.statMtime();
      } else if (writeNeeded) {
        // A hidden entry goes once the entry hiding it was changed or removed
        const shadowedEntries = new Map(
          Array.from(this.shadowedEntries).filter(
            ([visible]) => entries.get(visible.name.toLowerCase()) === visible,
          ),
        );

        const layout = await writeArchiveFile(
          this.archivePath,
          { magic: this.magic, trailer: this.trailer },
          [...Array.from(shadowedEntries.values()).flat(), ...entries.values()],
        );

        // Fresh objects rather than edits: an entry handed out before the
        // write must keep describing the file it was read from
        const written = new Map(
          layout.placedEntries.map(({ entry, offset, size }) => [
            entry,
            { name: entry.name, storedName: entry.storedName, offset, size },
          ]),
        );
        const writtenEntry = (entry: BigFileEntry): BigFileEntry =>
          written.get(entry) ?? entry;

        this.entries = new Map(
          Array.from(entries, ([key, entry]) => [key, writtenEntry(entry)]),
        );
        this.shadowedEntries = new Map(
          Array.from(shadowedEntries, ([visible, shadows]) => [
            writtenEntry(visible),
            shadows.map(writtenEntry),
          ]),
        );

        this.lastWrittenAt = await this.statMtime();
      }

      if (writeNeeded) {
        const now = Date.now();

        for (const change of changes) {
          const changedPath =
            change.kind === 'move' || change.kind === 'copy'
              ? change.to
              : change.path;

          // A move or copy carries every entry below a directory
          for (const key of this.entries.keys()) {
            if (
              key === changedPath.toLowerCase() ||
              key.startsWith(`${changedPath.toLowerCase()}/`)
            ) {
              this.entryWrittenAt.set(key, now);
            }
          }
        }
      }

      for (const change of changes) {
        changeTree(this.root, change);
      }
    });
  }

  /**
   * Gets the entry stored at a path, matched case insensitively. Nothing for a
   * directory, which the archive stores no entry for.
   */
  public getEntry(entryPath: string): BigFileEntry | undefined {
    return this.entries.get(entryPath.toLowerCase());
  }

  /**
   * Reads the data of the entry at a path, or nothing when there is none.
   * The entry is looked up inside the queue, after every earlier save, so its
   * offsets always describe the file the bytes are read from.
   */
  public readEntry(entryPath: string): Promise<Uint8Array | undefined> {
    return this.enqueue(async () => {
      const entry = this.getEntry(entryPath);

      return entry && readEntryData(this.archivePath, entry);
    });
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
          const entry = this.getEntry(item.node.entryPath);

          if (!entry) {
            throw new Error(
              `Entry missing from archive: ${item.node.entryPath}`,
            );
          }

          await onFile(item, await reader.readEntry(entry));
        }
      } finally {
        await reader.close();
      }
    });
  }

  /** Gets the entry paths of all files at or below a node */
  public getFileEntryPaths(node: VirtualNode): string[] {
    return getFileNodes(node).map((fileNode) => fileNode.entryPath);
  }
}
