import { FileSystemError, FileType } from 'vscode';
import type { LogOutputChannel, Uri } from 'vscode';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { isContainedPath, isPathBelow } from '../../core/paths';
import { findConflicts, planTransfer } from '../../core/transferPlan';
import type { ConflictChoice, TransferItem } from '../../core/transferPlan';
import type { Archive, EntryChange, EntrySource } from './archive';
import type { ArchivePolicy } from './archivePolicy';
import type { ArchiveRegistry } from './archiveRegistry';
import {
  findBlockingFile,
  getFileNodes,
  getRelativeEntryPath,
  isArchiveRoot,
} from './virtualNode';
import { getNodePath } from './nodeAddress';
import type { VirtualNode } from './virtualNode';

/**
 * A file on its way into an archive. A file that lives on disk is copied in
 * while the archive is written, so its content never sits in memory.
 */
export interface ImportedFile {
  name: string;
  size: number;
  /** The file on disk to copy in; `content` is written when this is unset */
  sourcePath?: string;
  content?: Uint8Array;
}

/**
 * What a transfer did: the files that landed in the target, and how many of
 * them left their source, which a read-only source never lets go of
 */
export interface TransferResult {
  transferred: number;
  removed: number;
}

/**
 * The part of the registry operations read: where a uri or node points, and
 * the content a transfer carries over
 */
export type ArchiveLookup = Pick<
  ArchiveRegistry,
  | 'fireChanged'
  | 'getArchiveContext'
  | 'getArchiveOf'
  | 'getNode'
  | 'groupByArchive'
  | 'getDirectoryContent'
  | 'readFiles'
>;

/**
 * The mutations of the archive model. Each one ends in a single apply per
 * archive, which asks the archive policy first, so no write reaches an
 * archive of a read-only source.
 */
export interface ArchiveOperations {
  /**
   * Writes an entry, creating it when the archive holds none at that path.
   * The whole archive is rewritten, since changing one entry shifts every
   * offset after it.
   */
  writeFile(uri: Uri, content: Uint8Array): Promise<void>;
  /**
   * Writes several entries, creating those the archives hold none of. Each
   * archive is rewritten once however many of its entries change, so the
   * whole set lands as one save per archive.
   */
  writeFiles(
    files: readonly { uri: Uri; content: Uint8Array }[],
  ): Promise<void>;
  /**
   * Creates a directory. Nothing is written to the archive, which stores file
   * paths and knows no directories of its own.
   */
  createDirectory(uri: Uri): Promise<void>;
  /** Deletes a file, or a directory with everything below it */
  delete(uri: Uri): Promise<void>;
  /** Deletes nodes, which may span several archives */
  deleteNodes(nodes: readonly VirtualNode[]): Promise<void>;
  /** Renames or moves a node, keeping everything below it */
  rename(oldUri: Uri, newUri: Uri): Promise<void>;
  /** Moves nodes into a directory under their own names */
  moveNodes(
    sources: readonly VirtualNode[],
    targetDirectory: VirtualNode,
  ): Promise<void>;
  /** Copies nodes into a directory under the names they are given */
  copyNodes(
    copies: readonly { source: VirtualNode; targetName: string }[],
    targetDirectory: VirtualNode,
  ): Promise<void>;
  /**
   * Adds imported files to a directory under the names they carry, as one
   * change to the archive however many files there are
   */
  addFiles(
    targetDirectory: VirtualNode,
    files: readonly ImportedFile[],
  ): Promise<void>;
  /**
   * Copies the files below nodes, of any archives, into a directory, and
   * removes them from where they came from when `move` is set. The target
   * archive is written once however many files and sources there are, and a
   * source archive once for what leaves it. Sources in a read-only archive
   * are only ever copied. The names the target already holds go to `choose`,
   * which answers what to do with them, or undefined to cancel.
   */
  transferNodes(
    sources: readonly VirtualNode[],
    targetDirectory: VirtualNode,
    move: boolean,
    choose: (names: string[]) => Promise<ConflictChoice | undefined>,
  ): Promise<TransferResult>;
}

/** Files above this size are staged on disk during a transfer rather than held in memory */
const STAGE_LIMIT = 8 * 1024 * 1024;

const joinEntryPath = (directoryPath: string, name: string): string =>
  directoryPath ? `${directoryPath}/${name}` : name;

