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
import { getParentPath, isPathBelow, splitPath } from '../common/paths';
import { Archive } from './archive';
import type { EntryChange, EntrySource } from './archive';
import {
  createWorkspaceSources,
  findSourceFor,
  getArchiveRootPath,
} from './archiveSource';
import type { ArchiveSource } from './archiveSource';
import { findBlockingFile, findChild } from './virtualNode';
import type { VirtualNode } from './virtualNode';

/**
 * What happened to an archive, and where it sits in the virtual file system.
 * Only a changed archive can be refreshed on its own; adding or removing one
 * changes the set of roots.
 */
export interface ArchiveChange {
  kind: 'added' | 'changed' | 'removed';
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
  public readonly onDidChangeArchive = this._onDidChangeArchive.event;

  /** Keyed by each archive's root key */
  private archives = new Map<string, Archive>();

  /** The places archives are found in, which a uri names first */
  private sources: ArchiveSource[] = [];

  private readonly archiveWatcher: FileSystemWatcher;

  private currentScan: Promise<void>;

  constructor(private log: LogOutputChannel) {
    this.currentScan = this.scanWorkspace();
    this.archiveWatcher = this.watchArchives();
  }

  public dispose(): void {
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

      const archive = Archive.create(archivePath, getArchiveRootPath(source, uri));

      await archive.verify();

      this.archives.set(archive.rootKey, archive);

      this.fireChanged(archive, 'added');
    } catch (error) {
      if (error instanceof NotAnArchiveError) {
        this.log.info(`Ignoring ${archivePath}: ${error.message}`);
        return;
      }

      this.log.error(`Failed to reload archive ${archivePath}`, error);
    }
  }

  private forgetArchive(uri: Uri): void {
    const archive = this.getArchiveByPath(uri.fsPath);

    if (!archive) {
      return;
    }

    this.archives.delete(archive.rootKey);

    this.fireChanged(archive, 'removed');
  }

  private fireChanged(archive: Archive, kind: ArchiveChange['kind']): void {
    this._onDidChangeArchive.fire({
      kind,
      archivePath: archive.archivePath,
      rootPath: archive.rootPath,
    });
  }

  /** Resolves once the latest scan is done, so nothing reads a half built tree */
  public whenReady(): Promise<void> {
    return this.currentScan;
  }

  public scanWorkspace(): Promise<void> {
    this.currentScan = this.runScan();

    return this.currentScan;
  }

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

        const rootPath = getArchiveRootPath(source, uri);
        const known = loaded.get(rootPath.toLowerCase());

        // Reusing the instance keeps the tree the view already holds, and
        // with it the directories that exist only there
        const archive = known ?? Archive.create(uri.fsPath, rootPath);

        if (known) {
          await known.reload();
        } else {
          // Only the header, so a scan stays cheap however many there are
          await archive.verify();
        }

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
        this.log.info(`Ignoring a file that is not an archive: ${result.reason.message}`);
      } else {
        this.log.error('Failed to read archive', result.reason);
      }
    });

    if (unreadable.length) {
      window.showWarningMessage(
        `${unreadable.length} of ${archiveUris.length} BIG archives could not be read.`,
      );
    }
  }

  public getArchiveRoots(): VirtualNode[] {
    return Array.from(this.archives.values(), (archive) => archive.root);
  }

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
   * Finds the archive a node URI points into. The longest root path wins, so
   * an archive below a directory named like another archive still resolves.
   */
  private findArchiveForUri(uriPath: string): Archive | undefined {
    const wanted = uriPath.toLowerCase();
    let match: Archive | undefined;

    for (const archive of this.archives.values()) {
      if (
        isPathBelow(wanted, archive.rootKey) &&
        archive.rootKey.length > (match?.rootKey.length ?? 0)
      ) {
        match = archive;
      }
    }

    return match;
  }

  /**
   * Resolves a URI, which only the file system provider has: everything else
   * works with the nodes it hands out.
   */
  private resolveUri(
    uri: Uri,
  ): { archive: Archive; entryPath: string } | undefined {
    const archive = this.findArchiveForUri(uri.path);

    if (!archive) {
      return undefined;
    }

    const entryPath = splitPath(uri.path.slice(archive.rootPath.length)).join(
      '/',
    );

    return { archive, entryPath };
  }

  private getArchiveContext(uri: Uri): { archive: Archive; entryPath: string } {
    const resolved = this.resolveUri(uri);

    if (!resolved) {
      throw FileSystemError.FileNotFound(uri);
    }

    return resolved;
  }

  /** Gets the archive a node belongs to, or reports the node as missing */
  private getArchiveOf(node: VirtualNode): Archive {
    const archive = this.getArchiveByPath(node.archivePath);

    if (!archive) {
      throw FileSystemError.FileNotFound(node.path);
    }

    return archive;
  }

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
    if (!this.findArchiveForUri(uri.path)) {
      await this.whenReady();
    }

    const archive = this.findArchiveForUri(uri.path);

    if (!archive) {
      return undefined;
    }

    await archive.ensureLoaded();

    return this.getNode(uri);
  }

  /** Reads the archive a node belongs to, for a view about to show it */
  public async loadArchiveOf(node: VirtualNode): Promise<void> {
    await this.getArchiveByPath(node.archivePath)?.ensureLoaded();
  }

  /** Gets the directory a node sits in, or nothing for an archive root */
  public getParent(node: VirtualNode): VirtualNode | undefined {
    if (node.isArchiveRoot) {
      return undefined;
    }

    const archive = this.getArchiveByPath(node.archivePath);

    return (
      archive &&
      findChild(archive.root, getParentPath(archive.getEntryPath(node)))
    );
  }

  public getEntryPath(node: VirtualNode): string | undefined {
    return this.getArchiveByPath(node.archivePath)?.getEntryPath(node);
  }

  private getEntryForNode(node: VirtualNode): BigFileEntry | undefined {
    if (node.type !== FileType.File) {
      return undefined;
    }

    const archive = this.getArchiveByPath(node.archivePath);

    return archive?.getEntry(archive.getEntryPath(node));
  }

  public async getFileContent(
    node: VirtualNode,
  ): Promise<Uint8Array | undefined> {
    const archive = this.getArchiveByPath(node.archivePath);
    const entry = this.getEntryForNode(node);

    return archive && entry ? archive.readEntry(entry) : undefined;
  }

  /** Gets a file's size from the index, never from its content */
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

  /** Rejects a path whose parents run through an existing file */
  private ensureWritablePath(archive: Archive, entryPath: string): void {
    const blockingFile = findBlockingFile(archive.root, entryPath);

    if (blockingFile) {
      throw FileSystemError.FileNotADirectory(blockingFile.path);
    }
  }

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
          path: archive.getEntryPath(node),
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
    const targetPath = archive.getEntryPath(targetDirectory);

    const changes = sources.map((source) => {
      const from = archive.getEntryPath(source);
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
    const targetPath = archive.getEntryPath(targetDirectory);

    const changes = copies.map(({ source, targetName }) => ({
      kind: 'copy' as const,
      from: archive.getEntryPath(source),
      to: joinEntryPath(targetPath, targetName),
    }));

    await this.apply(archive, changes);
  }

  /** Adds files to a directory */
  public async addFiles(
    targetDirectory: VirtualNode,
    files: readonly ImportedFile[],
  ): Promise<void> {
    const archive = this.getArchiveOf(targetDirectory);
    const targetPath = archive.getEntryPath(targetDirectory);

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

  private ensureMovable(from: string, to: string): void {
    const fromKey = from.toLowerCase();
    const toKey = to.toLowerCase();

    // Equal paths are a rename that only changes the casing, not a move
    if (toKey !== fromKey && isPathBelow(toKey, fromKey)) {
      throw FileSystemError.NoPermissions('Cannot move an entry into itself');
    }
  }

  private groupByArchive(
    nodes: readonly VirtualNode[],
  ): Map<Archive, VirtualNode[]> {
    const grouped = new Map<Archive, VirtualNode[]>();

    for (const node of nodes) {
      if (node.isArchiveRoot) {
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
