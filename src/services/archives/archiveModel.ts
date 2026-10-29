import type { Event, LogOutputChannel, Uri } from 'vscode';
import type { ConflictChoice } from '../../game/install/transferPlan';
import type { Archive } from './archive';
import { createArchiveOperations } from './archiveOperations';
import type {
  ArchiveOperations,
  ImportedFile,
  TransferResult,
} from './archiveOperations';
import { createArchivePolicy } from './archivePolicy';
import type { ArchivePolicy } from './archivePolicy';
import { createArchiveRegistry } from './archiveRegistry';
import type { ArchiveChange, ArchiveRegistry } from './archiveRegistry';
import { createArchiveScanner } from './archiveScanner';
import type { ArchiveScanner } from './archiveScanner';
import type { ArchiveSource } from './archiveSource';
import type { VirtualNode } from './virtualNode';

export type { ArchiveChange, ImportedFile, TransferResult };

/** What a caller can turn off when it creates an `ArchiveModel` */
export interface ArchiveModelOptions {
  /**
   * Read the archives nobody opened, once the workspace is quiet. On by
   * default: it costs nothing visible and makes opening one later instant.
   */
  readAhead?: boolean;
}

/**
 * The archives of the workspace: finds them on disk, keeps them loaded, and
 * turns an operation into the changes that carry it out. A façade over the
 * scanner, the registry, the read-only policy and the operations, which hold
 * the logic.
 */
export class ArchiveModel {
  private readonly registry: ArchiveRegistry;
  private readonly scanner: ArchiveScanner;
  private readonly policy: ArchivePolicy;
  private readonly operations: ArchiveOperations;

  /**
   * Fires when an archive is added, changed or removed, however that came
   * about: a save, the watcher, or a scan. The tree redraws from it and the
   * file system provider turns it into file events.
   */
  public readonly onDidChangeArchive: Event<ArchiveChange>;

  /** Fires when a scan has found the archives again, which can add or drop any */
  public readonly onDidScan: Event<void>;

  /**
   * Starts the first scan and the watcher straight away, so the model can be
   * asked for roots as soon as it exists. Nothing is read here: the scan only
   * lists the files that carry the extension.
   */
  constructor(log: LogOutputChannel, options: ArchiveModelOptions = {}) {
    this.registry = createArchiveRegistry(log, {
      whenReady: () => this.scanner.whenReady(),
      discover: (uri) => this.scanner.discover(uri),
      retryLater: (archivePath) => this.scanner.retryLater(archivePath),
    });
    this.policy = createArchivePolicy(() => this.registry.sources);
    this.operations = createArchiveOperations(this.registry, this.policy, log);
    this.scanner = createArchiveScanner(
      this.registry,
      log,
      options.readAhead !== false,
    );
    this.onDidChangeArchive = this.registry.onDidChangeArchive;
    this.onDidScan = this.scanner.onDidScan;
  }

  /**
   * Stops the watcher and the reads running behind the scenes. The model is
   * not usable afterwards, since nothing brings the archives back up to date.
   */
  public dispose(): void {
    this.registry.dispose();
    this.scanner.dispose();
  }

  /** Resolves once the latest scan is done, so nothing reads a half built tree */
  public whenReady(): Promise<void> {
    return this.scanner.whenReady();
  }

  /**
   * Finds the archives again, after the workspace folders changed. An archive
   * that is still there keeps its instance, so the tree the view holds and the
   * directories that live only in it survive the rescan.
   */
  public scanWorkspace(): Promise<void> {
    return this.scanner.scanWorkspace();
  }

  /** The root node of every archive found, for a view that shows them flat */
  public getArchiveRoots(): VirtualNode[] {
    return this.registry.getArchiveRoots();
  }

  /** The places archives were found in, which the tree shows as its top rows */
  public getSources(): readonly ArchiveSource[] {
    return this.registry.sources;
  }

  /** Every archive of a source, for a view that groups them by folder */
  public getArchivesOf(sourceId: string): readonly Archive[] {
    return this.registry.getArchivesOf(sourceId);
  }

  /** Whether an archive sits in a source that is never written to */
  public isReadOnly(archive: Archive): boolean {
    return this.policy.isReadOnly(archive.sourceId);
  }

  /**
   * Rejects a write into a source that is read-only, going by the source a
   * uri names first so it holds for an archive nobody has opened
   */
  public ensureWritable(uri: Uri): void {
    const [sourceId = ''] = uri.path.split('/').filter(Boolean);

    this.policy.ensureWritable(sourceId);
  }