const toEntrySource = (file: ImportedFile): EntrySource =>
  file.sourcePath
    ? { kind: 'file', path: file.sourcePath, size: file.size }
    : { kind: 'data', content: file.content ?? new Uint8Array() };

/**
 * Rejects a path that would escape the archive when extracted, or whose
 * parents run through an existing file
 */
const ensureWritablePath = (archive: Archive, entryPath: string): void => {
  if (!isContainedPath(entryPath)) {
    throw FileSystemError.NoPermissions(`Invalid entry path: ${entryPath}`);
  }

  const blockingFile = findBlockingFile(archive.root, entryPath);

  if (blockingFile) {
    throw FileSystemError.FileNotADirectory(getNodePath(blockingFile));
  }
};

/** Rejects a move to a path that would escape the archive, or of a directory into itself */
const ensureMovable = (from: string, to: string): void => {
  if (!isContainedPath(to)) {
    throw FileSystemError.NoPermissions(`Invalid entry path: ${to}`);
  }

  const fromKey = from.toLowerCase();
  const toKey = to.toLowerCase();

  // Equal paths are a rename that only changes the casing, not a move
  if (toKey !== fromKey && isPathBelow(toKey, fromKey)) {
    throw FileSystemError.NoPermissions('Cannot move an entry into itself');
  }
};

