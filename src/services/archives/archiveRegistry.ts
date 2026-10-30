import { EventEmitter, FileSystemError, FileType } from 'vscode';
import type { Event, LogOutputChannel, Uri } from 'vscode';
import { NotAnArchiveError } from '../../formats/big/bigFormat';
import type { BigFileEntry } from '../../formats/big/bigFormat';
import { delay } from '../../core/delay';
import type { Archive } from './archive';
import type { ArchiveSource } from './archiveSource';
import {
  findChild,
  getFileNodes,
  getRelativeEntryPath,
  isArchiveRoot,
} from './virtualNode';
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
  /**
   * The archive's index table was read for the first time, which only fills
   * its row in. What the archive holds did not change, so a view built from
   * every archive's content, which reads each one itself, has no reason to
   * build again.
   */
  loaded?: boolean;
}

/**
 * The part of the scanner the registry leans on to resolve a uri for an
 * archive it has not heard of, and to look again at one that failed to read
 */
export interface ArchiveDiscovery {
  /** Resolves once the latest scan is done */
  whenReady(): Promise<void>;
  /** Takes on the archive a uri points into when its file is there but no scan has found it */
  discover(uri: Uri): Promise<void>;
  /** Reads an archive that failed once more, a moment later; each path gets one retry */
  retryLater(archivePath: string): void;
}

/**
 * The archives the model knows and the sources they sit in: finds an archive
 * or node by path or uri, and reads archives when asked or in the background.
 * The scanner fills `archives` and `sources`; everything else reads them.
 */
export interface ArchiveRegistry {
  /** Keyed by each archive's root key, and swapped whole by a scan */
  archives: Map<string, Archive>;
  /** The places archives are found in, which a uri names first */
  sources: ArchiveSource[];
  /** Set once the model is disposed, which stops the background reads */
  readonly isDisposed: boolean;
  /** Fires for every archive added, changed or removed, through `fireChanged` */
  readonly onDidChangeArchive: Event<ArchiveChange>;
  /** Stops the background reads; the registry is not usable afterwards */
  dispose(): void;
  /**
   * Announces an archive on `onDidChangeArchive`, which is the only place it
   * is fired from: the views redraw from this and nothing else
   */
  fireChanged(
    archive: Archive,
    kind: ArchiveChange['type'],
    loaded?: boolean,
  ): void;
  /** Gets the root node of every archive found, for a view that shows them flat */
  getArchiveRoots(): VirtualNode[];
  /** Gets every archive of a source, for a view that groups them by folder */
  getArchivesOf(sourceId: string): readonly Archive[];
  /**
   * Finds an archive by its path on disk, matched case insensitively. This is
   * how a change coming back from the watcher or the event is tied to one.
   */
  getArchiveByPath(archivePath: string): Archive | undefined;
  /**
   * Resolves a URI, which only the file system provider has: everything else
   * works with the nodes it hands out.
   */
  resolveUri(uri: Uri): ResolvedUri | undefined;
  /**
   * Resolves a uri for an operation that cannot go on without one, throwing
   * the `FileNotFound` the file system provider API asks for when the uri
   * names no archive this model knows.
   */
  getArchiveContext(uri: Uri): ResolvedUri;
  /** Gets the archive a node belongs to, or reports the node as missing */
  getArchiveOf(node: VirtualNode): Archive;
  /**
   * Finds the node a uri names among the archives already read. Nothing for a
   * uri into an archive nobody has opened, which is what `resolveNode` is for.
   */
  getNode(uri: Uri): VirtualNode | undefined;
  /**
   * Resolves a URI, reading the archive it points into if that has not
   * happened yet. The file system provider uses this rather than `getNode`,
   * since a URI can arrive for an archive nobody has opened.
   */
  resolveNode(uri: Uri): Promise<VirtualNode | undefined>;
  /**
   * Reads an archive's index table, and drops it if the file turns out not to
   * be an archive. The extension is only a name, so this is where that is
   * settled rather than by opening every file the scan finds.
   */
  readArchive(archive: Archive): Promise<boolean>;
  /** Reads the archive a node belongs to, for a view about to show it */
  loadArchiveOf(node: VirtualNode): Promise<void>;
  /**
   * Reads the archives nobody has opened, one at a time and out of the way,
   * so opening one later is instant without any of it delaying startup.
   */
  startBackgroundLoading(): void;
  /**
   * Reads the content of a file node straight from the archive on disk.
   * Nothing for a directory, or for a node the entries no longer hold.
   */
  getFileContent(node: VirtualNode): Promise<Uint8Array | undefined>;
  /** Gets a file node's size, from the index table or from a write that has not been saved yet */
  getFileSize(node: VirtualNode): number;
  /** Lists the files and directories below a directory, by path below it */
  getDirectoryContent(directory: VirtualNode): {
    files: string[];
    directories: string[];
  };
  /** Reads several file nodes, opening each archive involved only once */
  readFiles<T extends { node: VirtualNode }>(
    items: readonly T[],
    onFile: (item: T, content: Uint8Array) => Promise<void>,
  ): Promise<void>;
  /**
   * Groups nodes by the archive holding them, since changes are applied one
   * archive at a time. An archive root is refused: it is a file on disk, not
   * an entry any archive could change.
   */
  groupByArchive(nodes: readonly VirtualNode[]): Map<Archive, VirtualNode[]>;
}

