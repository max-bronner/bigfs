import {
  workspace,
  window,
  EventEmitter,
  FileSystemError,
  FileType,
  Uri,
} from 'vscode';
import type { FileSystemWatcher, LogOutputChannel } from 'vscode';
import { BIG_PATTERN } from '../constants';
import { NotAnArchiveError } from '../binary/bigFormat';
import type { BigFileEntry } from '../binary/bigFormat';
import { isContainedPath, isPathBelow } from '../common/paths';
import { Archive } from './archive';
import type { EntryChange, EntrySource } from './archive';
import {
  createWorkspaceSources,
  findSourceFor,
  getPathInSource,
} from './archiveSource';
import type { ArchiveSource } from './archiveSource';
import { findBlockingFile, findChild, isArchiveRoot } from './virtualNode';
import { getNodePath, parseNodeUri } from './nodeAddress';
import type { ResolvedUri } from './nodeAddress';
import type { VirtualNode } from './virtualNode';

/**
 * Event payload emitted by `ArchiveModel.onDidChangeArchive` when an archive
 * is added, changed or removed. Only a changed archive can be refreshed on its
 * own; adding or removing one changes the set of roots.
 */
export interface ArchiveChange {
  type: 'added' | 'changed' | 'removed';
  archivePath: string;
  rootPath: string;
}

/**
 * A file on its way into an archive. A file that lives on disk is copied in
 * while the archive is written, so its content never sits in memory.
 */
export interface ImportedFile {
  name: string;
  size: number;
  sourcePath?: string;
  content?: Uint8Array;
}

/** What a caller can turn off when it creates an `ArchiveModel` */
export interface ArchiveModelOptions {
  /**
   * Read the archives nobody opened, once the workspace is quiet. On by
   * default: it costs nothing visible and makes opening one later instant.
   */
  readAhead?: boolean;
}

/**
 * Milliseconds the read ahead waits before it starts, and again each time it
 * steps aside for a read the user is waiting on
 */
const BACKGROUND_LOAD_DELAY = 500;

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const isFile = async (uri: Uri): Promise<boolean> => {
  try {
    const { type } = await workspace.fs.stat(uri);

    return type === FileType.File;
  } catch {
    return false;
  }
};

const joinEntryPath = (directoryPath: string, name: string): string =>
  directoryPath ? `${directoryPath}/${name}` : name;

const toEntrySource = (file: ImportedFile): EntrySource =>
  file.sourcePath
    ? { kind: 'file', path: file.sourcePath, size: file.size }
    : { kind: 'data', content: file.content ?? new Uint8Array() };

/**
 * The archives of the workspace: finds them on disk, keeps them loaded, and
 * turns an operation into the changes that carry it out.
 */
export class ArchiveModel {
  private _onDidChangeArchive = new EventEmitter<ArchiveChange>();

  /**
   * Fires when an archive is added, changed or removed, however that came
   * about: a save, the watcher, or a scan. The tree redraws from it and the
   * file system provider turns it into file events.
   */
  public readonly onDidChangeArchive = this._onDidChangeArchive.event;

  /** Keyed by each archive's root key */
  private archives = new Map<string, Archive>();

  /** The places archives are found in, which a uri names first */
  private sources: ArchiveSource[] = [];

  private disposed = false;

  /** Reads the user is waiting on, which the background work steps aside for */
  private awaitedLoads = 0;
  private backgroundLoading?: Promise<void>;

  /** Follows the archives on disk for the life of the model */
  private readonly archiveWatcher: FileSystemWatcher;

  /** The scan in flight, replaced by each rescan and awaited by `whenReady` */
  private currentScan: Promise<void>;

  /**
   * Starts the first scan and the watcher straight away, so the model can be
   * asked for roots as soon as it exists. Nothing is read here: the scan only
   * lists the files that carry the extension.
   */
  constructor(
    private log: LogOutputChannel,
    private options: ArchiveModelOptions = {},
  ) {
    this.currentScan = this.scanWorkspace();
    this.archiveWatcher = this.watchArchives();
  }

  /**
   * Stops the watcher and the reads running behind the scenes. The model is
   * not usable afterwards, since nothing brings the archives back up to date.
   */
  public dispose(): void {
    this.disposed = true;
    this.archiveWatcher.dispose();
  }