  /** Whether the entry a uri names sits in an archive that is never written to */
  public isReadOnlyUri(uri: Uri): boolean {
    const resolved = this.registry.resolveUri(uri);

    return resolved ? this.isReadOnly(resolved.archive) : false;
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
    return this.registry.getArchiveByPath(archivePath);
  }

  /**
   * Finds the node a uri names among the archives already read. Nothing for a
   * uri into an archive nobody has opened, which is what `resolveNode` is for.
   */
  public getNode(uri: Uri): VirtualNode | undefined {
    return this.registry.getNode(uri);
  }

  /**
   * Resolves a URI, reading the archive it points into if that has not
   * happened yet. The file system provider uses this rather than `getNode`,
   * since a URI can arrive for an archive nobody has opened.
   */
  public resolveNode(uri: Uri): Promise<VirtualNode | undefined> {
    return this.registry.resolveNode(uri);
  }

  /** Reads the archive a node belongs to, for a view about to show it */
  public loadArchiveOf(node: VirtualNode): Promise<void> {
    return this.registry.loadArchiveOf(node);
  }

  /**
   * Reads the content of a file node straight from the archive on disk.
   * Nothing for a directory, or for a node the entries no longer hold.
   */
  public getFileContent(node: VirtualNode): Promise<Uint8Array | undefined> {
    return this.registry.getFileContent(node);
  }

  /** From the index table, or from a write that has not been saved yet */
  public getFileSize(node: VirtualNode): number {
    return this.registry.getFileSize(node);
  }

  /** Lists the files and directories below a directory, by path below it */
  public getDirectoryContent(directory: VirtualNode): {
    files: string[];
    directories: string[];
  } {
    return this.registry.getDirectoryContent(directory);
  }

  /** Reads several file nodes, opening each archive involved only once */
  public readFiles<T extends { node: VirtualNode }>(
    items: readonly T[],
    onFile: (item: T, content: Uint8Array) => Promise<void>,
  ): Promise<void> {
    return this.registry.readFiles(items, onFile);
  }

  /**
   * Writes an entry, creating it when the archive holds none at that path.
   * The whole archive is rewritten, since changing one entry shifts every
   * offset after it.
   */
  public writeFile(uri: Uri, content: Uint8Array): Promise<void> {
    return this.operations.writeFile(uri, content);
  }

  /**
   * Writes several entries, creating those the archives hold none of. Each
   * archive is rewritten once however many of its entries change, so the
   * whole set lands as one save per archive.
   */
  public writeFiles(
    files: readonly { uri: Uri; content: Uint8Array }[],
  ): Promise<void> {
    return this.operations.writeFiles(files);
  }

  /**
   * Creates a directory. Nothing is written to the archive, which stores file
   * paths and knows no directories of its own.
   */
  public createDirectory(uri: Uri): Promise<void> {
    return this.operations.createDirectory(uri);
  }

  /** Deletes a file, or a directory with everything below it */
  public delete(uri: Uri): Promise<void> {
    return this.operations.delete(uri);
  }

  /** Deletes nodes, which may span several archives */
  public deleteNodes(nodes: readonly VirtualNode[]): Promise<void> {
    return this.operations.deleteNodes(nodes);
  }

  /** Renames or moves a node, keeping everything below it */
  public rename(oldUri: Uri, newUri: Uri): Promise<void> {
    return this.operations.rename(oldUri, newUri);
  }

  /** Moves nodes into a directory under their own names */
  public moveNodes(
    sources: readonly VirtualNode[],
    targetDirectory: VirtualNode,
  ): Promise<void> {
    return this.operations.moveNodes(sources, targetDirectory);
  }

  /** Copies nodes into a directory under the names they are given */
  public copyNodes(
    copies: readonly { source: VirtualNode; targetName: string }[],
    targetDirectory: VirtualNode,
  ): Promise<void> {
    return this.operations.copyNodes(copies, targetDirectory);
  }

  /**
   * Adds imported files to a directory under the names they carry, as one
   * change to the archive however many files there are
   */
  public addFiles(
    targetDirectory: VirtualNode,
    files: readonly ImportedFile[],
  ): Promise<void> {
    return this.operations.addFiles(targetDirectory, files);
  }

  /**
   * Copies the files below nodes, of any archives, into a directory, and
   * removes them from where they came from when `move` is set. Sources in a
   * read-only archive are only ever copied. The names the target already
   * holds go to `choose`, which answers what to do with them, or undefined
   * to cancel.
   */
  public transferNodes(
    sources: readonly VirtualNode[],
    targetDirectory: VirtualNode,
    move: boolean,
    choose: (names: string[]) => Promise<ConflictChoice | undefined>,
  ): Promise<TransferResult> {
    return this.operations.transferNodes(
      sources,
      targetDirectory,
      move,
      choose,
    );
  }
}