/**
 * Milliseconds the read ahead waits before it starts, and again each time it
 * steps aside for a read the user is waiting on
 */
const BACKGROUND_LOAD_DELAY = 500;

/**
 * Creates the registry the archive model looks archives up in. `discovery`
 * is asked lazily, so it may be the scanner built after the registry.
 */
export const createArchiveRegistry = (
  log: LogOutputChannel,
  discovery: ArchiveDiscovery,
): ArchiveRegistry => {
  const onDidChangeArchive = new EventEmitter<ArchiveChange>();
  let disposed = false;

  // Reads the user is waiting on, which the background work steps aside for
  let awaitedLoads = 0;
  let backgroundLoading: Promise<void> | undefined;

  // Nothing for a directory, which an archive stores no entry for
  const getEntryForNode = (node: VirtualNode): BigFileEntry | undefined => {
    if (node.type !== FileType.File) {
      return undefined;
    }

    const archive = node.archive;

    return archive?.getEntry(node.entryPath);
  };

  // Walks the archives that are still unread, one at a time and behind
  // anything the user is waiting on. Stops as soon as the model is disposed.
  const loadRemaining = async (): Promise<void> => {
    await delay(BACKGROUND_LOAD_DELAY);

    for (const archive of Array.from(registry.archives.values())) {
      if (disposed) {
        return;
      }

      if (archive.isLoaded) {
        continue;
      }

      // Whatever the user opened goes first
      while (awaitedLoads > 0 && !disposed) {
        await delay(BACKGROUND_LOAD_DELAY);
      }

      if (await registry.readArchive(archive)) {
        registry.fireChanged(archive, 'changed', true);
      }

      // Hand the thread back between archives, parsing one is not free
      await delay(0);
    }
  };

  const registry: ArchiveRegistry = {
    archives: new Map<string, Archive>(),
    sources: [],

    get isDisposed() {
      return disposed;
    },

    onDidChangeArchive: onDidChangeArchive.event,

    dispose() {
      disposed = true;
    },

    fireChanged(archive, kind, loaded = false) {
      onDidChangeArchive.fire({
        type: kind,
        archivePath: archive.archivePath,
        rootPath: archive.rootPath,
        ...(loaded && { loaded }),
      });
    },

    getArchiveRoots() {
      return Array.from(registry.archives.values(), (archive) => archive.root);
    },

    getArchivesOf(sourceId) {
      return Array.from(registry.archives.values()).filter(
        (archive) => archive.sourceId === sourceId,
      );
    },

    getArchiveByPath(archivePath) {
      const wanted = archivePath.toLowerCase();

      for (const archive of registry.archives.values()) {
        if (archive.archivePath.toLowerCase() === wanted) {
          return archive;
        }
      }

      return undefined;
    },

    resolveUri(uri) {
      return parseNodeUri(uri, registry.archives.values());
    },

    getArchiveContext(uri) {
      const resolved = registry.resolveUri(uri);

      if (!resolved) {
        throw FileSystemError.FileNotFound(uri);
      }

      return resolved;
    },

    getArchiveOf(node) {
      const archive = node.archive;

      if (!archive) {
        throw FileSystemError.FileNotFound(getNodePath(node));
      }

      return archive;
    },

    getNode(uri) {
      const resolved = registry.resolveUri(uri);

      return resolved && findChild(resolved.archive.root, resolved.entryPath);
    },

    async resolveNode(uri) {
      if (!registry.resolveUri(uri)) {
        await discovery.whenReady();
      }
      if (!registry.resolveUri(uri)) {
        await discovery.discover(uri);
      }

      const resolved = registry.resolveUri(uri);

      if (!resolved || !(await registry.readArchive(resolved.archive))) {
        return undefined;
      }

      return registry.getNode(uri);
    },

    async readArchive(archive) {
      try {
        await archive.ensureLoaded();

        return true;
      } catch (error) {
        discovery.retryLater(archive.archivePath);
        if (error instanceof NotAnArchiveError) {
          log.info(`Ignoring ${archive.archivePath}: ${error.message}`);
        } else {
          log.error(`Failed to read archive ${archive.archivePath}`, error);
        }

        registry.archives.delete(archive.rootKey);
        registry.fireChanged(archive, 'removed');

        return false;
      }
    },

    async loadArchiveOf(node) {
      const archive = node.archive;

      if (!archive || archive.isLoaded) {
        return;
      }

      // Counted so the background reads wait rather than compete for the thread
      awaitedLoads += 1;

      try {
        if (await registry.readArchive(archive)) {
          // The row had nothing to say about its content until now
          registry.fireChanged(archive, 'changed', true);
        }
      } finally {
        awaitedLoads -= 1;
      }
    },

    startBackgroundLoading() {
      backgroundLoading ??= loadRemaining().finally(() => {
        backgroundLoading = undefined;
      });
    },

    async getFileContent(node) {
      return node.archive?.readEntry(node.entryPath);
    },

    getFileSize(node) {
      const entry = getEntryForNode(node);

      if (!entry) {
        return 0;
      }

      return entry.pendingData?.length ?? entry.size;
    },

    getDirectoryContent(directory) {
      const files = getFileNodes(directory).map((node) =>
        getRelativeEntryPath(directory, node),
      );
      const directories = new Set<string>();

      for (const file of files) {
        const segments = file.split('/');

        for (let depth = 1; depth < segments.length; depth += 1) {
          directories.add(segments.slice(0, depth).join('/'));
        }
      }

      return { files, directories: Array.from(directories) };
    },

    async readFiles(items, onFile) {
      for (const [archive, group] of registry.groupByArchive(
        items.map((item) => item.node),
      )) {
        const groupItems = items.filter((item) => group.includes(item.node));

        await archive.readFileNodes(groupItems, onFile);
      }
    },

    groupByArchive(nodes) {
      const grouped = new Map<Archive, VirtualNode[]>();

      for (const node of nodes) {
        if (isArchiveRoot(node)) {
          throw FileSystemError.NoPermissions('Archives cannot be changed');
        }

        const archive = registry.getArchiveOf(node);
        const group = grouped.get(archive) ?? [];

        group.push(node);
        grouped.set(archive, group);
      }

      return grouped;
    },
  };

  return registry;
};