  /** Follows the archives on disk, so edits made outside the editor show up */
  private watchArchives(): FileSystemWatcher {
    const watcher = workspace.createFileSystemWatcher(BIG_PATTERN);

    watcher.onDidChange((uri) => this.reloadArchive(uri));
    watcher.onDidCreate((uri) => this.reloadArchive(uri));
    watcher.onDidDelete((uri) => this.forgetArchive(uri));

    return watcher;
  }

  /**
   * Brings an archive up to date after the watcher saw its file appear or
   * change, taking on one that was created inside a source. A write the
   * extension made itself reloads nothing and fires no change.
   */
  private async reloadArchive(uri: Uri): Promise<void> {
    const archivePath = uri.fsPath;
    const loaded = this.getArchiveByPath(archivePath);

    if (!loaded && !(await isFile(uri))) {
      return; // a directory can carry the extension too
    }

    try {
      if (loaded) {
        if (await loaded.reload()) {
          this.fireChanged(loaded, 'changed');
        }

        return;
      }

      const source = findSourceFor(this.sources, uri);

      if (!source) {
        return; // outside every source, so not ours to show
      }

      const archive = Archive.create(
        archivePath,
        source.id,
        getPathInSource(source, uri),
      );

      this.archives.set(archive.rootKey, archive);

      this.fireChanged(archive, 'added');
    } catch (error) {
      this.log.error(`Failed to reload archive ${archivePath}`, error);
    }
  }

  /**
   * Reads an archive's index table, and drops it if the file turns out not to
   * be an archive. The extension is only a name, so this is where that is
   * settled rather than by opening every file the scan finds.
   */
  private async readArchive(archive: Archive): Promise<boolean> {
    try {
      await archive.ensureLoaded();

      return true;
    } catch (error) {
      if (error instanceof NotAnArchiveError) {
        this.log.info(`Ignoring ${archive.archivePath}: ${error.message}`);
      } else {
        this.log.error(`Failed to read archive ${archive.archivePath}`, error);
      }

      this.archives.delete(archive.rootKey);
      this.fireChanged(archive, 'removed');

      return false;
    }
  }

  /** Drops an archive whose file is gone, which changes the set of roots */
  private forgetArchive(uri: Uri): void {
    const archive = this.getArchiveByPath(uri.fsPath);

    if (!archive) {
      return;
    }

    this.archives.delete(archive.rootKey);

    this.fireChanged(archive, 'removed');
  }

  /**
   * Announces an archive on `onDidChangeArchive`, which is the only place it
   * is fired from: the views redraw from this and nothing else
   */
  private fireChanged(archive: Archive, kind: ArchiveChange['type']): void {
    this._onDidChangeArchive.fire({
      type: kind,
      archivePath: archive.archivePath,
      rootPath: archive.rootPath,
    });
  }

  /** Resolves once the latest scan is done, so nothing reads a half built tree */
  public whenReady(): Promise<void> {
    return this.currentScan;
  }

  /**
   * Finds the archives again, after the workspace folders changed. An archive
   * that is still there keeps its instance, so the tree the view holds and the
   * directories that live only in it survive the rescan.
   */
  public scanWorkspace(): Promise<void> {
    this.currentScan = this.runScan();

    return this.currentScan;
  }

  /**
   * Rebuilds the sources and the archives from what is on disk, and starts the
   * read ahead. Reports how many candidates could not be read, counting a file
   * that is not an archive at all as one to ignore rather than one that failed.
   */
  private async runScan(): Promise<void> {
    this.sources = createWorkspaceSources();

    if (!this.sources.length) {
      this.archives = new Map<string, Archive>();

      return;
    }

    const loaded = this.archives;

    this.archives = new Map<string, Archive>();

    const archiveUris = await workspace.findFiles(BIG_PATTERN);

    const results = await Promise.allSettled(
      archiveUris.map(async (uri) => {
        const source = findSourceFor(this.sources, uri);

        if (!source) {
          return;
        }

        const pathInSource = getPathInSource(source, uri);
        const rootPath = `/${source.id}/${pathInSource}`;
        const known = loaded.get(rootPath.toLowerCase());

        // Reusing the instance keeps the tree the view already holds, and
        // with it the directories that exist only there
        const archive =
          known ?? Archive.create(uri.fsPath, source.id, pathInSource);

        if (known) {
          await known.reload();
        }

        // Nothing is opened here: the scan lists what carries the extension
        // and each archive is read when it is needed or read ahead
        this.archives.set(archive.rootKey, archive);
      }),
    );

    const failed = results.filter((result) => result.status === 'rejected');

    // A file that is not an archive at all is not a failure worth reporting
    const unreadable = failed.filter(
      (result) => !(result.reason instanceof NotAnArchiveError),
    );

    failed.forEach((result) => {
      if (result.reason instanceof NotAnArchiveError) {
        this.log.info(
          `Ignoring a file that is not an archive: ${result.reason.message}`,
        );
      } else {
        this.log.error('Failed to read archive', result.reason);
      }
    });

    if (unreadable.length) {
      window.showWarningMessage(
        `${unreadable.length} of ${archiveUris.length} BIG archives could not be read.`,
      );
    }

    if (this.options.readAhead !== false) {
      this.startBackgroundLoading();
    }
  }

