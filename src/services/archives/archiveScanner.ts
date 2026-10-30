import { workspace, window, EventEmitter, FileType, Uri } from 'vscode';
import type { Disposable, Event, LogOutputChannel } from 'vscode';
import { BIG_PATTERN } from '../../constants';
import { NotAnArchiveError } from '../../formats/big/bigFormat';
import { delay } from '../../core/delay';
import { Archive } from './archive';
import { createSources, findSourceFor, getPathInSource } from './archiveSource';
import { findArchives } from '../../node/installScan';
import { onDidChangeSetting, settings } from '../../platform/settings';
import type { ArchiveDiscovery, ArchiveRegistry } from './archiveRegistry';

/**
 * Finds the archives of the workspace and the base game folders on disk and
 * follows them there, filling the registry it is given
 */
export interface ArchiveScanner extends ArchiveDiscovery, Disposable {
  /** Fires when a scan has found the archives again, which can add or drop any */
  readonly onDidScan: Event<void>;
  /**
   * Finds the archives again, after the workspace folders changed. An archive
   * that is still there keeps its instance, so the tree the view holds and the
   * directories that live only in it survive the rescan.
   */
  scanWorkspace(): Promise<void>;
}

/** How long a file that failed to read is left before it is read again */
const RETRY_DELAY = 1500;

const isFile = async (uri: Uri): Promise<boolean> => {
  try {
    const { type } = await workspace.fs.stat(uri);

    return type === FileType.File;
  } catch {
    return false;
  }
};

/**
 * Creates the scanner, starting the first scan and the watchers straight
 * away, so the registry can be asked for roots as soon as it exists. Nothing
 * is read here: the scan only lists the files that carry the extension.
 */