/** Creates the operations that turn a request into changes to archives */
export const createArchiveOperations = (
  lookup: ArchiveLookup,
  policy: ArchivePolicy,
  log: LogOutputChannel,
): ArchiveOperations => {
  // Carries out changes against one archive: the single place that applies a
  // mutation, reports a failure and tells the view about it, so an operation
  // only has to say what changes.
  const apply = async (
    archive: Archive,
    changes: readonly EntryChange[],
  ): Promise<void> => {
    policy.ensureWritable(archive.sourceId);

    try {
      await archive.applyChanges(changes);
    } catch (error) {
      log.error(`Failed to save archive ${archive.archivePath}`, error);
      throw error;
    }

    lookup.fireChanged(archive, 'changed');
  };

  const operations: ArchiveOperations = {
    async writeFile(uri, content) {
      const { archive, entryPath } = lookup.getArchiveContext(uri);

      if (!entryPath) {
        throw FileSystemError.NoPermissions('Cannot write to the archive root');
      }

      if (lookup.getNode(uri)?.type === FileType.Directory) {
        throw FileSystemError.FileIsADirectory(uri);
      }

      ensureWritablePath(archive, entryPath);

      await apply(archive, [
        { kind: 'put', path: entryPath, source: { kind: 'data', content } },
      ]);
    },

    async writeFiles(files) {
      const byArchive = new Map<Archive, EntryChange[]>();

      for (const { uri, content } of files) {
        const { archive, entryPath } = lookup.getArchiveContext(uri);

        if (!entryPath) {
          throw FileSystemError.NoPermissions(
            'Cannot write to the archive root',
          );
        }

        ensureWritablePath(archive, entryPath);
        byArchive.set(archive, [
          ...(byArchive.get(archive) ?? []),
          { kind: 'put', path: entryPath, source: { kind: 'data', content } },
        ]);
      }
      for (const [archive, changes] of byArchive) {
        await apply(archive, changes);
      }
    },

    async createDirectory(uri) {
      const { archive, entryPath } = lookup.getArchiveContext(uri);

      if (!entryPath) {
        throw FileSystemError.NoPermissions('Cannot create the archive root');
      }

      ensureWritablePath(archive, entryPath);

      await apply(archive, [{ kind: 'addDirectory', path: entryPath }]);
    },

    async delete(uri) {
      const node = lookup.getNode(uri);

      if (!node) {
        throw FileSystemError.FileNotFound(uri);
      }

      await operations.deleteNodes([node]);
    },

    async deleteNodes(nodes) {
      for (const [archive, group] of lookup.groupByArchive(nodes)) {
        await apply(
          archive,
          group.map((node) => ({
            kind: 'remove' as const,
            path: node.entryPath,
          })),
        );
      }
    },

    async rename(oldUri, newUri) {
      const source = lookup.getArchiveContext(oldUri);
      const target = lookup.getArchiveContext(newUri);

      if (source.archive !== target.archive) {
        throw FileSystemError.NoPermissions('Cannot move between archives');
      }

      if (!source.entryPath || !target.entryPath) {
        throw FileSystemError.NoPermissions('Cannot move the archive itself');
      }

      ensureMovable(source.entryPath, target.entryPath);

      await apply(source.archive, [
        { kind: 'move', from: source.entryPath, to: target.entryPath },
      ]);
    },

    async moveNodes(sources, targetDirectory) {
      const archive = lookup.getArchiveOf(targetDirectory);
      const targetPath = targetDirectory.entryPath;

      const changes = sources.map((source) => {
        const from = source.entryPath;
        const to = joinEntryPath(targetPath, source.name);

        ensureMovable(from, to);

        return { kind: 'move' as const, from, to };
      });

      await apply(archive, changes);
    },

    async copyNodes(copies, targetDirectory) {
      const archive = lookup.getArchiveOf(targetDirectory);
      const targetPath = targetDirectory.entryPath;

      const changes = copies.map(({ source, targetName }) => ({
        kind: 'copy' as const,
        from: source.entryPath,
        to: joinEntryPath(targetPath, targetName),
      }));

      await apply(archive, changes);
    },

    async addFiles(targetDirectory, files) {
      const archive = lookup.getArchiveOf(targetDirectory);
      const targetPath = targetDirectory.entryPath;

      const changes = files.map((file) => {
        const entryPath = joinEntryPath(targetPath, file.name);

        ensureWritablePath(archive, entryPath);

        return {
          kind: 'put' as const,
          path: entryPath,
          source: toEntrySource(file),
        };
      });

      await apply(archive, changes);
    },

    async transferNodes(sources, targetDirectory, move, choose) {
      const archive = lookup.getArchiveOf(targetDirectory);
      const files: (TransferItem & { node: VirtualNode })[] = [];

      for (const source of sources) {
        if (isArchiveRoot(source)) {
          continue; // an archive is a file on disk, not an entry to carry over
        }

        for (const node of getFileNodes(source)) {
          files.push({
            node,
            path:
              node === source
                ? source.name
                : `${source.name}/${getRelativeEntryPath(source, node)}`,
          });
        }
      }

      const content = lookup.getDirectoryContent(targetDirectory);
      const conflicts = findConflicts(files, content);
      let choice: ConflictChoice = 'replace';

      if (conflicts.length) {
        const answer = await choose(conflicts.map((conflict) => conflict.path));

        if (!answer) {
          return { transferred: 0, removed: 0 };
        }

        choice = answer;
      }

      const plan = planTransfer(files, content, choice);

      if (!plan.length) {
        return { transferred: 0, removed: 0 };
      }

      const targetPath = targetDirectory.entryPath;
      const entryPaths = plan.map((planned) =>
        joinEntryPath(targetPath, planned.targetPath),
      );

      for (const entryPath of entryPaths) {
        ensureWritablePath(archive, entryPath);
      }

      const staging = await mkdtemp(path.join(tmpdir(), 'bigfs-transfer-'));

      try {
        const sourcesOfPut = new Map<string, EntrySource>();
        let staged = 0;

        await lookup.readFiles(
          plan.map((planned, index) => ({ node: planned.item.node, index })),
          async ({ index }, bytes) => {
            if (bytes.length <= STAGE_LIMIT) {
              sourcesOfPut.set(entryPaths[index], {
                kind: 'data',
                content: bytes,
              });
              return;
            }

            const file = path.join(staging, String(staged++));

            await writeFile(file, bytes);
            sourcesOfPut.set(entryPaths[index], {
              kind: 'file',
              path: file,
              size: bytes.length,
            });
          },
        );

        const changes: EntryChange[] = entryPaths.map((entryPath) => ({
          kind: 'put',
          path: entryPath,
          source: sourcesOfPut.get(entryPath) as EntrySource,
        }));

        const removals = new Map<Archive, EntryChange[]>();

        for (const { item } of move ? plan : []) {
          const origin = item.node.archive;

          if (policy.isReadOnly(origin.sourceId)) {
            continue;
          }

          const group = removals.get(origin) ?? [];

          group.push({ kind: 'remove', path: item.node.entryPath });
          removals.set(origin, group);
        }

        // The copies are written first, so a failure never loses a file
        await apply(archive, [...changes, ...(removals.get(archive) ?? [])]);

        for (const [origin, group] of removals) {
          if (origin !== archive) {
            await apply(origin, group);
          }
        }

        return {
          transferred: plan.length,
          removed: Array.from(removals.values()).reduce(
            (total, group) => total + group.length,
            0,
          ),
        };
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
    },
  };

  return operations;
};