  /** The root node of every archive found, for a view that shows them flat */
  public getArchiveRoots(): VirtualNode[] {
    return Array.from(this.archives.values(), (archive) => archive.root);
  }

  /** The places archives were found in, which the tree shows as its top rows */
  public getSources(): readonly ArchiveSource[] {
    return this.sources;
  }

  /** Every archive of a source, for a view that groups them by folder */
  public getArchivesOf(sourceId: string): readonly Archive[] {
    return Array.from(this.archives.values()).filter(
      (archive) => archive.sourceId === sourceId,
    );
  }

  /** Whether an archive has read its index table yet */
  public isLoaded(node: VirtualNode): boolean {
    return node.archive.isLoaded;
  }

  /**
   * Finds an archive by its path on disk, matched case insensitively. This is
   * how a change coming back from the watcher or the event is tied to one.
   */
  public getArchiveByPath(archivePath: string): Archive | undefined {
    const wanted = archivePath.toLowerCase();

    for (const archive of this.archives.values()) {
      if (archive.archivePath.toLowerCase() === wanted) {
        return archive;
      }
    }

    return undefined;
  }

  /**
   * Resolves a URI, which only the file system provider has: everything else
   * works with the nodes it hands out.
   */
  private resolveUri(uri: Uri): ResolvedUri | undefined {
    return parseNodeUri(uri, this.archives.values());
  }

  /**
   * Resolves a uri for an operation that cannot go on without one, throwing
   * the `FileNotFound` the file system provider API asks for when the uri
   * names no archive this model knows.
   */
  private getArchiveContext(uri: Uri): ResolvedUri {
    const resolved = this.resolveUri(uri);

    if (!resolved) {
      throw FileSystemError.FileNotFound(uri);
    }

    return resolved;
  }

  /** Gets the archive a node belongs to, or reports the node as missing */
  private getArchiveOf(node: VirtualNode): Archive {
    const archive = node.archive;

    if (!archive) {
      throw FileSystemError.FileNotFound(getNodePath(node));
    }

    return archive;
  }

  /**
   * Finds the node a uri names among the archives already read. Nothing for a
   * uri into an archive nobody has opened, which is what `resolveNode` is for.
   */
  public getNode(uri: Uri): VirtualNode | undefined {
    const resolved = this.resolveUri(uri);

    return resolved && findChild(resolved.archive.root, resolved.entryPath);
  }

  /**
   * Resolves a URI, reading the archive it points into if that has not
   * happened yet. The file system provider uses this rather than `getNode`,
   * since a URI can arrive for an archive nobody has opened.
   */
  public async resolveNode(uri: Uri): Promise<VirtualNode | undefined> {
    if (!this.resolveUri(uri)) {
      await this.whenReady();
    }

    const resolved = this.resolveUri(uri);

    if (!resolved || !(await this.readArchive(resolved.archive))) {
      return undefined;
    }

    return this.getNode(uri);
  }

  /** Reads the archive a node belongs to, for a view about to show it */
  public async loadArchiveOf(node: VirtualNode): Promise<void> {
    const archive = node.archive;

    if (!archive || archive.isLoaded) {
      return;
    }

    // Counted so the background reads wait rather than compete for the thread
    this.awaitedLoads += 1;

    try {
      if (await this.readArchive(archive)) {
        // The row had nothing to say about its content until now
        this.fireChanged(archive, 'changed');
      }
    } finally {
      this.awaitedLoads -= 1;
    }
  }