export const createArchiveScanner = (
  registry: ArchiveRegistry,
  log: LogOutputChannel,
  readAhead: boolean,
): ArchiveScanner => {
  const onDidScan = new EventEmitter<void>();

  // Counts the scans started, so one that a newer scan overtook adds nothing
  let scanGeneration = 0;

  // The scan in flight, replaced by each rescan and awaited by `whenReady`
  let currentScan: Promise<void>;

  // Archive paths that failed to read and were given their one retry
  const retried = new Set<string>();

  // Brings an archive up to date after the watcher saw its file appear or
  // change, taking on one that was created inside a source. A write the
  // extension made itself reloads nothing and fires no change.
  const reloadArchive = async (uri: Uri): Promise<void> => {
    const archivePath = uri.fsPath;
    const loaded = registry.getArchiveByPath(archivePath);

    if (!loaded && !(await isFile(uri))) {
      return; // a directory can carry the extension too
    }

    try {
      if (loaded) {
        if (await loaded.reload()) {
          registry.fireChanged(loaded, 'changed');
        }

        return;
      }

      const source = findSourceFor(registry.sources, uri);

      if (!source) {
        return; // outside every source, so not ours to show
      }

      const archive = Archive.create(
        archivePath,
        source.id,
        getPathInSource(source, uri),
      );

      registry.archives.set(archive.rootKey, archive);

      registry.fireChanged(archive, 'added');
    } catch (error) {
      log.error(`Failed to reload archive ${archivePath}`, error);
    }
  };

  // A file the watcher saw change: worth another retry if it fails again
  const reported = (uri: Uri): Promise<void> => {
    retried.delete(uri.fsPath);
    return reloadArchive(uri);
  };

  // Drops an archive whose file is gone, which changes the set of roots
  const forgetArchive = (uri: Uri): void => {
    const archive = registry.getArchiveByPath(uri.fsPath);

    if (!archive) {
      return;
    }

    registry.archives.delete(archive.rootKey);

    registry.fireChanged(archive, 'removed');
  };

  // Follows the archives on disk, so edits made outside the editor show up
  const watchArchives = (): Disposable => {
    const watcher = workspace.createFileSystemWatcher(BIG_PATTERN);

    watcher.onDidChange((uri) => reported(uri));
    watcher.onDidCreate((uri) => reported(uri));
    watcher.onDidDelete((uri) => forgetArchive(uri));

    return watcher;
  };

  // Rebuilds the sources and the archives from what is on disk, and starts the
  // read ahead. Reports how many candidates could not be read, counting a file
  // that is not an archive at all as one to ignore rather than one that failed.
  const runScan = async (): Promise<void> => {
    const generation = (scanGeneration += 1);
    const sources = await createSources();

    if (generation !== scanGeneration) {
      return; // a newer scan has started and will say what is there
    }

    if (!sources.length) {
      registry.sources = sources;
      registry.archives = new Map<string, Archive>();

      return;
    }

    // The scan fills a map of its own and swaps it in when done, so a save
    // that arrives meanwhile still finds the archives it writes to
    const loaded = registry.archives;
    const found = new Map<string, Archive>();

    registry.sources = sources;

    const archiveUris = [
      ...(await workspace.findFiles(BIG_PATTERN)),
      ...(
        await Promise.all(
          sources
            .filter((source) => source.external)
            .map((source) =>
              findArchives(source.baseUri.fsPath).catch(() => []),
            ),
        )
      )
        .flat()
        .map((archivePath) => Uri.file(archivePath)),
    ];

    const results = await Promise.allSettled(
      archiveUris.map(async (uri) => {
        const source = findSourceFor(sources, uri);

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
        found.set(archive.rootKey, archive);
      }),
    );

    if (generation !== scanGeneration) {
      return;
    }

    registry.archives = found;

    const failed = results.filter((result) => result.status === 'rejected');

    // A file that is not an archive at all is not a failure worth reporting
    const unreadable = failed.filter(
      (result) => !(result.reason instanceof NotAnArchiveError),
    );

    failed.forEach((result) => {
      if (result.reason instanceof NotAnArchiveError) {
        log.info(
          `Ignoring a file that is not an archive: ${result.reason.message}`,
        );
      } else {
        log.error('Failed to read archive', result.reason);
      }
    });

    if (unreadable.length) {
      window.showWarningMessage(
        `${unreadable.length} of ${archiveUris.length} BIG archives could not be read.`,
      );
    }

    if (readAhead) {
      registry.startBackgroundLoading();
    }
  };

  const scanner: ArchiveScanner = {
    onDidScan: onDidScan.event,

    scanWorkspace() {
      currentScan = runScan().finally(() => onDidScan.fire());

      return currentScan;
    },

    whenReady() {
      return currentScan;
    },

    async discover(uri) {
      const [sourceId, ...segments] = uri.path.split('/').filter(Boolean);
      const source = registry.sources.find((each) => each.id === sourceId);

      if (!source) {
        return;
      }
      for (let count = 1; count <= segments.length; count++) {
        if (!/\.big$/i.test(segments[count - 1])) {
          continue;
        }

        const candidate = Uri.joinPath(
          source.baseUri,
          ...segments.slice(0, count),
        );

        if (
          !registry.getArchiveByPath(candidate.fsPath) &&
          (await isFile(candidate))
        ) {
          await reloadArchive(candidate);
        }
        return;
      }
    },

    retryLater(archivePath) {
      if (retried.has(archivePath)) {
        return;
      }
      retried.add(archivePath);
      void delay(RETRY_DELAY).then(() => {
        if (!registry.isDisposed && !registry.getArchiveByPath(archivePath)) {
          return reloadArchive(Uri.file(archivePath));
        }
      });
    },

    dispose() {
      archiveWatcher.dispose();
      sourceWatchers.forEach((watcher) => watcher.dispose());
    },
  };

  void scanner.scanWorkspace();

  // Follows the archives on disk for the life of the scanner
  const archiveWatcher = watchArchives();

  // Follows the workspace folders and the base game settings, which decide what a scan finds
  const sourceWatchers: Disposable[] = [
    workspace.onDidChangeWorkspaceFolders(() => {
      void scanner.scanWorkspace();
    }),
    onDidChangeSetting(
      [settings.baseGameFolder, settings.underlyingGameFolder],
      () => {
        void scanner.scanWorkspace();
      },
    ),
  ];

  return scanner;
};