  /**
   * Reads the archives nobody has opened, one at a time and out of the way,
   * so opening one later is instant without any of it delaying startup.
   */
  private startBackgroundLoading(): void {
    this.backgroundLoading ??= this.loadRemaining().finally(() => {
      this.backgroundLoading = undefined;
    });
  }

  /**
   * Walks the archives that are still unread, one at a time and behind
   * anything the user is waiting on. Stops as soon as the model is disposed.
   */
  private async loadRemaining(): Promise<void> {
    await delay(BACKGROUND_LOAD_DELAY);

    for (const archive of Array.from(this.archives.values())) {
      if (this.disposed) {
        return;
      }

      if (archive.isLoaded) {
        continue;
      }

      // Whatever the user opened goes first
      while (this.awaitedLoads > 0 && !this.disposed) {
        await delay(BACKGROUND_LOAD_DELAY);
      }

      if (await this.readArchive(archive)) {
        this.fireChanged(archive, 'changed');
      }

      // Hand the thread back between archives, parsing one is not free
      await delay(0);
    }
  }

  /** Nothing for a directory, which an archive stores no entry for */
  private getEntryForNode(node: VirtualNode): BigFileEntry | undefined {
    if (node.type !== FileType.File) {
      return undefined;
    }

    const archive = node.archive;

    return archive?.getEntry(node.entryPath);
  }

  /**
   * Reads the content of a file node straight from the archive on disk.
   * Nothing for a directory, or for a node the entries no longer hold.
   */
  public async getFileContent(
    node: VirtualNode,
  ): Promise<Uint8Array | undefined> {
    const archive = node.archive;
    const entry = this.getEntryForNode(node);

    return archive && entry ? archive.readEntry(entry) : undefined;
  }

  /** From the index table, or from a write that has not been saved yet */
  public getFileSize(node: VirtualNode): number {
    const entry = this.getEntryForNode(node);

    if (!entry) {
      return 0;
    }

    return entry.pendingData?.length ?? entry.size;
  }

  /**
   * Carries out changes against one archive: the single place that applies a
   * mutation, reports a failure and tells the view about it, so an operation
   * only has to say what changes.
   */
  private async apply(
    archive: Archive,
    changes: readonly EntryChange[],
  ): Promise<void> {
    try {
      await archive.applyChanges(changes);
    } catch (error) {
      this.log.error(`Failed to save archive ${archive.archivePath}`, error);
      throw error;
    }

    this.fireChanged(archive, 'changed');
  }

  /**
   * Rejects a path that would escape the archive when extracted, or whose
   * parents run through an existing file
   */
  private ensureWritablePath(archive: Archive, entryPath: string): void {
    if (!isContainedPath(entryPath)) {
      throw FileSystemError.NoPermissions(`Invalid entry path: ${entryPath}`);
    }

    const blockingFile = findBlockingFile(archive.root, entryPath);

    if (blockingFile) {
      throw FileSystemError.FileNotADirectory(getNodePath(blockingFile));
    }
  }

  /**
   * Writes an entry, creating it when the archive holds none at that path.
   * The whole archive is rewritten, since changing one entry shifts every
   * offset after it.
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

    await this.apply(archive, [
      { kind: 'put', path: entryPath, source: { kind: 'data', content } },
    ]);
  }

  /**
   * Creates a directory. Nothing is written to the archive, which stores file
   * paths and knows no directories of its own.
   */
  public async createDirectory(uri: Uri): Promise<void> {
    const { archive, entryPath } = this.getArchiveContext(uri);

    if (!entryPath) {
      throw FileSystemError.NoPermissions('Cannot create the archive root');
    }

    this.ensureWritablePath(archive, entryPath);

    await this.apply(archive, [{ kind: 'addDirectory', path: entryPath }]);
  }

  /** Deletes a file, or a directory with everything below it */
  public async delete(uri: Uri): Promise<void> {
    const node = this.getNode(uri);

    if (!node) {
      throw FileSystemError.FileNotFound(uri);
    }

    await this.deleteNodes([node]);
  }

  /** Deletes nodes, which may span several archives */
  public async deleteNodes(nodes: readonly VirtualNode[]): Promise<void> {
    for (const [archive, group] of this.groupByArchive(nodes)) {
      await this.apply(
        archive,
        group.map((node) => ({
          kind: 'remove' as const,
          path: node.entryPath,
        })),
      );
    }
  }

  /** Renames or moves a node, keeping everything below it */
  public async rename(oldUri: Uri, newUri: Uri): Promise<void> {
    const source = this.getArchiveContext(oldUri);
    const target = this.getArchiveContext(newUri);

    if (source.archive !== target.archive) {
      throw FileSystemError.NoPermissions('Cannot move between archives');
    }

    if (!source.entryPath || !target.entryPath) {
      throw FileSystemError.NoPermissions('Cannot move the archive itself');
    }

    this.ensureMovable(source.entryPath, target.entryPath);

    await this.apply(source.archive, [
      { kind: 'move', from: source.entryPath, to: target.entryPath },
    ]);
  }

  /** Moves nodes into a directory under their own names */
  public async moveNodes(
    sources: readonly VirtualNode[],
    targetDirectory: VirtualNode,
  ): Promise<void> {
    const archive = this.getArchiveOf(targetDirectory);
    const targetPath = targetDirectory.entryPath;

    const changes = sources.map((source) => {
      const from = source.entryPath;
      const to = joinEntryPath(targetPath, source.name);

      this.ensureMovable(from, to);

      return { kind: 'move' as const, from, to };
    });

    await this.apply(archive, changes);
  }

  /** Copies nodes into a directory under the names they are given */
  public async copyNodes(
    copies: readonly { source: VirtualNode; targetName: string }[],
    targetDirectory: VirtualNode,
  ): Promise<void> {
    const archive = this.getArchiveOf(targetDirectory);
    const targetPath = targetDirectory.entryPath;

    const changes = copies.map(({ source, targetName }) => ({
      kind: 'copy' as const,
      from: source.entryPath,
      to: joinEntryPath(targetPath, targetName),
    }));

    await this.apply(archive, changes);
  }

  /**
   * Adds imported files to a directory under the names they carry, as one
   * change to the archive however many files there are
   */
  public async addFiles(
    targetDirectory: VirtualNode,
    files: readonly ImportedFile[],
  ): Promise<void> {
    const archive = this.getArchiveOf(targetDirectory);
    const targetPath = targetDirectory.entryPath;

    const changes = files.map((file) => {
      const entryPath = joinEntryPath(targetPath, file.name);

      this.ensureWritablePath(archive, entryPath);

      return {
        kind: 'put' as const,
        path: entryPath,
        source: toEntrySource(file),
      };
    });

    await this.apply(archive, changes);
  }

  /** Reads several file nodes, opening each archive involved only once */
  public async readFiles<T extends { node: VirtualNode }>(
    items: readonly T[],
    onFile: (item: T, content: Uint8Array) => Promise<void>,
  ): Promise<void> {
    for (const [archive, group] of this.groupByArchive(
      items.map((item) => item.node),
    )) {
      const groupItems = items.filter((item) => group.includes(item.node));

      await archive.readFileNodes(groupItems, onFile);
    }
  }

  /** Rejects a move to a path that would escape the archive, or of a directory into itself */
  private ensureMovable(from: string, to: string): void {
    if (!isContainedPath(to)) {
      throw FileSystemError.NoPermissions(`Invalid entry path: ${to}`);
    }

    const fromKey = from.toLowerCase();
    const toKey = to.toLowerCase();

    // Equal paths are a rename that only changes the casing, not a move
    if (toKey !== fromKey && isPathBelow(toKey, fromKey)) {
      throw FileSystemError.NoPermissions('Cannot move an entry into itself');
    }
  }

  /**
   * Groups nodes by the archive holding them, since changes are applied one
   * archive at a time. An archive root is refused: it is a file on disk, not
   * an entry any archive could change.
   */
  private groupByArchive(
    nodes: readonly VirtualNode[],
  ): Map<Archive, VirtualNode[]> {
    const grouped = new Map<Archive, VirtualNode[]>();

    for (const node of nodes) {
      if (isArchiveRoot(node)) {
        throw FileSystemError.NoPermissions('Archives cannot be changed');
      }

      const archive = this.getArchiveOf(node);
      const group = grouped.get(archive) ?? [];

      group.push(node);
      grouped.set(archive, group);
    }

    return grouped;
  }
}
